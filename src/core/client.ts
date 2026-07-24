import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { request } from "undici"

import type { CliConfig } from "./config.js"
import { isTokenCacheValid, normalizeToken, readTokenCache, requireAccessCredentials, writeTokenCache, type TokenCache } from "./auth.js"
import { ApiError, attachEnvelopeTraceId, ValidationError } from "./errors.js"
import { ENDPOINTS, type EndpointDefinition, resolveTimeoutMs } from "./endpoints.js"
import { getLookupData } from "./lookupData/index.js"
import { decodeResponseBody, getDispatcher, isVerbose, logTiming, markRetryable, PAGE_CONCURRENCY, parseRetryAfterMs, runWithConcurrency, withRetry } from "./transport.js"
import type { DownloadResult } from "./download.js"

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
// recovers it. 0000001008 is the legacy code (probed 2026-07-20: still what the
// token filter emits); 999002 TOKEN_INVALID is its 2026-07-17 replacement, listed
// ahead of the rollout so self-heal does not silently die when the filter switches.
// 8000014/8000015 are the retired AK/SK codes, kept for older server builds.
// 999011 CREDENTIAL_INVALID is not here and could not act if it were — it comes from
// auth.login, which runs useAuth=false and so never reaches this check. Its "never
// replay" guarantee lives in transport's TERMINAL_API_CODES instead.
const AUTH_RETRY_CODES = new Set(["8000014", "8000015", "0000001008", "999002"])

export class GangtiseClient {
  private refreshPromise: Promise<string> | null = null
  private memoCache: TokenCache | null = null
  // After an injected env token (GANGTISE_TOKEN) is rejected and we self-heal via
  // login, stop preferring that now-stale token so the retry uses the fresh one.
  private envTokenInvalidated = false

  constructor(private readonly config: CliConfig) {}

