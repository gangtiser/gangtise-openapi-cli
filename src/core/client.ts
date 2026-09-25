import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { FormData, request } from "undici"

import type { CliConfig } from "./config.js"
import { credentialFingerprint, isTokenCacheValid, normalizeToken, readTokenCache, requireAccessCredentials, writeTokenCache, type TokenCache } from "./auth.js"
import { ApiError, attachEnvelopeTraceId, markStructural, ValidationError } from "./errors.js"
import { ENDPOINTS, type EndpointDefinition, resolveTimeoutMs } from "./endpoints.js"
import { getLookupData } from "./lookupData/index.js"
import { stagingPath } from "./output.js"
import { decodeResponseBody, getDispatcher, isVerbose, logTiming, markRetryable, PAGE_CONCURRENCY, parseRetryAfterMs, quoteBigIntFields, runInOrder, withRetry } from "./transport.js"
import { attachRowSink, type ExportSink } from "./rowSink.js"
import type { DownloadResult } from "./download.js"
import { markIncomplete } from "./exitStatus.js"

interface Envelope<T> {
  code?: string | number
  msg?: string
  status?: boolean
  success?: boolean
  data?: T
  /** Server-side correlation id, added by the 2026-07-17 envelope. */
  traceId?: string | number
}
// Auth errors that warrant a forced re-login + one replay: the token was rejected
// server-side while still looking valid by local expiry, so only a forced refresh
// recovers it. 0000001008 is the legacy code (probed 2026-09-12: still what the
// token filter emits); 999002 TOKEN_INVALID is its 2026-07-17 replacement, listed
// ahead of the rollout so self-heal does not silently die when the filter switches.
// 8000014/8000015 are the retired AK/SK codes, kept for older server builds.
// 999011 CREDENTIAL_INVALID is not here and could not act if it were — it comes from
// auth.login, which runs useAuth=false and so never reaches this check. Its "never
// replay" guarantee lives in transport's TERMINAL_API_CODES instead.
const AUTH_RETRY_CODES = new Set(["8000014", "8000015", "0000001008", "999002"])

/** The payload shape an endpoint promises (see `EndpointDefinition.expects`). */
function hasExpectedShape(expects: "list" | "array", payload: unknown): boolean {
  if (expects === "array") return Array.isArray(payload)
  return Boolean(payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).list))
}

/** Credits above which a --size-less fetch of a per-row billed list is refused once its
 * total is known (see `billing` in endpoints.ts). Omitting --size means "everything", and on
 * a list priced per row everything can be tens of thousands of credits from one missing flag. */
export const COSTLY_FETCH_CREDITS = 1000
/** A guarded list whose full first page would cost more than this learns its total from a
 * one-row probe first, so a refused fetch pays for one row rather than a page. */
const PROBE_ABOVE_CREDITS = 50

/** How a list endpoint refuses an offset past its window: 140002 (at HTTP 500) on the vault
 * message list (probed 2026-09-25), 100006 on the insight lists that declare `maxWindow`. A
 * total-cap probe answered with one of these sat on a window; any other failure (a 503 that
 * outlived its retries, a dropped connection) says nothing about the total, so it stays silent. */
const OFFSET_REFUSAL_CODES = new Set(["140002", "100006"])

/** Several lists answer "nothing matched" with `list: null` instead of [] — hot-topic, summary,
 * the A-share and HK announcement lists, performance-calendar (probed 2026-09-25, server
 * P2-27). A numeric total of exactly 0 says what an empty list would, so it is read as one;
 * a null list under any other total, a string total or a missing list is still a broken
 * page and takes the unexpected-shape path. */
function readEmptyListAsArray(page: unknown): void {
  const rec = page as Record<string, unknown> | null
  if (rec && typeof rec === "object" && rec.total === 0 && rec.list === null) rec.list = []
}

/** A fetch-all whose `total` is, or may be, a server-side cap: warn, and mark the result so a
 * truncated export cannot pass as complete (partial → exit 3). */
function markTotalCapped(out: Record<string, unknown>, why: string, collected: number, keepBelow: number): void {
  process.stderr.write(`[gangtise] warning: ${why}. This export is TRUNCATED at ${collected} rows. Narrow the query (e.g. a shorter time range) until total stays below ${keepBelow}, and fetch in slices.\n`)
  out.partial = true
  out.totalCapped = true
}

export class GangtiseClient {
  /** The caller confirmed (--yes) a --size-less fetch past COSTLY_FETCH_CREDITS. */
  allowCostlyFetch = false

  private refreshPromise: Promise<string> | null = null
  private memoCache: TokenCache | null = null
  // After an injected env token (GANGTISE_TOKEN) is rejected and we self-heal via
  // login, stop preferring that now-stale token so the retry uses the fresh one.
  private envTokenInvalidated = false

  /** The sink a large jsonl export streams into, if the command opened one. The first
   * fetch-all / sharded / per-security producer claims it; a later call in the same
   * command collects in memory as usual (see ExportSink). */
  private rowSinkClaimed = false

  constructor(private readonly config: CliConfig, readonly rowSink?: ExportSink) {}

  claimRowSink(): ExportSink | undefined {
    if (!this.rowSink || this.rowSinkClaimed) return undefined
    this.rowSinkClaimed = true
    return this.rowSink
  }

  private async getAuthorizationHeader(forceRefresh = false): Promise<string> {
    if (this.config.token && !this.envTokenInvalidated && !forceRefresh) {
      return normalizeToken(this.config.token)
    }

    if (!forceRefresh) {
      // `undefined` when no accessKey is configured: nothing to compare against, and
      // without credentials there is no second account this cache could belong to.
      const expected = this.config.accessKey ? credentialFingerprint(this.config.accessKey, this.config.baseUrl) : undefined
      if (isTokenCacheValid(this.memoCache, undefined, expected)) {
        return normalizeToken(this.memoCache!.accessToken)
      }
      const cache = await readTokenCache(this.config.tokenCachePath)
      if (isTokenCacheValid(cache, undefined, expected)) {
        this.memoCache = cache
        return normalizeToken(cache!.accessToken)
      }
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.doTokenRefresh().finally(() => { this.refreshPromise = null })
    }
    return this.refreshPromise
  }

