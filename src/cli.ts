#!/usr/bin/env node
import { Command } from "commander"

import { collectKeyValue, collectList, collectNumberList, maybeArray } from "./core/args.js"
import { readTokenCache } from "./core/auth.js"
import { GangtiseClient } from "./core/client.js"
import { loadConfig, type OutputFormat } from "./core/config.js"
import { ApiError, ConfigError, DownloadError } from "./core/errors.js"
import { renderOutput, saveOutputIfNeeded } from "./core/output.js"

function parseFormat(value?: string): OutputFormat {
  const format = value ?? "table"
  if (["table", "json", "jsonl", "csv", "markdown"].includes(format)) {
    return format as OutputFormat
  }
  throw new ConfigError(`Unsupported format: ${format}`)
}

function normalizeRows(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  if (Array.isArray(record.fieldList) && Array.isArray(record.list)) {
    return record.list.map((row) => {
      if (!Array.isArray(row)) return row
      return (record.fieldList as unknown[]).reduce<Record<string, unknown>>((acc, field, index) => {
        acc[String(field)] = row[index]
        return acc
      }, {})
    })
  }

  if (Array.isArray(record.list)) {
    return record.list
  }

  return value
}

async function printData(data: unknown, format: OutputFormat, output?: string) {
  const normalized = normalizeRows(data)
  const content = renderOutput(normalized, format)
  if (output) {
    await saveOutputIfNeeded(content, output)
    process.stdout.write(`${output}\n`)
    return
  }
  process.stdout.write(`${content}\n`)
}

async function saveDownloadResult(result: unknown, fallbackName: string, output?: string) {
  if (!(result && typeof result === "object")) {
    throw new DownloadError("Unexpected download response")
  }

  const file = result as { data?: Uint8Array; text?: string; url?: string; filename?: string }

  if (file.data instanceof Uint8Array) {
    const outputPath = output ?? file.filename ?? fallbackName
    await saveOutputIfNeeded(file.data, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.text === 'string') {
    const outputPath = output ?? `${fallbackName}.txt`
    await saveOutputIfNeeded(file.text, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.url === 'string') {
    if (output) {
      await saveOutputIfNeeded(file.url, output)
      process.stdout.write(`${output}\n`)
      return
    }
    process.stdout.write(`${file.url}\n`)
    return
  }

  throw new DownloadError("Unexpected download response")
}

function addTimeFilters(command: Command) {
  return command
    .option("--from <number>", "Starting offset", "0")
    .option("--size <number>", "Total rows to return; omit to fetch all")
    .option("--start-time <datetime>", "Start time")
    .option("--end-time <datetime>", "End time")
    .option("--keyword <keyword>", "Keyword")
}

const program = new Command()
program.name("gangtise").description("Gangtise OpenAPI CLI").version("0.1.0")

program
  .command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const client = new GangtiseClient(loadConfig())
        await printData(await client.login(), parseFormat(options.format))
      }),
  )
  .addCommand(
    new Command("status")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const config = loadConfig()
        const cache = await readTokenCache(config.tokenCachePath)
        await printData({ hasEnvToken: Boolean(config.token), hasCachedToken: Boolean(cache?.accessToken), cache }, parseFormat(options.format))
      }),
  )

const lookup = new Command("lookup").description("Lookup helper APIs")
lookup
  .addCommand(new Command("research-area").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = new GangtiseClient(loadConfig())
    await printData(await client.call("lookup.research-areas.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("broker-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = new GangtiseClient(loadConfig())
    await printData(await client.call("lookup.broker-orgs.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("meeting-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = new GangtiseClient(loadConfig())
    await printData(await client.call("lookup.meeting-orgs.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("industry").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = new GangtiseClient(loadConfig())
    await printData(await client.call("lookup.industries.list"), parseFormat(options.format))
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
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.opinion.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime,
    rankType: Number(options.rankType), keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), chiefList: maybeArray(options.chief),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker), industryList: maybeArray(options.industry), conceptList: maybeArray(options.concept),
    llmTagList: maybeArray(options.llmTag), sourceList: maybeArray(options.source),
  }), parseFormat(options.format), options.output)
})

addTimeFilters(summary.command("list").option("--search-type <number>", "Search type", "1").option("--rank-type <number>", "Rank type", "1").option("--source <number>", "Source type", collectNumberList, []).option("--research-area <id>", "Research area", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.summary.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: Number(options.searchType), rankType: Number(options.rankType), keyword: options.keyword, sourceList: options.source.length ? options.source : undefined,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
  }), parseFormat(options.format), options.output)
})
summary.command("download").requiredOption("--summary-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("insight.summary.download", undefined, { summaryId: options.summaryId }), `summary-${options.summaryId}`, options.output)
})

