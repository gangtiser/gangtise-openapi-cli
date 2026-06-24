#!/usr/bin/env node
import { Command, Option } from "commander"

import { checkAsyncContent, pollAsyncContent, POLL_MAX_ATTEMPTS } from "./core/asyncContent.js"
import { readTokenCache } from "./core/auth.js"
import { collectKeyValue, collectList, collectNumberList, maybeArray, parseFrom, parseNumberOption, parseOptionalNumberOption, parseSize, parseTimestamp13 } from "./core/args.js"
import { buildIndicatorCrossSectionBody, buildIndicatorTimeSeriesBody, buildQuoteKlineBody, buildStockPoolStocksBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "./core/commandBodies.js"
import { flattenCrossSection, flattenTimeSeries, unwrapIndicatorData } from "./core/indicatorMatrix.js"
import { callKlineWithSharding } from "./core/quoteSharding.js"
import { loadConfig } from "./core/config.js"
import { resolveTitle, saveDownloadResult } from "./core/download.js"
import { ENDPOINTS } from "./core/endpoints.js"
import { ApiError, ConfigError } from "./core/errors.js"
import { normalizeRows } from "./core/normalize.js"
import { parseOutputFormat } from "./core/output.js"
import { printData } from "./core/printer.js"
import type { GangtiseClient } from "./core/client.js"
import type { TitleCacheConfig } from "./core/titleCache.js"

// --- Lazy-loaded modules (deferred to action handlers) ---
async function createClient() {
  const { GangtiseClient } = await import("./core/client.js")
  return new GangtiseClient(loadConfig())
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
  const client = await createClient()
  await printData(await produce(client), parseOutputFormat(options.format), options.output, cache)
}

/** Acquire a client and run an arbitrary action (downloads, polling, custom shaping). */
async function withClient(fn: (client: GangtiseClient) => Promise<void>): Promise<void> {
  await fn(await createClient())
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
  options: { output?: string; fallbackName: string; resolveOutputPath?: (result: unknown) => Promise<string | undefined> },
): Promise<void> {
  if (options.output) {
    const result = await client.call(endpointKey, undefined, query, { streamTo: options.output })
    await saveDownloadResult(result, options.fallbackName, options.output)
    return
  }
  const result = await client.call(endpointKey, undefined, query)
  const resolved = options.resolveOutputPath ? await options.resolveOutputPath(result) : undefined
  await saveDownloadResult(result, options.fallbackName, resolved)
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
  fileType?: { description: string; default?: string; required?: boolean }
  contentTypeDescription?: string
  titleListEndpoint?: string
}) {
  const cmd = parent.command(spec.name ?? "download").requiredOption(`${spec.idOption} <id>`)
  if (spec.fileType?.required) cmd.requiredOption("--file-type <number>", spec.fileType.description)
  else if (spec.fileType) cmd.option("--file-type <number>", spec.fileType.description, spec.fileType.default)
  if (spec.contentTypeDescription) cmd.requiredOption("--content-type <type>", spec.contentTypeDescription)
  cmd.option("--output <path>").action((options) => withClient(async (client) => {
    const id = options[spec.idField] as string
    const qp: Record<string, string | number> = { [spec.idField]: id }
    if (spec.fileType && options.fileType) qp.fileType = parseNumberOption(options.fileType, "--file-type", { integer: true, min: 1 })
    if (spec.contentTypeDescription) qp.contentType = options.contentType as string
    const titleList = spec.titleListEndpoint
    await runDownload(client, spec.endpointKey, qp, {
      output: options.output,
      fallbackName: `${spec.fallbackPrefix}-${id}`,
      resolveOutputPath: titleList ? (result) => resolveTitle(client, result, titleList, spec.idField, id) : undefined,
    })
  }))
}

function addTimeFilters(command: Command) {
  return command
    .option("--from <number>", "Starting offset", "0")
    .option("--size <number>", "Total rows to return; omit to fetch all")
    .option("--start-time <datetime>", "Start time")
    .option("--end-time <datetime>", "End time")
    .option("--keyword <keyword>", "Keyword")
}

