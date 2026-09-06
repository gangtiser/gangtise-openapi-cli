import { ApiError, markStructural } from "./errors.js"
import { columnarSchemaValid } from "./normalize.js"
import { attachRowSink, type JsonlRowSink } from "./rowSink.js"
import { PAGE_CONCURRENCY, runInOrder } from "./transport.js"

interface PartClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
  /** Present on GangtiseClient: the sink of a large jsonl export, if the command opened one. */
  claimRowSink?(): JsonlRowSink | undefined
}

/** Upper bound on the trading days per security in a date range, for sizing a request
 * against the per-request row cap: the exact weekday count (holidays only remove days,
 * so this never under-estimates — an under-estimate sends one request where two were
 * needed and the answer comes back capped). A missing or unusable range means the
 * server's default one-year window: 262 weekdays. */
export function estimateTradingDays(startDate: string | undefined, endDate: string | undefined): number {
  if (!startDate || !endDate) return 262
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 262
  let days = 0
  for (let t = start; t <= end; t += 86_400_000) {
    const weekday = new Date(t).getUTCDay()
    if (weekday !== 0 && weekday !== 6) days++
  }
  return days
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
 * A part with no rows is a legitimate answer (nothing traded in the window) and says
 * nothing about the column layout, so it is neither compared against the header nor
 * allowed to set it; a part with array rows must carry its own valid fieldList or it is a
 * structural error in that part, whatever order the parts arrived in.
 *
 * A part that fills its row cap is recorded in `truncatedSecurities` and the merged result
 * is marked partial (printData → exit 3); a part that already carries `partial` keeps the
 * merge partial too.
 */
export async function callPerSecurity(
  client: PartClient,
  endpointKey: string,
  securities: string[],
  makeBody: (code: string) => Record<string, unknown>,
  cap: number,
  label: string,
): Promise<Record<string, unknown>> {
  // A large jsonl export streams rows out part by part (JsonlRowSink); parts are merged
  // in input order as they complete (runInOrder).
  const sink = client.claimRowSink?.()
  let fieldList: unknown[] | undefined
  let headerSecurity: string | undefined
  /** An empty part's fieldList: used as the output header only when NO part had rows, so a
   * requested-but-missing column is still reported by flagMissingFields. */
  let emptyFields: unknown[] | undefined
  const merged: unknown[] = []
  let count = 0
  const truncated: string[] = []
  let partial = false
  const mergePart = async (part: unknown, i: number): Promise<void> => {
    const rec = part as Record<string, unknown> | null
    if (!(rec && typeof rec === "object" && Array.isArray(rec.list))) {
      throw markStructural(new ApiError(`${label}: ${securities[i]} returned no list payload — the response layout may have changed`, undefined, undefined, rec))
    }
    if (rec.partial === true) partial = true
    if (rec.list.length === 0) {
      if (!emptyFields && Array.isArray(rec.fieldList)) emptyFields = rec.fieldList
      return
    }
    const fields = Array.isArray(rec.fieldList) && rec.fieldList.length > 0 ? rec.fieldList : undefined
    if (rec.list.some(Array.isArray) && !columnarSchemaValid(fields, rec.list)) {
      throw markStructural(new ApiError(`${label}: ${securities[i]} returned columnar rows without a usable fieldList (missing, duplicated or mis-sized) — they cannot be read by position`, undefined, undefined, rec))
    }
    if (fields && !fieldList) {
      fieldList = fields
      headerSecurity = securities[i]
      sink?.setFieldList(fieldList)
    }
    if ((fields ?? fieldList) && !sameColumns(fieldList, fields)) {
      throw markStructural(new ApiError(`${label}: ${securities[i]} answered with columns ${JSON.stringify(fields)} while ${headerSecurity} answered ${JSON.stringify(fieldList)} — the parts cannot be merged`, undefined, undefined, rec))
    }
    if (rec.list.length >= cap) truncated.push(securities[i])
    count += rec.list.length
    if (sink) await sink.push(rec.list)
    else for (const row of rec.list) merged.push(row)
  }
  await runInOrder(securities, PAGE_CONCURRENCY, (code) => client.call(endpointKey, makeBody(code)), mergePart)
  const out: Record<string, unknown> = { total: count, list: merged }
  if (sink) attachRowSink(out, sink)
  if (fieldList) out.fieldList = fieldList
  else if (count === 0 && emptyFields) out.fieldList = emptyFields
  if (partial) out.partial = true
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
