#!/usr/bin/env node
import { Command, Option } from "commander"

import { checkAsyncContent, pollAsyncContent, POLL_MAX_ATTEMPTS } from "./core/asyncContent.js"
import { readTokenCache } from "./core/auth.js"
import { collectKeyValue, collectList, collectNumberList, maybeArray, parseFrom, parseNumberOption, parseOptionalNumberOption, parseSize, parseTimestamp13 } from "./core/args.js"
import { buildQuoteKlineBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "./core/commandBodies.js"
import { loadConfig } from "./core/config.js"
import { resolveTitle, saveDownloadResult } from "./core/download.js"
import { ENDPOINTS } from "./core/endpoints.js"
import { ApiError, ConfigError } from "./core/errors.js"
import { normalizeRows } from "./core/normalize.js"
import { parseOutputFormat } from "./core/output.js"
import { printData } from "./core/printer.js"

// --- Lazy-loaded modules (deferred to action handlers) ---
async function createClient() {
  const { GangtiseClient } = await import("./core/client.js")
  return new GangtiseClient(loadConfig())
}

function addTimeFilters(command: Command) {
  return command
    .option("--from <number>", "Starting offset", "0")
    .option("--size <number>", "Total rows to return; omit to fetch all")
    .option("--start-time <datetime>", "Start time")
    .option("--end-time <datetime>", "End time")
    .option("--keyword <keyword>", "Keyword")
}

import { CLI_VERSION } from "./version.js"

const program = new Command()

program.name("gangtise").description("Gangtise OpenAPI CLI").version(CLI_VERSION)

program
  .command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const client = await createClient()
        await printData(await client.login(), parseOutputFormat(options.format))
      }),
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

const lookup = new Command("lookup").description("Lookup helper APIs")
lookup
  .addCommand(new Command("research-area").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.research-areas.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("broker-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.broker-orgs.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("meeting-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.meeting-orgs.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("industry").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.industries.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("region").description("Foreign report region codes").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.regions.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("announcement-category").description("Announcement category codes").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.announcement-categories.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("industry-code").description("Shenwan industry codes for security-clue --gts-code").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.industry-codes.list"), parseOutputFormat(options.format))
  })))
  .addCommand(new Command("theme-id").description("Theme IDs for theme-tracking --theme-id").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.theme-ids.list"), parseOutputFormat(options.format))
  })))
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

addTimeFilters(opinion.command("list").option("--rank-type <number>", "Rank type", "1").option("--research-area <id>", "Research area ID", collectList, []).option("--chief <id>", "Chief ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--concept <id>", "Concept ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--source <source>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.opinion.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), chiefList: maybeArray(options.chief),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker), industryList: maybeArray(options.industry), conceptList: maybeArray(options.concept),
    llmTagList: maybeArray(options.llmTag), sourceList: maybeArray(options.source),
  }), parseOutputFormat(options.format), options.output)
})

addTimeFilters(summary.command("list").option("--search-type <number>", "Search type", "1").option("--rank-type <number>", "Rank type", "1").option("--source <number>", "Source type", collectNumberList, []).option("--research-area <id>", "Research area", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.summary.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword, sourceList: options.source.length ? options.source : undefined,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
  }), parseOutputFormat(options.format), options.output, { endpointKey: "insight.summary.list", idField: "summaryId" })
})
summary.command("download").requiredOption("--summary-id <id>").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.summary.download", undefined, { summaryId: options.summaryId })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.summary.list", "summaryId", options.summaryId)
  await saveDownloadResult(result, `summary-${options.summaryId}`, options.output ?? title)
})