import { setVerbose } from "./core/transport.js"
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
      .option("--format <format>", "Output format", "json")
      .action((options) => emit(options, (client) => client.login())),
  )
  .addCommand(
    new Command("status")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const config = loadConfig()
        const cache = await readTokenCache(config.tokenCachePath)
        await printData({ hasEnvToken: Boolean(config.token), hasCachedToken: Boolean(cache?.accessToken), cache }, parseOutputFormat(options.format))
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
const roadshow = new Command("roadshow")
const siteVisit = new Command("site-visit")
const strategy = new Command("strategy")
const forum = new Command("forum")
const research = new Command("research")
const foreignReport = new Command("foreign-report")
const announcement = new Command("announcement")
const announcementHk = new Command("announcement-hk")
const foreignOpinion = new Command("foreign-opinion")
const independentOpinion = new Command("independent-opinion")
const officialAccount = new Command("official-account")

addTimeFilters(opinion.command("list").option("--rank-type <number>", "Rank type", "1").option("--research-area <id>", "Research area ID", collectList, []).option("--chief <id>", "Chief ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--concept <id>", "Concept ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--source <source>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), chiefList: maybeArray(options.chief),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker), industryList: maybeArray(options.industry), conceptList: maybeArray(options.concept),
    llmTagList: maybeArray(options.llmTag), sourceList: maybeArray(options.source),
  })))

addTimeFilters(summary.command("list").option("--search-type <number>", "Search type", "1").option("--rank-type <number>", "Rank type", "1").option("--source <number>", "Source type", collectNumberList, []).option("--research-area <id>", "Research area", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.summary.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, sourceList: options.source.length ? options.source : undefined,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
  }), { endpointKey: "insight.summary.list", idField: "summaryId" }))
addDownloadCommand(summary, { endpointKey: "insight.summary.download", idOption: "--summary-id", idField: "summaryId", fallbackPrefix: "summary", fileType: { description: "File type: 1=original(default) 2=HTML; only affects meeting platform summaries" }, titleListEndpoint: "insight.summary.list" })

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
  if (fields.researchArea) list.option("--research-area <id>", "Research area ID (constant-list category gangtiseIndustry: 1008001xx industries + 122000xxx macro/strategy/fixed-income/quant/overseas directions)", collectList, [])
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

addTimeFilters(research.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--broker <id>", "Broker ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--source <type>", "Source type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.research.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    brokerList: maybeArray(options.broker), securityList: maybeArray(options.security), industryList: maybeArray(options.industry),
    categoryList: maybeArray(options.category), llmTagList: maybeArray(options.llmTag), ratingList: maybeArray(options.rating),
    ratingChangeList: maybeArray(options.ratingChange), minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }),
    maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }), sourceList: maybeArray(options.source),
  }), { endpointKey: "insight.research.list", idField: "reportId" }))
addDownloadCommand(research, { endpointKey: "insight.research.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "research", fileType: { description: "File type: 1=PDF 2=Markdown", default: "1" }, titleListEndpoint: "insight.research.list" })

addTimeFilters(foreignReport.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--region <id>", "Region ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.foreign-report.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    securityList: maybeArray(options.security), regionList: maybeArray(options.region), categoryList: maybeArray(options.category),
    industryList: maybeArray(options.industry), brokerList: maybeArray(options.broker), llmTagList: maybeArray(options.llmTag),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
    minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }), maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }),
  }), { endpointKey: "insight.foreign-report.list", idField: "reportId" }))
addDownloadCommand(foreignReport, { endpointKey: "insight.foreign-report.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "foreign-report", fileType: { description: "File type: 1=PDF 2=Markdown 3=CN-PDF 4=CN-Markdown", default: "1" }, titleListEndpoint: "insight.foreign-report.list" })

addTimeFilters(announcement.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.announcement.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: parseTimestamp13(options.startTime, "--start-time"), endTime: parseTimestamp13(options.endTime, "--end-time"),
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword,
    securityList: maybeArray(options.security), categoryList: maybeArray(options.category),
  }), { endpointKey: "insight.announcement.list", idField: "announcementId" }))
