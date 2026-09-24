#!/usr/bin/env node
import { Command, Option } from "commander"

import { checkAsyncContent, pollAsyncContent, POLL_MAX_ATTEMPTS } from "./core/asyncContent.js"
import { readTokenCache, redactTokenCache } from "./core/auth.js"
import { collectKeyValue, collectList, collectNumberList, collectText, dateArg, datetimeArg, screenerExpressionFields, isVersionNewer, localDateString, maybeArray, parseChoiceList, parseFrom, parseNumberOption, parseOptionalNumberOption, parseScreenerIndicators, parseSize, parseTimestamp13 } from "./core/args.js"
import { buildIndicatorCrossSectionBody, buildIndicatorScreenerBody, buildIndicatorTimeSeriesBody, buildQuoteKlineBody, buildStockPoolStocksBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "./core/commandBodies.js"
import { checkScreenerBindings, droppedFromMatrix, flattenCrossSection, flattenTimeSeries, isEmptyMatrix, requireIndicatorMatrix, unwrapIndicatorData } from "./core/indicatorMatrix.js"
import { callPerSecurity, estimateTradingDays } from "./core/perSecurity.js"
import { callKlineWithSharding, isFullMarket } from "./core/quoteSharding.js"
import { loadConfig } from "./core/config.js"
import { releaseClaim, resolveTitle, saveDownloadResult, uniquePath } from "./core/download.js"
import { resolveCalendarType } from "./core/calendarType.js"
import { ENDPOINTS, listEndpoints } from "./core/endpoints.js"
import { ApiError, ConfigError, ValidationError } from "./core/errors.js"
import { uploadDriveFile } from "./core/driveUpload.js"
import { fetchFileParseResult, pollFileParseResult, submitFileParse } from "./core/fileParse.js"
import { assertColumnarHeader, flagFailedItems, flagMissingFields, normalizeRows, zipFieldRow } from "./core/normalize.js"
import { parseOutputFormat } from "./core/output.js"
import { printData } from "./core/printer.js"
import { ExportSink, rowCount } from "./core/rowSink.js"
import type { GangtiseClient } from "./core/client.js"
import type { TitleCacheConfig } from "./core/titleCache.js"

/** Output options of a query command, read up front so a large jsonl / csv export to a
 * file can stream rows out as they arrive (ExportSink) instead of collecting them first. */
interface StreamOptions { format?: string; output?: string; cache?: TitleCacheConfig }

// --- Lazy-loaded modules (deferred to action handlers) ---
async function createClient(stream?: StreamOptions) {
  const { GangtiseClient } = await import("./core/client.js")
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
async function emit(
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
async function withClient(fn: (client: GangtiseClient) => Promise<void>): Promise<void>
async function withClient(stream: StreamOptions, fn: (client: GangtiseClient) => Promise<void>): Promise<void>
async function withClient(a: StreamOptions | ((client: GangtiseClient) => Promise<void>), b?: (client: GangtiseClient) => Promise<void>): Promise<void> {
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
const DEFAULT_QUOTE_LIMIT = 6000

/**
 * Limit-capped, non-paginated endpoints (fund-flow, kline) report `total` as the
 * RETURNED row count, not the true total, so a full page (rows == the limit we sent) is
 * the only truncation signal. Flag the result partial (printData → exit 3) + warn so a
 * capped export isn't mistaken for the full set. `cap` MUST be the exact limit the caller
 * sent on the request; `--limit` is validated to <= 10000 so `cap` can't exceed the
 * server ceiling and hide a truncation.
 */
function flagIfLimitTruncated(data: unknown, cap: number, label: string, rangeFlags = "--start-date/--end-date"): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const rec = data as Record<string, unknown>
  if (rec.partial === true) return
  if (Array.isArray(rec.list) && rec.list.length >= cap) {
    rec.partial = true
    process.stderr.write(`[gangtise] warning: ${label} returned ${rec.list.length} rows = the ${cap}-row limit; results are likely truncated (this endpoint has no pagination). Narrow ${rangeFlags} or raise --limit (max 10000), fetching in date batches.\n`)
  }
}

/**
 * Run a download. If `output` is set we already know the destination, so the
 * client streams the body straight to disk (no in-memory Uint8Array copy);
 * otherwise we buffer and let the caller resolve a friendly title.
 */
async function runDownload(
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
function addDownloadCommand(parent: Command, spec: {
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

function addTimeFilters(command: Command) {
  return command
    .option("--from <number>", "Starting offset", "0")
    .option("--size <number>", "Total rows to return; omit to fetch all")
    .option("--start-time <datetime>", "Start time", datetimeArg("--start-time"))
    .option("--end-time <datetime>", "End time", datetimeArg("--end-time"))
    .option("--keyword <keyword>", "Keyword")
}

import { isVerbose, setVerbose } from "./core/transport.js"
import { CLI_VERSION } from "./version.js"

const program = new Command()

program
  .name("gangtise")
  .description("Gangtise OpenAPI CLI")
  .version(CLI_VERSION)
  .option("--verbose", "Print per-request timings to stderr (also: GANGTISE_VERBOSE=1)")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts().verbose) setVerbose(true)
  })

program
  .command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login")
      .option("--show-token", "Show the raw access token (default: redacted)")
      .option("--format <format>", "Output format", "json")
      .action((options) => emit(options, async (client) => {
        const result = await client.login()
        // `source` is the load-bearing field: with GANGTISE_TOKEN set, that token is
        // what every other command sends, and no login happened. Without it the output
        // reads like "logged in as X" while requests go out as someone else.
        const note = result.source === "env-token"
          ? "GANGTISE_TOKEN is set, so this is the token every command will send — no login was performed. Unset it to use GANGTISE_ACCESS_KEY / GANGTISE_SECRET_KEY instead."
          : undefined
        const base = { source: result.source, ...(note ? { note } : {}) }
        return options.showToken
          ? { ...base, authorization: result.authorization, cache: result.cache }
          : { ...base, authorization: "<redacted>", cache: redactTokenCache(result.cache) }
      })),
  )
  .addCommand(
    new Command("status")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const config = loadConfig()
        const cache = await readTokenCache(config.tokenCachePath)
        await printData({ hasEnvToken: Boolean(config.token), hasCachedToken: Boolean(cache?.accessToken), cache: redactTokenCache(cache) }, parseOutputFormat(options.format))
      }),
  )

const lookup = new Command("lookup").description("Local lookup tables (IDs not covered by 'reference constant-list')")
const addLookupList = (name: string, endpointKey: string, description?: string) => {
  const cmd = new Command(name)
  if (description) cmd.description(description)
  lookup.addCommand(cmd.addCommand(new Command("list").option("--format <format>", "Output format", "table").action((options) => emit(options, (client) => client.call(endpointKey)))))
}
addLookupList("broker-org", "lookup.broker-orgs.list")
addLookupList("meeting-org", "lookup.meeting-orgs.list")
program.addCommand(lookup)

const insight = new Command("insight").description("Insight APIs")
const opinion = new Command("opinion")
const summary = new Command("summary")
const pamirsSummary = new Command("pamirs-summary")
const roadshow = new Command("roadshow")
const siteVisit = new Command("site-visit")
const strategy = new Command("strategy")
const forum = new Command("forum")
const performanceCalendar = new Command("performance-calendar")
const research = new Command("research")
const foreignReport = new Command("foreign-report")
const announcement = new Command("announcement")
const announcementHk = new Command("announcement-hk")
const announcementUs = new Command("announcement-us")
const foreignOpinion = new Command("foreign-opinion")
const independentOpinion = new Command("independent-opinion")
const officialAccount = new Command("official-account")
const qa = new Command("qa")
const reportImage = new Command("report-image")

addTimeFilters(opinion.command("list").addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--research-area <id>", "Research area ID: citicIndustry code (1008001xx) or gangtiseIndustry direction code (122000xxx: macro/strategy/fixed-income/quant/overseas). swIndustry (104xx0000) returns 0 here", collectList, []).option("--chief <id>", "Chief ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--concept <id>", "Concept ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--source <source>", "Source", collectList, []).option("--with-content", "Return the full body inline (v1 list, 30 credits/row) instead of the 200-char brief (1 credit/row). v1 shape: title and body sit under contentList.title / contentList.content, and there is no brief").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call(options.withContent ? "insight.opinion.list-with-content" : "insight.opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), chiefList: maybeArray(options.chief),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker), industryList: maybeArray(options.industry), conceptList: maybeArray(options.concept),
    llmTagList: maybeArray(options.llmTag), sourceList: maybeArray(options.source),
  })))

addTimeFilters(summary.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--source <number>", "Source type", collectNumberList, []).option("--research-area <id>", "Research area ID; this endpoint accepts all three code sets: citicIndustry (1008001xx), swIndustry (104xx0000), gangtiseIndustry direction (122000xxx)", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.summary.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, sourceList: options.source.length ? options.source : undefined,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
  }), { endpointKey: "insight.summary.list", idField: "summaryId" }))
addDownloadCommand(summary, { endpointKey: "insight.summary.download", idOption: "--summary-id", idField: "summaryId", fallbackPrefix: "summary", fileType: { description: "File type: 1=original(default) 2=HTML; only affects meeting platform summaries", choices: ["1", "2"] }, titleListEndpoint: "insight.summary.list" })

// Pamirs is one lead institution's expert-summary library, exposed on its own
// path rather than as a `summary list` filter. It advertises a NARROWER filter
// set than `summary` — no --source / --institution / --participant-role — so the
// options are spelled out here instead of sharing summary's builder: an
// unsupported flag would be dropped server-side and silently widen the result.
// Every enum is whitelisted locally. The server drops an unrecognised VALUE the
// same way it drops an unrecognised FIELD — silently, returning the unfiltered
// set with exit 0. Worse, a bad `--search-type` takes `--keyword` down with it:
// `--keyword 茅台 --search-type 99` answers the whole library instead of the
// handful that match, so the caller reads a full-library dump as a keyword hit.
// Same class of defect
// that put whitelists on securities-search / institution-search / official-account.
const PAMIRS_CATEGORIES = ["companyAnalysis", "industryAnalysis"] as const
const PAMIRS_MARKETS = ["aShares", "hkStocks", "usChinaConcept", "usStocks"] as const
addTimeFilters(pamirsSummary.command("list").description("List Pamirs expert summaries (requires the expert-summary database)").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--research-area <id>", "Research area ID: accepts BOTH industry code sets -- citicIndustry (1008001xx) and swIndustry (104xx0000) -- but NOT gangtiseIndustry direction codes (122000xxx), which return 0 on this endpoint only", collectList, []).option("--security <code>", "Security code, e.g. 000001.SZ", collectList, []).option("--category <name>", `Category: ${PAMIRS_CATEGORIES.join(" / ")}`, collectList, []).option("--market <name>", `Market: ${PAMIRS_MARKETS.join(" / ")}`, collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.pamirs-summary.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security),
    categoryList: parseChoiceList(options.category, "--category", PAMIRS_CATEGORIES), marketList: parseChoiceList(options.market, "--market", PAMIRS_MARKETS),
  }), { endpointKey: "insight.pamirs-summary.list", idField: "summaryId" }))
addDownloadCommand(pamirsSummary, { endpointKey: "insight.pamirs-summary.download", idOption: "--summary-id", idField: "summaryId", fallbackPrefix: "pamirs-summary", fileType: { description: "File type: 1=original(default) 2=HTML", choices: ["1", "2"] }, titleListEndpoint: "insight.pamirs-summary.list" })

// Each schedule endpoint accepts a different subset of filters (see API spec);
// the blanket helper used to expose all of them, so an unsupported flag (e.g.
// strategy --research-area) silently returned 0. Each command now advertises
// only the fields its endpoint supports. `category`/`market` carry per-command
// help because their valid values differ (roadshow type vs site-visit form).
type ScheduleFields = {
  researchArea?: boolean
  institution?: boolean
  security?: boolean
  object?: boolean
  category?: string
  market?: string
  participantRole?: boolean
  brokerType?: boolean
  permission?: boolean
  location?: boolean
}
const addScheduleList = (command: Command, endpointKey: string, fields: ScheduleFields) => {
  const list = command.command("list")
  if (fields.researchArea) list.option("--research-area <id>", "Research area ID: citicIndustry code (1008001xx) or gangtiseIndustry direction code (122000xxx: macro/strategy/fixed-income/quant/overseas). swIndustry (104xx0000) returns 0 here", collectList, [])
  if (fields.institution) list.option("--institution <id>", "Lead institution ID", collectList, [])
  if (fields.security) list.option("--security <code>", "Security code", collectList, [])
  if (fields.object) list.option("--object <type>", "Object type: company/industry", collectList, [])
  if (fields.category) list.option("--category <name>", fields.category, collectList, [])
  if (fields.market) list.option("--market <name>", fields.market, collectList, [])
  if (fields.participantRole) list.option("--participant-role <name>", "Participant role: management/expert", collectList, [])
  if (fields.brokerType) list.option("--broker-type <name>", "Lead broker type: cnBroker/otherBroker", collectList, [])
  if (fields.permission) list.option("--permission <number>", "Permission: 1=public 2=private", collectNumberList, [])
  if (fields.location) list.option("--location <id>", "Location ID (domesticCity constant, via 'reference constant-list')", collectList, [])
  list.option("--format <format>", "Output format", "table").option("--output <path>", "Output path")
  addTimeFilters(list).action((options) => emit(options, (client) => client.call(endpointKey, {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    researchAreaList: fields.researchArea ? maybeArray(options.researchArea) : undefined,
    institutionList: fields.institution ? maybeArray(options.institution) : undefined,
    securityList: fields.security ? maybeArray(options.security) : undefined,
    objectList: fields.object ? maybeArray(options.object) : undefined,
    categoryList: fields.category ? maybeArray(options.category) : undefined,
    marketList: fields.market ? maybeArray(options.market) : undefined,
    participantRoleList: fields.participantRole ? maybeArray(options.participantRole) : undefined,
    brokerTypeList: fields.brokerType ? maybeArray(options.brokerType) : undefined,
    permission: fields.permission && options.permission?.length ? options.permission : undefined,
    locationList: fields.location ? maybeArray(options.location) : undefined,
  })))
}
addScheduleList(roadshow, "insight.roadshow.list", {
  researchArea: true, institution: true, security: true, location: true,
  category: "Roadshow type: earningsCall/strategyMeeting/companyAnalysis/industryAnalysis/fundRoadshow",
  market: "Market: aShares/hkStocks/usChinaConcept/usStocks",
  participantRole: true, brokerType: true, permission: true,
})
addScheduleList(siteVisit, "insight.site-visit.list", {
  researchArea: true, institution: true, security: true, location: true, object: true,
  category: "Site-visit form: single/series",
  market: "Market: aShares/hkStocks/usChinaConcept",
  permission: true,
})
addScheduleList(strategy, "insight.strategy.list", { institution: true, location: true })
addScheduleList(forum, "insight.forum.list", { researchArea: true, location: true })

