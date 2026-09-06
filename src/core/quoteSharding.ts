import { isStructuralError } from "./errors.js"
import { columnarSchemaValid } from "./normalize.js"
import { attachRowSink, type JsonlRowSink } from "./rowSink.js"
import { isVerbose, PAGE_CONCURRENCY, runInOrder } from "./transport.js"

export interface KlineBody {
  securityList?: string[]
  startDate?: string
  endDate?: string
  limit?: number
  fieldList?: string[]
  [key: string]: unknown
}

interface ShardConfig {
  /** Days per shard. Picked so each request stays under the 10K-row API cap. */
  shardDays: number
  concurrency?: number
  /** securityList value that means "whole market" for this endpoint and triggers
   * date-sharding + the lifted row cap. `aShares` for fund-flow and for the unified
   * `day-kline` (which also takes `hkStocks` / `usStocks`, each with its own shardDays
   * — the caller resolves which keyword was asked for); the menu-retired per-market
   * kline endpoints still use the historical `all`, which is the default here. */
  fullMarketValue?: string
}

interface KlineClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
  /** Present on GangtiseClient: the sink of a large jsonl export, if the command opened one. */
  claimRowSink?(): JsonlRowSink | undefined
}

const DAY_MS = 86_400_000
/** API-side row cap (per docs). Used to lift the default 6000-row cap on whole-market
 * queries so a 2-day A-share shard (~11K rows) isn't silently truncated. Single-security
 * queries are untouched. */