addDownloadCommand(announcement, { endpointKey: "insight.announcement.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement", fileType: { description: "File type: 1=PDF 2=Markdown", default: "1" }, titleListEndpoint: "insight.announcement.list" })

addTimeFilters(announcementHk.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code (e.g. 01913.HK)", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.announcement-hk.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }),
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    securityList: maybeArray(options.security), categoryList: maybeArray(options.category),
  }), { endpointKey: "insight.announcement-hk.list", idField: "announcementId" }))
addDownloadCommand(announcementHk, { endpointKey: "insight.announcement-hk.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement-hk", titleListEndpoint: "insight.announcement-hk.list" })

addTimeFilters(foreignOpinion.command("list").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code (e.g. UBER.N)", collectList, []).option("--region <code>", "Region code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.foreign-opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    regionList: maybeArray(options.region), industryList: maybeArray(options.industry),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
  })))

addTimeFilters(independentOpinion.command("list").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code (e.g. GSK.N)", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.independent-opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    industryList: maybeArray(options.industry), securityList: maybeArray(options.security),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
  })))
addDownloadCommand(independentOpinion, { endpointKey: "insight.independent-opinion.download", idOption: "--independent-opinion-id", idField: "independentOpinionId", fallbackPrefix: "independent-opinion", fileType: { description: "File type: 1=original HTML 2=CN-translated HTML", required: true } })

addTimeFilters(officialAccount.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--account-id <id>", "Official account ID", collectList, []).option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, []).option("--category <type>", "Article type: news/law/report/view/data/event/meeting/notice/recruit/investEdu/brand/notes/other", collectList, []).option("--industry <id>", "Industry ID (constant-list citicIndustry/swIndustry)", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action((options) => emit(options, (client) => client.call("insight.official-account.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }),
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    keyword: options.keyword,
    accountIdList: maybeArray(options.accountId), securityList: maybeArray(options.security),
    categoryList: maybeArray(options.category), industryList: maybeArray(options.industry),
  }), { endpointKey: "insight.official-account.list", idField: "articleId" }))
addDownloadCommand(officialAccount, { endpointKey: "insight.official-account.download", idOption: "--article-id", idField: "articleId", fallbackPrefix: "official-account", fileType: { description: "File type: 1=txt(default) 2=HTML", default: "1" }, titleListEndpoint: "insight.official-account.list" })

insight.addCommand(opinion)
insight.addCommand(summary)
insight.addCommand(roadshow)
insight.addCommand(siteVisit)
insight.addCommand(strategy)
insight.addCommand(forum)
insight.addCommand(research)
insight.addCommand(foreignReport)
insight.addCommand(announcement)
insight.addCommand(announcementHk)
insight.addCommand(foreignOpinion)
insight.addCommand(independentOpinion)
insight.addCommand(officialAccount)
program.addCommand(insight)

const quote = new Command("quote").description("Quote APIs")
const addKlineCommand = (name: string, endpointKey: string, securityHelp: string, shardDays: number) =>
  quote.command(name)
    .option("--security <code>", securityHelp, collectList, [])
    .option("--start-date <date>", "Start date (default: 1 year before end-date)")
    .option("--end-date <date>", "End date (default: latest)")
    .option("--limit <number>", "Max rows per request (default: 6000, max: 10000)")
    .option("--field <field>", "Field", collectList, [])
    .option("--format <format>", "Output format", "table")
    .option("--output <path>")
    .action((options) => emit(options, (client) => callKlineWithSharding(client, endpointKey, buildQuoteKlineBody(options), { shardDays })))