// Earnings calendar: the only insight list filtered by DATE (--start-date/--end-date
// on publishDate), not by the --start-time datetime every sibling uses — so it does
// not go through addTimeFilters. It also takes no --keyword / --rank-type / --search-type.
/** Row ceiling applied when `--security` is the only thing bounding a
 * performance-calendar fetch. Far above any single company's calendar (a whole
 * A-share history is dozens of rows), far below the 50k the auto-pagination
 * would otherwise pull if the server ever stopped honoring securityList. */
const SECURITY_ONLY_ROW_CAP = 1000

/** Warn + mark partial when a `--security`-only fetch lands on the cap with rows
 * still unfetched: that is the signature of a filter that did not narrow anything,
 * and the rows on screen are then a truncated slice of the whole calendar rather
 * than a company's. `total` decides it — a result that happens to be exactly `cap`
 * rows long IS complete (from + rows covers total) and must stay exit 0, or every
 * automated caller reads a full answer as truncated. */
function flagIfImplicitCapHit(data: unknown, cap: number, from: number): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const rec = data as Record<string, unknown>
  const rows = rowCount(data)
  if (rows < cap) return
  const total = typeof rec.total === "number" ? rec.total : undefined
  if (total !== undefined && from + rows >= total) return
  rec.partial = true
  process.stderr.write(`[gangtise] warning: --security was the only bound, so the fetch was capped at ${cap} rows and more remain (total=${String(rec.total)}) — the filter may not have narrowed anything. Re-run with --start-date/--end-date or an explicit --size.\n`)
}

const PERFORMANCE_MARKETS = ["aShares", "hkStocks", "usChinaConcept", "usStocks"] as const
const PERFORMANCE_CATEGORIES = ["performanceForecast", "performanceExpress", "performanceAnnouncement"] as const
performanceCalendar.command("list").description("Earnings calendar (业绩预告 / 快报 / 公告)")
  .option("--from <number>", "Starting offset", "0")
  .option("--size <number>", "Total rows to return; omit to fetch all")
  .option("--start-date <date>", "Start date (yyyy-MM-dd), filters publishDate", dateArg("--start-date"))
  .option("--end-date <date>", "End date (yyyy-MM-dd), filters publishDate", dateArg("--end-date"))
  .option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, [])
  .option("--market <name>", `Market: ${PERFORMANCE_MARKETS.join("/")}`, collectList, [])
  .option("--category <name>", `Event type: ${PERFORMANCE_CATEGORIES.join("/")}`, collectList, [])
  .option("--format <format>", "Output format", "table").option("--output <path>", "Output path")
  .action((options) => {
    // Enum typos first: a misspelled --category is the likelier mistake, and its
    // message is the more useful one when both checks would fire.
    const marketList = parseChoiceList(options.market, "--market", PERFORMANCE_MARKETS)
    const categoryList = parseChoiceList(options.category, "--category", PERFORMANCE_CATEGORIES)
    // Unfiltered, this endpoint holds well over 100k rows (probed 2026-07-25; it
    // also carries FUTURE scheduled events) and an omitted --size means "fetch
    // everything" — 50k rows at the 1000-page cap, ~5000 credits at 0.1/row.
    // Require a bound: a full date range, an explicit --size, or a security filter.
    const explicitlyBounded = Boolean(options.size) || Boolean(options.startDate && options.endDate)
    if (!explicitlyBounded && !options.security.length) {
      throw new ValidationError("insight performance-calendar list without a bound would auto-paginate the whole calendar (>120k rows at 0.1 credits each): pass --start-date and --end-date, or --security, or an explicit --size")
    }
    // --security is only a real bound while the server honors securityList. It does
    // today (probed 2026-07-25: an unknown or malformed code returns total 0, it is
    // not silently ignored like a bad enum) — but a five-figure credit bill must not
    // rest on that staying true. When --security is the ONLY bound, cap the fetch:
    // one company's whole calendar is dozens of rows, so the cap is invisible in
    // normal use and turns a filter regression into a truncated result (partial +
    // exit 3) instead of a 5000-credit pull.
    const implicitCap = explicitlyBounded ? undefined : SECURITY_ONLY_ROW_CAP
    const from = parseFrom(options.from)
    return emit(options, async (client) => {
      const data = await client.call("insight.performance-calendar.list", {
        from, size: parseSize(options.size) ?? implicitCap,
        startDate: options.startDate, endDate: options.endDate,
        marketList,
        securityList: maybeArray(options.security),
        categoryList,
      })
      if (implicitCap) flagIfImplicitCapHit(data, implicitCap, from)
      return data
    }, { endpointKey: "insight.performance-calendar.list", idField: "performanceReportId" })
  })
addDownloadCommand(performanceCalendar, { endpointKey: "insight.performance-calendar.download", idOption: "--performance-report-id", idField: "performanceReportId", fallbackPrefix: "performance-calendar", titleListEndpoint: "insight.performance-calendar.list" })

addTimeFilters(research.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--broker <id>", "Broker ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--source <type>", "Source type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.research.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    brokerList: maybeArray(options.broker), securityList: maybeArray(options.security), industryList: maybeArray(options.industry),
    categoryList: maybeArray(options.category), llmTagList: maybeArray(options.llmTag), ratingList: maybeArray(options.rating),
    ratingChangeList: maybeArray(options.ratingChange), minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }),
    maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }), sourceList: maybeArray(options.source),
  }), { endpointKey: "insight.research.list", idField: "reportId" }))
addDownloadCommand(research, { endpointKey: "insight.research.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "research", fileType: { description: "File type: 1=PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.research.list" })

addTimeFilters(foreignReport.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code", collectList, []).option("--region <id>", "Region ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.foreign-report.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    securityList: maybeArray(options.security), regionList: maybeArray(options.region), categoryList: maybeArray(options.category),
    industryList: maybeArray(options.industry), brokerList: maybeArray(options.broker), llmTagList: maybeArray(options.llmTag),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
    minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }), maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }),
  }), { endpointKey: "insight.foreign-report.list", idField: "reportId" }))
addDownloadCommand(foreignReport, { endpointKey: "insight.foreign-report.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "foreign-report", fileType: { description: "File type: 1=PDF 2=Markdown 3=CN-PDF 4=CN-Markdown", choices: ["1", "2", "3", "4"], default: "1" }, titleListEndpoint: "insight.foreign-report.list" })

// Contract: A-share announcement startTime/endTime go out as 13-digit epoch millis
// (parseTimestamp13), while HK/US announcement and every other insight list send the
// datetime string straight through. All three filter correctly — verified live against
// a narrow past window (each returns in-window rows). A-share's API also accepts the
// string form, but the 13-digit conversion is kept as the historical spec contract;
// don't "unify" it away without re-confirming the A-share announcement spec.
addTimeFilters(announcement.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.announcement.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: parseTimestamp13(options.startTime, "--start-time"), endTime: parseTimestamp13(options.endTime, "--end-time"),
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword,
    securityList: maybeArray(options.security), categoryList: maybeArray(options.category),
  }), { endpointKey: "insight.announcement.list", idField: "announcementId" }))
addDownloadCommand(announcement, { endpointKey: "insight.announcement.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement", fileType: { description: "File type: 1=PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement.list" })

addTimeFilters(announcementHk.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code (e.g. 01913.HK)", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.announcement-hk.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }),
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    securityList: maybeArray(options.security), categoryList: maybeArray(options.category),
  }), { endpointKey: "insight.announcement-hk.list", idField: "announcementId" }))
addDownloadCommand(announcementHk, { endpointKey: "insight.announcement-hk.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement-hk", fileType: { description: "File type: 1=original 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement-hk.list" })

addTimeFilters(announcementUs.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code (e.g. TSLA.O)", collectList, []).option("--category <id>", "Category ID (constant-list usShareAnnouncementCategory)", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.announcement-us.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }),
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    securityList: maybeArray(options.security), categoryList: maybeArray(options.category),
  }), { endpointKey: "insight.announcement-us.list", idField: "announcementId" }))
addDownloadCommand(announcementUs, { endpointKey: "insight.announcement-us.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement-us", fileType: { description: "File type: 1=original PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement-us.list" })

addTimeFilters(foreignOpinion.command("list").addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code (e.g. UBER.N)", collectList, []).option("--region <code>", "Region code -- this endpoint accepts only cn/cnHk/cnTw/us/jp/uk; the other 13 values of regionCategory (sea/gl/fr/de/kr/in/ca/me/othAs/othEur/latAm/oce/af) are rejected here with 100005 though they all work on foreign-report", collectList, []).option("--industry <id>", "Industry ID -- swIndustry codes only (104xx0000); citicIndustry codes are rejected with 100005 even where constant-category declares them", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--with-content", "Return the full body inline (v1 list, 30 credits/row) as content / contentTranslate, instead of the 200-char brief (1 credit/row)").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call(options.withContent ? "insight.foreign-opinion.list-with-content" : "insight.foreign-opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    regionList: maybeArray(options.region), industryList: maybeArray(options.industry),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
  })))

/** Opinion bodies by ID, for the two detail endpoints. Each takes at most 20 IDs per
 * call and skips, without an error, any ID it has no body for — a typo, an ID outside
 * the account's data window, and possibly one published minutes ago. Batches go out
 * one at a time — 30 credits per returned body — and the IDs that came back empty are
 * named on stderr and in `missingIds`, marking the result partial (exit 3). */
async function fetchOpinionDetails(client: GangtiseClient, endpointKey: string, idListField: string, idField: string, ids: string[]): Promise<Record<string, unknown>> {
  const BATCH = 20
  const unique = [...new Set(ids)]
  if (!unique.length) throw new ValidationError("pass at least one opinion ID")
  const list: Record<string, unknown>[] = []
  let unfetched: string[] = []
  let unfetchedError: Record<string, unknown> | undefined
  for (let i = 0; i < unique.length; i += BATCH) {
    try {
      const rows = await client.call(endpointKey, { [idListField]: unique.slice(i, i + BATCH) })
      if (Array.isArray(rows)) list.push(...(rows as Record<string, unknown>[]))
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

opinion.command("detail").description("Full bodies of domestic chief opinions by ID (30 credits per returned opinion; batched 20 per call)")
  .requiredOption("--chief-opinion-id <id>", "chiefOpinionId from 'insight opinion list' (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => fetchOpinionDetails(client, "insight.opinion.detail", "chiefOpinionIdList", "chiefOpinionId", options.chiefOpinionId)))

foreignOpinion.command("detail").description("Full bodies (content + contentTranslate) of foreign opinions by ID (30 credits per returned opinion; batched 20 per call)")
  .requiredOption("--foreign-opinion-id <id>", "foreignOpinionId from 'insight foreign-opinion list' (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => fetchOpinionDetails(client, "insight.foreign-opinion.detail", "foreignOpinionIdList", "foreignOpinionId", options.foreignOpinionId)))

addTimeFilters(independentOpinion.command("list").addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--security <code>", "Security code (e.g. GSK.N)", collectList, []).option("--industry <id>", "Industry ID -- swIndustry codes only (104xx0000); citicIndustry codes are rejected with 100005 even where constant-category declares them", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.independent-opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    industryList: maybeArray(options.industry), securityList: maybeArray(options.security),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
  })))
addDownloadCommand(independentOpinion, { endpointKey: "insight.independent-opinion.download", idOption: "--independent-opinion-id", idField: "independentOpinionId", fallbackPrefix: "independent-opinion", fileType: { description: "File type: 1=original HTML 2=CN-translated HTML", choices: ["1", "2"], required: true } })

addTimeFilters(officialAccount.command("list").addOption(new Option("--search-type <number>", "Search type: 1=title 2=fulltext").choices(["1", "2"]).default("1")).addOption(new Option("--rank-type <number>", "Rank type: 1=composite 2=time desc").choices(["1", "2"]).default("1")).option("--account-id <id>", "Official account ID", collectList, []).option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, []).option("--category <type>", "Article type: news/law/report/view/data/event/meeting/notice/recruit/investEdu/brand/notes/other", collectList, []).option("--industry <id>", "Industry ID (constant-list citicIndustry/swIndustry)", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.official-account.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }),
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    accountIdList: maybeArray(options.accountId), securityList: maybeArray(options.security),
    categoryList: maybeArray(options.category), industryList: maybeArray(options.industry),
  }), { endpointKey: "insight.official-account.list", idField: "articleId" }))
