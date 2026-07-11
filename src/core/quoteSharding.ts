import { isVerbose, PAGE_CONCURRENCY, runWithConcurrency } from "./transport.js"

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
   * date-sharding + the lifted row cap: `all` for kline (default), `aShares` for
   * fund-flow. */
  fullMarketValue?: string
}

interface KlineClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
}

const DAY_MS = 86_400_000
/** API-side row cap (per docs). Used to lift the default 6000-row cap on
 * `--security all` queries so a 2-day A-share shard (~11K rows) isn't
 * silently truncated. Single-security queries are untouched. */
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

export function isFullMarket(body: KlineBody, fullMarketValue: string): boolean {
  const list = body.securityList
  if (!Array.isArray(list) || list.length !== 1) return false
  return list[0] === fullMarketValue
}

/** Kline uses `all` as its whole-market keyword; fund-flow uses `aShares`. Thin wrapper
 * so kline call sites read naturally. */
export function isAllMarket(body: KlineBody): boolean {
  return isFullMarket(body, "all")
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
    // every 1-day-sharded full-market query: fund-flow AND day-kline / day-kline-us
    // (both shardDays 1 in cli.ts). Multi-day shards (day-kline-hk=2, index=30) always
    // straddle weekdays, so they're never dropped.
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
  const results = await runWithConcurrency(shards, config.concurrency ?? PAGE_CONCURRENCY, async (shard) => {
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
      aborted = true
      failedShards.push(shard)
      return null
    }
  })

  let fieldList: unknown[] | undefined
  let header: Record<string, unknown> | null = null
  const merged: unknown[] = []
  // Record WHICH windows maxed out, not just how many: a script/agent consumer
  // needs the concrete date ranges to re-pull narrower windows (mirrors failedShards).
  const truncatedShards: Array<{ startDate: string; endDate: string }> = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (!(r && typeof r === "object")) continue
    const rec = r as Record<string, unknown>
    if (!header) header = rec
    if (!fieldList && Array.isArray(rec.fieldList)) fieldList = rec.fieldList
    if (isTruncated(rec)) truncatedShards.push(shards[i])
    // Append one-by-one rather than push(...list): a future higher row cap could
    // make a single shard's list large enough to overflow the stack via spread.
    if (Array.isArray(rec.list)) for (const item of rec.list as unknown[]) merged.push(item)
  }

  // Every shard failed → surface the error loudly (non-zero exit) rather than
  // masking a total outage as an empty success.
  if (failedShards.length === shards.length) {
    throw firstError ?? new Error(`All ${shards.length} kline shards failed`)
  }

  if (!header) return { list: [] }
  // `total` on a shard is that shard's own row count; overwrite it with the merged count
  // so the JSON `total` and the `Total:` stderr line reflect the whole combined result.
  const out: Record<string, unknown> = { ...header, total: merged.length, list: merged }
  if (fieldList) out.fieldList = fieldList
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
