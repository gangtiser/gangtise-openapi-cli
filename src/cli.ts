#!/usr/bin/env node
import { Command, Option } from "commander"

import fs from "node:fs/promises"
import os from "node:os"
import path, { extname } from "node:path"
import { collectKeyValue, collectList, collectNumberList, maybeArray } from "./core/args.js"
import { readTokenCache } from "./core/auth.js"
import { GangtiseClient } from "./core/client.js"
import { loadConfig, type OutputFormat } from "./core/config.js"
import { ApiError, ConfigError, DownloadError } from "./core/errors.js"
import { renderOutput, saveOutputIfNeeded } from "./core/output.js"
import { normalizeRows } from "./core/normalize.js"

function parseFormat(value?: string): OutputFormat {
  const format = value ?? "table"
  if (["table", "json", "jsonl", "csv", "markdown"].includes(format)) {
    return format as OutputFormat
  }
  throw new ConfigError(`Unsupported format: ${format}`)
}

// --- Title cache: list writes, download reads ---
const TITLE_CACHE_PATH = path.join(os.homedir(), ".config", "gangtise", "title-cache.json")
const TITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

interface TitleCacheEntry { titles: Record<string, string>; ts: number }
type TitleCacheData = Record<string, TitleCacheEntry> // keyed by endpoint

async function readTitleCache(): Promise<TitleCacheData> {
  try {
    return JSON.parse(await fs.readFile(TITLE_CACHE_PATH, "utf8")) as TitleCacheData
  } catch { return {} }
}

async function writeTitleCache(endpoint: string, titles: Record<string, string>): Promise<void> {
  const data = await readTitleCache()
  data[endpoint] = { titles, ts: Date.now() }
  await fs.mkdir(path.dirname(TITLE_CACHE_PATH), { recursive: true })
  await fs.writeFile(TITLE_CACHE_PATH, JSON.stringify(data), "utf8")
}

function lookupTitleCache(data: TitleCacheData, endpoint: string, id: string): string | undefined {
  const entry = data[endpoint]
  if (!entry || Date.now() - entry.ts > TITLE_CACHE_TTL_MS) return undefined
  return entry.titles[id]
}

interface TitleCacheConfig { endpointKey: string; idField: string; titleField?: string }

async function printData(data: unknown, format: OutputFormat, output?: string, cache?: TitleCacheConfig) {
  const normalized = normalizeRows(data)
  // Populate title cache from list results
  if (cache && Array.isArray(normalized)) {
    const titleField = cache.titleField ?? "title"
    const titles: Record<string, string> = {}
    for (const row of normalized) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>
        const id = r[cache.idField]
        const title = r[titleField]
        if (id != null && typeof title === "string" && title) titles[String(id)] = title
      }
    }
    if (Object.keys(titles).length > 0) writeTitleCache(cache.endpointKey, titles).catch(() => {})
  }
  const content = renderOutput(normalized, format)
  if (output) {
    await saveOutputIfNeeded(content, output)
    process.stdout.write(`${output}\n`)
    return
  }
  process.stdout.write(`${content}\n`)
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/gzip": ".gz",
  "application/x-7z-compressed": ".7z",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "application/octet-stream": ".bin",
}

function extFromContentType(contentType?: string): string {
  if (!contentType) return ""
  const mime = contentType.split(";")[0].trim().toLowerCase()
  return MIME_EXT[mime] ?? ""
}