addDownloadCommand(officialAccount, { endpointKey: "insight.official-account.download", idOption: "--article-id", idField: "articleId", fallbackPrefix: "official-account", fileType: { description: "File type: 1=txt(default) 2=HTML", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.official-account.list" })

// QA request keys are BARE (source/questionCategory/answerImportant), not the *List
// convention — the body below mirrors the spec exactly. Datetimes pass through as strings.
qa.command("list").requiredOption("--security-code <code>", "Security code, e.g. 601012.SH").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all (max page 500)").option("--start-time <datetime>", "Start time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)", datetimeArg("--start-time")).option("--end-time <datetime>", "End time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)", datetimeArg("--end-time")).option("--source <type>", "Source: conference/interactive/survey (repeat)", collectList, []).option("--question-category <name>", "Question category (repeat): productAndBusiness/capacityAndProjects/ordersAndCustomers/financialData/materialEvents/capitalOperations/shareholdersAndDividends/corporateGovernance/marketAndValuation/macroAndIndustry/risksAndOthers", collectList, []).option("--answer-important <flag>", "Answer involves key info: 1=yes 0=no (repeat; omit for all)", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("insight.qa.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    securityCode: options.securityCode, startTime: options.startTime, endTime: options.endTime,
    source: maybeArray(options.source), questionCategory: maybeArray(options.questionCategory),
    answerImportant: options.answerImportant.length ? options.answerImportant : undefined,
  })))

reportImage.command("list").requiredOption("--keyword <text>", "Search keyword, e.g. 'AI' '新能源汽车'").option("--top <number>", "Max results (default: 10, max: 20)", "10").option("--source-id <id>", "Report source ID, to filter to one report (from a report list or knowledge base)").option("--start-time <datetime>", "Start time (yyyy-MM-dd HH:mm:ss; yyyy-MM-dd auto-completed)", datetimeArg("--start-time")).option("--end-time <datetime>", "End time (yyyy-MM-dd HH:mm:ss; yyyy-MM-dd auto-completed)", datetimeArg("--end-time")).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("insight.report-image.list", {
    keyword: options.keyword, top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 20 }),
    sourceId: options.sourceId, startTime: options.startTime, endTime: options.endTime,
  })))
addDownloadCommand(reportImage, { endpointKey: "insight.report-image.download", idOption: "--chunk-id", idField: "chunkId", fallbackPrefix: "report-image" })

insight.addCommand(opinion)
insight.addCommand(summary)
insight.addCommand(pamirsSummary)
insight.addCommand(roadshow)
insight.addCommand(siteVisit)
insight.addCommand(strategy)
insight.addCommand(forum)
insight.addCommand(performanceCalendar)
insight.addCommand(research)
insight.addCommand(foreignReport)
insight.addCommand(announcement)
insight.addCommand(announcementHk)
insight.addCommand(announcementUs)
insight.addCommand(foreignOpinion)
insight.addCommand(independentOpinion)
insight.addCommand(officialAccount)
insight.addCommand(qa)
insight.addCommand(reportImage)

// Meeting highlights feed. Billed per ROW (5 credits), so `--size` matters here more
// than on the free list endpoints: omitting it fetches every page in the range.
const highlight = new Command("highlight")
highlight.command("list").description("Meeting highlights feed: key takeaways per meeting, newest first (5 credits/row)")
  .option("--from <number>", "Starting offset", "0")
  .option("--size <number>", "Total rows to return; omit to fetch all (max page 50). Billed per row — bound this on wide ranges")
  .option("--start-time <datetime>", "Start time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)", datetimeArg("--start-time"))
  .option("--end-time <datetime>", "End time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)", datetimeArg("--end-time"))
  .option("--security <code>", "Security code, e.g. 000001.SZ / 09992.HK / AAPL.O (repeatable)", collectList, [])
  .option("--research-area <id>", "Research area ID: citicIndustry (1008001xx) or gangtiseIndustry direction (122000xxx). swIndustry codes are NOT accepted here", collectList, [])
  .option("--format <format>", "Output format", "table").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("insight.highlight.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    securityList: maybeArray(options.security), researchAreaList: maybeArray(options.researchArea),
  })))
insight.addCommand(highlight)
program.addCommand(insight)

const quote = new Command("quote").description("Quote APIs")

/** Whole-market keywords an endpoint accepts, mapped to days per shard. A shard holds
 * (rows per trading day x shardDays) and must stay under the 10K-row API cap. A-shares
 * and US each list several thousand securities per day, so they take one day per shard;
 * HK is roughly half that and takes two; the SH/SZ/BJ index universe is only in the
 * hundreds, so fifteen calendar days still lands well inside the cap.
 *
 * Indices are NOT "far fewer per window": a few hundred rows across ~22 trading days
 * clears 10K, which is why the historical 30-day size silently truncated every shard.
 *
 * These universes grow with listings, and the counts are not pinned here on purpose —
 * they drift. What to watch is the product: when a market's rows per trading day
 * approach 10K / shardDays, cut shardDays. The measured per-market counts, each with
 * the date it was taken, are in the `bug/` ledger.
 *
 * The unified `day-kline` dropped the old `all` keyword on 2026-08-14 in favour of the
 * three market keywords, which must each be sent alone. The menu-retired per-market
 * endpoints still take `all`. */
type MarketShardDays = Record<string, number>
const KLINE_MARKETS: MarketShardDays = { aShares: 1, hkStocks: 2, usStocks: 1 }
const LEGACY_ALL_MARKET = (shardDays: number): MarketShardDays => ({ all: shardDays })
/** Realtime takes the same keywords but returns one snapshot per security, so there is
 * nothing to shard and it only needs the accepted-keyword list. */
const REALTIME_MARKETS = ["aShares", "hkStocks", "usStocks"]
/** fund-flow is A-share only, so `aShares` is its sole whole-market keyword. */
const FUND_FLOW_MARKETS = ["aShares"]

/** Every keyword the quote APIs have ever taken, including ones a given command no
 * longer accepts. What an unrecognised keyword does depends on the endpoint, and BOTH
 * outcomes are worth a local error: the unified `day-kline` / `realtime` / `fund-flow`
 * answer `120001` "invalid security code" (which sends the user hunting for a typo in a
 * code that is fine), while the menu-retired per-market endpoints answer `code=000000`
 * with `total: 0` — a silent empty result indistinguishable from "no data".
 *
 * Compared lower-cased, and 🔴 **that folding is load-bearing, not tidiness** — the API's
 * own case handling used to differ BY ENDPOINT. Re-probed 2026-08-24 (curl direct, all six):
 *
 *   folds case:      ALL SIX, including fund-flow — `aShares` / `ashares` / `ASHARES` /
 *                    `AShares` / `aSHARES` all return the same rows.
 *
 * Until 2026-08-21 `fund-flow` was the lone exception: only the literal `aShares` worked
 * and every other casing came back as `120001 非有效A股`. That is fixed server-side now,
 * so canonicalising is no longer load-bearing for correctness anywhere — on every endpoint
 * it merely keeps our shard lookup in step with the server (drop it and a case variant
 * degrades to an unsharded 6000-row request).
 *
 * Keep it anyway: it normalises rather than rejects, so it can only be more forgiving than
 * the server, and it costs nothing. The fund-flow case test stays as a regression pin —
 * but note it now pins OUR normalisation, not a server-side quirk.
 *
 * ⚠️ `all` collides with a real ticker root (`ALL` is Allstate on the NYSE), so a bare
 * `--security ALL` fetches the whole US market instead of that stock. That resolution
 * happens on the SERVER (`ALL` / `All` / `all` are equivalent to it on all three retired
 * endpoints), so matching case-sensitively here would not prevent it — it would only stop
 * us from sharding a request the server treats as whole-market anyway, turning a complete
 * result into a 6000-row truncation. The fix for that user is the suffixed `ALL.N`.
 *
 * Unknown keywords are deliberately NOT rejected — this is a known-keyword list, so a
 * future server-side addition degrades to "unsharded" rather than being refused outright
 * (fail-open, no enum drift). */
const MARKET_KEYWORDS = new Set(["all", "ashares", "hkstocks", "usstocks"])
const matchesMarketKeyword = (value: string, keyword: string): boolean =>
  value.toLowerCase() === keyword.toLowerCase()
const checkMarketKeywords = (securities: string[], accepted: readonly string[], command: string): void => {
  const used = securities.filter((s) => MARKET_KEYWORDS.has(s.toLowerCase()))
  if (used.length === 0) return
  // Report an unsupported keyword before the alone-ness rule: when both are wrong, the
  // keyword itself is the thing the user has to change.
  const unsupported = used.filter((k) => !accepted.some((a) => matchesMarketKeyword(k, a)))
  if (unsupported.length > 0) {
    throw new ValidationError(accepted.length > 0
      ? `${command}: '${unsupported[0]}' is not a whole-market keyword for this command — use ${accepted.join(" / ")}`
      : `${command}: this command takes explicit security codes only — '${unsupported[0]}' and other whole-market keywords are not supported`)
  }
  // The API rejects a keyword sent alongside security codes or a second keyword, again
  // as a bare 120001 that points at the codes rather than at the combination. On
  // `fund-flow` it is worse than a rejection: the keyword is silently dropped and only
  // the explicit codes come back, exit 0.
  if (securities.length > 1) {
    throw new ValidationError(`${command}: a market keyword must be passed alone, got '${securities.join(", ")}' — the API rejects it mixed with security codes or another keyword`)
  }
}

/** Fold a user-typed keyword back to the spelling the sharding lookup expects, so a case
 * variant reaches the same code path as the canonical form. Non-keywords pass through
 * untouched. */
const canonicalizeMarketKeywords = (securities: string[], accepted: readonly string[]): string[] =>
  securities.map((s) => accepted.find((a) => matchesMarketKeyword(s, a)) ?? s)

const addKlineCommand = (name: string, endpointKey: string, securityHelp: string, markets: MarketShardDays) =>
  quote.command(name)
    .option("--security <code>", securityHelp, collectList, [])
    .option("--start-date <date>", "Start date (default: 1 year before end-date)", dateArg("--start-date"))
    .option("--end-date <date>", "End date (default: latest)", dateArg("--end-date"))
    .option("--limit <number>", "Max rows per request (default: 6000, max: 10000)")
    .option("--field <field>", "Field", collectList, [])
    .option("--format <format>", "Output format", "table")
    .option("--output <path>")
    .action((options) => {
      // Validate BEFORE withClient: createClient() logs in when no token is cached, so a
      // check inside the callback would spend a request to then fail locally anyway.
      checkMarketKeywords(options.security, Object.keys(markets), `quote ${name}`)
      options.security = canonicalizeMarketKeywords(options.security, Object.keys(markets))
      return withClient(options, async (client) => {
      const format = parseOutputFormat(options.format)
      const body = buildQuoteKlineBody(options)
      // Each market shards at its own granularity, so resolve which keyword was asked
      // for before picking shardDays — a whole-market HK pull tolerates 2-day windows
      // where A-share and US pulls need one day each.
      const keyword = Object.keys(markets).find((k) => isFullMarket(body, k))
      if (keyword) {
        // A whole-market query is date-sharded: callKlineWithSharding lifts the limit to
        // the API max and owns completeness (partial / failedShards), so leave `limit`
        // unset and skip the single-request truncation guard.
        // A null answer never reaches here: the endpoint's `expects: "list"` fails it
        // inside the client, envelope traceId attached (endpoints.ts).
        const data = await callKlineWithSharding(client, endpointKey, body, { shardDays: markets[keyword], fullMarketValue: keyword })
        flagMissingFields(data, body.fieldList, `quote ${name}`)
        await printData(data, format, options.output)
        return
      }
      // Explicit securities: pin the limit to the known default so the sent limit and the
      // truncation cap are the same number by construction.
      const limit = body.limit ?? DEFAULT_QUOTE_LIMIT
      const securities = body.securityList ?? []
      // Several securities over a range that would not fit one request (securities ×
      // trading days > limit) go out one request per security, merged in input order.
      // One request would come back capped at `limit` with the tail securities missing
      // (partial + exit 3); per-security batching keeps each part well under the cap.
      if (securities.length > 1 && securities.length * estimateTradingDays(body.startDate, body.endDate) > limit) {
        const data = await callPerSecurity(client, endpointKey, securities, (code) => ({ ...body, securityList: [code], limit }), limit, `quote ${name}`)
        flagMissingFields(data, body.fieldList, `quote ${name}`)
        await printData(data, format, options.output)
        return
      }
      const data = await client.call(endpointKey, { ...body, limit })
      flagIfLimitTruncated(data, limit, name)
      flagMissingFields(data, body.fieldList, `quote ${name}`)
      await printData(data, format, options.output)
      })
    })