addKlineCommand("day-kline", "quote.day-kline", "Security code (A-share: .SH/.SZ/.BJ, or 'all' for full market)", 1)
addKlineCommand("day-kline-hk", "quote.day-kline-hk", "Security code (HK stock: .HK, or 'all' for full market)", 2)
addKlineCommand("day-kline-us", "quote.day-kline-us", "Security code (US stock: e.g. AAPL.O, or 'all' for full market)", 1)
addKlineCommand("index-day-kline", "quote.index-day-kline", "Index code (.SH/.SZ/.BJ, or 'all' for full market)", 30)
quote.command("minute-kline").option("--security <code>", "Security code (A-share only: .SH/.SZ/.BJ)").option("--start-time <datetime>", "Start time (yyyy-MM-dd HH:mm:ss)").option("--end-time <datetime>", "End time (yyyy-MM-dd HH:mm:ss)").option("--limit <number>", "Max rows per request (default: 5000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("quote.minute-kline", { securityCode: options.security, startTime: options.startTime, endTime: options.endTime, limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }), fieldList: maybeArray(options.field) })))
quote.command("realtime").description("Realtime quote snapshot (A-share / HK / US)").option("--security <code>", "Security code (e.g. 600519.SH / 00700.HK / AAPL.O), or market keyword: aShares / hkStocks / usStocks", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("quote.realtime", { securityList: maybeArray(options.security), fieldList: maybeArray(options.field) })))
program.addCommand(quote)

const fundamental = new Command("fundamental").description("Fundamental APIs")