const addScheduleList = (command: Command, endpointKey: string) => addTimeFilters(command.command("list").option("--research-area <id>", "Research area", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--broker-type <name>", "Broker type", collectList, []).option("--permission <number>", "Permission", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call(endpointKey, {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    researchAreaList: maybeArray(options.researchArea), institutionList: maybeArray(options.institution), securityList: maybeArray(options.security),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
    brokerTypeList: maybeArray(options.brokerType), permission: options.permission.length ? options.permission : undefined,
  }), parseFormat(options.format), options.output)
})
addScheduleList(roadshow, "insight.roadshow.list")
addScheduleList(siteVisit, "insight.site-visit.list")
addScheduleList(strategy, "insight.strategy.list")
addScheduleList(forum, "insight.forum.list")

addTimeFilters(research.command("list").option("--broker <id>", "Broker ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.research.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    brokerList: maybeArray(options.broker), securityList: maybeArray(options.security), industryList: maybeArray(options.industry),
  }), parseFormat(options.format), options.output)
})
research.command("download").requiredOption("--report-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("insight.research.download", undefined, { reportId: options.reportId }), `research-${options.reportId}`, options.output)
})

addTimeFilters(foreignReport.command("list").option("--security <code>", "Security code", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.foreign-report.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    securityList: maybeArray(options.security),
  }), parseFormat(options.format), options.output)
})
foreignReport.command("download").requiredOption("--report-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("insight.foreign-report.download", undefined, { reportId: options.reportId }), `foreign-report-${options.reportId}`, options.output)
})

addTimeFilters(announcement.command("list").option("--security <code>", "Security code", collectList, []).option("--announcement-type <type>", "Announcement type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.announcement.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    securityList: maybeArray(options.security), announcementTypeList: maybeArray(options.announcementType),
  }), parseFormat(options.format), options.output)
})
announcement.command("download").requiredOption("--announcement-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("insight.announcement.download", undefined, { announcementId: options.announcementId }), `announcement-${options.announcementId}`, options.output)
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
quote.command("day-kline").option("--security <code>", "Security code", collectList, []).option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("quote.day-kline", { securityList: maybeArray(options.security), startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
quote.command("income-statement").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period", collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("quote.income-statement", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : ["latest"], reportType: options.reportType.length ? options.reportType : ["consolidated"], fieldList: options.field }), parseFormat(options.format), options.output)
})
quote.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("quote.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
quote.command("valuation-analysis").requiredOption("--security-code <code>").requiredOption("--indicator <name>", "Indicator like peTtm/pbMrq/peg/psTtm/pcfTtm/em").option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("quote.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
program.addCommand(quote)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").requiredOption("--query <text>", "Query", collectList, []).option("--top <number>", "Top", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <ms>").option("--end-time <ms>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.knowledge-batch", { queries: options.query, top: Number(options.top), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: options.startTime ? Number(options.startTime) : undefined, endTime: options.endTime ? Number(options.endTime) : undefined }), parseFormat(options.format), options.output)
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("ai.knowledge-resource.download", undefined, { resourceType: Number(options.resourceType), sourceId: options.sourceId }), `resource-${options.sourceId}`, options.output)
})
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>").requiredOption("--end-time <datetime>").requiredOption("--query-mode <mode>").option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.security-clue.list", { from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, queryMode: options.queryMode, gtsCodeList: maybeArray(options.gtsCode), source: maybeArray(options.source) }), parseFormat(options.format), options.output)
})
ai.command("one-pager").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.one-pager", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("investment-logic").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.investment-logic", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("peer-comparison").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.peer-comparison", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("cloud-disk-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--file-type <number>", "File type", collectNumberList, []).option("--space-type <number>", "Space type", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.cloud-disk.list", { from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), parseFormat(options.format), options.output)
})
ai.command("cloud-disk-download").requiredOption("--file-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("ai.cloud-disk.download", undefined, { fileId: options.fileId }), `file-${options.fileId}`, options.output)
})
program.addCommand(ai)

program.command("raw").description("Raw API calls").addCommand(new Command("call").argument("<endpointKey>").option("--body <json>").option("--query <key=value>", "Query string pair", collectKeyValue, {}).option("--format <format>", "Output format", "json").option("--output <path>").action(async (endpointKey, options) => {
  const client = new GangtiseClient(loadConfig())
  const body = options.body ? JSON.parse(options.body) : undefined
  const data = await client.call(endpointKey, body, options.query)
  if (data && typeof data === "object" && "data" in (data as Record<string, unknown>) && (data as { data?: unknown }).data instanceof Uint8Array) {
    await saveDownloadResult(data, "download.bin", options.output)
    return
  }
  await printData(data, parseFormat(options.format), options.output)
}))

async function main() {
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