addKlineCommand("day-kline", "quote.day-kline", "Security code — A-share .SH/.SZ/.BJ, ETF .SH/.SZ (e.g. 512800.SH), HK .HK, US .O/.N/.A, exchange index .SH/.SZ/.BJ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); or one market keyword: aShares / hkStocks / usStocks (auto-sharded by date, must be passed alone; keywords cover stocks only — ETFs and indices must be listed by code)", KLINE_MARKETS)
addKlineCommand("day-kline-hk", "quote.day-kline-hk", "[deprecated: use 'day-kline'] Security code (HK stock: .HK, or 'all' for full market)", LEGACY_ALL_MARKET(2))
addKlineCommand("day-kline-us", "quote.day-kline-us", "[deprecated: use 'day-kline'] Security code (US stock: e.g. AAPL.O, or 'all' for full market)", LEGACY_ALL_MARKET(1))
// 15 days, not the historical 30: ~531 index rows per trading day x ~11 trading days in a
// 15-day window is ~5.8K, while a 30-day window is ~11.7K — every shard silently maxed out
// at the 10K cap and lost ~11% of the range (it surfaced as exit 3 + truncatedShards, but
// the split was never sized to avoid it in the first place).
addKlineCommand("index-day-kline", "quote.index-day-kline", "[deprecated: use 'day-kline'] Index code (.SH/.SZ/.BJ, or 'all' for full market)", LEGACY_ALL_MARKET(15))
quote.command("minute-kline").option("--security <code>", "Security code — A-share .SH/.SZ (SH/SZ only), ETF .SH/.SZ (e.g. 512800.SH), exchange index .SH/.SZ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); repeat for several — one request each, run concurrently and merged; no whole-market keyword", collectList, []).option("--start-time <datetime>", "Start time (yyyy-MM-dd HH:mm:ss)", datetimeArg("--start-time")).option("--end-time <datetime>", "End time (yyyy-MM-dd HH:mm:ss)", datetimeArg("--end-time")).option("--limit <number>", "Max rows per request (default: 6000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(options, async (client) => {
  const format = parseOutputFormat(options.format)
  const limit = parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 10000 }) ?? DEFAULT_QUOTE_LIMIT
  const fieldList = maybeArray<string>(options.field)
  const securities = options.security as string[]
  if (securities.length === 0) throw new ValidationError("--security is required (repeat it for several securities)")
  const makeBody = (code: string) => ({ securityCode: code, startTime: options.startTime, endTime: options.endTime, limit, fieldList })
  // The API takes ONE securityCode per request; several go out concurrently and merge in
  // input order (callPerSecurity owns the per-security truncation flag).
  const data = securities.length === 1
    ? await client.call("quote.minute-kline", makeBody(securities[0]))
    : await callPerSecurity(client, "quote.minute-kline", securities, makeBody, limit, "quote minute-kline")
  if (securities.length === 1) flagIfLimitTruncated(data, limit, "minute-kline", "--start-time/--end-time")
  flagMissingFields(data, fieldList, "quote minute-kline")
  await printData(data, format, options.output)
}))
quote.command("realtime").description("Realtime quote snapshot (A-share / HK / US stocks, ETFs, and indices incl. 20 global indices)").option("--security <code>", "Security code — stock .SH/.SZ/.BJ/.HK/.O/.N/.A, ETF .SH/.SZ (e.g. 512800.SH), exchange index .SH/.SZ/.BJ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); or one market keyword: aShares / hkStocks / usStocks (must be passed alone; keywords cover stocks only — ETFs and indices have no whole-market keyword)", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => {
  // Realtime takes the same market keywords as day-kline but never shards (one snapshot
  // per security), so it only needs the "alone, and a keyword this API knows" check.
  checkMarketKeywords(options.security, REALTIME_MARKETS, "quote realtime")
  return emit(options, async (client) => {
    const fieldList = maybeArray<string>(options.field)
    const data = await client.call("quote.realtime", { securityList: maybeArray(options.security), fieldList })
    flagMissingFields(data, fieldList, "quote realtime")
    return data
  })
})
quote.command("fund-flow").description("A-share daily fund flow (SH/SZ/BJ)").option("--security <code>", "Security code (e.g. 600519.SH / 920982.BJ), or 'aShares' for full A-share market — auto-sharded by day (repeat)", collectList, []).option("--start-date <date>", "Start date yyyy-MM-dd (default: endDate minus 1 year)", dateArg("--start-date")).option("--end-date <date>", "End date yyyy-MM-dd (default: latest trading day)", dateArg("--end-date")).option("--limit <number>", "Max rows per request (default: 6000, max: 10000; single-security cap — aShares auto-shards by day)").option("--field <field>", "Field, e.g. mainNetInflow/largeInflow/xlargeOutflow (repeat); omit for all", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => {
  // fund-flow needs this guard MORE than the kline commands, not less: mixing the keyword
  // with codes doesn't even fail here. The server silently drops `aShares` and answers
  // with just the explicit codes — one row, exit 0, no warning — so "whole market plus
  // this one" quietly becomes "only this one". Validate before withClient so no login
  // request is spent on a query that fails locally.
  checkMarketKeywords(options.security, FUND_FLOW_MARKETS, "quote fund-flow")
  options.security = canonicalizeMarketKeywords(options.security, FUND_FLOW_MARKETS)
  return withClient(options, async (client) => {
  const format = parseOutputFormat(options.format)
  const body = {
    securityList: maybeArray<string>(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 10000 }),
    fieldList: maybeArray<string>(options.field),
  }
  if (isFullMarket(body, "aShares")) {
    // Full-market fund-flow: the server errors (430012/430013) instead of truncating when
    // a single request exceeds the row cap, so date-shard by day (~5.4k A-share rows/day,
    // under the lifted API cap) and merge — same mechanism as `--security all` kline.
    // Sharding needs an explicit range; without both dates it would fall back to one
    // doomed full-market request, so require the range up front with a clear message.
    if (!body.startDate || !body.endDate) {
      throw new ValidationError("quote fund-flow --security aShares requires both --start-date and --end-date (the full market is fetched via per-day shards)")
    }
    const data = await callKlineWithSharding(client, "quote.fund-flow", body, { shardDays: 1, fullMarketValue: "aShares" })
    flagMissingFields(data, body.fieldList, "quote fund-flow")
    await printData(data, format, options.output)
    return
  }
  const limit = body.limit ?? DEFAULT_QUOTE_LIMIT
  const data = await client.call("quote.fund-flow", { ...body, limit })
  flagIfLimitTruncated(data, limit, "fund-flow")
  flagMissingFields(data, body.fieldList, "quote fund-flow")
  await printData(data, format, options.output)
  })
})
program.addCommand(quote)

const fundamental = new Command("fundamental").description("Fundamental APIs")

const addFinancialReport = (name: string, endpointKey: string, periodHelp = "Period") => fundamental.command(name).requiredOption("--security-code <code>").option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", periodHelp, collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call(endpointKey, { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) })))
addFinancialReport("income-statement", "fundamental.income-statement")
addFinancialReport("income-statement-quarterly", "fundamental.income-statement-quarterly", "Period: q1/q2/q3/q4/latest")
addFinancialReport("balance-sheet", "fundamental.balance-sheet")
addFinancialReport("cash-flow", "fundamental.cash-flow")
addFinancialReport("cash-flow-quarterly", "fundamental.cash-flow-quarterly", "Period: q1/q2/q3/q4/latest")
addFinancialReport("income-statement-hk", "fundamental.income-statement-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
addFinancialReport("balance-sheet-hk", "fundamental.balance-sheet-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
addFinancialReport("cash-flow-hk", "fundamental.cash-flow-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
addFinancialReport("income-statement-us", "fundamental.income-statement-us", "Period: q1/h1/q3/nsd/annual/latest")
addFinancialReport("balance-sheet-us", "fundamental.balance-sheet-us", "Period: q1/h1/q3/nsd/annual/latest")
addFinancialReport("cash-flow-us", "fundamental.cash-flow-us", "Period: q1/h1/q3/nsd/annual/latest")
fundamental.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).addOption(new Option("--breakdown <type>", "Breakdown: product/industry/region").choices(["product", "industry", "region"]).default("product")).option("--period <type>", "Period: interim/annual", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("fundamental.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, breakdown: options.breakdown, periodList: maybeArray(options.period), fieldList: maybeArray(options.field) })))
fundamental.command("valuation-analysis").requiredOption("--security-code <code>").addOption(new Option("--indicator <name>", "Indicator").choices(["peTtm", "pbMrq", "peg", "psTtm", "pcfTtm", "em"]).makeOptionMandatory()).option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--skip-null", "Drop rows where value or percentileRank is null").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const requested = maybeArray(options.field)
  // --skip-null judges `value` and `percentileRank`, so both must come back even when
  // --field asked for neither: a column that was not requested reads as `undefined` here,
  // the filter counts that as null, and EVERY row is dropped — an empty result with exit 0
  // that looks like "no data for this security". Fetch the columns the filter needs on top
  // of --field, then drop them again before output so --field still decides the columns.
  const filterFields = options.skipNull && requested ? ["value", "percentileRank"].filter((field) => !requested.includes(field)) : []
  const fieldList = requested && filterFields.length > 0 ? [...requested, ...filterFields] : requested
  let data: unknown = await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }), fieldList })
  if (options.skipNull) {
    const normalized = normalizeRows(data)
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
      const rec = normalized as Record<string, unknown>
      if (Array.isArray(rec.list)) {
        const filtered = rec.list.filter((row) => {
          if (!row || typeof row !== "object") return false
          const r = row as Record<string, unknown>
          return r.value != null && r.percentileRank != null
        }).map((row) => {
          if (filterFields.length === 0) return row
          const r = { ...(row as Record<string, unknown>) }
          for (const field of filterFields) delete r[field]
          return r
        })
        data = { ...rec, list: filtered, total: filtered.length }
      }
    }
  }
  await printData(data, format, options.output)
}))
fundamental.command("top-holders").requiredOption("--security-code <code>").addOption(new Option("--holder-type <type>", "Holder type: top10/top10Float").choices(["top10", "top10Float"]).makeOptionMandatory()).option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period: q1/interim/q3/annual/latest", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("fundamental.top-holders", { securityCode: options.securityCode, holderType: options.holderType, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined })))
fundamental.command("earning-forecast").requiredOption("--security-code <code>").option("--start-date <date>", "Start date (default: 1 year before end-date)", dateArg("--start-date")).option("--end-date <date>", "End date (default: today)", dateArg("--end-date")).option("--consensus <name>", "Consensus indicator: netIncome/netIncomeYoy/eps/pe/bps/pb/peg/roe/ps", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => {
  const endDate = options.endDate ?? localDateString(new Date())
  // Anchor the default window to endDate (as the help text promises), not to today —
  // a historical --end-date without --start-date should mean "the year before it".
  const startDate = options.startDate ?? new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return client.call("fundamental.earning-forecast", { securityCode: options.securityCode, startDate, endDate, consensusList: maybeArray(options.consensus) })
}))
program.addCommand(fundamental)

// ─── bond ───
// Every bond endpoint is metered (0.4 credits per call, or per row / bond / issuer on
// three of them), so the code list is checked locally before spending anything.
// They answer COLUMNAR (`{fieldList, list}` with array rows); `normalizeRows` zips
// that into objects, so nothing here needs to handle it.
const bond = new Command("bond").description("Bond APIs: profiles, issuers, quotes, valuations, cash flows, ratings, announcements")

function requireBondCodes(codes: string[], max?: number): string[] {
  if (!codes.length) throw new ValidationError("--security is required: pass one or more bond codes, e.g. --security 019742.SH --security 220205.IB")
  // The server counts the cap after de-duplication, so a merged list with repeats is legal.
  const unique = [...new Set(codes)]
  if (max && unique.length > max) throw new ValidationError(`${unique.length} distinct bond codes in one call — this endpoint takes at most ${max}. Split them into batches of ${max} and run one call per batch.`)
  return unique
}

const bondSecurityOption = (command: Command) => command
  .option("--security <code>", "Bond code, e.g. 019742.SH / 123456.SZ / 220205.IB (repeatable). Short names and pinyin are rejected — resolve them with 'reference securities-search' first", collectList, [])
  .option("--field <field>", "Field to return (repeatable); omit for all. An unsupported name rejects the whole call with 100003", collectList, [])
  .option("--format <format>", "Output format", "table").option("--output <path>")

/** securityList + optional date range + fieldList — the shape four of the twelve share. */
const addBondRange = (name: string, endpointKey: string, describe: string, rangeHelp: string, max?: number) =>
  bondSecurityOption(bond.command(name).description(describe))
    .option("--start-date <date>", `${rangeHelp} start (yyyy-MM-dd); omit for all history`, dateArg("--start-date"))
    .option("--end-date <date>", `${rangeHelp} end (yyyy-MM-dd); omit for all history`, dateArg("--end-date"))
    .action((options) => emit(options, (client) => client.call(endpointKey, { securityList: requireBondCodes(options.security, max), startDate: options.startDate, endDate: options.endDate, fieldList: maybeArray(options.field) })))

bondSecurityOption(bond.command("basic-info").description("Bond static profiles: issuance, term, coupon, rating, guarantee, special terms"))
  .action((options) => emit(options, (client) => client.call("bond.basic-info", { securityList: requireBondCodes(options.security, 10000), fieldList: maybeArray(options.field) })))

bondSecurityOption(bond.command("rating-overview").description("Bond, issuer and guarantor ratings side by side"))
  .action((options) => emit(options, (client) => client.call("bond.rating-overview", { securityList: requireBondCodes(options.security, 10), fieldList: maybeArray(options.field) })))

addBondRange("cash-flow", "bond.cash-flow", "Interest payment and redemption schedule per bond", "Payment date")
addBondRange("issuance-detail", "bond.issuance-detail", "Issuance and re-issuance records: bidding, pricing, cover ratios", "Issue announcement date")
addBondRange("rating-change", "bond.rating-change", "Bond rating change history: current vs previous rating, direction, outlook, agency (max 10 bonds per call)", "Announcement date", 10)
addBondRange("exercise-notice", "bond.exercise-notice", "Put/call exercise schedule and results for option-embedded bonds", "Exercise date")