const addFinancialReport = (name: string, endpointKey: string, periodHelp = "Period") => fundamental.command(name).requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", periodHelp, collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call(endpointKey, { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) })))
addFinancialReport("income-statement", "fundamental.income-statement")
addFinancialReport("income-statement-quarterly", "fundamental.income-statement-quarterly", "Period: q1/q2/q3/q4/latest")
addFinancialReport("balance-sheet", "fundamental.balance-sheet")
addFinancialReport("cash-flow", "fundamental.cash-flow")
addFinancialReport("cash-flow-quarterly", "fundamental.cash-flow-quarterly", "Period: q1/q2/q3/q4/latest")
addFinancialReport("income-statement-hk", "fundamental.income-statement-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
addFinancialReport("balance-sheet-hk", "fundamental.balance-sheet-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
addFinancialReport("cash-flow-hk", "fundamental.cash-flow-hk", "Period: q1/h1/q3/h2/nsd/annual/latest")
fundamental.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").addOption(new Option("--breakdown <type>", "Breakdown: product/industry/region").choices(["product", "industry", "region"]).default("product")).option("--period <type>", "Period: interim/annual", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("fundamental.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, breakdown: options.breakdown, periodList: maybeArray(options.period), fieldList: maybeArray(options.field) })))
fundamental.command("valuation-analysis").requiredOption("--security-code <code>").addOption(new Option("--indicator <name>", "Indicator").choices(["peTtm", "pbMrq", "peg", "psTtm", "pcfTtm", "em"]).makeOptionMandatory()).option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--skip-null", "Drop rows where value or percentileRank is null").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  let data: unknown = await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }), fieldList: maybeArray(options.field) })
  if (options.skipNull) {
    const normalized = normalizeRows(data)
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
      const rec = normalized as Record<string, unknown>
      if (Array.isArray(rec.list)) {
        const filtered = rec.list.filter((row) => {
          if (!row || typeof row !== "object") return false
          const r = row as Record<string, unknown>
          return r.value != null && r.percentileRank != null
        })
        data = { ...rec, list: filtered, total: filtered.length }
      }
    }
  }
  await printData(data, parseOutputFormat(options.format), options.output)
}))
fundamental.command("top-holders").requiredOption("--security-code <code>").addOption(new Option("--holder-type <type>", "Holder type: top10/top10Float").choices(["top10", "top10Float"]).makeOptionMandatory()).option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period: q1/interim/q3/annual/latest", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("fundamental.top-holders", { securityCode: options.securityCode, holderType: options.holderType, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined })))
fundamental.command("earning-forecast").requiredOption("--security-code <code>").option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: today)").option("--consensus <name>", "Consensus indicator: netIncome/netIncomeYoy/eps/pe/bps/pb/peg/roe/ps", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => {
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10)
  const startDate = options.startDate ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return client.call("fundamental.earning-forecast", { securityCode: options.securityCode, startDate, endDate, consensusList: maybeArray(options.consensus) })
}))
program.addCommand(fundamental)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").requiredOption("--query <text>", "Query", collectList, []).option("--top <number>", "Top", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <ms>").option("--end-time <ms>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.knowledge-batch", { queries: options.query, top: parseNumberOption(options.top, "--top", { integer: true, min: 1 }), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: parseOptionalNumberOption(options.startTime, "--start-time", { integer: true, min: 0 }), endTime: parseOptionalNumberOption(options.endTime, "--end-time", { integer: true, min: 0 }) })))
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action((options) => withClient(async (client) => {
  await runDownload(client, "ai.knowledge-resource.download", { resourceType: parseNumberOption(options.resourceType, "--resource-type", { integer: true, min: 0 }), sourceId: options.sourceId }, {
    output: options.output,
    fallbackName: `resource-${options.sourceId}`,
  })
}))
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>").requiredOption("--end-time <datetime>").addOption(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory()).option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.security-clue.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, queryMode: options.queryMode, gtsCodeList: maybeArray(options.gtsCode), source: maybeArray(options.source) })))
ai.command("one-pager").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.one-pager", { securityCode: options.securityCode })))
ai.command("investment-logic").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.investment-logic", { securityCode: options.securityCode })))
ai.command("peer-comparison").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.peer-comparison", { securityCode: options.securityCode })))
ai.command("earnings-review").requiredOption("--security-code <code>").requiredOption("--period <period>", "Report period (e.g. 2025q3, 2025interim, 2025annual)").option("--wait", "Wait for content generation (blocking, up to 3 min)").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient(async (client) => {
  const idResult = await client.call("ai.earnings-review.get-id", { securityCode: options.securityCode, period: options.period }) as { dataId?: string }
  const dataId = idResult?.dataId
  if (!dataId) {
    process.stderr.write("Failed to get earnings review ID. The report may not be available yet.\n")
    process.exitCode = 1
    return
  }

  if (!options.wait) {
    process.stderr.write(`Earnings review task submitted. dataId: ${dataId}\n`)
    process.stdout.write(`${JSON.stringify({ dataId, status: "pending", hint: `Run 'gangtise ai earnings-review-check --data-id ${dataId}' in ~2 minutes to get results` })}\n`)
    return
  }

  process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
  if (!await pollAsyncContent(client, "ai.earnings-review.get-content", dataId, parseOutputFormat(options.format), options.output)) {
    process.stderr.write(`Content not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise ai earnings-review-check --data-id ${dataId}\n`)
    process.exitCode = 1
  }
}))
ai.command("earnings-review-check").requiredOption("--data-id <id>", "dataId from earnings-review").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient((client) => checkAsyncContent(client, "ai.earnings-review.get-content", options.dataId, parseOutputFormat(options.format), options.output)))
ai.command("theme-tracking").requiredOption("--theme-id <id>", "Theme ID (use 'reference concept-search')").requiredOption("--date <date>", "Date (yyyy-MM-dd)").option("--type <name>", "Report type: morning/night", collectList, []).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => {
  const typeList = options.type.length ? options.type : undefined
  return client.call("ai.theme-tracking", { themeId: options.themeId, date: options.date, type: typeList })
}))
ai.command("research-outline").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.research-outline", { securityCode: options.securityCode })))
ai.command("hot-topic").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-date <date>", "Start date (yyyy-MM-dd)").option("--end-date <date>", "End date (yyyy-MM-dd)").option("--category <name>", "Report type: morningBriefing/noonBriefing/afternoonFlash/eveningBriefing", collectList, []).option("--with-related-securities", "Include related securities info").option("--no-with-related-securities", "Exclude related securities info").option("--with-close-reading", "Include close reading content").option("--no-with-close-reading", "Exclude close reading content").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => {
  const ALL_CATEGORIES = ["morningBriefing", "noonBriefing", "afternoonFlash", "eveningBriefing"]
  return client.call("ai.hot-topic", {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    startDate: options.startDate,
    endDate: options.endDate,
    categoryList: options.category.length > 0 ? options.category : ALL_CATEGORIES,
    withRelatedSecurities: options.withRelatedSecurities === false ? undefined : true,
    withCloseReading: options.withCloseReading === false ? undefined : true,
  })
}))
ai.command("management-discuss-announcement").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)").requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension: businessOperation/financialPerformance/developmentAndRisk/all").choices(["businessOperation", "financialPerformance", "developmentAndRisk", "all"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.management-discuss-announcement", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  })))
ai.command("management-discuss-earnings-call").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)").requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension").choices(["businessOperation", "financialPerformance", "developmentAndRisk"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("ai.management-discuss-earnings-call", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  })))
ai.command("viewpoint-debate").requiredOption("--viewpoint <text>", "Viewpoint text (max 1000 chars)").option("--wait", "Wait for content generation (blocking, up to 3 min)").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient(async (client) => {
  const idResult = await client.call("ai.viewpoint-debate.get-id", { viewpoint: options.viewpoint }) as { dataId?: string }
  const dataId = idResult?.dataId
  if (!dataId) {
    process.stderr.write("Failed to get viewpoint debate ID.\n")
    process.exitCode = 1
    return
  }

  if (!options.wait) {
    process.stderr.write(`Viewpoint debate task submitted. dataId: ${dataId}\n`)
    process.stdout.write(`${JSON.stringify({ dataId, status: "pending", hint: `Run 'gangtise ai viewpoint-debate-check --data-id ${dataId}' in ~2 minutes to get results` })}\n`)
    return
  }

  process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
  if (!await pollAsyncContent(client, "ai.viewpoint-debate.get-content", dataId, parseOutputFormat(options.format), options.output)) {
    process.stderr.write(`Content not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise ai viewpoint-debate-check --data-id ${dataId}\n`)
    process.exitCode = 1
  }
}))
ai.command("viewpoint-debate-check").requiredOption("--data-id <id>", "dataId from viewpoint-debate").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient((client) => checkAsyncContent(client, "ai.viewpoint-debate.get-content", options.dataId, parseOutputFormat(options.format), options.output)))
const reference = new Command("reference").description("Reference data APIs")
reference.command("securities-search").requiredOption("--keyword <text>", "Search keyword (name/code/pinyin/English)").option("--category <type>", "Category: stock/dr/index/fund", collectList, []).option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.securities-search", {
    keyword: options.keyword,
    category: options.category.length ? options.category : undefined,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1 }),
  })))