const addScheduleList = (command: Command, endpointKey: string) => addTimeFilters(command.command("list").option("--research-area <id>", "Research area", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--broker-type <name>", "Broker type", collectList, []).option("--object <type>", "Object type: company/industry", collectList, []).option("--permission <number>", "Permission", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call(endpointKey, {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    researchAreaList: maybeArray(options.researchArea), institutionList: maybeArray(options.institution), securityList: maybeArray(options.security),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
    brokerTypeList: maybeArray(options.brokerType), objectList: maybeArray(options.object), permission: options.permission.length ? options.permission : undefined,
  }), parseOutputFormat(options.format), options.output)
})
addScheduleList(roadshow, "insight.roadshow.list")
addScheduleList(siteVisit, "insight.site-visit.list")
addScheduleList(strategy, "insight.strategy.list")
addScheduleList(forum, "insight.forum.list")

addTimeFilters(research.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--broker <id>", "Broker ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--source <type>", "Source type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.research.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    brokerList: maybeArray(options.broker), securityList: maybeArray(options.security), industryList: maybeArray(options.industry),
    categoryList: maybeArray(options.category), llmTagList: maybeArray(options.llmTag), ratingList: maybeArray(options.rating),
    ratingChangeList: maybeArray(options.ratingChange), minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }),
    maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }), sourceList: maybeArray(options.source),
  }), parseOutputFormat(options.format), options.output, { endpointKey: "insight.research.list", idField: "reportId" })
})
research.command("download").requiredOption("--report-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.research.download", undefined, { reportId: options.reportId, fileType: parseNumberOption(options.fileType, "--file-type", { integer: true, min: 1 }) })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.research.list", "reportId", options.reportId)
  await saveDownloadResult(result, `research-${options.reportId}`, options.output ?? title)
})

addTimeFilters(foreignReport.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--region <id>", "Region ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.foreign-report.list", {
    from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }),
    securityList: maybeArray(options.security), regionList: maybeArray(options.region), categoryList: maybeArray(options.category),
    industryList: maybeArray(options.industry), brokerList: maybeArray(options.broker), llmTagList: maybeArray(options.llmTag),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
    minReportPages: parseOptionalNumberOption(options.minPages, "--min-pages", { integer: true, min: 0 }), maxReportPages: parseOptionalNumberOption(options.maxPages, "--max-pages", { integer: true, min: 0 }),
  }), parseOutputFormat(options.format), options.output, { endpointKey: "insight.foreign-report.list", idField: "reportId" })
})
foreignReport.command("download").requiredOption("--report-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown 3=CN-PDF 4=CN-Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.foreign-report.download", undefined, { reportId: options.reportId, fileType: parseNumberOption(options.fileType, "--file-type", { integer: true, min: 1 }) })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.foreign-report.list", "reportId", options.reportId)
  await saveDownloadResult(result, `foreign-report-${options.reportId}`, options.output ?? title)
})

addTimeFilters(announcement.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--announcement-type <type>", "Announcement type", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.announcement.list", {
    from: parseFrom(options.from), size: parseSize(options.size),
    startTime: parseTimestamp13(options.startTime, "--start-time"), endTime: parseTimestamp13(options.endTime, "--end-time"),
    searchType: parseNumberOption(options.searchType, "--search-type", { integer: true, min: 1 }), rankType: parseNumberOption(options.rankType, "--rank-type", { integer: true, min: 1 }), keyword: options.keyword,
    securityList: maybeArray(options.security), announcementTypeList: maybeArray(options.announcementType), categoryList: maybeArray(options.category),
  }), parseOutputFormat(options.format), options.output, { endpointKey: "insight.announcement.list", idField: "announcementId" })
})
announcement.command("download").requiredOption("--announcement-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.announcement.download", undefined, { announcementId: options.announcementId, fileType: parseNumberOption(options.fileType, "--file-type", { integer: true, min: 1 }) })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.announcement.list", "announcementId", options.announcementId)
  await saveDownloadResult(result, `announcement-${options.announcementId}`, options.output ?? title)
})

insight.addCommand(opinion)
insight.addCommand(summary)
insight.addCommand(roadshow)
insight.addCommand(siteVisit)
insight.addCommand(strategy)
insight.addCommand(forum)
insight.addCommand(research)
insight.addCommand(foreignReport)
insight.addCommand(announcement)
program.addCommand(insight)