bondSecurityOption(bond.command("daily-quote").description("Daily close quotes (exchange + CFETS): dirty/clean price, YTM, duration, convexity"))
  .requiredOption("--start-date <date>", "Trade date range start (yyyy-MM-dd)", dateArg("--start-date"))
  .requiredOption("--end-date <date>", "Trade date range end (yyyy-MM-dd)", dateArg("--end-date"))
  .action((options) => emit(options, (client) => client.call("bond.daily-quote", { securityList: requireBondCodes(options.security), startDate: options.startDate, endDate: options.endDate, fieldList: maybeArray(options.field) })))

bondSecurityOption(bond.command("valuation").description("Shanghai Clearing House valuations: price, yield, duration, convexity, PVBP"))
  .requiredOption("--start-date <date>", "Valuation date range start (yyyy-MM-dd)", dateArg("--start-date"))
  .requiredOption("--end-date <date>", "Valuation date range end (yyyy-MM-dd)", dateArg("--end-date"))
  .addOption(new Option("--confidence-level <level>", "Valuation confidence; defaults to 推荐 server-side, which already filters out 不推荐").choices(["推荐", "不推荐"]))
  .action((options) => emit(options, (client) => client.call("bond.valuation", { securityList: requireBondCodes(options.security), startDate: options.startDate, endDate: options.endDate, confidenceLevel: options.confidenceLevel, fieldList: maybeArray(options.field) })))

/** The two issuer-keyed commands: `--security` (bond codes → their issuers) and
 * `--issuer` (fuzzy name match, one best hit per name) are mutually exclusive
 * upstream — sending both returns 100003, so the pair is checked here. */
function issuerSelector(security: string[], issuer: string[]): Record<string, unknown> {
  if (security.length && issuer.length) throw new ValidationError("--security and --issuer are mutually exclusive: pass bond codes or issuer names, not both")
  if (!security.length && !issuer.length) throw new ValidationError("pass either --security (bond codes) or --issuer (issuer names)")
  return security.length ? { securityList: security } : { issuerNameList: issuer }
}

const issuerNameOption = (command: Command) => command.option("--issuer <name>", "Issuer name, full or short (repeatable); fuzzy-matched, one best hit per name", collectList, [])

issuerNameOption(bondSecurityOption(bond.command("issuer-info").description("Issuer profiles: nature, SW industry, registration, rating, outstanding bonds")))
  .action((options) => emit(options, (client) => client.call("bond.issuer-info", { ...issuerSelector(options.security, options.issuer), fieldList: maybeArray(options.field) })))

issuerNameOption(bondSecurityOption(bond.command("issuer-rating-change").description("Issuer rating change history (at most 10 issuers matched per call)")))
  .option("--start-date <date>", "Announcement date range start (yyyy-MM-dd); omit for all history", dateArg("--start-date"))
  .option("--end-date <date>", "Announcement date range end (yyyy-MM-dd); omit for all history", dateArg("--end-date"))
  .action((options) => emit(options, (client) => client.call("bond.issuer-rating-change", { ...issuerSelector(options.security, options.issuer), startDate: options.startDate, endDate: options.endDate, fieldList: maybeArray(options.field) })))

bond.command("issuance-plan").description("Rate-bond issuance calendar over a date range")
  .requiredOption("--start-date <date>", "Issue date range start (yyyy-MM-dd)", dateArg("--start-date"))
  .requiredOption("--end-date <date>", "Issue date range end (yyyy-MM-dd)", dateArg("--end-date"))
  .option("--field <field>", "Field to return (repeatable); omit for all", collectList, [])
  .option("--format <format>", "Output format", "table").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("bond.issuance-plan", { startDate: options.startDate, endDate: options.endDate, fieldList: maybeArray(options.field) })))

// The one paged endpoint of the family, and the only one anywhere that answers WITHOUT
// a `total` (by design, per the 2026-09 spec) — so it cannot join the shared
// auto-pagination, which needs the first page's total to plan the rest. Callers walk
// `--page-no` until a page comes back empty.
bondSecurityOption(bond.command("announcement").description("Bond announcements, paged. Filter by bond codes OR by announcement date range, never both"))
  .option("--start-date <date>", "Announcement date range start (yyyy-MM-dd); mutually exclusive with --security", dateArg("--start-date"))
  .option("--end-date <date>", "Announcement date range end (yyyy-MM-dd); mutually exclusive with --security", dateArg("--end-date"))
  .option("--page-no <number>", "Page number, from 1. No total is returned: increment until a page comes back empty", "1")
  .option("--page-size <number>", "Rows per page, 1-200", "50")
  .action((options) => emit(options, (client) => {
    const byDate = Boolean(options.startDate || options.endDate)
    if (options.security.length && byDate) throw new ValidationError("--security and --start-date/--end-date are mutually exclusive on bond announcement: filter by bond codes or by date range, not both")
    if (!options.security.length && !byDate) throw new ValidationError("pass either --security (bond codes) or --start-date/--end-date (announcement date range)")
    return client.call("bond.announcement", {
      securityList: maybeArray(options.security), startDate: options.startDate, endDate: options.endDate,
      pageNo: parseNumberOption(options.pageNo, "--page-no", { integer: true, min: 1 }),
      pageSize: parseNumberOption(options.pageSize, "--page-size", { integer: true, min: 1, max: 200 }),
      fieldList: maybeArray(options.field),
    })
  }))

program.addCommand(bond)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").option("--query <text>", "Query text; repeat for up to 5. Each --query is taken whole — commas inside it are part of the question, not separators", collectText, []).option("--top <number>", "Max results (default: 10, max: 20)", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <datetime>", "13/10-digit epoch or YYYY-MM-DD[ HH:mm[:ss]] (space or T)").option("--end-time <datetime>", "13/10-digit epoch or YYYY-MM-DD[ HH:mm[:ss]] (space or T)").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => {
  if (!options.query.length) throw new ValidationError("--query is required: pass at least one --query")
  return emit(options, (client) => client.call("ai.knowledge-batch", { queries: options.query, top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 20 }), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: parseTimestamp13(options.startTime, "--start-time"), endTime: parseTimestamp13(options.endTime, "--end-time") }))
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action((options) => withClient(async (client) => {
  await runDownload(client, "ai.knowledge-resource.download", { resourceType: parseNumberOption(options.resourceType, "--resource-type", { integer: true, min: 0 }), sourceId: options.sourceId }, {
    output: options.output,
    fallbackName: `resource-${options.sourceId}`,
  })
}))
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>", "Start time", datetimeArg("--start-time")).requiredOption("--end-time <datetime>", "End time", datetimeArg("--end-time")).addOption(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory()).option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.security-clue.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, queryMode: options.queryMode, gtsCodeList: maybeArray(options.gtsCode), source: maybeArray(options.source) })))
ai.command("one-pager").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.one-pager", { securityCode: options.securityCode })))
ai.command("investment-logic").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.investment-logic", { securityCode: options.securityCode })))
ai.command("peer-comparison").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.peer-comparison", { securityCode: options.securityCode })))
ai.command("earnings-review").requiredOption("--security-code <code>").requiredOption("--period <period>", "Report period (e.g. 2025q3, 2025interim, 2025annual)").option("--wait", "Wait for content generation (blocking, up to ~5 min)").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const idResult = await client.call("ai.earnings-review.get-id", { securityCode: options.securityCode, period: options.period }) as { dataId?: string }
  const dataId = idResult?.dataId
  if (!dataId) {
    process.stderr.write("Failed to get earnings review ID. The report may not be available yet.\n")
    process.exitCode = 1
    return
  }

  if (!options.wait) {
    process.stderr.write(`Earnings review task submitted. dataId: ${dataId}\n`)
    // Through printData, not a bare stdout.write: the submit-only path still has to
    // honour --output and --format. Writing straight to stdout meant a caller who
    // passed --output got exit 0 and no file, and the automation that was supposed
    // to read the dataId out of it had nothing to read.
    await printData({ dataId, status: "pending", hint: `Run 'gangtise ai earnings-review-check --data-id ${dataId}' in ~2 minutes to get results` }, format, options.output)
    return
  }

  process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
  const outcome = await pollAsyncContent(client, "ai.earnings-review.get-content", dataId, format, options.output)
  if (outcome !== "ok") {
    // "failed" already printed its terminal "Do not retry" line — only a timeout
    // gets the retry hint.
    if (outcome === "timeout") {
      process.stderr.write(`Content not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise ai earnings-review-check --data-id ${dataId}\n`)
    }
    process.exitCode = 1
  }
}))
ai.command("earnings-review-check").requiredOption("--data-id <id>", "dataId from earnings-review").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient((client) => checkAsyncContent(client, "ai.earnings-review.get-content", options.dataId, parseOutputFormat(options.format), options.output)))
ai.command("theme-tracking").requiredOption("--theme-id <id>", "Theme ID (use 'reference concept-search')").requiredOption("--date <date>", "Date (yyyy-MM-dd)", dateArg("--date")).option("--type <name>", "Report type: morning/night", collectList, []).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => {
  const typeList = options.type.length ? options.type : undefined
  return client.call("ai.theme-tracking", { themeId: options.themeId, date: options.date, type: typeList })
}))
ai.command("research-outline").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.research-outline", { securityCode: options.securityCode })))
ai.command("hot-topic").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--category <name>", "Report type: morningBriefing/noonBriefing/afternoonFlash/eveningBriefing", collectList, []).option("--with-related-securities", "Include related securities info").option("--no-with-related-securities", "Exclude related securities info").option("--with-close-reading", "Include close reading content").option("--no-with-close-reading", "Exclude close reading content").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => {
  const ALL_CATEGORIES = ["morningBriefing", "noonBriefing", "afternoonFlash", "eveningBriefing"]
  return client.call("ai.hot-topic", {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    startDate: options.startDate,
    endDate: options.endDate,
    categoryList: options.category.length > 0 ? options.category : ALL_CATEGORIES,
    withRelatedSecurities: options.withRelatedSecurities !== false,
    withCloseReading: options.withCloseReading !== false,
  })
}))
ai.command("management-discuss-announcement").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)", dateArg("--report-date")).requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension: businessOperation/financialPerformance/developmentAndRisk/all").choices(["businessOperation", "financialPerformance", "developmentAndRisk", "all"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.management-discuss-announcement", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  })))
ai.command("management-discuss-earnings-call").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)", dateArg("--report-date")).requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension").choices(["businessOperation", "financialPerformance", "developmentAndRisk"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.management-discuss-earnings-call", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  })))
ai.command("viewpoint-debate").requiredOption("--viewpoint <text>", "Viewpoint text (max 1000 chars)").option("--wait", "Wait for content generation (blocking, up to ~5 min)").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const idResult = await client.call("ai.viewpoint-debate.get-id", { viewpoint: options.viewpoint }) as { dataId?: string }
  const dataId = idResult?.dataId
  if (!dataId) {
    process.stderr.write("Failed to get viewpoint debate ID.\n")
    process.exitCode = 1
    return
  }

  if (!options.wait) {
    process.stderr.write(`Viewpoint debate task submitted. dataId: ${dataId}\n`)
    // Through printData, not a bare stdout.write: the submit-only path still has to
    // honour --output and --format. Writing straight to stdout meant a caller who
    // passed --output got exit 0 and no file, and the automation that was supposed
    // to read the dataId out of it had nothing to read.
    await printData({ dataId, status: "pending", hint: `Run 'gangtise ai viewpoint-debate-check --data-id ${dataId}' in ~2 minutes to get results` }, format, options.output)
    return
  }

  process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
  const outcome = await pollAsyncContent(client, "ai.viewpoint-debate.get-content", dataId, format, options.output)
  if (outcome !== "ok") {
    if (outcome === "timeout") {
      process.stderr.write(`Content not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise ai viewpoint-debate-check --data-id ${dataId}\n`)
    }
    process.exitCode = 1
  }
}))
ai.command("viewpoint-debate-check").requiredOption("--data-id <id>", "dataId from viewpoint-debate").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient((client) => checkAsyncContent(client, "ai.viewpoint-debate.get-content", options.dataId, parseOutputFormat(options.format), options.output)))
/** Local ceiling on codes per `ai stock-summary` call: the documented limit of 6000.
 * A live whole-market A-share batch — the largest set that exists, well past the size
 * where this endpoint used to answer with an empty list — came back complete, with
 * every omitted code confirmed to have no highlights on its own. So the guard sits at
 * the documented limit rather than below it. The stretch from a full A-share batch up
 * to 6000 rests on that documented limit, not on a probe: exceeding the A-share count
 * takes a cross-market batch. If a request inside the documented limit ever answers
 * with an empty list, lower this again. Probes behind both the old ceiling and this
 * reversal: `bug/server-open.md` P1-12. */
const STOCK_SUMMARY_MAX_SECURITIES = 6000

