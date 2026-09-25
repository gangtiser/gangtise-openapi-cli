/** Plumbing shared by every command group: client acquisition, the print pipeline,
 * downloads, the time-filter option set, and the guards more than one group needs. */
import { Command, Option } from "commander"

import { collectList, dateArg, datetimeArg, maybeArray, numberListArg, parseChoiceList, parseFrom, parseNumberOption, parseOptionalNumberOption, parseSize } from "../core/args.js"
import { loadConfig } from "../core/config.js"
import { releaseClaim, resolveTitle, saveDownloadResult, uniquePath } from "../core/download.js"
import { ENDPOINTS } from "../core/endpoints.js"
import { ValidationError } from "../core/errors.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { ExportSink } from "../core/rowSink.js"
import type { GangtiseClient } from "../core/client.js"
import type { TitleCacheConfig } from "../core/titleCache.js"

/** Output options of a query command, read up front so a large jsonl / csv export to a
 * file can stream rows out as they arrive (ExportSink) instead of collecting them first. */
export interface StreamOptions { format?: string; output?: string; cache?: TitleCacheConfig }

// --- Lazy-loaded modules (deferred to action handlers) ---
export async function createClient(stream?: StreamOptions) {
  const { GangtiseClient } = await import("../core/client.js")
  // Only a jsonl / csv export to a file streams; every other format collects in memory as before.
  const sink = stream?.output && (stream.format === "jsonl" || stream.format === "csv") ? new ExportSink(stream.output, stream.format, stream.cache) : undefined
  return new GangtiseClient(loadConfig(), sink)
}

/**
 * Acquire a client, run `produce` to fetch data, and render it through the
 * shared pipeline. Collapses the `createClient()` + `printData(await client.call(...),
 * parseOutputFormat(options.format), options.output)` boilerplate that every
 * query command repeated.
 */
export async function emit(
  options: { format?: string; output?: string },
  produce: (client: GangtiseClient) => Promise<unknown>,
  cache?: TitleCacheConfig,
): Promise<void> {
  // Validate --format before fetching: a typo'd format must not burn a full
  // (possibly credit-metered) data pull only to fail at render time.
  const format = parseOutputFormat(options.format)
  const client = await createClient({ format, output: options.output, cache })
  try {
    await printData(await produce(client), format, options.output, cache)
  } finally {
    // A no-op after printData finished the file; on any failure it removes the .part.
    await client.rowSink?.abort()
  }
}

/** Acquire a client and run an arbitrary action (downloads, polling, custom shaping).
 * Query commands that print through printData themselves pass their output options
 * first, so a jsonl export can stream (see createClient). */
export async function withClient(fn: (client: GangtiseClient) => Promise<void>): Promise<void>
export async function withClient(stream: StreamOptions, fn: (client: GangtiseClient) => Promise<void>): Promise<void>
export async function withClient(a: StreamOptions | ((client: GangtiseClient) => Promise<void>), b?: (client: GangtiseClient) => Promise<void>): Promise<void> {
  const [stream, fn] = typeof a === "function" ? [undefined, a] : [a, b as (client: GangtiseClient) => Promise<void>]
  const client = await createClient(stream)
  try {
    await fn(client)
  } finally {
    await client.rowSink?.abort()
  }
}

/**
 * Server-side default row cap shared by the limit-capped, non-paginated quote endpoints
 * (fund-flow, minute-kline, day/index kline — all default to 6000 per the API docs). We
 * send it EXPLICITLY when `--limit` is omitted (rather than letting the server apply its
 * own default) so the request limit and the truncation `cap` below are always the same
 * number — never a guess about the server's default that can drift out of sync.
 */
export const DEFAULT_QUOTE_LIMIT = 6000

/**
 * Limit-capped, non-paginated endpoints (fund-flow, kline) report `total` as the
 * RETURNED row count, not the true total, so a full page (rows == the limit we sent) is
 * the only truncation signal. Flag the result partial (printData → exit 3) + warn so a
 * capped export isn't mistaken for the full set. `cap` MUST be the exact limit the caller
 * sent on the request. Where the server has a row ceiling of its own (the quote
 * endpoints: 10000), `--limit` is validated to it, so `cap` never exceeds that ceiling
 * and hides a truncation.
 */
export function flagIfLimitTruncated(data: unknown, cap: number, label: string, rangeFlags = "--start-date/--end-date", advice?: string): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const rec = data as Record<string, unknown>
  if (rec.partial === true) return
  if (Array.isArray(rec.list) && rec.list.length >= cap) {
    rec.partial = true
    process.stderr.write(`[gangtise] warning: ${label} returned ${rec.list.length} rows = the ${cap}-row limit; results are likely truncated (this endpoint has no pagination). ${advice ?? `Narrow ${rangeFlags} or raise --limit (max 10000), fetching in date batches.`}\n`)
  }
}

/**
 * Run a download. If `output` is set we already know the destination, so the
 * client streams the body straight to disk (no in-memory Uint8Array copy);
 * otherwise we buffer and let the caller resolve a friendly title.
 */