reference.command("constant-category").description("List constant categories and which API params accept them").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.constant-category")))
reference.command("constant-list").requiredOption("--category <code>", "Category code from 'reference constant-category' (e.g. citicIndustry/swIndustry/regionCategory)").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.constant-list", { category: options.category })))
reference.command("concept-search").requiredOption("--keyword <text>", "Search keyword (name/pinyin/group name)").option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.concept-search", {
    keyword: options.keyword,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1 }),
  })))
reference.command("sector-search").option("--keyword <text>", "Search keyword (name/pinyin)").option("--top <number>", "Max results (default: 10, max: 10)", "10").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.sector-search", {
    keyword: options.keyword,
    top: parseNumberOption(options.top, "--top", { integer: true, min: 1 }),
  })))
reference.command("sector-constituents").requiredOption("--sector-id <id>", "Sector ID from 'reference sector-search'").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("reference.sector-constituents", { sectorId: options.sectorId })))
program.addCommand(reference)

const vault = new Command("vault").description("Vault APIs")
vault.command("drive-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--file-type <number>", "File type", collectNumberList, []).option("--space-type <number>", "Space type", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.drive.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), { endpointKey: "vault.drive.list", idField: "fileId" }))
addDownloadCommand(vault, { endpointKey: "vault.drive.download", name: "drive-download", idOption: "--file-id", idField: "fileId", fallbackPrefix: "file", titleListEndpoint: "vault.drive.list" })
vault.command("record-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--category <name>", "Recording type: upload/link/mobile/gtNote/pc/share", collectList, []).option("--space-type <number>", "Space type: 1=my records / 2=tenant records", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.record.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, categoryList: maybeArray(options.category), spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), { endpointKey: "vault.record.list", idField: "recordId" }))
addDownloadCommand(vault, { endpointKey: "vault.record.download", name: "record-download", idOption: "--record-id", idField: "recordId", fallbackPrefix: "record", contentTypeDescription: "Content type: original/asr/summary", titleListEndpoint: "vault.record.list" })
vault.command("my-conference-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--research-area <id>", "Research area ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Conference category: earningsCall/strategyMeeting/fundRoadshow/shareholdersMeeting/maMeeting/specialMeeting/companyAnalysis/industryAnalysis/other", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.my-conference.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution), categoryList: maybeArray(options.category) }), { endpointKey: "vault.my-conference.list", idField: "conferenceId" }))
addDownloadCommand(vault, { endpointKey: "vault.my-conference.download", name: "my-conference-download", idOption: "--conference-id", idField: "conferenceId", fallbackPrefix: "conference", contentTypeDescription: "Content type: asr/summary", titleListEndpoint: "vault.my-conference.list" })
vault.command("wechat-message-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, []).option("--wechat-group-id <id>", "WeChat group ID", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Message type: text/image/documents/url", collectList, []).option("--tag <name>", "Tag: roadShow/research/strategyMeeting/meetingSummary/industryComment/companyComment/earningsReview", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.wechat-message.list", buildWechatMessageListBody(options))))
vault.command("wechat-chatroom-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Rows to return", "20").option("--room-name <name>", "WeChat group name; repeat or comma-separate for multiple names", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.wechat-chatroom.list", buildWechatChatroomListBody(options))))
vault.command("stock-pool-list").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.list", {})))
vault.command("stock-pool-stocks").option("--pool-id <id>", "Pool ID; repeat for multiple; omit (or 'all') for all pools", collectList).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("vault.stock-pool.stocks", buildStockPoolStocksBody(options))))
program.addCommand(vault)
program.addCommand(ai)