const ALL_MARKET_LIMIT = 10_000
function parseDate(value: string): Date | null {
  // Accept yyyy-MM-dd; reject anything else so we can fall back to a single request.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Index map from the merged header's columns into a shard's own fieldList: `null` when
 * the two already agree (nothing to do), an index array when the shard merely orders its
 * columns differently, `undefined` when a header column is absent from the shard. */
function columnRemap(header: unknown[], shard: unknown[]): number[] | null | undefined {
  if (header.length === shard.length && header.every((field, i) => field === shard[i])) return null
  const index = new Map(shard.map((field, i) => [String(field), i]))
  const map: number[] = []
  for (const field of header) {
    const i = index.get(String(field))
    if (i === undefined) return undefined
    map.push(i)
  }
  return map
}

/** A shard's columnar rows can only be read through its own fieldList: it must exist,
 * carry unique names, and every array row must be exactly as wide as it. Object rows
 * carry their own keys and are not judged here. */
export function isFullMarket(body: KlineBody, fullMarketValue: string): boolean {
  const list = body.securityList
  if (!Array.isArray(list) || list.length !== 1) return false
  return list[0] === fullMarketValue
}

/** Sat/Sun in UTC — shard dates are formatted from UTC midnight (see parseDate). */
function isWeekendUtc(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

function buildShards(start: Date, end: Date, shardDays: number): Array<{ startDate: string; endDate: string }> {
  const shards: Array<{ startDate: string; endDate: string }> = []
  let cursor = start.getTime()
  const endTime = end.getTime()
  while (cursor <= endTime) {
    const shardEnd = Math.min(cursor + (shardDays - 1) * DAY_MS, endTime)
    // Per-day sharding (shardDays===1): a lone weekend day always returns empty (A/HK/US
    // markets closed) — skip it to save ~28% of requests and daily quota. This covers
    // every 1-day-sharded full-market query: fund-flow AND day-kline (aShares/usStocks)
    // / day-kline-us.
    //
    // Multi-day shards (day-kline hkStocks=2, index-day-kline=15) are NOT filtered. Note
    // this is a deliberate simplification, not a claim that they always contain a weekday:
    // a 2-day shard starting on a Saturday is Sat+Sun and returns nothing. That costs one
    // wasted request at a range boundary and never drops a trading day, whereas filtering
    // multi-day windows correctly would mean walking each window's days.
    if (!(shardDays === 1 && isWeekendUtc(new Date(cursor)))) {
      shards.push({
        startDate: formatDate(new Date(cursor)),
        endDate: formatDate(new Date(shardEnd)),
      })
    }
    cursor = shardEnd + DAY_MS
  }
  return shards
}

/**
 * For full-market (`--security all`) K-line queries that span more than `shardDays`,
 * split the date range and run shards in parallel. Each shard is sized so the
 * combined row count stays under the 10K-row API limit. For small ranges or
 * single-security queries this is a no-op.
 */
export async function callKlineWithSharding(client: KlineClient, endpointKey: string, body: KlineBody, config: ShardConfig): Promise<unknown> {
  const fullMarketValue = config.fullMarketValue ?? "all"
  if (!isFullMarket(body, fullMarketValue)) {
    return client.call(endpointKey, body)
  }

  // `--security all` returns thousands of rows per day; lift the default 6000-row
  // cap to the API max so single-shard requests aren't silently truncated. This
  // must apply even when a date is missing (no sharding possible then, but the
  // single request still needs the lifted cap).
  const allMarketBody: KlineBody = { ...body, limit: body.limit ?? ALL_MARKET_LIMIT }
  const perShardLimit = allMarketBody.limit ?? ALL_MARKET_LIMIT
  // A shard maxes out for two reasons with different fixes: a user-set low --limit is
  // raisable; hitting the API cap itself is not (only a smaller internal shardDays window
  // would help). Word the truncation warning accordingly.
  const truncationHint = perShardLimit < ALL_MARKET_LIMIT
    ? "raise or omit --limit to fetch the full market"
    : `a single ${config.shardDays}-day window exceeds the ${ALL_MARKET_LIMIT}-row API cap`

  // A full-market response whose row count reaches the per-request limit was itself
  // capped (a low user --limit, or a single day exceeding the API row cap) — its slice
  // is incomplete, so the result must be flagged partial rather than shown as complete.
  const isTruncated = (rec: Record<string, unknown>): boolean =>
    Array.isArray(rec.list) && rec.list.length >= perShardLimit

  // A single full-market request (missing/unparseable dates, or a range that fits one
  // shard) skips the merge loop below, so it needs the same truncation check inline — or
  // a low --limit / oversized day slips through as a silent exit-0 success.
  const callSingle = async (): Promise<unknown> => {
    const single = await client.call(endpointKey, allMarketBody)
    if (single && typeof single === "object" && !Array.isArray(single) && isTruncated(single as Record<string, unknown>)) {
      ;(single as Record<string, unknown>).partial = true
      process.stderr.write(`[gangtise] warning: full-market request hit the ${perShardLimit}-row limit and was likely truncated; results are partial — ${truncationHint}.\n`)
    }
    return single
  }

  if (!body.startDate || !body.endDate) {
    return callSingle()
  }

  const start = parseDate(body.startDate)
  const end = parseDate(body.endDate)
  if (!start || !end || end < start) {
    return callSingle()
  }

  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (totalDays <= config.shardDays) {
    return callSingle()
  }

  const shards = buildShards(start, end, config.shardDays)
  // A range that's entirely weekends (per-day sharding) filters down to nothing — no
  // trading days to fetch. Return empty rather than falling into the all-shards-failed
  // check below, which would misread 0 shards as a total outage and throw.
  if (shards.length === 0) return { list: [] }
  // isVerbose() (not a direct env read) so the global --verbose flag reaches
  // shard logging too — cli.ts enables it via setVerbose in a preAction hook.
  if (isVerbose()) {
    process.stderr.write(`[gangtise] sharding ${endpointKey} into ${shards.length} requests (${config.shardDays} day(s) each)\n`)
  }

  // Per-shard fault tolerance: a failing shard is recorded and skipped (returns a
  // null sentinel) instead of rejecting, so the surviving shards still complete.
  // runWithConcurrency uses Promise.all under the hood, which would otherwise abort
  // every shard on the first rejection.
  const failedShards: Array<{ startDate: string; endDate: string }> = []
  let firstError: unknown = null
  let aborted = false
  const fetchShard = async (shard: { startDate: string; endDate: string }): Promise<unknown> => {
    // A prior shard hit a hard error (rate limit, no-perm, retries exhausted). Stop
    // dispatching the rest rather than burning quota into the same failure; record them
    // as failed so the merged result is flagged partial. Mirrors requestPaginated.
    if (aborted) {
      failedShards.push(shard)
      return null
    }
    try {
      const res = await client.call(endpointKey, { ...allMarketBody, startDate: shard.startDate, endDate: shard.endDate })
      // A shard that resolves but carries no `list` array is shape-broken (an error
      // object, a truncated envelope) — its rows are missing. Treat it exactly like a
      // thrown shard so the result is marked partial, not silently short. Unlike a hard
      // error this doesn't abort the fan-out: one malformed shard isn't systemic.
      if (!(res && typeof res === "object" && Array.isArray((res as Record<string, unknown>).list))) {
        failedShards.push(shard)
        return null
      }
      return res
    } catch (error) {
      if (!firstError) firstError = error
      // A structural error (the client rejected THIS response's shape) is local to one
      // shard; only a systemic failure stops the rest from being sent.
      if (!isStructuralError(error)) aborted = true
      failedShards.push(shard)
      return null
    }
  }

  // A large jsonl export streams rows out shard by shard (JsonlRowSink) instead of holding
  // the merged list; shards are merged in date order as they complete (runInOrder), so
  // the file order equals the in-memory merge order.
  const sink = client.claimRowSink?.()
  let fieldList: unknown[] | undefined
  /** Meta (total, partial, …) is copied from the first shard that contributed rows;
   * `fallback` serves an all-empty result and is taken only from a shard that passed as a
   * legitimate empty window — never from one already judged failed, whose fieldList
   * (empty or rejected) would otherwise become the "columns the server returned". */
  let header: Record<string, unknown> | null = null
  let fallback: Record<string, unknown> | null = null
  const merged: unknown[] = []
  let count = 0
  /** Keys of the object rows kept — the returned columns when no columnar header exists. */
  const objectKeys = new Set<string>()
  // Record WHICH windows maxed out, not just how many: a script/agent consumer
  // needs the concrete date ranges to re-pull narrower windows (mirrors failedShards).
  const truncatedShards: Array<{ startDate: string; endDate: string }> = []
  const keep = async (rows: unknown[]): Promise<void> => {
    count += rows.length
    if (!fieldList) for (const row of rows) if (row && typeof row === "object" && !Array.isArray(row)) for (const key of Object.keys(row)) objectKeys.add(key)
    if (sink) await sink.push(rows)
    else for (const row of rows) merged.push(row)
  }
  const mergeShard = async (r: unknown, i: number): Promise<void> => {
    if (!(r && typeof r === "object")) return
    const rec = r as Record<string, unknown>
    if (isTruncated(rec)) truncatedShards.push(shards[i])
    if (!Array.isArray(rec.list)) return
    if (rec.list.length === 0) {
      // A shard that claims rows it did not deliver (total > 0, or an explicit partial
      // marker) is a contradiction, not a holiday: keep the completeness signal.
      if ((typeof rec.total === "number" && rec.total > 0) || rec.partial === true) {
        failedShards.push(shards[i])
        const claim = typeof rec.total === "number" && rec.total > 0 ? `reported total=${rec.total}` : "carried a partial marker"
        process.stderr.write(`[gangtise] warning: shard ${shards[i].startDate}..${shards[i].endDate} ${claim} but delivered no rows; treated as failed (see failedShards)\n`)
        return
      }
      // A genuinely empty window (a weekend / holiday): it says nothing about the column
      // layout, so it neither supplies the merged header — an empty fieldList would
      // swallow every later column — nor counts as failed for lacking one. It is the only
      // kind of shard an all-empty result may take its metadata from.
      if (!fallback) fallback = rec
      return
    }
    const shardFields = Array.isArray(rec.fieldList) && rec.fieldList.length > 0 ? rec.fieldList : undefined
    const columnar = rec.list.some(Array.isArray)
    // Columnar rows are only interpretable through their own shard's fieldList, and only
    // when that list is well-formed: present, unique names, every array row exactly as
    // wide as it. Anything else is a structural anomaly in THIS shard. The single-request
    // path lets zipFieldRow reject such a row; the merge must not be where it slips
    // through — padded, truncated or read under a guessed header. Drop it as a failed
    // shard (dates kept for a re-pull) and say so.
    if (columnar && !columnarSchemaValid(shardFields, rec.list)) {
      failedShards.push(shards[i])
      process.stderr.write(`[gangtise] warning: shard ${shards[i].startDate}..${shards[i].endDate} returned columnar rows that do not match its own fieldList (missing, duplicated or mis-sized); its rows were dropped (see failedShards)\n`)
      return
    }
    // Only a schema that was validated against columnar rows may become the merged
    // header. An object-row shard's fieldList (if it carries one) constrains nothing of
    // its own, was never checked, and must not constrain the array shards that follow.
    if (!fieldList && columnar && shardFields) {
      fieldList = shardFields
      sink?.setFieldList(fieldList)
    }
    if (!header) header = rec
    // The merged result carries ONE fieldList (the first data shard's) and columnar rows
    // are zipped against it by position. A shard whose fieldList differs in order would be
    // read under the wrong column names — close landing in volume — with nothing else in
    // the payload to notice. Re-map such a shard's rows onto the header order; a shard
    // missing a header column cannot be aligned and is treated like a failed shard too.
    const remap = columnar && fieldList && shardFields ? columnRemap(fieldList, shardFields) : null
    if (remap === undefined) {
      failedShards.push(shards[i])
      process.stderr.write(`[gangtise] warning: shard ${shards[i].startDate}..${shards[i].endDate} returned columns that cannot be aligned with the first shard's fieldList; its rows were dropped (see failedShards)\n`)
      return
    }
    const rows = rec.list as unknown[]
    await keep(remap ? rows.map((item) => (Array.isArray(item) ? remap.map((k) => item[k]) : item)) : rows)
  }
  await runInOrder(shards, config.concurrency ?? PAGE_CONCURRENCY, fetchShard, mergeShard)

  // Every shard failed → surface the error loudly (non-zero exit) rather than
  // masking a total outage as an empty success.
  if (failedShards.length === shards.length) {
    throw firstError ?? new Error(`All ${shards.length} kline shards failed`)
  }

  // Defensive default only. With JSON payloads every shard is a contributor (header), a
  // legitimate empty window (fallback) or failed — and all-failed threw above — so one of
  // the two is always set here; `{}` just keeps the markers below total if that ever changes.
  const base: Record<string, unknown> = header ?? fallback ?? {}
  // `total` on a shard is that shard's own row count; overwrite it with the merged count
  // so the JSON `total` and the `Total:` stderr line reflect the whole combined result.
  const out: Record<string, unknown> = { ...base, total: count, list: merged }
  if (sink) attachRowSink(out, sink)
  // Two different jobs share the output's fieldList: zipping array rows by position (only
  // a header validated against columnar rows may do that), and telling flagMissingFields
  // which columns came back (which needs an honest answer for EVERY shape). So:
  //   validated columnar header            → that header
  //   object rows, no validated header     → the union of the rows' own keys — the
  //                                          returned columns ARE the keys; a base shard's
  //                                          unvalidated list is never trusted for this
  //   nothing merged, base has a fieldList → the server's explicit column set, even empty:
  //                                          "no requested column came back" is then true
  //   nothing merged, no metadata at all   → no fieldList (nothing to compare against)
  if (fieldList) {
    out.fieldList = fieldList
  } else if (count > 0) {
    out.fieldList = [...objectKeys]
  } else if (Array.isArray(base.fieldList)) {
    out.fieldList = base.fieldList
  } else {
    delete out.fieldList
  }
  if (failedShards.length > 0) {
    out.partial = true
    out.failedShards = failedShards
    process.stderr.write(`[gangtise] warning: ${failedShards.length}/${shards.length} shards failed; results are partial (see failedShards)\n`)
  }
  if (truncatedShards.length > 0) {
    out.partial = true
    out.truncatedShards = truncatedShards
    process.stderr.write(`[gangtise] warning: ${truncatedShards.length}/${shards.length} shard(s) hit the ${perShardLimit}-row limit and were likely truncated; results are partial (see truncatedShards) — ${truncationHint}.\n`)
  }
  return out
}