export async function runDownload(
  client: { call: (k: string, body?: unknown, q?: Record<string, string | number>, o?: { streamTo?: string }) => Promise<unknown> },
  endpointKey: string,
  query: Record<string, string | number>,
  options: { output?: string; fallbackName: string; body?: unknown; resolveOutputPath?: (result: unknown) => Promise<string | undefined> },
): Promise<void> {
  if (options.output) {
    const result = await client.call(endpointKey, options.body, query, { streamTo: options.output })
    await saveDownloadResult(result, options.fallbackName, options.output)
    return
  }
  const result = await client.call(endpointKey, options.body, query)
  const resolved = options.resolveOutputPath ? await options.resolveOutputPath(result) : undefined
  // Title-derived names are auto-generated too — dedupe them like the fallback names.
  // uniquePath claims the name by creating the final file itself as an empty
  // placeholder; if the save never happens, releaseClaim removes that (still empty)
  // placeholder so it does not linger looking like a finished download.
  const target = resolved ? await uniquePath(resolved) : undefined
  try {
    await saveDownloadResult(result, options.fallbackName, target)
  } catch (error) {
    if (target) await releaseClaim(target)
    throw error
  }
}

/**
 * Register a download subcommand. All download commands share one shape: a
 * required id option, optionally --file-type / --content-type, then --output.
 * `idField` doubles as the commander option key and the query/title-cache
 * field, so it must stay the camelCase twin of `idOption`.
 */
export function addDownloadCommand(parent: Command, spec: {
  endpointKey: string
  idOption: string
  idField: string
  fallbackPrefix: string
  name?: string
  // `choices` is REQUIRED whenever fileType is offered: an out-of-range value is
  // not rejected server-side, it just downloads something else (probed 2026-08-08:
  // --file-type 99 went out as fileType=99 and the download proceeded). Typing it
  // as mandatory keeps a future download command from silently skipping the guard.
  fileType?: { description: string; choices: string[]; default?: string; required?: boolean }
  contentTypeDescription?: string
  titleListEndpoint?: string
}) {
  const cmd = parent.command(spec.name ?? "download").requiredOption(`${spec.idOption} <id>`)
  if (spec.fileType) {
    const option = new Option("--file-type <number>", spec.fileType.description).choices(spec.fileType.choices)
    cmd.addOption(spec.fileType.required ? option.makeOptionMandatory() : option.default(spec.fileType.default))
  }
  if (spec.contentTypeDescription) cmd.requiredOption("--content-type <type>", spec.contentTypeDescription)
  // Opt-in because it is NOT free: on a title-cache miss the lookup pulls
  // TITLE_LOOKUP_SIZE rows (4 requests) from a list endpoint that is metered per row
  // on most of these commands. Running `... list` first caches the titles and makes
  // the friendly name free, which is the documented workflow.
  if (spec.titleListEndpoint) {
    cmd.option("--resolve-title", "On a title-cache miss, query the list endpoint for a friendly filename (4 extra requests; most of these list endpoints bill per row). Without it the server filename or <prefix>-<id> is used. Ignored when --output is given")
  }
  cmd.option("--output <path>").action((options) => withClient(async (client) => {
    const id = options[spec.idField] as string
    const qp: Record<string, string | number> = { [spec.idField]: id }
    if (spec.fileType && options.fileType) qp.fileType = parseNumberOption(options.fileType, "--file-type", { integer: true, min: 1 })
    if (spec.contentTypeDescription) qp.contentType = options.contentType as string
    const titleList = spec.titleListEndpoint
    await runDownload(client, spec.endpointKey, qp, {
      output: options.output,
      fallbackName: `${spec.fallbackPrefix}-${id}`,
      resolveOutputPath: titleList
        ? (result) => resolveTitle(client, result, titleList, spec.idField, id, { allowLookup: Boolean(options.resolveTitle) })
        : undefined,
    })
  }))
}

/** The `--yes` gate for irreversible endpoints, shared by the dedicated commands and
 * `raw call`. It reads `ENDPOINTS[key].destructive` so there is one fact, not two:
 * a rule duplicated per entry point is a rule that will be added to one and not the
 * other. Throws BEFORE a client is acquired, so a refusal can never race a
 * half-issued request. */
export function assertConfirmed(endpointKey: string, confirmed: boolean, target: string): void {
  const destructive = ENDPOINTS[endpointKey]?.destructive
  if (!destructive || confirmed) return
  throw new ValidationError(`${destructive.warning} 确认要对 ${target} 执行就加上 --yes。`)
}

// ─── declared query commands ───

/** One option of a query command together with the request-body entry it feeds. The two
 * used to be written separately for every command — the option chain in one place, the
 * body object in another — and a flag wired to the wrong key, or to none, stayed
 * invisible until a filter silently stopped filtering. `body` is left out for options
 * that steer the command rather than the request (--format, --output, --with-content). */
export interface Field {
  option: Option
  body?: (value: any) => Record<string, unknown>
}

export const field = (option: Option, body?: Field["body"]): Field => ({ option, body })