ai.command("stock-summary").description("Stock highlights: refined research summary per security (A-share / HK)").option("--security <code>", `Security code (e.g. 600519.SH / 00700.HK), up to ${STOCK_SUMMARY_MAX_SECURITIES} per call; market keywords are NOT supported by this endpoint`, collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => {
  // Guard against an empty --security: omitting it would send securityList:undefined,
  // which the backend may treat as all-market (3 credits/row × thousands of rows).
  if (!options.security.length) throw new ValidationError(`--security is required: pass one or more security codes (A-share / HK), up to ${STOCK_SUMMARY_MAX_SECURITIES} per call`)
  if (options.security.length > STOCK_SUMMARY_MAX_SECURITIES) {
    throw new ValidationError(`ai stock-summary: ${options.security.length} securities in one call — the endpoint takes at most ${STOCK_SUMMARY_MAX_SECURITIES}. Split the codes into batches of at most ${STOCK_SUMMARY_MAX_SECURITIES} and run one call per batch.`)
  }
  // The endpoint dropped whole-market batches on 2026-08-14 and now answers a market
  // keyword with 120001 "invalid security code" — which reads as a typo in the code.
  checkMarketKeywords(options.security, [], "ai stock-summary")
  return emit(options, (client) => client.call("ai.stock-summary.list", { securityList: maybeArray(options.security) }))
})
const reference = new Command("reference").description("Reference data APIs")
reference.command("securities-search").requiredOption("--keyword <text>", "Search keyword (name/code/pinyin/English)").option("--category <type>", "Category: stock/dr/index/fund", collectList, []).option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.securities-search", {
    keyword: options.keyword,
    category: parseChoiceList(options.category, "--category", ["stock", "dr", "index", "fund"]),
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
reference.command("constant-category").description("List constant categories and which API params accept them").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.constant-category")))
reference.command("constant-list").requiredOption("--category <code>", "Category code from 'reference constant-category' (e.g. citicIndustry/swIndustry/regionCategory)").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.constant-list", { category: options.category })))
reference.command("concept-search").requiredOption("--keyword <text>", "Search keyword (name/pinyin/group name)").option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.concept-search", {
    keyword: options.keyword,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
reference.command("sector-search").option("--keyword <text>", "Search keyword (name/pinyin)").option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.sector-search", {
    keyword: options.keyword,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
reference.command("sector-constituents").requiredOption("--sector-id <id>", "Sector ID from 'reference sector-search'").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.sector-constituents", { sectorId: options.sectorId })))
reference.command("chiefs-search").requiredOption("--keyword <text>", "Search keyword (chief name / institution / team)").option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.chiefs-search", {
    keyword: options.keyword,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
reference.command("institution-search").requiredOption("--keyword <text>", "Search keyword (institution name / abbreviation)").option("--category <name>", "Category: domesticBroker/foreignInstitution/leadInstitution/opinionInstitution/foreignOpinionInstitution (repeat); omit for all", collectList, []).option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.institution-search", {
    keyword: options.keyword,
    categoryList: parseChoiceList(options.category, "--category", ["domesticBroker", "foreignInstitution", "leadInstitution", "opinionInstitution", "foreignOpinionInstitution"]),
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
// Note: request key is BARE `category` here (spec), unlike institution-search's `categoryList`.
reference.command("official-account-search").requiredOption("--keyword <text>", "Search keyword (account name / institution / keyword, e.g. 东吴证券)").option("--category <name>", "Category: listedCompany/broker/government/media (repeat); omit for all incl. uncategorized", collectList, []).option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.official-account-search", {
    keyword: options.keyword,
    category: parseChoiceList(options.category, "--category", ["listedCompany", "broker", "government", "media"]),
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 10 }),
  })))
program.addCommand(reference)

const vault = new Command("vault").description("Vault APIs")
vault.command("drive-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>", "Start time", datetimeArg("--start-time")).option("--end-time <datetime>", "End time", datetimeArg("--end-time")).option("--keyword <text>").option("--file-type <number>", "File type", collectNumberList, []).option("--space-type <number>", "Space type", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.drive.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), { endpointKey: "vault.drive.list", idField: "fileId" }))
addDownloadCommand(vault, { endpointKey: "vault.drive.download", name: "drive-download", idOption: "--file-id", idField: "fileId", fallbackPrefix: "file", titleListEndpoint: "vault.drive.list" })

// ── drive management ──
// All free. Folder IDs come from 'drive-folder-list' ('root' = a space's root); file IDs
// from 'drive-folder-list' or 'drive-list'. Names are never unique — same-name files and
// folders are allowed and told apart only by ID — so re-running an upload, a create or a
// copy makes a second one. The two deletes are irreversible and need --yes.
const driveSpaceOption = (help: string) => new Option("--space-type <n>", help).choices(["1", "2"]).default("1")

vault.command("drive-folder-list").description("List the direct subfolders and files of a drive folder (free)")
  .addOption(driveSpaceOption("Space: 1=my drive 2=tenant drive"))
  .option("--parent-id <id>", "Folder ID in that space; omit (or 'root') for the space's root. A folder of the other space is rejected with 100003")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.drive.folder-list", { spaceType: Number(options.spaceType), parentId: options.parentId })))

vault.command("drive-upload").description("Upload a file to the AI drive (free; max 100MB per file; trial accounts max 500MB/day)")
  .requiredOption("--file <path>", "File to upload")
  .addOption(driveSpaceOption("Target space: 1=my drive 2=tenant drive (shared with your whole tenant)"))
  .option("--folder-id <id>", "Target folder ID in that space; omit (or 'root') for the space's root")
  .option("--title <name>", "Name in the drive, max 200 characters; defaults to the local file name")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => uploadDriveFile(client, options.file, { spaceType: Number(options.spaceType), folderId: options.folderId, title: options.title })))

vault.command("drive-create-folder").description("Create a drive folder (free). Same-name folders are allowed, so re-running creates a second one")
  .requiredOption("--name <name>", "Folder name, max 200 characters (230004 past that)")
  .addOption(driveSpaceOption("Space: 1=my drive 2=tenant drive (shared with your whole tenant)"))
  .option("--parent-id <id>", "Parent folder ID in that space; omit (or 'root') for the root")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.drive.create-folder", { folderName: options.name, spaceType: Number(options.spaceType), parentId: options.parentId })))

vault.command("drive-rename").description("Rename a drive file or folder (free)")
  .addOption(new Option("--type <type>", "What --id names").choices(["file", "folder"]).makeOptionMandatory())
  .requiredOption("--id <id>", "File or folder ID")
  .requiredOption("--name <name>", "New name, max 200 characters")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.drive.rename", { type: options.type, id: options.id, name: options.name })))

vault.command("drive-move-file").description("Move drive files into a folder of the SAME space (free)")
  .requiredOption("--file-id <id>", "File ID (repeat or comma-separate)", collectList)
  .requiredOption("--target-folder-id <id>", "Destination folder ID, or 'root'. Files of the other space land in failList (空间不一致)")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, async (client) => {
    const data = await client.call("vault.drive.move-file", { fileIdList: options.fileId, targetFolderId: options.targetFolderId })
    flagFailedItems(data, "vault drive-move-file")
    return data
  }))

vault.command("drive-move-folder").description("Move a drive folder under another folder of the SAME space (free)")
  .requiredOption("--folder-id <id>", "Folder ID to move")
  .requiredOption("--target-parent-id <id>", "Destination parent folder ID, or 'root'. Not the folder itself, one of its subfolders, or the other space (230005)")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.drive.move-folder", { folderId: options.folderId, targetParentId: options.targetParentId })))

// Files only. The endpoint also takes copyType=folder, but that answers 000000 with a new
// folder ID while leaving the copy empty (probed 2026-09-24), so it is not offered here.
vault.command("drive-copy").description("Copy files to the OTHER space: my drive <-> tenant drive (free; same-space copies are rejected)")
  .requiredOption("--file-id <id>", "Source file ID (repeat or comma-separate)", collectList)
  .requiredOption("--target-folder-id <id>", "Destination folder ID in the other space, or 'root' for that space's root")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, async (client) => {
    const data = await client.call("vault.drive.copy", { copyType: "file", fileIdList: options.fileId, targetFolderId: options.targetFolderId })
    flagFailedItems(data, "vault drive-copy")
    return data
  }))

vault.command("drive-delete-file").description("Delete drive files — irreversible (free)")
  .requiredOption("--file-id <id>", "File ID to delete (repeat or comma-separate)", collectList)
  .option("--yes", "Required: confirm the deletion")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action(async (options) => {
    assertConfirmed("vault.drive.delete-file", Boolean(options.yes), options.fileId.join("、"))
    await emit(options, async (client) => {
      const data = await client.call("vault.drive.delete-file", { fileIdList: options.fileId })
      flagFailedItems(data, "vault drive-delete-file")
      return data
    })
  })

vault.command("drive-delete-folder").description("Delete a drive folder AND every subfolder and file inside it — irreversible (free)")
  .requiredOption("--folder-id <id>", "Folder ID to delete")
  .option("--yes", "Required: confirm the deletion")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action(async (options) => {
    assertConfirmed("vault.drive.delete-folder", Boolean(options.yes), options.folderId)
    await emit(options, (client) => client.call("vault.drive.delete-folder", { folderId: options.folderId }))
  })
vault.command("record-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>", "Start time", datetimeArg("--start-time")).option("--end-time <datetime>", "End time", datetimeArg("--end-time")).option("--keyword <text>").option("--category <name>", "Recording type: upload/link/mobile/gtNote/pc/share", collectList, []).option("--space-type <number>", "Space type: 1=my records / 2=tenant records", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.record.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, categoryList: maybeArray(options.category), spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), { endpointKey: "vault.record.list", idField: "recordId" }))
addDownloadCommand(vault, { endpointKey: "vault.record.download", name: "record-download", idOption: "--record-id", idField: "recordId", fallbackPrefix: "record", contentTypeDescription: "Content type: original/asr/summary", titleListEndpoint: "vault.record.list" })
vault.command("my-conference-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>", "Start time", datetimeArg("--start-time")).option("--end-time <datetime>", "End time", datetimeArg("--end-time")).option("--keyword <text>").option("--research-area <id>", "Research area ID: citicIndustry code (1008001xx) or gangtiseIndustry direction code (122000xxx: macro/strategy/fixed-income/quant/overseas). swIndustry (104xx0000) returns 0 here", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Conference category: earningsCall/strategyMeeting/fundRoadshow/shareholdersMeeting/maMeeting/specialMeeting/companyAnalysis/industryAnalysis/other", collectList, []).option("--source <number>", "Recording source: 1=企微会议助理 2=会议服务微信群 (repeat)", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.my-conference.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution), categoryList: maybeArray(options.category), sourceList: options.source.length ? options.source : undefined }), { endpointKey: "vault.my-conference.list", idField: "conferenceId" }))
addDownloadCommand(vault, { endpointKey: "vault.my-conference.download", name: "my-conference-download", idOption: "--conference-id", idField: "conferenceId", fallbackPrefix: "conference", contentTypeDescription: "Content type: asr/summary", titleListEndpoint: "vault.my-conference.list" })
vault.command("wechat-message-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>", "Start time", datetimeArg("--start-time")).option("--end-time <datetime>", "End time", datetimeArg("--end-time")).option("--keyword <text>").option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, []).option("--wechat-group-id <id>", "WeChat group ID", collectList, []).option("--industry <id>", "Industry ID -- citicIndustry codes (1008001xx) only; swIndustry codes and unknown values are rejected with 100005", collectList, []).option("--category <name>", "Message type: text/image/documents/url", collectList, []).option("--tag <name>", "Tag: roadShow/research/strategyMeeting/meetingSummary/industryComment/companyComment/earningsReview", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.wechat-message.list", buildWechatMessageListBody(options))))
vault.command("wechat-chatroom-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--room-name <name>", "WeChat group name; repeat or comma-separate for multiple names", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.wechat-chatroom.list", buildWechatChatroomListBody(options))))
vault.command("stock-pool-list").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.list", {})))
vault.command("stock-pool-stocks").option("--pool-id <id>", "Pool ID; repeat for multiple; omit (or 'all') for all pools", collectList).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.stocks", buildStockPoolStocksBody(options))))
/** The `--yes` gate for irreversible endpoints, shared by the dedicated commands and
 * `raw call`. It reads `ENDPOINTS[key].destructive` so there is one fact, not two:
 * a rule duplicated per entry point is a rule that will be added to one and not the
 * other. Throws BEFORE a client is acquired, so a refusal can never race a
 * half-issued request. */
function assertConfirmed(endpointKey: string, confirmed: boolean, target: string): void {
  const destructive = ENDPOINTS[endpointKey]?.destructive
  if (!destructive || confirmed) return
  throw new ValidationError(`${destructive.warning} 确认要对 ${target} 执行就加上 --yes。`)
}

// ── stock-pool writes ──
// These five change the user's own watchlists; every other command in the CLI only reads.
// `addStock` / `deleteStock` / `deletePool` report per-item failures inside a 000000
// envelope, so each pipes its result through flagFailedItems (→ partial, exit 3).
vault.command("stock-pool-create").requiredOption("--name <name>", "New pool name; max 10 characters (a CJK character counts as 1) and must differ from every existing pool name. A duplicate is rejected with 230006, an over-long name with 230007. Max 30 pools per account (230003)").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.create", { poolName: options.name })))
vault.command("stock-pool-rename").requiredOption("--pool-id <id>", "Pool ID from 'stock-pool-list'").requiredOption("--name <name>", "New pool name; same rules as stock-pool-create (max 10 characters, must differ from every existing pool name). Renaming a pool to its own current name succeeds").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.rename", { poolId: options.poolId, poolName: options.name })))
vault.command("stock-pool-add-stock").requiredOption("--pool-id <id>", "Target pool ID from 'stock-pool-list'").requiredOption("--security <code>", "Security code, e.g. 600519.SH (repeat or comma-separate)", collectList).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, async (client) => {
  const data = await client.call("vault.stock-pool.add-stock", { poolId: options.poolId, securityCodeList: options.security })
  flagFailedItems(data, "vault stock-pool-add-stock")
  return data
}))
vault.command("stock-pool-remove-stock").requiredOption("--pool-id <id>", "Target pool ID from 'stock-pool-list'").requiredOption("--security <code>", "Security code, e.g. 600519.SH (repeat or comma-separate)", collectList).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, async (client) => {
  const data = await client.call("vault.stock-pool.remove-stock", { poolId: options.poolId, securityCodeList: options.security })
  flagFailedItems(data, "vault stock-pool-remove-stock")
  return data
}))
// --yes is required, not a convenience: deleting a pool also drops every watch relation
// inside it (a pool can hold up to 10000 securities) and nothing restores them. The other
// four writes are recoverable by re-running their opposite, so only this one asks.
vault.command("stock-pool-delete").requiredOption("--pool-id <id>", "Pool ID to delete; repeat or comma-separate for multiple", collectList).option("--yes", "Required: confirm the deletion").option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  assertConfirmed("vault.stock-pool.delete", Boolean(options.yes), options.poolId.join("、"))
  await emit(options, async (client) => {
    const data = await client.call("vault.stock-pool.delete", { poolIdList: options.poolId })
    flagFailedItems(data, "vault stock-pool-delete")
    return data
  })
})
program.addCommand(vault)
program.addCommand(ai)

