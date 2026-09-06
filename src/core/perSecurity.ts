import { ApiError, markStructural } from "./errors.js"
import { PAGE_CONCURRENCY, runWithConcurrency } from "./transport.js"

interface PartClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
}

/** Days per security the server would answer for a date range, for sizing a request
 * against the per-request row cap. Calendar days scaled to trading days; a missing
 * range means the server's default one-year window. */
export function estimateTradingDays(startDate: string | undefined, endDate: string | undefined): number {
  if (!startDate || !endDate) return 250
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 250
  const calendarDays = Math.floor((end - start) / 86_400_000) + 1
  return Math.ceil(calendarDays * 5 / 7)
}

/**
 * Fan a query out one request per security (`PAGE_CONCURRENCY` wide) and merge the
 * columnar answers in input order.
 *
 * Used where the API takes a single security per request (minute-kline), and where one
 * request naming N securities would exceed the per-request row cap (day-kline over a long
 * range). Every part is the same endpoint with the same fieldList request, so the column
 * layout must agree exactly: a part whose fieldList differs is a broken response and fails
 * the whole command rather than being merged under the wrong names. The per-day sharder
 * tolerates a bad shard because the surviving windows are still useful; here the caller
 * named every security, and one silently missing from the output is exactly the gap the
 * exit code exists to surface — so errors propagate too (a wrong code fails the command
 * with 120001, as the single-request path does).
 *
 * A part that fills its row cap is recorded in `truncatedSecurities` and the merged result
 * is marked partial (printData → exit 3).
 */
export async function callPerSecurity(
  client: PartClient,
  endpointKey: string,
  securities: string[],
  makeBody: (code: string) => Record<string, unknown>,
  cap: number,
  label: string,
): Promise<Record<string, unknown>> {
  const results = await runWithConcurrency(securities, PAGE_CONCURRENCY, (code) => client.call(endpointKey, makeBody(code)))
  let fieldList: unknown[] | undefined
  const merged: unknown[] = []
  const truncated: string[] = []
  for (let i = 0; i < results.length; i++) {
    const rec = results[i] as Record<string, unknown> | null
    if (!(rec && typeof rec === "object" && Array.isArray(rec.list))) {
      throw markStructural(new ApiError(`${label}: ${securities[i]} returned no list payload — the response layout may have changed`, undefined, undefined, rec))
    }
    const fields = Array.isArray(rec.fieldList) ? rec.fieldList : undefined
    if (fields && !fieldList) fieldList = fields
    if ((fields ?? fieldList) && !sameColumns(fieldList, fields)) {
      throw markStructural(new ApiError(`${label}: ${securities[i]} answered with columns ${JSON.stringify(fields)} while ${securities[0]} answered ${JSON.stringify(fieldList)} — the parts cannot be merged`, undefined, undefined, rec))
    }
    if (rec.list.length >= cap) truncated.push(securities[i])
    for (const row of rec.list) merged.push(row)
  }
  const out: Record<string, unknown> = { total: merged.length, list: merged }
  if (fieldList) out.fieldList = fieldList
  if (truncated.length > 0) {
    out.partial = true
    out.truncatedSecurities = truncated
    process.stderr.write(`[gangtise] warning: ${label}: ${truncated.join(", ")} returned ${cap} rows = the per-request limit; those securities are likely truncated (see truncatedSecurities). Narrow the date range for them or raise --limit (max 10000).\n`)
  }
  return out
}

function sameColumns(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (!a || !b) return false
  return a.length === b.length && a.every((field, i) => field === b[i])
}