/** Resolve a human-readable filename by looking up the title from cache or list endpoint. */
async function resolveTitle(
  client: GangtiseClient,
  result: unknown,
  listEndpoint: string,
  idField: string,
  idValue: string,
  titleField = "title",
): Promise<string | undefined> {
  const file = result as { filename?: string; contentType?: string }
  const serverExt = file.filename ? extname(file.filename) : extFromContentType(file.contentType)

  function buildFilename(rawTitle: string): string {
    let title = rawTitle.replace(/[/\\:*?"<>|]/g, "_").trim()
    if (serverExt && !title.toLowerCase().endsWith(serverExt.toLowerCase())) {
      title += serverExt
    }
    return title
  }

  // 1. Check file-based title cache (populated by prior list command)
  try {
    const cacheData = await readTitleCache()
    const cached = lookupTitleCache(cacheData, listEndpoint, idValue)
    if (cached) return buildFilename(cached)
  } catch { /* ignore */ }

  // 2. Fallback: query list API (scan recent 200 items)
  try {
    const resp = await client.call(listEndpoint, { from: 0, size: 200 }) as { list?: Array<Record<string, unknown>> }
    const items = Array.isArray(resp) ? resp : (resp.list ?? [])
    const match = items.find(f => String(f[idField]) === String(idValue))
    const rawTitle = match?.[titleField]
    if (typeof rawTitle === "string" && rawTitle) return buildFilename(rawTitle)
  } catch { /* ignore */ }

  return undefined
}

async function saveDownloadResult(result: unknown, fallbackName: string, output?: string) {
  if (!(result && typeof result === "object")) {
    throw new DownloadError("Unexpected download response")
  }

  const file = result as { data?: Uint8Array; text?: string; url?: string; filename?: string; contentType?: string }

  if (file.data instanceof Uint8Array) {
    const outputPath = output ?? file.filename ?? (fallbackName + extFromContentType(file.contentType))
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
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

function loadPackageVersion(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const req = createRequire(import.meta.url)
  // Works from both src/ (dev) and dist/src/ (built)
  try { return (req(path.resolve(__dirname, "../package.json")) as { version: string }).version } catch {}
  try { return (req(path.resolve(__dirname, "../../package.json")) as { version: string }).version } catch {}
  return "0.0.0"
}

program.name("gangtise").description("Gangtise OpenAPI CLI").version(loadPackageVersion())

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
  .addCommand(new Command("industry-code").description("Shenwan industry codes for security-clue --gts-code").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const data = [
      { name: "申万农林牧渔", code: "821031.SWI" },
      { name: "申万基础化工", code: "821032.SWI" },
      { name: "申万钢铁", code: "821033.SWI" },
      { name: "申万有色金属", code: "821034.SWI" },
      { name: "申万电子", code: "821035.SWI" },
      { name: "申万汽车", code: "821036.SWI" },
      { name: "申万家用电器", code: "821037.SWI" },
      { name: "申万食品饮料", code: "821038.SWI" },
      { name: "申万纺织服饰", code: "821039.SWI" },
      { name: "申万轻工制造", code: "821040.SWI" },
      { name: "申万医药生物", code: "821041.SWI" },
      { name: "申万公用事业", code: "821042.SWI" },
      { name: "申万交通运输", code: "821043.SWI" },
      { name: "申万房地产", code: "821044.SWI" },
      { name: "申万商贸零售", code: "821045.SWI" },
      { name: "申万社会服务", code: "821046.SWI" },
      { name: "申万银行", code: "821047.SWI" },
      { name: "申万非银金融", code: "821048.SWI" },
      { name: "申万综合", code: "821049.SWI" },
      { name: "申万建筑材料", code: "821050.SWI" },
      { name: "申万建筑装饰", code: "821051.SWI" },
      { name: "申万电力设备", code: "821052.SWI" },
      { name: "申万机械设备", code: "821053.SWI" },
      { name: "申万国防军工", code: "821054.SWI" },
      { name: "申万计算机", code: "821055.SWI" },
      { name: "申万传媒", code: "821056.SWI" },
      { name: "申万通信", code: "821057.SWI" },
      { name: "申万煤炭", code: "821058.SWI" },
      { name: "申万石油石化", code: "821059.SWI" },
      { name: "申万环保", code: "821060.SWI" },
      { name: "申万美容护理", code: "821061.SWI" },
    ]
    await printData(data, parseFormat(options.format))
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
  }), parseFormat(options.format), options.output, { endpointKey: "insight.summary.list", idField: "summaryId" })
})
summary.command("download").requiredOption("--summary-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  const result = await client.call("insight.summary.download", undefined, { summaryId: options.summaryId })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.summary.list", "summaryId", options.summaryId)
  await saveDownloadResult(result, `summary-${options.summaryId}`, options.output ?? title)
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
  }), parseFormat(options.format), options.output, { endpointKey: "insight.research.list", idField: "reportId" })
})
research.command("download").requiredOption("--report-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  const result = await client.call("insight.research.download", undefined, { reportId: options.reportId })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.research.list", "reportId", options.reportId)
  await saveDownloadResult(result, `research-${options.reportId}`, options.output ?? title)
})