  private async getAuthorizationHeader(forceRefresh = false): Promise<string> {
    if (this.config.token && !this.envTokenInvalidated && !forceRefresh) {
      return normalizeToken(this.config.token)
    }

    if (!forceRefresh) {
      if (isTokenCacheValid(this.memoCache)) {
        return normalizeToken(this.memoCache!.accessToken)
      }
      const cache = await readTokenCache(this.config.tokenCachePath)
      if (isTokenCacheValid(cache)) {
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

    const cache: TokenCache = { ...envelope, accessToken, expiresIn, expiresAt }
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

    // First page: serial — we need total before deciding how many more requests to fan out.
    const firstPageSize = requestedSize === undefined ? maxPageSize : Math.min(maxPageSize, requestedSize)
    const firstPage = await this.requestJson<Record<string, unknown>>(endpoint, {
      ...initialBody,
      from: startFrom,
      size: firstPageSize,
    })

    if (!this.isPaginatedListResponse(firstPage)) {
      // Shape drift (e.g. total arriving as a string) silently degrades fetch-all
      // to a single page with no partial marker — make it visible on verbose.
      if (isVerbose()) {
        process.stderr.write(`[gangtise] warning: ${endpoint.key} is marked paginated but the first page has an unexpected shape (no numeric total + list); returning it as-is\n`)
      }
      return firstPage
    }

    const total = firstPage.total
    const collected: unknown[] = [...firstPage.list]

    const available = Math.max(total - startFrom, 0)
    const target = requestedSize === undefined ? available : Math.min(requestedSize, available)

    // Last page reached on first request. If `total` promises more rows than the
    // short page delivered, the server's page cap may be lower than our configured
    // maxPageSize — say so instead of silently returning a subset as "everything".
    if (firstPage.list.length < firstPageSize) {
      const out: Record<string, unknown> = {
        ...firstPage,
        total,
        list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
      }
      if (collected.length < target) {
        process.stderr.write(`[gangtise] warning: server returned a short page (${collected.length} rows) but reported total=${total}; treating it as the end of data — results may be incomplete\n`)
        // Machine-readable counterpart of the warning: scripts key off partial /
        // exit code 3, and must not mistake a truncated result for a complete one.
        out.partial = true
      }
      return out
    }

    if (collected.length >= target) {
      return {
        ...firstPage,
        total,
        list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
      }
    }

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
    // Fail-soft fan-out: a hard page failure (rate-limit 903301, no-perm, retries
    // exhausted) must NOT discard the pages already fetched. Catch per page, record
    // it, and stop starting new requests so we don't keep burning quota into a rate
    // limit. Mirrors quoteSharding's partial-result tolerance — but firstPage already
    // succeeded to get here, so unlike sharding there's no total-failure case.
    const failedPages: PageReq[] = []
    let firstError: unknown = null
    let aborted = false
    const pages = await runWithConcurrency(pageRequests, PAGE_CONCURRENCY, async (req) => {
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
        if (!this.isPaginatedListResponse(page)) {
          // Treat a shape-broken page like a failed page: its rows are missing, so
          // the result must carry the partial marker instead of looking complete.
          unexpectedShape = true
          failedPages.push(req)
          return [] as unknown[]
        }
        if (page.total !== total) totalDrift = true
        return page.list
      } catch (error) {
        if (!firstError) firstError = error
        aborted = true
        failedPages.push(req)
        return [] as unknown[]
      }
    })

    for (const list of pages) {
      if (list.length === 0) continue
      collected.push(...list)
    }

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
      process.stderr.write(`[gangtise] warning: hit the ${MAX_PAGES}-page safety cap; fetched ${collected.length} of ${total} rows. Narrow the query (e.g. a shorter date range) or pass --size to fetch a bounded subset.\n`)
    }

    const out: Record<string, unknown> = {
      ...firstPage,
      total,
      list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
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
    const short = collected.length < target
    if (short || totalDrift || failedPages.length > 0) out.partial = true
    if (failedPages.length > 0) {
      out.failedPages = failedPages.map((p) => ({ from: p.from, size: p.size }))
      const detail = firstError instanceof Error ? `: ${firstError.message}` : ""
      const skippedHint = aborted ? " A page hit a non-retryable error (e.g. rate limit); remaining pages were skipped." : ""
      process.stderr.write(`[gangtise] warning: ${failedPages.length}/${pageRequests.length} pages not fetched${detail}; results are partial — got ${collected.length}/${total} rows (see failedPages).${skippedHint}\n`)
    } else if (short && !truncatedByPageCap && !totalDrift) {
      // A short later page with no failure, cap, or drift to explain it: the server
      // simply delivered fewer rows than `total` promised. Warn so an interactive run
      // sees why the result is partial (the other causes each warn on their own path).
      process.stderr.write(`[gangtise] warning: server returned ${collected.length} of ${total} rows (a later page came back short); results may be incomplete\n`)
    }
    return out
  }

  async login() {
    const authorization = await this.getAuthorizationHeader()
    const cache = await readTokenCache(this.config.tokenCachePath)
    return {
      authorization,
      cache,
    }
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
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        // undici does not auto-decompress; decodeResponseBody gunzips below. Server
        // gzip cuts JSON payloads ~3-10x (measured 3.6x on constant-list).
        'accept-encoding': 'gzip',
      }
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
        body: endpoint.method === 'GET' ? undefined : JSON.stringify(body ?? {}),
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
        parsed = JSON.parse(text) as Envelope<T>
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
        return this.unwrapEnvelope(parsed, response.statusCode, retryAfterMs)
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
      // EDE uses 999999 for "no data for this query" (probed 2026-07-11) — the
      // generic "系统错误，请稍后重试" hint would send the user retrying a query
      // that will never have data. Swap in a fetch-specific hint. Only the data
      // endpoints take a date/security/params; indicator.search shares the
      // no-999999 policy but has just a keyword, so it keeps the generic hint
      // instead of nonsensical date/scope/param guidance.
      const isIndicatorFetch = endpoint.key === 'indicator.cross-section' || endpoint.key === 'indicator.time-series'
      if (isIndicatorFetch && error instanceof ApiError && error.code === '999999') {
        throw new ApiError(error.message, error.code, error.statusCode, error.details, error.retryAfterMs,
          'EDE 的 999999 多为查询无数据——先核对：日期匹配指标周期（财务/MRQ 用报告期末如 2025-12-31、日频估值用交易日）、标的在 scopeList 覆盖内、parameterList 中 required 参数已补；确认应有数据再重试。')
      }
      throw error
    })
  }

  async download(endpoint: EndpointDefinition, query: Record<string, string | number>, options?: { streamTo?: string }): Promise<DownloadResult> {
    const dispatcher = getDispatcher()
    const url = this.buildUrl(endpoint.path)
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })
    const authState = { retried: false }

    return withRetry(async () => {
      const authorization = await this.getAuthorizationHeader()
      const startedAt = Date.now()
      let currentUrl = url
      let auth: string | undefined = authorization
      let response = await request(currentUrl, {
        method: endpoint.method,
        headers: { Authorization: authorization },
        headersTimeout: this.config.timeoutMs,
        bodyTimeout: this.config.timeoutMs,
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
          headersTimeout: this.config.timeoutMs,
          bodyTimeout: this.config.timeoutMs,
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
        logTiming(`GET ${endpoint.path} (json)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
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
        logTiming(`GET ${endpoint.path} (text)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
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
        // Stream into a .part sibling and rename over the target only on success:
        // writing to the target directly would truncate an existing file on the
        // FIRST byte and delete it on failure — a failed re-download (or each
        // withRetry attempt) must never destroy the user's previous good file.
        const partPath = `${options.streamTo}.part`
        try {
          await pipeline(response.body, createWriteStream(partPath))
          await fs.rename(partPath, options.streamTo)
        } catch (error) {
          await fs.unlink(partPath).catch(() => {})
          throw error
        }
        logTiming(`GET ${endpoint.path} (stream)`, Date.now() - startedAt, `${response.statusCode}`)
        return { contentType, filename, savedPath: options.streamTo }
      }

      const buffer = await response.body.arrayBuffer()
      logTiming(`GET ${endpoint.path} (binary)`, Date.now() - startedAt, `${response.statusCode}, ${buffer.byteLength}B`)
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

    if (endpoint.kind === 'download') {
      return this.download(endpoint, query ?? {}, options)
    }

    if (endpoint.kind === 'json' && endpoint.pagination?.enabled) {
      return this.requestPaginated(endpoint, body)
    }

    return this.requestJson(endpoint, body)
  }
}