const quote = new Command("quote").description("Quote APIs")
quote.command("day-kline").option("--security <code>", "Security code (A-share: .SH/.SZ/.BJ, or 'all' for full market)", collectList, []).option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: latest)").option("--limit <number>", "Max rows per request (default: 6000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.day-kline", buildQuoteKlineBody(options)), parseOutputFormat(options.format), options.output)
})
quote.command("day-kline-hk").option("--security <code>", "Security code (HK stock: .HK, or 'all' for full market)", collectList, []).option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: latest)").option("--limit <number>", "Max rows per request (default: 6000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.day-kline-hk", buildQuoteKlineBody(options)), parseOutputFormat(options.format), options.output)
})
quote.command("index-day-kline").option("--security <code>", "Index code (.SH/.SZ/.BJ, or 'all' for full market)", collectList, []).option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: latest)").option("--limit <number>", "Max rows per request (default: 6000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.index-day-kline", buildQuoteKlineBody(options)), parseOutputFormat(options.format), options.output)
})
quote.command("minute-kline").option("--security <code>", "Security code (A-share only: .SH/.SZ/.BJ)").option("--start-time <datetime>", "Start time (yyyy-MM-dd HH:mm:ss)").option("--end-time <datetime>", "End time (yyyy-MM-dd HH:mm:ss)").option("--limit <number>", "Max rows per request (default: 5000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.minute-kline", { securityCode: options.security, startTime: options.startTime, endTime: options.endTime, limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }), fieldList: maybeArray(options.field) }), parseOutputFormat(options.format), options.output)
})
program.addCommand(quote)

const fundamental = new Command("fundamental").description("Fundamental APIs")