addTimeFilters(foreignReport.command("list").option("--security <code>", "Security code", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.foreign-report.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    securityList: maybeArray(options.security),
  }), parseFormat(options.format), options.output, { endpointKey: "insight.foreign-report.list", idField: "reportId" })
})
foreignReport.command("download").requiredOption("--report-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  const result = await client.call("insight.foreign-report.download", undefined, { reportId: options.reportId })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.foreign-report.list", "reportId", options.reportId)
  await saveDownloadResult(result, `foreign-report-${options.reportId}`, options.output ?? title)
})

addTimeFilters(announcement.command("list").option("--security <code>", "Security code", collectList, []).option("--announcement-type <type>", "Announcement type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("insight.announcement.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    securityList: maybeArray(options.security), announcementTypeList: maybeArray(options.announcementType),
  }), parseFormat(options.format), options.output, { endpointKey: "insight.announcement.list", idField: "announcementId" })
})
announcement.command("download").requiredOption("--announcement-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  const result = await client.call("insight.announcement.download", undefined, { announcementId: options.announcementId })
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
quote.command("day-kline").option("--security <code>", "Security code", collectList, []).option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("quote.day-kline", { securityList: maybeArray(options.security), startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
program.addCommand(quote)

const fundamental = new Command("fundamental").description("Fundamental APIs")
fundamental.command("income-statement").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period", collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("fundamental.income-statement", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : ["latest"], reportType: options.reportType.length ? options.reportType : ["consolidated"], fieldList: options.field }), parseFormat(options.format), options.output)
})
fundamental.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("fundamental.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
fundamental.command("valuation-analysis").requiredOption("--security-code <code>").requiredOption("--indicator <name>", "Indicator like peTtm/pbMrq/peg/psTtm/pcfTtm/em").option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
program.addCommand(fundamental)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").requiredOption("--query <text>", "Query", collectList, []).option("--top <number>", "Top", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <ms>").option("--end-time <ms>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await printData(await client.call("ai.knowledge-batch", { queries: options.query, top: Number(options.top), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: options.startTime ? Number(options.startTime) : undefined, endTime: options.endTime ? Number(options.endTime) : undefined }), parseFormat(options.format), options.output)
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  await saveDownloadResult(await client.call("ai.knowledge-resource.download", undefined, { resourceType: Number(options.resourceType), sourceId: options.sourceId }), `resource-${options.sourceId}`, options.output)
})
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>").requiredOption("--end-time <datetime>").addOption(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory()).option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
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
  await printData(await client.call("ai.cloud-disk.list", { from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), parseFormat(options.format), options.output, { endpointKey: "ai.cloud-disk.list", idField: "fileId" })
})
ai.command("cloud-disk-download").requiredOption("--file-id <id>").option("--output <path>").action(async (options) => {
  const client = new GangtiseClient(loadConfig())
  const result = await client.call("ai.cloud-disk.download", undefined, { fileId: options.fileId })
  const title = options.output ? undefined : await resolveTitle(client, result, "ai.cloud-disk.list", "fileId", options.fileId)
  await saveDownloadResult(result, `file-${options.fileId}`, options.output ?? title)
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