/** Sent as given. */
export const value = (flags: string, description: string | undefined, key: string): Field =>
  field(new Option(flags, description), (v) => ({ [key]: v }))

/** Sent as given; Commander refuses the command without it. */
export const required = (flags: string, description: string | undefined, key: string): Field =>
  field(new Option(flags, description).makeOptionMandatory(), (v) => ({ [key]: v }))

/** A yyyy-MM-dd date, validated as it is parsed. */
export const date = (flags: string, description: string, key: string, opts: { required?: boolean } = {}): Field => {
  const option = new Option(flags, description)
  option.argParser(dateArg(option.long as string))
  return field(opts.required ? option.makeOptionMandatory() : option, (v) => ({ [key]: v }))
}

/** Repeatable or comma-separated; left out of the body when empty. */
export const list = (flags: string, description: string, key: string): Field =>
  field(new Option(flags, description).argParser(collectList).default([]), (v: string[]) => ({ [key]: maybeArray(v) }))

/** Repeatable numbers; left out of the body when empty. */
export const numberList = (flags: string, description: string, key: string): Field => {
  const option = new Option(flags, description).default([])
  option.argParser(numberListArg(option.long as string))
  return field(option, (v: number[]) => ({ [key]: v.length ? v : undefined }))
}

/** Repeatable, and every value checked against a known set before anything is sent. */
export const choiceList = (flags: string, description: string, key: string, choices: readonly string[]): Field => {
  const option = new Option(flags, description).argParser(collectList).default([])
  return field(option, (v: string[]) => ({ [key]: parseChoiceList(v, option.long as string, choices) }))
}

/** Optional non-negative integer. */
export const count = (flags: string, description: string, key: string): Field => {
  const option = new Option(flags, description)
  return field(option, (v: string | undefined) => ({ [key]: parseOptionalNumberOption(v, option.long as string, { integer: true, min: 0 }) }))
}

/** A numeric enum the API takes as a number. */
const numberEnum = (flags: string, description: string, key: string, choices: string[], fallback: string): Field => {
  const option = new Option(flags, description).choices(choices).default(fallback)
  return field(option, (v: string) => ({ [key]: parseNumberOption(v, option.long as string, { integer: true, min: 1 }) }))
}
export const rankType = (): Field => numberEnum("--rank-type <number>", "Rank type: 1=composite 2=time desc", "rankType", ["1", "2"], "1")
export const searchType = (): Field => numberEnum("--search-type <number>", "Search type: 1=title 2=fulltext", "searchType", ["1", "2"], "1")

/** --top, capped at the endpoint's own ceiling. */
export const top = (max: number): Field =>
  field(new Option("--top <number>", `Max results (default: 10, max: ${max})`).default("10"), (v: string) => ({ top: parseNumberOption(v, "--top", { integer: true, min: 1, max }) }))

export const flag = (flags: string, description: string): Field => field(new Option(flags, description))
export const format = (fallback = "table"): Field => field(new Option("--format <format>", "Output format").default(fallback))
export const output = (description?: string): Field => field(new Option("--output <path>", description))

export const from = (): Field => field(new Option("--from <number>", "Starting offset").default("0"), (v: string) => ({ from: parseFrom(v) }))
export const size = (description = "Total rows to return; omit to fetch all"): Field =>
  field(new Option("--size <number>", description), (v: string | undefined) => ({ size: parseSize(v) }))

/** How a datetime option reaches the body: as typed, or converted (e.g. to epoch millis). */
type TimeValue = (value: string | undefined, flag: string) => unknown
const asTyped: TimeValue = (v) => v
export const startTime = (description = "Start time", toBody: TimeValue = asTyped): Field =>
  field(new Option("--start-time <datetime>", description).argParser(datetimeArg("--start-time")), (v) => ({ startTime: toBody(v, "--start-time") }))
export const endTime = (description = "End time", toBody: TimeValue = asTyped): Field =>
  field(new Option("--end-time <datetime>", description).argParser(datetimeArg("--end-time")), (v) => ({ endTime: toBody(v, "--end-time") }))

/** The five options every insight list ends with, in that order. */
export const timeFilters = (toBody: TimeValue = asTyped): Field[] =>
  [from(), size(), startTime("Start time", toBody), endTime("End time", toBody), value("--keyword <keyword>", "Keyword", "keyword")]

export const requestBody = (fields: Field[], options: Record<string, unknown>): Record<string, unknown> =>
  Object.assign({}, ...fields.map((f) => f.body?.(options[f.option.attributeName()]) ?? {}))

/** A command that is one request: its options, in help order, each feeding the body. */
export function query(parent: Command, name: string, spec: {
  description?: string
  endpoint: string | ((options: Record<string, unknown>) => string)
  fields: Field[]
  cache?: TitleCacheConfig
}): Command {
  const command = parent.command(name)
  if (spec.description) command.description(spec.description)
  for (const f of spec.fields) command.addOption(f.option)
  return command.action((options) => emit(options, (client) => client.call(
    typeof spec.endpoint === "string" ? spec.endpoint : spec.endpoint(options),
    requestBody(spec.fields, options),
  ), spec.cache))
}