const addFinancialReport = (name: string, endpointKey: string, periodHelp = "Period") => fundamental.command(name).requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", periodHelp, collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call(endpointKey, { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) }), parseOutputFormat(options.format), options.output)
})
addFinancialReport("income-statement", "fundamental.income-statement")
addFinancialReport("income-statement-quarterly", "fundamental.income-statement-quarterly", "Period: q1/q2/q3/q4/latest")
addFinancialReport("balance-sheet", "fundamental.balance-sheet")
addFinancialReport("cash-flow", "fundamental.cash-flow")
addFinancialReport("cash-flow-quarterly", "fundamental.cash-flow-quarterly", "Period: q1/q2/q3/q4/latest")
fundamental.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").addOption(new Option("--breakdown <type>", "Breakdown: product/industry/region").choices(["product", "industry", "region"]).default("product")).option("--period <type>", "Period: interim/annual", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, breakdown: options.breakdown, periodList: maybeArray(options.period), fieldList: maybeArray(options.field) }), parseOutputFormat(options.format), options.output)
})
fundamental.command("valuation-analysis").requiredOption("--security-code <code>").addOption(new Option("--indicator <name>", "Indicator").choices(["peTtm", "pbMrq", "peg", "psTtm", "pcfTtm", "em"]).makeOptionMandatory()).option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--skip-null", "Drop rows where value or percentileRank is null").option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  let data: unknown = await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }), fieldList: maybeArray(options.field) })
  if (options.skipNull) {
    const normalized = await normalizeRows(data)
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
})
fundamental.command("top-holders").requiredOption("--security-code <code>").addOption(new Option("--holder-type <type>", "Holder type: top10/top10Float").choices(["top10", "top10Float"]).makeOptionMandatory()).option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period: q1/interim/q3/annual/latest", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.top-holders", { securityCode: options.securityCode, holderType: options.holderType, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined }), parseOutputFormat(options.format), options.output)
})
fundamental.command("earning-forecast").requiredOption("--security-code <code>").option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: today)").option("--consensus <name>", "Consensus indicator: netIncome/netIncomeYoy/eps/pe/bps/pb/peg/roe/ps", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10)
  const startDate = options.startDate ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await printData(await client.call("fundamental.earning-forecast", { securityCode: options.securityCode, startDate, endDate, consensusList: maybeArray(options.consensus) }), parseOutputFormat(options.format), options.output)
})
program.addCommand(fundamental)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").requiredOption("--query <text>", "Query", collectList, []).option("--top <number>", "Top", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <ms>").option("--end-time <ms>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.knowledge-batch", { queries: options.query, top: parseNumberOption(options.top, "--top", { integer: true, min: 1 }), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: parseOptionalNumberOption(options.startTime, "--start-time", { integer: true, min: 0 }), endTime: parseOptionalNumberOption(options.endTime, "--end-time", { integer: true, min: 0 }) }), parseOutputFormat(options.format), options.output)
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await saveDownloadResult(await client.call("ai.knowledge-resource.download", undefined, { resourceType: parseNumberOption(options.resourceType, "--resource-type", { integer: true, min: 0 }), sourceId: options.sourceId }), `resource-${options.sourceId}`, options.output)
})
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>").requiredOption("--end-time <datetime>").addOption(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory()).option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.security-clue.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, queryMode: options.queryMode, gtsCodeList: maybeArray(options.gtsCode), source: maybeArray(options.source) }), parseOutputFormat(options.format), options.output)
})
ai.command("one-pager").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.one-pager", { securityCode: options.securityCode }), parseOutputFormat(options.format), options.output)
})
ai.command("investment-logic").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.investment-logic", { securityCode: options.securityCode }), parseOutputFormat(options.format), options.output)
})
ai.command("peer-comparison").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.peer-comparison", { securityCode: options.securityCode }), parseOutputFormat(options.format), options.output)
})
ai.command("earnings-review").requiredOption("--security-code <code>").requiredOption("--period <period>", "Report period (e.g. 2025q3, 2025interim, 2025annual)").option("--wait", "Wait for content generation (blocking, up to 3 min)").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
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
})
ai.command("earnings-review-check").requiredOption("--data-id <id>", "dataId from earnings-review").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await checkAsyncContent(client, "ai.earnings-review.get-content", options.dataId, parseOutputFormat(options.format), options.output)
})
ai.command("theme-tracking").requiredOption("--theme-id <id>", "Theme ID (use lookup theme-id list)").requiredOption("--date <date>", "Date (yyyy-MM-dd)").option("--type <name>", "Report type: morning/night", collectList, []).option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const typeList = options.type.length ? options.type : undefined
  await printData(await client.call("ai.theme-tracking", { themeId: options.themeId, date: options.date, type: typeList }), parseOutputFormat(options.format), options.output)
})
ai.command("research-outline").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.research-outline", { securityCode: options.securityCode }), parseOutputFormat(options.format), options.output)
})
ai.command("hot-topic").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-date <date>", "Start date (yyyy-MM-dd)").option("--end-date <date>", "End date (yyyy-MM-dd)").option("--category <name>", "Report type: morningBriefing/noonBriefing/afternoonFlash/eveningBriefing", collectList, []).option("--with-related-securities", "Include related securities info").option("--no-with-related-securities", "Exclude related securities info").option("--with-close-reading", "Include close reading content").option("--no-with-close-reading", "Exclude close reading content").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const ALL_CATEGORIES = ["morningBriefing", "noonBriefing", "afternoonFlash", "eveningBriefing"]
  await printData(await client.call("ai.hot-topic", {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    startDate: options.startDate,
    endDate: options.endDate,
    categoryList: options.category.length > 0 ? options.category : ALL_CATEGORIES,
    withRelatedSecurities: options.withRelatedSecurities === false ? undefined : true,
    withCloseReading: options.withCloseReading === false ? undefined : true,
  }), parseOutputFormat(options.format), options.output)
})
ai.command("management-discuss-announcement").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)").requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension").choices(["businessOperation", "financialPerformance", "developmentAndRisk"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.management-discuss-announcement", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  }), parseOutputFormat(options.format), options.output)
})
ai.command("management-discuss-earnings-call").requiredOption("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)").requiredOption("--security-code <code>", "Security code (e.g. 000001.SZ)").addOption(new Option("--dimension <name>", "Discussion dimension").choices(["businessOperation", "financialPerformance", "developmentAndRisk"]).makeOptionMandatory()).option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.management-discuss-earnings-call", {
    reportDate: options.reportDate,
    securityCode: options.securityCode,
    discussionDimension: options.dimension,
  }), parseOutputFormat(options.format), options.output)
})
ai.command("viewpoint-debate").requiredOption("--viewpoint <text>", "Viewpoint text (max 1000 chars)").option("--wait", "Wait for content generation (blocking, up to 3 min)").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
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
})
ai.command("viewpoint-debate-check").requiredOption("--data-id <id>", "dataId from viewpoint-debate").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await checkAsyncContent(client, "ai.viewpoint-debate.get-content", options.dataId, parseOutputFormat(options.format), options.output)
})
const vault = new Command("vault").description("Vault APIs")
vault.command("drive-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--file-type <number>", "File type", collectNumberList, []).option("--space-type <number>", "Space type", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.drive.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), parseOutputFormat(options.format), options.output, { endpointKey: "vault.drive.list", idField: "fileId" })
})
vault.command("drive-download").requiredOption("--file-id <id>").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("vault.drive.download", undefined, { fileId: options.fileId })
  const title = options.output ? undefined : await resolveTitle(client, result, "vault.drive.list", "fileId", options.fileId)
  await saveDownloadResult(result, `file-${options.fileId}`, options.output ?? title)
})
vault.command("record-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--category <name>", "Recording type: upload/link/mobile/gtNote/pc/share", collectList, []).option("--space-type <number>", "Space type: 1=my records / 2=tenant records", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.record.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, categoryList: maybeArray(options.category), spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), parseOutputFormat(options.format), options.output, { endpointKey: "vault.record.list", idField: "recordId" })
})
vault.command("record-download").requiredOption("--record-id <id>").requiredOption("--content-type <type>", "Content type: original/asr/summary").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("vault.record.download", undefined, { recordId: options.recordId, contentType: options.contentType })
  const title = options.output ? undefined : await resolveTitle(client, result, "vault.record.list", "recordId", options.recordId)
  await saveDownloadResult(result, `record-${options.recordId}`, options.output ?? title)
})
vault.command("my-conference-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--research-area <id>", "Research area ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Conference category: earningsCall/strategyMeeting/fundRoadshow/shareholdersMeeting/maMeeting/specialMeeting/companyAnalysis/industryAnalysis/other", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.my-conference.list", { from: parseFrom(options.from), size: parseSize(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution), categoryList: maybeArray(options.category) }), parseOutputFormat(options.format), options.output, { endpointKey: "vault.my-conference.list", idField: "conferenceId" })
})
vault.command("my-conference-download").requiredOption("--conference-id <id>").requiredOption("--content-type <type>", "Content type: asr/summary").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("vault.my-conference.download", undefined, { conferenceId: options.conferenceId, contentType: options.contentType })
  const title = options.output ? undefined : await resolveTitle(client, result, "vault.my-conference.list", "conferenceId", options.conferenceId)
  await saveDownloadResult(result, `conference-${options.conferenceId}`, options.output ?? title)
})
vault.command("wechat-message-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--wechat-group-id <id>", "WeChat group ID", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Message type: text/image/documents/url", collectList, []).option("--tag <name>", "Tag: roadShow/research/strategyMeeting/meetingSummary/industryComment/companyComment/earningsReview", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.wechat-message.list", buildWechatMessageListBody(options)), parseOutputFormat(options.format), options.output)
})
vault.command("wechat-chatroom-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Rows to return", "20").option("--room-name <name>", "WeChat group name; repeat or comma-separate for multiple names", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.wechat-chatroom.list", buildWechatChatroomListBody(options)), parseOutputFormat(options.format), options.output)
})
program.addCommand(vault)
program.addCommand(ai)

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
  const data = await client.call(endpointKey, body, options.query)
  if (endpoint.kind === "download") {
    await saveDownloadResult(data, "download.bin", options.output)
    return
  }
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