const alternative = new Command("alternative").description("Alternative data APIs")
alternative.command("edb-search").requiredOption("--keyword <text>", "Search keyword (e.g. '空调')").option("--limit <number>", "Max results (default: 100, max: 200)", "100").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => emit(options, (client) => client.call("alternative.edb-search", {
    keyword: options.keyword,
    limit: parseNumberOption(options.limit, "--limit", { integer: true, min: 1 }),
  })))
alternative.command("edb-data").option("--indicator-id <id>", "Indicator ID (repeat, max 10)", collectList, []).requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)").requiredOption("--end-date <date>", "End date (yyyy-MM-dd)").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const raw = await client.call("alternative.edb-data", {
    indicatorIdList: options.indicatorId,
    startDate: options.startDate,
    endDate: options.endDate,
  }) as { fieldList?: string[], dataList?: unknown[][] } | null
  let data: unknown = raw
  if (raw && Array.isArray(raw.fieldList) && Array.isArray(raw.dataList)) {
    const list = raw.dataList.map((row) =>
      (raw.fieldList as string[]).reduce<Record<string, unknown>>((acc, field, i) => {
        acc[field] = row[i]
        return acc
      }, {}),
    )
    data = { list, total: list.length }
  }
  await printData(data, parseOutputFormat(options.format), options.output)
}))
alternative.command("concept-info").requiredOption("--concept-id <id>", "Concept (theme index) ID, e.g. 121000130 机器人; discover via 'gangtise reference concept-search'").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("alternative.concept-info", { conceptId: options.conceptId })))
alternative.command("concept-securities").requiredOption("--concept-id <id>", "Concept (theme index) ID, e.g. 121000130 机器人; discover via 'gangtise reference concept-search'").option("--format <format>", "Output format", "json").option("--output <path>").action((options) => emit(options, (client) => client.call("alternative.concept-securities", { conceptId: options.conceptId })))
program.addCommand(alternative)