  private async doTokenRefresh(): Promise<string> {
    const credentials = requireAccessCredentials(this.config.accessKey, this.config.secretKey)

    const envelope = await this.requestJson<{
      accessToken: string
      expiresIn: number
      uid?: number
      userName?: string
      tenantId?: number
      time: number
    }>(ENDPOINTS["auth.login"], {
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
    }, false)

    // Validate the shape before touching it: a missing accessToken used to surface
    // as a bare TypeError from normalizeToken, hiding the real cause.
    if (typeof envelope?.accessToken !== "string" || !envelope.accessToken) {
      throw new ApiError("Login succeeded but the response carried no accessToken", undefined, undefined, envelope)
    }
    const accessToken = normalizeToken(envelope.accessToken)
    // A non-numeric expiresIn would make expiresAt NaN — the cache would never
    // validate and every command would silently re-login. Degrade to 0 instead
    // (token works now, next process logs in again).
    const expiresIn = Number.isFinite(envelope.expiresIn) ? envelope.expiresIn : 0
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn

    const cache: TokenCache = {
      ...envelope,
      accessToken,
      expiresIn,
      expiresAt,
      issuedFor: credentialFingerprint(credentials.accessKey, this.config.baseUrl),
    }
    this.memoCache = cache
    try {
      await writeTokenCache(this.config.tokenCachePath, cache)
    } catch (error) {
      // A read-only HOME or full disk must not fail the request — the in-memory
      // token is valid; we just can't persist it for the next process.
      const msg = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[gangtise] warning: could not persist token cache: ${msg}\n`)
    }

    return accessToken
  }

  /**
   * On a recoverable auth error (expired/invalid token codes), force a one-time
   * token refresh and re-throw as retryable so withRetry replays the request.
   * Otherwise — or once we've already retried this request — it's a no-op and
   * the caller re-throws the original error. `authState` persists across the
   * withRetry attempts so we only refresh once per logical request.
   */
  private async refreshAuthIfRecoverable(error: unknown, useAuth: boolean, authState: { retried: boolean }, usedAuthorization?: string): Promise<void> {
    if (
      useAuth
      && !authState.retried
      && error instanceof ApiError
      && error.code
      && AUTH_RETRY_CODES.has(error.code)
      && this.config.accessKey
      && this.config.secretKey
    ) {
      authState.retried = true
      this.envTokenInvalidated = true
      // If the failed request was still carrying an OLDER token than the one now in
      // memoCache, another request already refreshed — replay with the fresh token
      // instead of logging in again (back-to-back logins can kick each other's
      // sessions server-side, the 0000001008 semantics). If the failed request used
      // the CURRENT token, that token is genuinely dead: force a new login. A time
      // window is NOT a valid proxy here — right after the initial login the window
      // is always "recent", which would skip the refresh exactly when it's needed.
      const memoToken = this.memoCache && isTokenCacheValid(this.memoCache) ? normalizeToken(this.memoCache.accessToken) : null
      const alreadyRefreshed = memoToken !== null && usedAuthorization !== undefined && usedAuthorization !== memoToken
      if (!alreadyRefreshed) {
        this.memoCache = null
        await this.getAuthorizationHeader(true)
      }
      throw markRetryable(new ApiError(error.message, error.code, error.statusCode, error.details))
    }
  }

  /** `new URL("/a/b", "https://proxy/prefix")` drops "/prefix" — an absolute path
   * replaces the base's path per the URL spec. Join manually so a reverse-proxy
   * GANGTISE_BASE_URL with a path prefix keeps working. */
  private buildUrl(path: string): URL {
    const base = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`
    return new URL(path.replace(/^\//, ""), base)
  }

  private isEnvelope<T>(parsed: unknown): parsed is Envelope<T> {
    if (!parsed || typeof parsed !== 'object') return false
    const obj = parsed as Record<string, unknown>
    if (!('code' in obj)) return false
    return 'msg' in obj || 'data' in obj || 'success' in obj || 'status' in obj
  }

  private throwHttpError(parsed: unknown, statusCode: number, retryAfterMs?: number): never {
    if (this.isEnvelope(parsed)) {
      const code = parsed.code === undefined ? undefined : String(parsed.code)
      throw new ApiError(parsed.msg || `API request failed (HTTP ${statusCode})`, code, statusCode, parsed, retryAfterMs)
    }

    throw new ApiError(`API request failed (HTTP ${statusCode})`, undefined, statusCode, parsed, retryAfterMs)
  }

  private unwrapEnvelope<T>(parsed: Envelope<T>, statusCode?: number, retryAfterMs?: number): T {
    if (!this.isEnvelope<T>(parsed)) {
      return parsed as T
    }

    const code = parsed.code === undefined ? undefined : String(parsed.code)
    const ok = parsed.status === true || parsed.success === true || code === "000000" || code === "0"

    if (!ok) {
      throw new ApiError(parsed.msg || "API request failed", code, statusCode, parsed, retryAfterMs)
    }

    if ('data' in parsed) {
      // Carry the envelope's traceId onto the payload: the EDE endpoints wrap a
      // second envelope inside `data` and raise their own failures from it, by
      // which point this is the only traceId in reach.
      return attachEnvelopeTraceId(parsed.data, parsed.traceId) as T
    }

    return parsed as T
  }

  private async readLocalLookup(endpoint: EndpointDefinition) {
    const keyMapping: Record<string, Parameters<typeof getLookupData>[0]> = {
      "lookup.broker-orgs.list": "broker-orgs",
      "lookup.meeting-orgs.list": "meeting-orgs",
    }

    const lookupKey = keyMapping[endpoint.key]
    if (lookupKey) {
      return getLookupData(lookupKey)
    }

    throw new ApiError(`Unsupported local lookup endpoint: ${endpoint.key}`)
  }

  private isPaginatedListResponse(value: unknown): value is Record<string, unknown> & { total: number; list: unknown[] } {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof (value as { total?: unknown }).total === 'number'
      && Array.isArray((value as { list?: unknown[] }).list),
    )
  }

  private async requestPaginated(endpoint: EndpointDefinition, body?: unknown) {
    const initialBody = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {}

    if ('from' in initialBody && (typeof initialBody.from !== 'number' || !Number.isFinite(initialBody.from) || initialBody.from < 0)) {
      throw new ValidationError('Invalid from: expected a non-negative number')
    }
    if ('size' in initialBody && initialBody.size !== undefined && (typeof initialBody.size !== 'number' || !Number.isFinite(initialBody.size) || initialBody.size <= 0)) {
      throw new ValidationError('Invalid size: expected a positive number')
    }

    const startFrom = typeof initialBody.from === 'number' && Number.isFinite(initialBody.from) ? initialBody.from : 0
    const requestedSize = typeof initialBody.size === 'number' && Number.isFinite(initialBody.size) ? initialBody.size : undefined
    const maxPageSize = endpoint.pagination?.maxPageSize ?? requestedSize ?? 20
    // Rows past the offset window are unreachable (the server rejects the page), so no
    // page is planned across it — a page straddling it would fail the whole tail.
    const maxWindow = endpoint.pagination?.maxWindow
    if (maxWindow !== undefined && startFrom >= maxWindow) {
      throw new ValidationError(`${endpoint.key} serves rows only up to offset ${maxWindow} (from + size ≤ ${maxWindow}); --from ${startFrom} is past it. Narrow the query (e.g. a shorter time range) instead of paging deeper.`)
    }
    const windowRoom = maxWindow === undefined ? Infinity : maxWindow - startFrom

    // A per-row billed list fetched without --size is priced from `total` before the fetch
    // fans out, and refused past COSTLY_FETCH_CREDITS. A cheap list learns `total` from its
    // first page. Where a full first page would itself cost more than PROBE_ABOVE_CREDITS,
    // one row is asked for first, so a refused fetch pays for that row alone; the fetch then
    // starts over from the same offset at the usual page size, keeping every page on the
    // usual boundaries (the probe row is billed twice) rather than depending on how an
    // endpoint reads an unaligned `from`.
    const billing = endpoint.billing
    const guarded = requestedSize === undefined && billing?.per === "row" && !this.allowCostlyFetch
    const refuseIfCostly = (reportedTotal: number, fetched: number): void => {
      if (!guarded || !billing) return
      const rows = Math.min(Math.max(reportedTotal - startFrom, 0), windowRoom)
      const estimatedCredits = Math.round(rows * billing.price * 100) / 100
      if (estimatedCredits <= COSTLY_FETCH_CREDITS) return
      throw new ValidationError(`fetching all ${rows} rows of ${endpoint.key} would cost about ${estimatedCredits} credits (${billing.price} per row), above the ${COSTLY_FETCH_CREDITS}-credit guard for a fetch without --size. Only ${fetched} row(s) were fetched, to learn the total. Pass --size N for a bounded subset, or --yes to fetch them all.`)
    }
    // The probe stands in as the first page when it already answers the fetch: when its
    // shape is unexpected (reported below, without paying a full page to see it again) and
    // when it holds exactly the rows left to fetch (a result of one row or none; more rows
    // than `total` leaves contradicts itself, and the first page is fetched as usual).
    let probe: Record<string, unknown> | undefined
    let probed = false
    let probeRows = 0
    if (guarded && billing && Math.min(maxPageSize, windowRoom) * billing.price > PROBE_ABOVE_CREDITS) {
      probe = await this.requestJson<Record<string, unknown>>(endpoint, { ...initialBody, from: startFrom, size: 1 })
      readEmptyListAsArray(probe)
      if (!this.isPaginatedListResponse(probe)) {
        probed = true
      } else {
        refuseIfCostly(probe.total, probe.list.length)
        probeRows = probe.list.length
        probed = probe.list.length === Math.min(Math.max(probe.total - startFrom, 0), windowRoom)
      }
    }

    // First page: serial — we need total before deciding how many more requests to fan out.
    const firstPageSize = probed ? 1 : Math.min(requestedSize === undefined ? maxPageSize : Math.min(maxPageSize, requestedSize), windowRoom)
    const firstPage = probed ? probe as Record<string, unknown> : await this.requestJson<Record<string, unknown>>(endpoint, {
      ...initialBody,
      from: startFrom,
      size: firstPageSize,
    })

    readEmptyListAsArray(firstPage)
    if (!this.isPaginatedListResponse(firstPage)) {
      // Shape drift (e.g. total arriving as a string) silently degrades fetch-all
      // to a single page with no partial marker. This is NOT hypothetical: passing
      // industryList to insight foreign-opinion / independent-opinion makes the
      // server answer 200 + data:null, which then renders as one phantom row
      // ({"value":null} in jsonl, a blank row in table/markdown). Verbose-only was
      // the wrong bar — a caller who never sets GANGTISE_VERBOSE reads that row as
      // real data, so warn on stderr unconditionally.
      process.stderr.write(`[gangtise] warning: ${endpoint.key} is marked paginated but the first page has an unexpected shape (no numeric total + list); returning it as-is\n`)
      // A warning only helps a human. Scripts read the exit code, and without one they
      // cannot tell "this filter legitimately matched nothing" from "this filter is
      // broken". Reuse exit 3 (result is not what was asked for) rather than inventing a
      // fourth code — fetch-all silently degraded to one page either way.
      //
      // Applies to EVERY malformed shape, not just `null`: a string `total` truncates the
      // result to page 1, which looks complete and is therefore worse than an obviously
      // empty payload. Every paginated endpoint is a genuine {total, list} list (the
      // odd-shaped ones like reference.constant-list are not marked paginated), so there
      // is no legitimate response that lands here. Endpoints where `null` IS a valid
      // answer (ai.one-pager for a security with no generated content) are unpaginated
      // and never reach this branch.
      markIncomplete()
      return firstPage
    }

    const total = firstPage.total

    const available = Math.max(total - startFrom, 0)
    const wanted = requestedSize === undefined ? available : Math.min(requestedSize, available)
    const target = Math.min(wanted, windowRoom)
    // The total-cap probe asks for the row at offset `total`; past the window the server
    // rejects it outright, so it would only ever spend a request and learn nothing.
    const probeFits = maxWindow === undefined || total + 1 <= maxWindow
    // Rows the caller asked for that sit past the offset window: nothing can fetch them,
    // so the result is partial on every return path below, whatever else happens.
    const flagWindowCut = (out: Record<string, unknown>): void => {
      if (target >= wanted) return
      process.stderr.write(`[gangtise] warning: ${endpoint.key} serves rows only up to offset ${maxWindow} (from + size ≤ ${maxWindow}); ${wanted - target} of the ${wanted} requested rows lie past it and were not fetched. Narrow the query (e.g. a shorter time range) and fetch in slices.\n`)
      out.partial = true
    }

    // Rows either accumulate in `collected` or, for a large jsonl export, go straight out
    // through the sink in page order (ExportSink); `count` is the row count either way.
    // With `--size N` at most N rows are kept even if the server over-returns.
    const sink = this.claimRowSink()
    if (sink && Array.isArray(firstPage.fieldList)) sink.setFieldList(firstPage.fieldList)
    const collected: unknown[] = []
    let count = 0
    // A row already kept, seen again whole on a neighbouring page (see `rowId` in
    // endpoints.ts). Only the id and a digest are held per row, not the row itself.
    const rowId = endpoint.rowId
    const seen = rowId ? new Map<string, string>() : undefined
    let duplicateRows = 0
    // An id seen again with different content on a LATER page: a row that moved or
    // changed while paging, so its neighbours may have shifted too. Both versions are
    // kept. The same on ONE page — a single consistent response — means the id does not
    // identify a row on this list, and the count is then disregarded, as it is for an
    // id field not yet seen to be one (`rowIdUnverified`).
    let changedRows = 0
    let idIsRowKey = true
    const dropRepeats = (rows: unknown[]): unknown[] => {
      if (!seen || !rowId) return rows
      const onThisPage = new Set<string>()
      return rows.filter((row) => {
        const id = row && typeof row === "object" ? (row as Record<string, unknown>)[rowId] : undefined
        if (id === undefined || id === null) return true
        const digest = createHash("sha1").update(JSON.stringify(row)).digest("base64")
        const key = String(id)
        const previous = seen.get(key)
        const earlierOnThisPage = onThisPage.has(key)
        onThisPage.add(key)
        if (previous === undefined) {
          seen.set(key, digest)
          return true
        }
        if (previous !== digest) {
          if (earlierOnThisPage) idIsRowKey = false
          else changedRows++
          return true
        }
        duplicateRows++
        return false
      })
    }
    const keep = async (fetched: unknown[]): Promise<void> => {
      const rows = dropRepeats(fetched)
      const kept = requestedSize === undefined ? rows : rows.slice(0, Math.max(0, requestedSize - count))
      if (kept.length === 0) return
      count += kept.length
      if (sink) await sink.push(kept)
      else for (const row of kept) collected.push(row)
    }
    // A `total` that reaches the declared window cannot be probed: rows past it can be
    // neither fetched nor counted, so the result is treated as truncated, as when a probe
    // finds rows. (vault.wechat-message.list: the unfiltered total stops at 10000 while its
    // monthly totals add up to more — probed 2026-09-25.)
    const checkTotalCap = async (out: Record<string, unknown>): Promise<void> => {
      if (probeFits) return this.flagIfTotalCapped(endpoint, initialBody, total, out, count)
      markTotalCapped(out, `${endpoint.key} reported total=${total}, which equals its ${maxWindow}-row offset window: rows past it can be neither fetched nor counted`, count, maxWindow)
    }
    const result = (): Record<string, unknown> => {
      const out: Record<string, unknown> = { ...firstPage, total, list: collected }
      if (duplicateRows > 0) {
        // The count falls short by the same number, which every return path below already
        // marks partial; this names the cause, since "short page" alone points elsewhere.
        process.stderr.write(`[gangtise] warning: ${endpoint.key} returned ${duplicateRows} row(s) more than once — its sort order is not unique, so paging also missed as many rows. The duplicates were dropped and the result is partial. Re-run over a shorter time range to fetch the missing rows.\n`)
        out.duplicateRows = duplicateRows
        out.partial = true
      }
      if (changedRows > 0 && idIsRowKey && !endpoint.rowIdUnverified) {
        process.stderr.write(`[gangtise] warning: ${endpoint.key} returned ${changedRows} row(s) whose ${rowId} came back on a later page with different content — the list changed while it was being paged, so rows may also have been missed. Both versions were kept (deduplicating by ${rowId} keeps one) and the result is partial. Re-run to fetch a consistent result.\n`)
        out.changedRows = changedRows
        out.partial = true
      }
      return sink ? attachRowSink(out, sink) : out
    }
    await keep(firstPage.list)

    // Last page reached on first request. If `total` promises more rows than the
    // short page delivered, the server's page cap may be lower than our configured
    // maxPageSize — say so instead of silently returning a subset as "everything".
    if (firstPage.list.length < firstPageSize) {
      const out = result()
      flagWindowCut(out)
      if (count < target) {
        process.stderr.write(`[gangtise] warning: server returned a short page (${count} rows) but reported total=${total}; treating it as the end of data — results may be incomplete\n`)
        // Machine-readable counterpart of the warning: scripts key off partial /
        // exit code 3, and must not mistake a truncated result for a complete one.
        out.partial = true
      }
      return out
    }

    if (count >= target) {
      const out = result()
      flagWindowCut(out)
      // Same probe the fan-out path runs below: a fetch-all that starts inside the last
      // page (from=9950 against total=10000) is just as exposed to a capped `total`, and
      // used to return here without ever checking. `total > firstPageSize` keeps the
      // request count unchanged for a result that genuinely fits in one page from offset
      // 0 — only a late `from` can land here with a total larger than a page.
      if (requestedSize === undefined && total > firstPageSize && target === wanted) await checkTotalCap(out)
      return out
    }

    // A cheap guarded list reaches here with its first page in hand; the probe path has
    // already checked, and passes again unless `total` grew past the guard in between.
    refuseIfCostly(total, count + (probed ? 0 : probeRows))

    // Build remaining page requests. The cap lives inside the loop: a corrupt
    // server `total` (e.g. 9e15) must not materialize millions of page objects —
    // or spin for minutes — before a post-hoc truncation applies.
    const MAX_PAGES = 1000
    let truncatedByPageCap = false
    type PageReq = { from: number; size: number }
    const pageRequests: PageReq[] = []
    let nextFrom = startFrom + firstPage.list.length
    const endFrom = startFrom + target
    while (nextFrom < endFrom) {
      if (pageRequests.length + 1 >= MAX_PAGES) {
        truncatedByPageCap = true
        break
      }
      const remaining = endFrom - nextFrom
      const size = Math.min(maxPageSize, remaining)
      pageRequests.push({ from: nextFrom, size })
      nextFrom += size
    }

    let unexpectedShape = false
    let totalDrift = false
    let laterPartial = false
    // Fail-soft fan-out: a hard page failure (rate-limit 903301, no-perm, retries
    // exhausted) must NOT discard the pages already fetched. Catch per page, record
    // it, and stop starting new requests so we don't keep burning quota into a rate
    // limit. Mirrors quoteSharding's partial-result tolerance — but firstPage already
    // succeeded to get here, so unlike sharding there's no total-failure case.
    const failedPages: PageReq[] = []
    let firstError: unknown = null
    let aborted = false
    // Pages are kept in page order as they complete (runInOrder), so a streamed export
    // is written in the same order a collected one is returned. A page holds at most
    // maxPageSize rows, so a window of several pages per worker costs little memory and
    // keeps the other workers fetching while one page backs off or waits out a timeout.
    await runInOrder(pageRequests, PAGE_CONCURRENCY, async (req) => {
      if (aborted) {
        failedPages.push(req)
        return [] as unknown[]
      }
      try {
        const page = await this.requestJson<Record<string, unknown>>(endpoint, {
          ...initialBody,
          from: req.from,
          size: req.size,
        })
        // A later page that says total 0 is a total that drifted mid-fetch, not a broken page.
        readEmptyListAsArray(page)
        if (!this.isPaginatedListResponse(page)) {
          // Treat a shape-broken page like a failed page: its rows are missing, so
          // the result must carry the partial marker instead of looking complete.
          unexpectedShape = true
          failedPages.push(req)
          return [] as unknown[]
        }
        if (page.total !== total) totalDrift = true
        if (page.partial === true) laterPartial = true
        return page.list
      } catch (error) {
        if (!firstError) firstError = error
        aborted = true
        failedPages.push(req)
        return [] as unknown[]
      }
    }, (list) => keep(list), PAGE_CONCURRENCY * 4)

    if (unexpectedShape) {
      process.stderr.write(`[gangtise] warning: a page response had unexpected shape; its rows are missing (counted in failedPages)\n`)
    }
    if (totalDrift) {
      process.stderr.write(`[gangtise] warning: 'total' changed across pages (data shifted during fetch); rows may be duplicated or missing\n`)
    }
    // Always surface a cap-induced truncation (not gated on verbose): the user
    // asked for everything and is silently getting a subset, mirroring the
    // partial-result warning in quoteSharding.
    if (truncatedByPageCap) {
      process.stderr.write(`[gangtise] warning: hit the ${MAX_PAGES}-page safety cap; fetched ${count} of ${total} rows. Narrow the query (e.g. a shorter date range) or pass --size to fetch a bounded subset.\n`)
    }

    const short = count < target
    // Every row arrived and some were dropped as repeats: the fetch otherwise reached
    // `total`, so it is still checked against a capped total, and no page came back short.
    const shortByRepeatsOnly = short && count + duplicateRows >= target

    const out = result()
    flagWindowCut(out)
    // Only on a genuine fetch-all that otherwise looked complete — see flagIfTotalCapped.
    if (requestedSize === undefined && total > 0 && target === wanted && (!short || shortByRepeatsOnly) && !totalDrift && !truncatedByPageCap && failedPages.length === 0) {
      await checkTotalCap(out)
    }
    // Unified completeness backstop. Whatever the cause — a failed/shape-broken page,
    // a short later page (server page cap < maxPageSize), the MAX_PAGES cap, or `total`
    // drifting mid-fetch — the result is partial. A short row count or a total drift each
    // force it; so does any failedPages entry on its own — an over-returning sibling page
    // can lift the row count back to target and mask the hole (short would read false), yet
    // the failedPages branch below still writes "results are partial" to stderr, so the flag
    // must agree. printData maps partial → exit 3 so a script can't read a truncated export
    // as complete. The cap and drift branches above already warned on stderr; failedPages
    // warns below.
    if (short || totalDrift || failedPages.length > 0) out.partial = true
    // A page that itself carries a partial marker (only the first page's metadata is
    // spread into the result) must keep the merged result incomplete.
    if (laterPartial) {
      out.partial = true
      process.stderr.write(`[gangtise] warning: a later page reported itself partial; the merged result is marked partial\n`)
    }
    if (failedPages.length > 0) {
      out.failedPages = failedPages.map((p) => ({ from: p.from, size: p.size }))
      const detail = firstError instanceof Error ? `: ${firstError.message}` : ""
      const skippedHint = aborted ? " A page hit a non-retryable error (e.g. rate limit); remaining pages were skipped." : ""
      process.stderr.write(`[gangtise] warning: ${failedPages.length}/${pageRequests.length} pages not fetched${detail}; results are partial — got ${count}/${total} rows (see failedPages).${skippedHint}\n`)
    } else if (short && !shortByRepeatsOnly && !truncatedByPageCap && !totalDrift) {
      // A short later page with no failure, cap, or drift to explain it: the server
      // simply delivered fewer rows than `total` promised. Warn so an interactive run
      // sees why the result is partial (the other causes each warn on their own path).
      process.stderr.write(`[gangtise] warning: server returned ${count} of ${total} rows (a later page came back short); results may be incomplete\n`)
    }
    return out
  }

  /**
   * `total` is not always the real row count. Three opinion endpoints report a fixed
   * 10000 while `from=30000` still returns real rows with monotonically older publish
   * times (the shape of Elasticsearch's default track_total_hits). A fetch-all then
   * stops exactly at the cap with collected === total, so every completeness check
   * passes and the truncated export looks complete — the worst failure mode we have,
   * because `opinion` bills 30 credits per row.
   *
   * Probe one row past the claimed end rather than hardcoding any number: the server
   * can change the cap, and evidence survives that where a constant would not. Callers
   * run it only on a genuine fetch-all that otherwise looked complete — when `total` is
   * honest the probe comes back empty, and an endpoint that prices per item charges
   * nothing for an empty answer, so the probe is free exactly when it finds nothing
   * wrong. Both exits of requestPaginated share it: the fan-out path and the
   * first-page-already-complete path (a fetch-all starting inside the last page).
   *
   * Deliberately NOT gated on `retry: "no-replay"`. That flag is about REPLAY safety
   * — "never resend a request the server may already have executed" (endpoints.ts) —
   * and the probe is a new request, never a resend, so the flag has nothing to say
   * about it. An earlier build did gate on it, having read it as a per-call-billing
   * marker. The single endpoint that gate excluded, `ai.hot-topic`, is priced per
   * returned item (50 per 篇, where one 篇 is a whole report), and the platform does
   * not charge a per-item endpoint for a query that finds nothing — so the gate saved
   * no credits and cost that endpoint its only truncation check.
   *
   * Do NOT generalize that into "every paginated endpoint is per-item billed": the
   * client cannot measure billing at all (there is no quota/usage API), at least one
   * paginated endpoint has no published unit price, and several are free. What the
   * probe relies on is narrower — on the endpoints where a capped `total` has been
   * observed, an empty answer is not billed.
   */
  private async flagIfTotalCapped(endpoint: EndpointDefinition, initialBody: Record<string, unknown>, total: number, out: Record<string, unknown>, collectedLength: number): Promise<void> {
    let totalCapped = false
    try {
      const probe = await this.requestJson<Record<string, unknown>>(endpoint, { ...initialBody, from: total, size: 1 })
      if (this.isPaginatedListResponse(probe) && probe.list.length > 0) totalCapped = true
    } catch (error) {
      // A failed probe must never fail an otherwise-complete export. But a probe the
      // server REFUSED is not the same as one that never got through: the rows before
      // `total` were served and the one at `total` was refused, which is how an offset
      // window the endpoint did not declare answers (140002 is also the generic business
      // failure, so this is the likely reading, not a proven one) — handled as the
      // declared-window path is, the conservative way.
      if (error instanceof ApiError && error.code !== undefined && OFFSET_REFUSAL_CODES.has(error.code)) {
        markTotalCapped(out, `${endpoint.key} reported total=${total} and refused the row right after it (${error.code}) — most likely a server-side offset window at total, so rows past it may exist and can be neither fetched nor counted`, collectedLength, total)
      }
    }
    if (!totalCapped) return
    markTotalCapped(out, `${endpoint.key} reported total=${total} but rows exist past that offset — 'total' is a server-side cap, not the real count`, collectedLength, total)
  }

  /** `auth login` reports the identity requests will actually use, and says how it
   * got there. Three cases, and the distinction matters because this is a diagnostic:
   *
   * - `GANGTISE_TOKEN` set → that token wins for EVERY other command, so reporting a
   *   freshly minted one would name an account no request will use. Report the
   *   injected token, contact nothing, and say so. (Forcing a refresh here also made
   *   the token-only workflow fail outright: with no AK/SK to log in with, a
   *   documented setup turned into "缺少环境变量 GANGTISE_ACCESS_KEY".)
   * - otherwise, AK/SK present → force a real login. Falling back to the cache would
   *   report the PREVIOUS account after a credential swap, which is the question
   *   `auth login` is least able to afford getting wrong.
   * - neither → `requireAccessCredentials` raises, which is the right answer.
   *
   * The cache comes from `doTokenRefresh`'s own in-memory result, never a re-read of
   * disk: when persisting fails (read-only HOME, full disk) the file still holds the
   * PREVIOUS account, and a re-read would pair this login's `authorization` with that
   * stale account's `cache` — one response naming two accounts. */
  async login(): Promise<{ authorization: string; cache: TokenCache | null; source: "env-token" | "login" }> {
    if (this.config.token && !this.envTokenInvalidated) {
      return { authorization: normalizeToken(this.config.token), cache: null, source: "env-token" }
    }
    const authorization = await this.getAuthorizationHeader(true)
    return { authorization, cache: this.memoCache ?? null, source: "login" }
  }

  async requestJson<T>(endpoint: EndpointDefinition, body?: unknown, useAuth = true): Promise<T> {
    if (endpoint.path.startsWith('/guide/')) {
      return this.readLocalLookup(endpoint) as Promise<T>
    }

    const dispatcher = getDispatcher()
    const url = this.buildUrl(endpoint.path)
    const authState = { retried: false }

    const timeoutMs = resolveTimeoutMs(this.config.timeoutMs, endpoint)

    return withRetry(async () => {
      // An upload endpoint hands undici the FormData itself: undici derives the
      // multipart content-type (boundary included) from the body, so setting one
      // here would corrupt the request.
      const isUpload = endpoint.kind === 'upload'
      const headers: Record<string, string> = {
        // undici does not auto-decompress; decodeResponseBody gunzips below. Server
        // gzip cuts JSON payloads ~3-10x (measured 3.6x on constant-list).
        'accept-encoding': 'gzip',
      }
      if (!isUpload) headers['content-type'] = 'application/json'
      // Keep the header we actually sent: the self-heal check compares it against
      // the current memoCache token to tell "stale token" from "fresh token died".
      let usedAuthorization: string | undefined
      if (useAuth) {
        usedAuthorization = await this.getAuthorizationHeader()
        headers.Authorization = usedAuthorization
      }

      const startedAt = Date.now()
      const response = await request(url, {
        method: endpoint.method,
        headers,
        body: endpoint.method === 'GET' ? undefined : (isUpload ? body as FormData : JSON.stringify(body ?? {})),
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        dispatcher,
      })
      // Only buffer + gunzip when the server actually compressed; an unencoded
      // response reads as text directly (and keeps existing behavior on that path).
      const encoding = response.headers['content-encoding']
      const gzipped = (Array.isArray(encoding) ? encoding[0] : encoding)?.toLowerCase().trim() === 'gzip'
      let text: string
      if (gzipped) {
        // A proxy/middlebox can declare gzip and deliver garbage — surface that as
        // an ApiError with request context instead of a bare zlib Z_DATA_ERROR.
        const bytes = new Uint8Array(await response.body.arrayBuffer())
        try {
          text = decodeResponseBody(bytes, encoding)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new ApiError(`Failed to decode gzip response for ${endpoint.method} ${endpoint.path}: ${detail}`, undefined, response.statusCode)
        }
      } else {
        text = await response.body.text()
      }
      logTiming(`${endpoint.method} ${endpoint.path}`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)

      // Parse Retry-After once so every error path below (JSON parse failure AND the
      // envelope/HTTP-error throw) carries it — a non-JSON 429/503 must still honor
      // the server's rate window instead of falling back to default backoff.
      const retryAfterMs = parseRetryAfterMs(response.headers['retry-after'], Date.now())

      let parsed: Envelope<T>
      try {
        parsed = JSON.parse(quoteBigIntFields(text, endpoint.bigIntFields)) as Envelope<T>
      } catch {
        const message = response.statusCode >= 400
          ? `API request failed (HTTP ${response.statusCode})`
          : 'Failed to parse API response'
        throw new ApiError(message, undefined, response.statusCode, text.slice(0, 500), retryAfterMs)
      }

      try {
        // Auth errors can arrive as HTTP 4xx or as a 200-wrapped error envelope;
        // both routes must reach the self-heal check below.
        if (response.statusCode >= 400) {
          this.throwHttpError(parsed, response.statusCode, retryAfterMs)
        }
        const payload = this.unwrapEnvelope(parsed, response.statusCode, retryAfterMs)
        // Shape check here rather than in the command: a `data: null` cannot carry the
        // envelope's traceId (attachEnvelopeTraceId needs an object), so the envelope
        // itself is what the error must hold for the failure to stay traceable.
        // Marked structural: local to this one response, so a fan-out (kline sharding)
        // records the shard as failed and keeps sending the others.
        if (endpoint.expects && !hasExpectedShape(endpoint.expects, payload)) {
          const got = payload === null ? "null" : Array.isArray(payload) ? "an array" : typeof payload
          throw markStructural(new ApiError(`${endpoint.key} returned no ${endpoint.expects} payload (got ${got}) — the response layout may have changed`, undefined, response.statusCode, parsed))
        }
        return payload
      } catch (error) {
        await this.refreshAuthIfRecoverable(error, useAuth, authState, usedAuthorization)
        throw error
      }
    }, {
      policy: endpoint.retry ?? "default",
      onRetry: (attempt, error, delay) => {
        if (!isVerbose()) return
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[gangtise] retry ${attempt} after ${delay.toFixed(0)}ms: ${msg.slice(0, 120)}\n`)
      },
    }).catch((error: unknown) => {
      // Until 2026-08-01 EDE answered a no-data query with 999999, so this hint
      // led with "多为查询无数据". No-data now comes back as a null CELL with its
      // row and column intact (re-probed 2026-08-08), which leaves 999999 meaning
      // an actual server fault — but the parameter checklist
      // is still the right first move: a wrong code or param name comes back as its
      // own error (100003), yet a date on the wrong axis silently yields null cells.
      // Only the data
      // endpoints take a date/security/params; indicator.search shares the
      // no-999999 policy but has just a keyword, so it keeps the generic hint
      // instead of nonsensical date/scope/param guidance.
      const isIndicatorFetch = endpoint.key === 'indicator.cross-section' || endpoint.key === 'indicator.time-series' || endpoint.key === 'indicator.screener'
      if (isIndicatorFetch && error instanceof ApiError && error.code === '999999') {
        throw new ApiError(error.message, error.code, error.statusCode, error.details, error.retryAfterMs,
          'EDE 取数故障。先核对参数再重试：参数名以 indicator search 的 parameterList 为准（传错名会报 100003 并指名）、日期匹配指标周期（财务报表类用报告期末如 2025-12-31，PE/PB 等日频估值用交易日）、标的在 scopeList 覆盖内、required 参数已补。注意此码不表示无数据——无数据返回保留行列的 null 单元格；code 或参数名写错报 100003、缺必填参数报 100001，都会指名。')
      }
      throw error
    })
  }

  /** POST a file as multipart/form-data under the field name `file`, plus any plain
   * text `fields` (undefined ones are left out). Reuses requestJson for auth / retry /
   * envelope handling — only the body differs. */
  async uploadFile<T>(endpointKey: string, file: { filename: string; data: Uint8Array; contentType?: string }, fields?: Record<string, string | number | undefined>): Promise<T> {
    const endpoint = ENDPOINTS[endpointKey]
    if (!endpoint || endpoint.kind !== 'upload') {
      throw new ApiError(`Not an upload endpoint: ${endpointKey}`)
    }
    const form = new FormData()
    // Cast: TS 5.7+ types Uint8Array as Uint8Array<ArrayBufferLike>, which BlobPart
    // (ArrayBufferView<ArrayBuffer>) rejects; a Node Buffer is always ArrayBuffer-backed.
    form.append('file', new Blob([file.data as BlobPart], { type: file.contentType ?? 'application/octet-stream' }), file.filename)
    for (const [name, value] of Object.entries(fields ?? {})) {
      if (value !== undefined) form.append(name, String(value))
    }
    return this.requestJson<T>(endpoint, form)
  }

  /** `body` is only sent for POST download endpoints (the file-parse result
   * endpoint takes `{taskId}` as JSON and answers with the ZIP bytes). */
  async download(endpoint: EndpointDefinition, query: Record<string, string | number>, options?: { streamTo?: string }, body?: unknown): Promise<DownloadResult> {
    const dispatcher = getDispatcher()
    const url = this.buildUrl(endpoint.path)
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })
    const authState = { retried: false }
    // Same floor `requestJson` applies: an endpoint that declares `timeoutMs` needs it
    // here too, and reading the global config directly silently ignored it. No download
    // endpoint declares one today — `tool.file-parse.result` is the obvious candidate
    // the day a 500-page result ZIP outgrows 30s — so this closes a landmine rather
    // than a live bug, and it never lowers a higher user-configured timeout.
    const timeoutMs = resolveTimeoutMs(this.config.timeoutMs, endpoint)

    return withRetry(async () => {
      const authorization = await this.getAuthorizationHeader()
      const startedAt = Date.now()
      let currentUrl = url
      let auth: string | undefined = authorization
      const isPost = endpoint.method === 'POST'
      let response = await request(currentUrl, {
        method: endpoint.method,
        headers: isPost
          ? { Authorization: authorization, 'content-type': 'application/json' }
          : { Authorization: authorization },
        body: isPost ? JSON.stringify(body ?? {}) : undefined,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        dispatcher,
      })

      // undici does not follow redirects, and a download endpoint may 302 to a
      // pre-signed object-store URL — without this the redirect body would be
      // saved as the "file". Follow up to 3 hops, dropping Authorization once the
      // redirect leaves the API origin so the bearer never reaches storage hosts.
      for (let hops = 0; hops < 3 && response.statusCode >= 300 && response.statusCode < 400; hops++) {
        const locationHeader = response.headers.location
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader
        if (!location) break
        await response.body.text().catch(() => {})
        const next = new URL(location, currentUrl)
        if (next.origin !== currentUrl.origin) auth = undefined
        currentUrl = next
        response = await request(currentUrl, {
          method: 'GET',
          headers: auth ? { Authorization: auth } : {},
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          dispatcher,
        })
      }

      // The loop above can exit with a 3xx still in hand (hop limit exceeded, or a
      // redirect without Location) — that response must never be treated as file
      // content: its HTML placeholder body would be saved as the "downloaded file".
      if (response.statusCode >= 300 && response.statusCode < 400) {
        await response.body.text().catch(() => {})
        throw new ApiError(`Download failed: unresolved redirect (HTTP ${response.statusCode})`, undefined, response.statusCode)
      }

      const contentType = Array.isArray(response.headers['content-type']) ? response.headers['content-type'][0] : response.headers['content-type']
      // From the final (post-redirect) response, so a rate-limited download honors
      // Retry-After too — every error branch below passes it into the ApiError.
      const retryAfterMs = parseRetryAfterMs(response.headers['retry-after'], Date.now())

      if (contentType?.includes('application/json')) {
        const text = await response.body.text()
        logTiming(`${endpoint.method} ${endpoint.path} (json)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          if (response.statusCode >= 400) {
            throw new ApiError('Download failed', undefined, response.statusCode, text, retryAfterMs)
          }
          return { text, contentType }
        }

        let data: unknown
        try {
          if (response.statusCode >= 400) {
            this.throwHttpError(parsed, response.statusCode, retryAfterMs)
          }
          data = this.unwrapEnvelope(parsed as Envelope<unknown>, response.statusCode, retryAfterMs)
        } catch (error) {
          await this.refreshAuthIfRecoverable(error, true, authState, authorization)
          throw error
        }
        if (data && typeof data === 'object' && 'url' in (data as Record<string, unknown>) && typeof (data as Record<string, unknown>).url === 'string') {
          return { url: String((data as Record<string, unknown>).url), contentType }
        }
        return { text: JSON.stringify(data, null, 2), contentType }
      }

      if (contentType?.includes('text/plain') || contentType?.includes('text/html')) {
        const text = await response.body.text()
        logTiming(`${endpoint.method} ${endpoint.path} (text)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
        if (response.statusCode >= 400) {
          throw new ApiError('Download failed', undefined, response.statusCode, text, retryAfterMs)
        }
        return { text, contentType }
      }

      if (response.statusCode >= 400) {
        const text = await response.body.text()
        throw new ApiError('Download failed', undefined, response.statusCode, text, retryAfterMs)
      }

      const contentDisposition = response.headers['content-disposition']
      const filenameMatch = Array.isArray(contentDisposition)
        ? contentDisposition[0]?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
        : contentDisposition?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
      // A plain filename= value with a bare % ("增长100%.pdf") is not valid URI
      // encoding — decodeURIComponent would throw and fail the whole download over
      // a cosmetic hint. Fall back to the raw value instead.
      let filename: string | undefined
      if (filenameMatch) {
        const raw = filenameMatch[1] || filenameMatch[2]
        try {
          filename = decodeURIComponent(raw)
        } catch {
          filename = raw
        }
      }

      // Stream directly to disk when caller already knows the destination
      if (options?.streamTo) {
        await fs.mkdir(path.dirname(options.streamTo), { recursive: true })
        // Stream into a staging sibling and rename over the target only on success:
        // writing to the target directly would truncate an existing file on the
        // FIRST byte and delete it on failure — a failed re-download (or each
        // withRetry attempt) must never destroy the user's previous good file.
        const partPath = stagingPath(options.streamTo)
        try {
          await pipeline(response.body, createWriteStream(partPath))
          await fs.rename(partPath, options.streamTo)
        } catch (error) {
          await fs.unlink(partPath).catch(() => {})
          throw error
        }
        logTiming(`${endpoint.method} ${endpoint.path} (stream)`, Date.now() - startedAt, `${response.statusCode}`)
        return { contentType, filename, savedPath: options.streamTo }
      }

      const buffer = await response.body.arrayBuffer()
      logTiming(`${endpoint.method} ${endpoint.path} (binary)`, Date.now() - startedAt, `${response.statusCode}, ${buffer.byteLength}B`)
      return {
        data: new Uint8Array(buffer),
        contentType,
        filename,
      }
    }, {
      // Download endpoints carry per-篇 billing too (summary/foreign-report/
      // my-conference at 50/篇) — honor the endpoint's retry policy here as well.
      policy: endpoint.retry ?? "default",
      onRetry: (attempt, error, delay) => {
        if (!isVerbose()) return
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[gangtise] download retry ${attempt} after ${delay.toFixed(0)}ms: ${msg.slice(0, 120)}\n`)
      },
    })
  }

  async call(endpointKey: string, body?: unknown, query?: Record<string, string | number>, options?: { streamTo?: string }) {
    const endpoint = ENDPOINTS[endpointKey]
    if (!endpoint) {
      throw new ApiError(`Unknown endpoint key: ${endpointKey}`)
    }

    if (endpoint.kind === 'upload') {
      throw new ValidationError(`${endpointKey} takes a file upload — use its dedicated command ('gangtise tool file-parse --file <path>' / 'gangtise vault drive-upload --file <path>'); 'raw call' cannot send files`)
    }

    if (endpoint.kind === 'download') {
      return this.download(endpoint, query ?? {}, options, body)
    }

    if (endpoint.kind === 'json' && endpoint.pagination?.enabled) {
      return this.requestPaginated(endpoint, body)
    }

    // auth.login is how a token is obtained: its credentials travel in the body, so it
    // must not first demand a token (a `raw call auth.login` with no env credentials
    // used to fail before any request went out).
    return this.requestJson(endpoint, body, endpoint.key !== 'auth.login')
  }
}
