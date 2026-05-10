import { runWithConcurrency } from "./transport.js"

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
}

interface KlineClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
}

const DAY_MS = 86_400_000

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

function isAllMarket(body: KlineBody): boolean {
  const list = body.securityList
  if (!Array.isArray(list) || list.length !== 1) return false
  return list[0] === "all"
}

function buildShards(start: Date, end: Date, shardDays: number): Array<{ startDate: string; endDate: string }> {
  const shards: Array<{ startDate: string; endDate: string }> = []
  let cursor = start.getTime()
  const endTime = end.getTime()
  while (cursor <= endTime) {
    const shardEnd = Math.min(cursor + (shardDays - 1) * DAY_MS, endTime)
    shards.push({
      startDate: formatDate(new Date(cursor)),
      endDate: formatDate(new Date(shardEnd)),
    })
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
  if (!isAllMarket(body) || !body.startDate || !body.endDate) {
    return client.call(endpointKey, body)
  }

  const start = parseDate(body.startDate)
  const end = parseDate(body.endDate)
  if (!start || !end || end < start) {
    return client.call(endpointKey, body)
  }

  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (totalDays <= config.shardDays) {
    return client.call(endpointKey, body)
  }

  const shards = buildShards(start, end, config.shardDays)
  if (process.env.GANGTISE_VERBOSE === "1" || process.env.GANGTISE_VERBOSE === "true") {
    process.stderr.write(`[gangtise] sharding ${endpointKey} into ${shards.length} requests (${config.shardDays} day(s) each)\n`)
  }

  const results = await runWithConcurrency(shards, config.concurrency ?? 5, async (shard) => {
    return client.call(endpointKey, { ...body, startDate: shard.startDate, endDate: shard.endDate })
  })

  let fieldList: unknown[] | undefined
  let header: Record<string, unknown> | null = null
  const merged: unknown[] = []
  for (const r of results) {
    if (!(r && typeof r === "object")) continue
    const rec = r as Record<string, unknown>
    if (!header) header = rec
    if (!fieldList && Array.isArray(rec.fieldList)) fieldList = rec.fieldList
    if (Array.isArray(rec.list)) merged.push(...(rec.list as unknown[]))
  }

  if (!header) return { list: [] }
  const out: Record<string, unknown> = { ...header, list: merged }
  if (fieldList) out.fieldList = fieldList
  return out
}
