import { ApiError, ValidationError } from "./errors.js"

/** The one client method the batcher needs, so it can be driven without HTTP in tests. */
export interface DetailClient {
  call(endpointKey: string, body?: unknown): Promise<unknown>
}

/** Opinion bodies by ID, for the two detail endpoints. Each takes at most 20 IDs per
 * call and skips, without an error, any ID it has no body for — a typo, an ID outside
 * the account's data window, and possibly one published minutes ago. Batches go out
 * one at a time — 30 credits per returned body — and the IDs that came back empty are
 * named on stderr and in `missingIds`, marking the result partial (exit 3). */
export async function fetchOpinionDetails(client: DetailClient, endpointKey: string, idListField: string, idField: string, ids: string[]): Promise<Record<string, unknown>> {
  const BATCH = 20
  const unique = [...new Set(ids)]
  if (!unique.length) throw new ValidationError("pass at least one opinion ID")
  const list: Record<string, unknown>[] = []
  let unfetched: string[] = []
  let unfetchedError: Record<string, unknown> | undefined
  for (let i = 0; i < unique.length; i += BATCH) {
    try {
      // An array by contract: both detail endpoints declare `expects: "array"`, so the client
      // has already failed any other layout — structurally, with its traceId — instead of
      // letting it read as "no bodies" and report every paid-for ID as missing.
      const rows = await client.call(endpointKey, { [idListField]: unique.slice(i, i + BATCH) }) as Record<string, unknown>[]
      list.push(...rows)
    } catch (error) {
      // Earlier batches are paid for: keep them, and put what was not fetched (and why)
      // in the result itself, so a script can re-run exactly those IDs.
      if (i === 0) throw error
      unfetched = unique.slice(i)
      const message = error instanceof Error ? error.message : String(error)
      unfetchedError = { message, ...(error instanceof ApiError ? { code: error.code, traceId: error.traceId } : {}) }
      process.stderr.write(`[gangtise] warning: ${endpointKey} failed on batch ${i / BATCH + 1} (${message}); ${unfetched.length} ID(s) not fetched: ${unfetched.join(", ")}. The bodies already returned are kept below — re-run for the IDs in unfetchedIds only.\n`)
      break
    }
  }
  const returned = new Set(list.map((row) => String(row[idField])))
  const missing = unique.filter((id) => !returned.has(id) && !unfetched.includes(id))
  const out: Record<string, unknown> = { total: list.length, list }
  if (missing.length > 0) {
    process.stderr.write(`[gangtise] warning: no body returned for ${missing.length} ID(s): ${missing.join(", ")} — the server skips an ID it has no body for without an error (e.g. a wrong ID; a just-published opinion may also not have its body yet). Result marked partial (exit 3).\n`)
    out.missingIds = missing
  }
  if (unfetched.length > 0) {
    out.unfetchedIds = unfetched
    out.unfetchedError = unfetchedError
  }
  if (missing.length > 0 || unfetched.length > 0) out.partial = true
  return out
}