const indicator = new Command("indicator").description("Data indicator (EDE) APIs: search codes, cross-section, time-series")
indicator.command("search").requiredOption("--keyword <text>", "Search keyword, e.g. '收盘价' '成交量' '营业收入' (not free-form questions)").option("--limit <number>", "Max results (default: 50, max: 100)", "50").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const raw = await client.call("indicator.search", {
    keyword: options.keyword,
    limit: parseNumberOption(options.limit, "--limit", { integer: true, min: 1 }),
  })
  await printData(unwrapIndicatorData(raw), parseOutputFormat(options.format), options.output)
}))
indicator.command("cross-section").option("--indicator <code>", "Indicator code, e.g. qte_close (repeat for multiple)", collectList, []).option("--security <code>", "Security code, e.g. 600519.SH (repeat for multiple)", collectList, []).requiredOption("--date <date>", "Data date (yyyy-MM-dd)").option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)").option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)").option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustmentType=2 for 前复权 (repeat)", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const raw = await client.call("indicator.cross-section", buildIndicatorCrossSectionBody(options))
  await printData(flattenCrossSection(unwrapIndicatorData(raw)), parseOutputFormat(options.format), options.output)
}))
indicator.command("time-series").option("--indicator <code>", "Indicator code, e.g. qte_close (repeat for multiple)", collectList, []).option("--security <code>", "Security code, e.g. 600519.SH (repeat for multiple)", collectList, []).requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)").requiredOption("--end-date <date>", "End date (yyyy-MM-dd)").option("--calendar-type <type>", "Calendar: ND=natural TD=trading WD=weekday (default TD)").option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)").option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)").option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustmentType=2 for 前复权 (repeat)", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action((options) => withClient(async (client) => {
  const raw = await client.call("indicator.time-series", buildIndicatorTimeSeriesBody(options))
  await printData(flattenTimeSeries(unwrapIndicatorData(raw)), parseOutputFormat(options.format), options.output)
}))
program.addCommand(indicator)

program.command("raw").description("Raw API calls").addCommand(new Command("call").argument("<endpointKey>").option("--body <json>").option("--query <key=value>", "Query string pair", collectKeyValue, {}).option("--format <format>", "Output format", "json").option("--output <path>").action(async (endpointKey, options) => {
  const endpoint = ENDPOINTS[endpointKey]
  if (!endpoint) {
    throw new ConfigError(`Unknown endpoint key: ${endpointKey}`)
  }
  const client = await createClient()
  let body: unknown
  if (options.body) {
    try {
      body = JSON.parse(options.body)
    } catch {
      throw new ConfigError(`Invalid JSON in --body: ${options.body}`)
    }
  }
  if (endpoint.kind === "download") {
    await runDownload(client, endpointKey, options.query as Record<string, string | number>, {
      output: options.output,
      fallbackName: "download.bin",
    })
    return
  }
  const data = await client.call(endpointKey, body, options.query)
  await printData(data, parseOutputFormat(options.format), options.output)
}))

async function checkForUpdate(timeoutMs = 2000): Promise<void> {
  const https = await import("node:https")
  await new Promise<void>((resolve) => {
    const req = https.get("https://registry.npmjs.org/gangtise-openapi-cli/latest", (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => {
        try {
          const latest: string = JSON.parse(body).version
          if (latest && latest !== CLI_VERSION) {
            process.stderr.write(`Update available: ${CLI_VERSION} → ${latest}\nRun: npm update -g gangtise-openapi-cli\n`)
          }
        } catch { /* ignore */ }
        resolve()
      })
    })
    req.on("error", () => resolve())
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve() })
  })
}

async function main() {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    process.stdout.write(`${CLI_VERSION}\n`)
    await checkForUpdate()
    return
  }
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof ApiError) {
      const hint = error.hint ? ` ${error.hint}` : ""
      process.stderr.write(`API error${error.code ? ` (${error.code})` : ""}: ${error.message}${hint}\n`)
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