const alternative = new Command("alternative").description("Alternative data APIs")
alternative.command("edb-search").requiredOption("--keyword <text>", "Search keyword (e.g. '空调')").option("--limit <number>", "Max results (default: 100, max: 200)", "100").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("alternative.edb-search", {
    keyword: options.keyword,
    limit: parseNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 200 }),
  })))
alternative.command("edb-data").option("--indicator-id <id>", "Indicator ID (repeat, max 10)", collectList, []).requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).requiredOption("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const raw = await client.call("alternative.edb-data", {
    indicatorIdList: options.indicatorId,
    startDate: options.startDate,
    endDate: options.endDate,
  }) as { fieldList?: string[], dataList?: unknown[][] } | null
  let data: unknown = raw
  if (raw && Array.isArray(raw.fieldList) && Array.isArray(raw.dataList)) {
    const fields = raw.fieldList as string[]
    // This flattening happens before normalizeRows ever sees the rows, so the header
    // rules (unique names) have to be applied here too — or a duplicated indicator
    // column would silently keep only its last value.
    assertColumnarHeader(fields, raw)
    const list = raw.dataList.map((row) => zipFieldRow(fields, row, raw))
    data = { list, total: list.length }
  }
  await printData(data, format, options.output)
}))
alternative.command("concept-info").description("Concept profile: definition, investment logic, industry space, competitive landscape (50 credits/call)").requiredOption("--concept-id <id>", "Concept (theme index) ID, e.g. 121000130 机器人; discover via 'gangtise reference concept-search'").option("--full", "Also return catalyst events (keyEvents) via the v1 endpoint — 500 credits/call instead of 50").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call(options.full ? "alternative.concept-info-full" : "alternative.concept-info", { conceptId: options.conceptId })))
alternative.command("concept-securities").description("Concept constituents, grouped (50 credits/call; free when the concept has none)").requiredOption("--concept-id <id>", "Concept (theme index) ID, e.g. 121000130 机器人; discover via 'gangtise reference concept-search'").option("--full", "Also return the key-stock flag (isKey) and inclusion reason via the v1 endpoint — 500 credits/call instead of 50").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call(options.full ? "alternative.concept-securities-full" : "alternative.concept-securities", { conceptId: options.conceptId })))
program.addCommand(alternative)

/** Mark and report the request codes the server did not answer for at all.
 *
 * What this catches changed on the server. EDE used to drop any axis it had no
 * DATA for — an indicator empty for every security vanished from
 * `indicatorList`, a security empty for every indicator vanished from
 * `securityCodeList`. Re-probed 2026-09-12: a coverage gap is now padded with
 * `null` and keeps its row and column (`mgn_bal` × 00700.HK — null, present,
 * even as the only cell in the request).
 *
 * A code the server cannot RESOLVE still vanishes: an unknown indicator code, or
 * a security code with the wrong suffix (`AAPL.US`, whose real form is
 * `AAPL.O`). So this is now a typo detector rather than a coverage detector —
 * which is the more useful of the two, since a coverage gap is visible as `null`
 * but a misspelled code is otherwise invisible: exit code 0, a plausible-looking
 * table, and a `--key-by code` mapping whose key simply is not there.
 *
 * Same signal as a failed page or a row cap: `partial` on the payload (printData
 * → exit 3) plus the omitted codes, so an automated caller can react without
 * parsing stderr. */
function flagDropped(rows: unknown, data: unknown, requestedSecurities: string[], requestedIndicators: string[]): void {
  // A wholly empty response is not a partial one: the diff against the request
  // would list everything as "omitted", which says nothing about which axis is
  // at fault. Exit 0, but say why it is ambiguous.
  if (isEmptyMatrix(data)) {
    process.stderr.write("[gangtise] note: the query returned no data at all. Since a real coverage gap now comes back as a null cell rather than an empty table, this usually means NOTHING in the request resolved — every security code or every indicator code was unrecognised — or a parameter name is wrong. Cross-check codes against 'gangtise indicator search --format json' and 'gangtise reference securities-search'.\n")
    return
  }
  const { securities, indicators } = droppedFromMatrix(data, requestedSecurities, requestedIndicators)
  if (securities.length === 0 && indicators.length === 0) return
  if (rows && typeof rows === "object" && !Array.isArray(rows)) {
    const rec = rows as Record<string, unknown>
    rec.partial = true
    if (indicators.length > 0) rec.omittedIndicators = indicators
    if (securities.length > 0) rec.omittedSecurities = securities
  }
  const parts: string[] = []
  if (indicators.length > 0) parts.push(`indicators ${indicators.join(", ")}`)
  if (securities.length > 0) parts.push(`securities ${securities.join(", ")}`)
  process.stderr.write(`[gangtise] warning: the response omits ${parts.join(" and ")} entirely — no row/column at all, not a null one. A code the server merely has no data for still comes back as null, so this normally means the code itself was not recognised: check it for typos and, for securities, for the wrong market suffix (US tickers are .O/.N, not .US). Result marked partial (exit 3).\n`)
}

/** `--indicator` / `--security` are repeatable, so Commander cannot mark them
 * required — but every matrix endpoint needs at least one of each and answers a
 * missing one with 100001, whose hint sends the user to `--help`, which in turn
 * showed them as optional with a `[]` default. Catch it here: no request, no
 * round trip, and a message that names the flag. */
function requireIndicatorScope(indicators: string[], securities: string[]): void {
  const missing = [indicators.length === 0 ? "--indicator" : "", securities.length === 0 ? "--security" : ""].filter(Boolean)
  if (missing.length > 0) {
    throw new ValidationError(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} required (repeat the flag for multiple values)`)
  }
}

const indicator = new Command("indicator").description("Data indicator (EDE) APIs: search codes, cross-section, time-series, screener")
indicator.command("search").requiredOption("--keyword <text>", "Search keyword, e.g. '收盘价' '成交量' '营业收入' (not free-form questions)").option("--limit <number>", "Max results (default: 50, max: 100)", "50").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const raw = await client.call("indicator.search", {
    keyword: options.keyword,
    limit: parseNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 100 }),
  })
  await printData(unwrapIndicatorData(raw), format, options.output)
}))
indicator.command("cross-section").option("--indicator <code>", "Indicator code, e.g. qte_close (REQUIRED, repeat for multiple)", collectList, []).option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, []).requiredOption("--date <date>", "Data date (yyyy-MM-dd); sent as each indicator's tradeDate. Report-period indicators (is_*, financial statements) REJECT tradeDate and require --indicator-param 'code:reportDate=yyyy-MM-dd' instead — check parameterList in 'indicator search'", dateArg("--date")).option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)").option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)").option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustType=2 for 前复权 (repeat); read exact keys from 'indicator search'. Bare 'code:' (nothing after the colon) declares the indicator takes NO date — required by any indicator whose parameterList has no date key at all, which otherwise rejects the tradeDate --date injects: the pty_* / scr_* static-attribute families (pty_op_scope, scr_exchg_mkt, scr_isin …), plus div_cash_paid_ratio / div_cash_yr (add 'code:fiscalYear=YYYY' too) and pty_shr_reg. It composes with real params, so 'code:' + 'code:scale=8' keeps the scale", collectList, []).addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode, unique & order-stable for batch code→value mapping").choices(["name", "code"]).default("name")).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  requireIndicatorScope(options.indicator, options.security)
  const raw = await client.call("indicator.cross-section", buildIndicatorCrossSectionBody(options))
  const data = requireIndicatorMatrix(raw)
  // Flatten first: a shape error must not be preceded by a dropped-rows warning
  // that reads like the run merely came back short.
  const rows = flattenCrossSection(data, options.keyBy)
  flagDropped(rows, data, options.security, options.indicator)
  await printData(rows, format, options.output)
}))
indicator.command("time-series").option("--indicator <code>", "Indicator code, e.g. qte_close (REQUIRED, repeat for multiple)", collectList, []).option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, []).requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date")).requiredOption("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date")).option("--calendar-type <type>", "Calendar: ND=natural TD=trading WD=weekday. Omit it and the CLI picks: a free 'indicator search' reads each parameterList and sends TD only when EVERY indicator is trading-day typed, otherwise it leaves the server on ND (report-period indicators land on dates a trading calendar lacks, and TD would answer them with an all-null grid). An explicit value is sent as given, with no lookup").option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)").option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)").option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustType=2 for 前复权 (repeat); read exact keys from 'indicator search'", collectList, []).addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode/securityCode, unique & order-stable for batch mapping").choices(["name", "code"]).default("name")).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  requireIndicatorScope(options.indicator, options.security)
  // Build first: buildIndicatorTimeSeriesBody runs the --indicator-param binding check,
  // and that guard has to fire before ANY request goes out — including the free probe below.
  const body = buildIndicatorTimeSeriesBody(options)
  // Then pick the date axis, and only when the caller left --calendar-type off:
  // an explicit value is an instruction, not a default to improve on.
  if (!body.calendarType) {
    const resolved = await resolveCalendarType(client, options.indicator)
    if (resolved) {
      body.calendarType = resolved
      process.stderr.write(`[gangtise] note: every requested indicator takes tradeDate, so this series was fetched on the trading-day calendar (calendarType=TD) instead of the server default ND — no all-null non-trading rows, and fewer cells against the 30000 cap. Pass --calendar-type ND to override.\n`)
    }
  }
  const raw = await client.call("indicator.time-series", body)
  const data = requireIndicatorMatrix(raw)
  // Pass the universe itself, not a count: flattenTimeSeries needs to know
  // whether a sector ID is in play (the server expands it, so one entry can mean
  // many securities) and dedupes internally. The request only breaks the tie when
  // the response is 1×1 anyway. Flatten before flagging so a shape error surfaces
  // on its own.
  const rows = flattenTimeSeries(data, options.keyBy, options.security)
  flagDropped(rows, data, options.security, options.indicator)
  await printData(rows, format, options.output)
}))
indicator.command("screener").description("Screen securities by an expression over indicator values (条件选股)").option("--indicator <spec>", "Bind a variable to an indicator, 'F1:code', e.g. F1:qte_mkt_cptl (REQUIRED, repeat)", collectList, []).option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, []).requiredOption("--expression <expr>", "Filter over the bound variables, e.g. 'F1 >= 800 && (F2 >= 20 && F2 <= 30)'; also supports contains/notcontains on string indicators").requiredOption("--date <date>", "Data date (yyyy-MM-dd); sent as every indicator's tradeDate unless it already has one — omitting it leaves date-bearing indicators unfiltered and silently yields an empty screen. Report-period indicators (is_*) reject tradeDate: give them --indicator-param 'F1:reportDate=yyyy-MM-dd'", dateArg("--date")).option("--indicator-param <spec>", "Per-variable param 'F1:key=value', e.g. F1:scale=8 (repeat); read exact keys from 'indicator search'. Bare 'F1:' (nothing after the colon) declares that the indicator takes NO date — required by any indicator whose parameterList has no date key at all, which otherwise rejects the tradeDate --date injects: the pty_* / scr_* static-attribute families (pty_op_scope, scr_exchg_sctr, scr_isin …), plus div_cash_paid_ratio / div_cash_yr (add 'F1:fiscalYear=YYYY' too) and pty_shr_reg. It composes with real params, so 'F1:' + 'F1:scale=8' keeps the scale", collectList, []).addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode").choices(["name", "code"]).default("name")).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  requireIndicatorScope(options.indicator, options.security)
  // Binding one indicator code to several variables (the same price on two
  // dates) is supported: the server used to answer every such binding from the
  // EARLIEST date among them and null the rest, which made the whole result
  // untrustworthy and needed an `unreliable` flag. Re-probed 2026-08-08 — fixed:
  // each variable now carries its own date's value, stable across repeats.
  const bindings = parseScreenerIndicators(options.indicator, options.indicatorParam, options.expression)
  const raw = await client.call("indicator.screener", buildIndicatorScreenerBody(options))
  // Same payload shape as cross-section (one row per matched security, one
  // column per indicator) with a `field` on each indicator entry. No dropped-row
  // flag here: a security missing from a screener result means it failed the
  // filter, which is the whole point.
  const data = requireIndicatorMatrix(raw)
  // Before anything is rendered: the returned bindings must be the ones that
  // were asked for, and the expression must still be evaluable from the columns
  // that came back — otherwise the rows cannot be shown to satisfy the
  // conditions they claim to. See checkScreenerBindings for how a missing column
  // is weighed against the expression's boolean structure.
  // Flatten first: it asserts the payload's structural axes, and a response
  // missing `indicatorList` outright deserves that diagnosis rather than being
  // reported as a binding problem. Nothing renders in between, so ordering the
  // structural check ahead of the semantic one is free.
  const rows = flattenCrossSection(data, options.keyBy)
  const filteredOn = screenerExpressionFields(options.expression)
  const unbound = checkScreenerBindings(data, bindings, options.expression)
  // Same ambiguity as the other matrix commands: an empty screen is a normal
  // answer AND what a wrong parameter name produces. Keyed on "nothing matched"
  // rather than the strict canonical-empty shape — a response that returns zero
  // securities while still echoing `indicatorList` is just as empty to the
  // caller, and just as ambiguous, but would slip past isEmptyMatrix.
  // flattenCrossSection above already asserted this is an array of non-empty
  // strings, so only its length is left to read.
  if ((data as { securityCodeList: unknown[] }).securityCodeList.length === 0) {
    process.stderr.write("[gangtise] note: nothing matched the expression. That is a normal answer — but an empty result is ALSO what an unrecognised code or a wrong parameter name produces. Cross-check the indicator codes and parameters against 'gangtise indicator search --format json'.\n")
  }
  if (unbound.length > 0) {
    // Whatever reached here still leaves the expression evaluable (or was never
    // read by it), so the rows stand: losing the column costs information, not
    // correctness, and it degrades rather than failing.
    const rec = rows as Record<string, unknown>
    rec.partial = true
    rec.omittedIndicators = unbound.map((field) => bindings.find((b) => b.field === field)?.indicatorCode ?? field)
    const alsoFiltered = unbound.filter((field) => filteredOn.includes(field))
    const filterNote = alsoFiltered.length > 0
      ? ` The expression also filters on ${alsoFiltered.join(", ")}, so that condition was applied to none of these rows — another branch of the expression could still have matched them legitimately, but verify before relying on that filter.`
      : ""
    process.stderr.write(`[gangtise] warning: ${unbound.join(", ")} produced no column at all — those output values are missing. An indicator the server merely has no data for still returns a null column, so this normally means the bound code was not recognised; check it against 'gangtise indicator search'.${filterNote} Result marked partial (exit 3).\n`)
  }
  await printData(rows, format, options.output)
}))
program.addCommand(indicator)

const tool = new Command("tool").description("Research tool APIs: PDF parsing")
tool.command("file-parse").description("Parse a PDF into Markdown + images (async; 0.8 credits/page, billed at submit)")
  .requiredOption("--file <path>", "PDF to upload (max 100MB / 500 pages)")
  .option("--wait", "Wait for the parse to finish and save the result ZIP (blocking, up to ~5 min)")
  .option("--output <path>", "Where to save the result ZIP (used with --wait)")
  .action((options) => withClient(async (client) => {
    const taskId = await submitFileParse(client, options.file)
    if (!options.wait) {
      process.stderr.write(`File parse task submitted. taskId: ${taskId}\n`)
      process.stdout.write(`${JSON.stringify({ taskId, status: "pending", hint: `Run 'gangtise tool file-parse-check --task-id ${taskId}' in ~3 minutes to download the result ZIP` })}\n`)
      return
    }
    process.stderr.write(`Got taskId: ${taskId}, waiting for the parse to finish...\n`)
    if (await pollFileParseResult(client, taskId, options.output) !== "ok") {
      // Fetching the result is free and the task keeps running server-side —
      // re-checking later costs nothing, resubmitting re-bills the whole file.
      process.stderr.write(`Parse result not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise tool file-parse-check --task-id ${taskId}\n`)
      process.exitCode = 1
    }
  }))
tool.command("file-parse-check").description("Download a finished file-parse result ZIP by taskId (free)")
  .requiredOption("--task-id <id>", "taskId from 'tool file-parse'")
  .option("--output <path>", "Where to save the result ZIP")
  .action((options) => withClient(async (client) => {
    if (await fetchFileParseResult(client, options.taskId, options.output) === "pending") {
      // 🔴 Deliberately a bare stdout write, NOT printData — do not "make this
      // consistent" with the ai *-check commands. Their --output is a render target;
      // this one is "where to save the result ZIP" (and there is no --format here at
      // all), so routing a pending JSON through it would leave a .zip that is not a
      // zip. The status line belongs on stdout precisely because --output is spoken
      // for.
      process.stdout.write(`${JSON.stringify({ taskId: options.taskId, status: "pending", hint: "Parse not finished yet, retry in ~1 minute" })}\n`)
    }
  }))

tool.command("web-search").description("Search the public web for research: deduped, source-tiered (T0-T3) results with optional page content (1 credit/call)")
  .requiredOption("--query <text>", "Search query, 1-200 chars. Sent verbatim — no intent rewriting server-side, so spell out what you want")
  .option("--size <number>", "Results to return, 1-20 (1-5 with --include-content)", "10")
  .addOption(new Option("--freshness <window>", "Time window over publishTime; results with no resolvable publish date are dropped by day/week/month").choices(["day", "week", "month", "none"]))
  .addOption(new Option("--min-tier <tier>", "Lowest source tier to keep; T3 = no filtering").choices(["T0", "T1", "T2", "T3"]))
  .option("--site <domain>", "Restrict to a registered domain or subdomain, e.g. csrc.gov.cn (repeatable, max 10, OR-ed)", collectList, [])
  .option("--include-content", "Return page body as Markdown; caps --size at 5")
  .option("--max-content-chars <number>", "Max chars per body, 1000-20000 (only with --include-content)")
  .option("--format <format>", "Output format", "table").option("--output <path>")
  .action((options) => emit(options, (client) => {
    // The size ceiling drops to 5 with bodies on. Checked here so a rejected call
    // doesn't spend the credit, and so the message names the flag that lowered the cap
    // instead of an unexplained "expected a number <= 5".
    const size = parseNumberOption(options.size, "--size", { integer: true, min: 1, max: 20 })
    if (options.includeContent && size > 5) throw new ValidationError(`--size ${size} with --include-content: this endpoint caps size at 5 when page bodies are requested. Lower --size, or drop --include-content to fetch up to 20 snippets.`)
    // Counted after de-duplication, as the server counts it.
    const sites = [...new Set(options.site as string[])]
    if (sites.length > 10) throw new ValidationError(`--site takes at most 10 distinct domains, got ${sites.length}`)
    return client.call("tool.web-search", {
      query: options.query, size, freshness: options.freshness, minTier: options.minTier,
      siteList: maybeArray(sites), includeContent: options.includeContent || undefined,
      maxContentChars: parseOptionalNumberOption(options.maxContentChars, "--max-content-chars", { integer: true, min: 1000, max: 20000 }),
    })
  }))
program.addCommand(tool)

program.command("raw").description("Raw API calls").addCommand(new Command("call").argument("<endpointKey>").option("--body <json>").option("--query <key=value>", "Query string pair", collectKeyValue, {}).option("--yes", "Confirm an irreversible endpoint (required for the ones marked destructive)").option("--format <format>", "Output format", "json").option("--output <path>").action(async (endpointKey, options) => {
  const endpoint = ENDPOINTS[endpointKey]
  if (!endpoint) {
    throw new ConfigError(`Unknown endpoint key: ${endpointKey}`)
  }
  // Same gate as the dedicated command. `raw call` is a passthrough for the REQUEST,
  // not a way around a guard on what the request does — and this one protects data
  // that nothing restores. Checked before the client is acquired.
  assertConfirmed(endpointKey, Boolean(options.yes), endpointKey)
  const format = parseOutputFormat(options.format)
  const client = await createClient({ format, output: options.output })
  let body: unknown
  if (options.body) {
    try {
      body = JSON.parse(options.body)
    } catch {
      throw new ConfigError(`Invalid JSON in --body: ${options.body}`)
    }
  }
  // Fail loudly on arguments the endpoint kind can't use — they used to be
  // silently dropped, leaving the user to puzzle over server-side errors.
  if (endpoint.kind === "download") {
    // POST download endpoints (file-parse result) take their parameters as a JSON
    // body; GET ones take --query and can't carry a body at all.
    if (body !== undefined && endpoint.method !== "POST") {
      throw new ValidationError(`--body is not supported for GET download endpoints (use --query key=value); ${endpointKey} is kind=download`)
    }
    await runDownload(client, endpointKey, options.query as Record<string, string | number>, {
      output: options.output,
      fallbackName: "download.bin",
      body,
    })
    return
  }
  if (Object.keys(options.query as Record<string, string>).length > 0) {
    throw new ValidationError(`--query is not supported for JSON endpoints (use --body '{...}'); ${endpointKey} is kind=json`)
  }
  try {
    const data = await client.call(endpointKey, body)
    // Result INTERPRETATION, which this path already does elsewhere (envelope
    // unwrapping, `total`, the duplicate-column check). Leaving it out here is what
    // let the same response exit 3 through the dedicated command and 0 through here.
    if (endpoint.itemFailures) flagFailedItems(data, `raw call ${endpointKey}`)
    await printData(data, format, options.output)
  } finally {
    await client.rowSink?.abort()
  }
})).addCommand(new Command("list").description("List all registered endpoint keys (for use with 'raw call')").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => printData(listEndpoints(), parseOutputFormat(options.format), options.output)))

async function checkForUpdate(timeoutMs = 2000): Promise<void> {
  try {
    const response = await fetch("https://registry.npmjs.org/gangtise-openapi-cli/latest", { signal: AbortSignal.timeout(timeoutMs) })
    const latest = (await response.json() as { version?: string }).version
    // Ordered compare, not inequality: during the just-published window the
    // registry still serves the PREVIOUS version — don't suggest a "downgrade".
    if (latest && isVersionNewer(latest, CLI_VERSION)) {
      process.stderr.write(`Update available: ${CLI_VERSION} → ${latest}\nRun: npm update -g gangtise-openapi-cli\n`)
    }
  } catch { /* best-effort: offline or a slow registry must not break --version */ }
}

/** Last-resort reporting for anything that escapes main()'s try/catch: an error
 * thrown inside an event callback or a rejected promise nobody awaited. Node's
 * default is a multi-line crash dump on stdout/stderr AND a non-zero exit — so a
 * command whose data was already printed correctly would end up looking like a
 * hard failure, with a stack trace where a message belongs. This release is
 * about exit codes meaning what they say; that is the one path that lies.
 *
 * The stack is kept behind --verbose: reaching here at all means a CLI bug
 * rather than an API failure, and one line is not enough to locate one. */
/** Milliseconds to let already-queued stdout reach the pipe before leaving. */
const FATAL_FLUSH_MS = 200
let leaving = false

function reportFatal(error: unknown): void {
  // `error.stack` already opens with "Name: message" — printing both duplicates
  // the first line.
  const stack = error instanceof Error ? error.stack : undefined
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const text = `${isVerbose() && stack ? stack : message}\n`
  if (leaving) {
    process.stderr.write(text)
    return
  }
  leaving = true
  process.exitCode = 1
  // Terminating is not optional: a fatal error with a live handle (a timer, an
  // open socket) would otherwise keep the process running forever on `exitCode`
  // alone. But `process.exit()` on the spot truncates whatever is still queued —
  // to a pipe BOTH streams are written asynchronously — and a handler meant to
  // stop this release from lying about exit codes must not start dropping output
  // to do it. So wait for the diagnostic itself AND for anything stdout still
  // owes, each bounded by the same deadline.
  //
  // stderr is not merely "check the length": the write is issued right here, so
  // its callback is the only thing that knows when it actually reached the pipe.
  // Exiting on the spot truncated a large diagnostic to one 64 KiB buffer.
  let pending = 1
  const leave = (): void => { if (--pending === 0) process.exit(1) }
  if (process.stdout.writableLength > 0) {
    pending++
    process.stdout.once("drain", leave)
  }
  setTimeout(() => process.exit(1), FATAL_FLUSH_MS)
  process.stderr.write(text, leave)
}
process.on("uncaughtException", reportFatal)
process.on("unhandledRejection", reportFatal)

/** Teardown races on a closed stdout: the reader went away, which is not this
 * process's failure. `gangtise ... | head` is the everyday case — it truncates
 * the output and still exits 0, so a same-class race has no principled reason to
 * exit 1. Without a handler the final write crashes Node with an unhandled
 * 'error' event; rethrowing from this callback did the same by another route
 * (a crash dump appended AFTER the correct JSON had already been written). */
const READER_GONE = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "EBADF"])
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error?.code && READER_GONE.has(error.code)) process.exit(0)
  reportFatal(error)
})

async function main() {
  // Positional check, not argv.includes: "--version" appearing later (e.g. as
  // another option's value) must not short-circuit the whole command.
  const firstArg = process.argv[2]
  if (firstArg === "--version" || firstArg === "-V") {
    process.stdout.write(`${CLI_VERSION}\n`)
    await checkForUpdate()
    return
  }
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof ApiError) {
      const hint = error.hint ? ` ${error.hint}` : ""
      // traceId is what Gangtise support needs to look a failure up; without it a
      // 999999 report is unactionable on their side.
      const trace = error.traceId ? ` [trace ${error.traceId}]` : ""
      process.stderr.write(`API error${error.code ? ` (${error.code})` : ""}${trace}: ${error.message}${hint}\n`)
      process.exitCode = 1
      return
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.name}: ${error.message}\n`)
      process.exitCode = 1
      return
    }
    process.stderr.write("Unknown error\n")
    process.exitCode = 1
  }
}

void main()
