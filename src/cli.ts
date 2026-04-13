#!/usr/bin/env node
import { Command, Option } from "commander"

import { collectKeyValue, collectList, collectNumberList, maybeArray, toTimestamp13 } from "./core/args.js"
import { loadConfig, type OutputFormat } from "./core/config.js"
import { ApiError, ConfigError, DownloadError } from "./core/errors.js"

// --- Lazy-loaded modules (deferred to action handlers) ---
async function createClient() {
  const { GangtiseClient } = await import("./core/client.js")
  return new GangtiseClient(loadConfig())
}

async function readTokenCache(...args: Parameters<typeof import("./core/auth.js").readTokenCache>) {
  return (await import("./core/auth.js")).readTokenCache(...args)
}

async function normalizeRows(...args: Parameters<typeof import("./core/normalize.js").normalizeRows>) {
  return (await import("./core/normalize.js")).normalizeRows(...args)
}

async function renderOutput(...args: Parameters<typeof import("./core/output.js").renderOutput>) {
  return (await import("./core/output.js")).renderOutput(...args)
}

async function saveOutputIfNeeded(...args: Parameters<typeof import("./core/output.js").saveOutputIfNeeded>) {
  return (await import("./core/output.js")).saveOutputIfNeeded(...args)
}

function parseFormat(value?: string): OutputFormat {
  const format = value ?? "table"
  if (["table", "json", "jsonl", "csv", "markdown"].includes(format)) {
    return format as OutputFormat
  }
  throw new ConfigError(`Unsupported format: ${format}`)
}

// --- Title cache: list writes, download reads ---
let _titleCachePath: string
function getTitleCachePath() {
  if (!_titleCachePath) {
    const path = require("node:path") as typeof import("node:path")
    const os = require("node:os") as typeof import("node:os")
    _titleCachePath = path.join(os.homedir(), ".config", "gangtise", "title-cache.json")
  }
  return _titleCachePath
}
const TITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

interface TitleCacheEntry { titles: Record<string, string>; ts: number }
type TitleCacheData = Record<string, TitleCacheEntry> // keyed by endpoint

async function readTitleCache(): Promise<TitleCacheData> {
  try {
    const fs = await import("node:fs/promises")
    return JSON.parse(await fs.readFile(getTitleCachePath(), "utf8")) as TitleCacheData
  } catch { return {} }
}

async function writeTitleCache(endpoint: string, titles: Record<string, string>): Promise<void> {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  const data = await readTitleCache()
  data[endpoint] = { titles, ts: Date.now() }
  await fs.mkdir(path.dirname(getTitleCachePath()), { recursive: true })
  await fs.writeFile(getTitleCachePath(), JSON.stringify(data), "utf8")
}

function lookupTitleCache(data: TitleCacheData, endpoint: string, id: string): string | undefined {
  const entry = data[endpoint]
  if (!entry || Date.now() - entry.ts > TITLE_CACHE_TTL_MS) return undefined
  return entry.titles[id]
}

interface TitleCacheConfig { endpointKey: string; idField: string; titleField?: string }

async function printData(data: unknown, format: OutputFormat, output?: string, cache?: TitleCacheConfig) {
  const normalized = await normalizeRows(data)
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
  const content = await renderOutput(normalized, format)
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
  client: Awaited<ReturnType<typeof createClient>>,
  result: unknown,
  listEndpoint: string,
  idField: string,
  idValue: string,
  titleField = "title",
): Promise<string | undefined> {
  const { extname } = await import("node:path")
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

const CLI_VERSION = "0.6.0"

program.name("gangtise").description("Gangtise OpenAPI CLI").version(CLI_VERSION)

program
  .command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const client = await createClient()
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
    const client = await createClient()
    await printData(await client.call("lookup.research-areas.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("broker-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.broker-orgs.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("meeting-org").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.meeting-orgs.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("industry").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.industries.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("region").description("Foreign report region codes").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.regions.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("announcement-category").description("Announcement category codes").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.announcement-categories.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("industry-code").description("Shenwan industry codes for security-clue --gts-code").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.industry-codes.list"), parseFormat(options.format))
  })))
  .addCommand(new Command("theme-id").description("Theme IDs for theme-tracking --theme-id").addCommand(new Command("list").option("--format <format>", "Output format", "table").action(async (options) => {
    const client = await createClient()
    await printData(await client.call("lookup.theme-ids.list"), parseFormat(options.format))
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
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime,
    rankType: Number(options.rankType), keyword: options.keyword, researchAreaList: maybeArray(options.researchArea), chiefList: maybeArray(options.chief),
    securityList: maybeArray(options.security), brokerList: maybeArray(options.broker), industryList: maybeArray(options.industry), conceptList: maybeArray(options.concept),
    llmTagList: maybeArray(options.llmTag), sourceList: maybeArray(options.source),
  }), parseFormat(options.format), options.output)
})

addTimeFilters(summary.command("list").option("--search-type <number>", "Search type", "1").option("--rank-type <number>", "Rank type", "1").option("--source <number>", "Source type", collectNumberList, []).option("--research-area <id>", "Research area", collectList, []).option("--security <code>", "Security code", collectList, []).option("--institution <id>", "Institution ID", collectList, []).option("--category <name>", "Category", collectList, []).option("--market <name>", "Market", collectList, []).option("--participant-role <name>", "Participant role", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.summary.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime,
    searchType: Number(options.searchType), rankType: Number(options.rankType), keyword: options.keyword, sourceList: options.source.length ? options.source : undefined,
    researchAreaList: maybeArray(options.researchArea), securityList: maybeArray(options.security), institutionList: maybeArray(options.institution),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
  }), parseFormat(options.format), options.output, { endpointKey: "insight.summary.list", idField: "summaryId" })
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
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    researchAreaList: maybeArray(options.researchArea), institutionList: maybeArray(options.institution), securityList: maybeArray(options.security),
    categoryList: maybeArray(options.category), marketList: maybeArray(options.market), participantRoleList: maybeArray(options.participantRole),
    brokerTypeList: maybeArray(options.brokerType), objectList: maybeArray(options.object), permission: options.permission.length ? options.permission : undefined,
  }), parseFormat(options.format), options.output)
})
addScheduleList(roadshow, "insight.roadshow.list")
addScheduleList(siteVisit, "insight.site-visit.list")
addScheduleList(strategy, "insight.strategy.list")
addScheduleList(forum, "insight.forum.list")

addTimeFilters(research.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--broker <id>", "Broker ID", collectList, []).option("--security <code>", "Security code", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--source <type>", "Source type", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.research.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: Number(options.searchType), rankType: Number(options.rankType),
    brokerList: maybeArray(options.broker), securityList: maybeArray(options.security), industryList: maybeArray(options.industry),
    categoryList: maybeArray(options.category), llmTagList: maybeArray(options.llmTag), ratingList: maybeArray(options.rating),
    ratingChangeList: maybeArray(options.ratingChange), minReportPages: options.minPages ? Number(options.minPages) : undefined,
    maxReportPages: options.maxPages ? Number(options.maxPages) : undefined, sourceList: maybeArray(options.source),
  }), parseFormat(options.format), options.output, { endpointKey: "insight.research.list", idField: "reportId" })
})
research.command("download").requiredOption("--report-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.research.download", undefined, { reportId: options.reportId, fileType: Number(options.fileType) })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.research.list", "reportId", options.reportId)
  await saveDownloadResult(result, `research-${options.reportId}`, options.output ?? title)
})

addTimeFilters(foreignReport.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--region <id>", "Region ID", collectList, []).option("--category <name>", "Report category", collectList, []).option("--industry <id>", "Industry ID", collectList, []).option("--broker <id>", "Broker ID", collectList, []).option("--llm-tag <tag>", "Semantic tag", collectList, []).option("--rating <name>", "Rating", collectList, []).option("--rating-change <name>", "Rating change", collectList, []).option("--min-pages <number>", "Min report pages").option("--max-pages <number>", "Max report pages").option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.foreign-report.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword,
    searchType: Number(options.searchType), rankType: Number(options.rankType),
    securityList: maybeArray(options.security), regionList: maybeArray(options.region), categoryList: maybeArray(options.category),
    industryList: maybeArray(options.industry), brokerList: maybeArray(options.broker), llmTagList: maybeArray(options.llmTag),
    ratingList: maybeArray(options.rating), ratingChangeList: maybeArray(options.ratingChange),
    minReportPages: options.minPages ? Number(options.minPages) : undefined, maxReportPages: options.maxPages ? Number(options.maxPages) : undefined,
  }), parseFormat(options.format), options.output, { endpointKey: "insight.foreign-report.list", idField: "reportId" })
})
foreignReport.command("download").requiredOption("--report-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown 3=CN-PDF 4=CN-Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.foreign-report.download", undefined, { reportId: options.reportId, fileType: Number(options.fileType) })
  const title = options.output ? undefined : await resolveTitle(client, result, "insight.foreign-report.list", "reportId", options.reportId)
  await saveDownloadResult(result, `foreign-report-${options.reportId}`, options.output ?? title)
})

addTimeFilters(announcement.command("list").option("--search-type <number>", "Search type: 1=title 2=fulltext", "1").option("--rank-type <number>", "Rank type: 1=composite 2=time desc", "1").option("--security <code>", "Security code", collectList, []).option("--announcement-type <type>", "Announcement type", collectList, []).option("--category <id>", "Category ID", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>", "Output path")).action(async (options) => {
  const client = await createClient()
  await printData(await client.call("insight.announcement.list", {
    from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size),
    startTime: toTimestamp13(options.startTime), endTime: toTimestamp13(options.endTime),
    searchType: Number(options.searchType), rankType: Number(options.rankType), keyword: options.keyword,
    securityList: maybeArray(options.security), announcementTypeList: maybeArray(options.announcementType), categoryList: maybeArray(options.category),
  }), parseFormat(options.format), options.output, { endpointKey: "insight.announcement.list", idField: "announcementId" })
})
announcement.command("download").requiredOption("--announcement-id <id>").option("--file-type <number>", "File type: 1=PDF 2=Markdown", "1").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("insight.announcement.download", undefined, { announcementId: options.announcementId, fileType: Number(options.fileType) })
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
quote.command("day-kline").option("--security <code>", "Security code (A-share only: .SH/.SZ/.BJ)", collectList, []).option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: latest)").option("--limit <number>", "Max rows per request (default: 5000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.day-kline", { securityList: maybeArray(options.security), startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
quote.command("day-kline-hk").option("--security <code>", "Security code (HK stock only: .HK)", collectList, []).option("--start-date <date>", "Start date (default: 1 year before end-date)").option("--end-date <date>", "End date (default: latest)").option("--limit <number>", "Max rows per request (default: 5000, max: 10000)").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("quote.day-kline-hk", { securityList: maybeArray(options.security), startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
program.addCommand(quote)

const fundamental = new Command("fundamental").description("Fundamental APIs")
fundamental.command("income-statement").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period", collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.income-statement", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
fundamental.command("balance-sheet").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period", collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.balance-sheet", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
fundamental.command("cash-flow").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).option("--period <period>", "Period", collectList, []).option("--report-type <type>", "Report type", collectList, []).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.cash-flow", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), period: options.period.length ? options.period : undefined, reportType: options.reportType.length ? options.reportType : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
fundamental.command("main-business").requiredOption("--security-code <code>").option("--start-date <date>").option("--end-date <date>").option("--fiscal-year <year>", "Fiscal year", collectList, []).addOption(new Option("--breakdown <type>", "Breakdown: product/industry/region").choices(["product", "industry", "region"]).default("product")).addOption(new Option("--period <type>", "Period: interim/annual").choices(["interim", "annual"])).option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.main-business", { securityCode: options.securityCode, startDate: options.startDate, endDate: options.endDate, fiscalYear: maybeArray(options.fiscalYear), breakdown: options.breakdown, period: options.period, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
fundamental.command("valuation-analysis").requiredOption("--security-code <code>").addOption(new Option("--indicator <name>", "Indicator").choices(["peTtm", "pbMrq", "peg", "psTtm", "pcfTtm", "em"]).makeOptionMandatory()).option("--start-date <date>").option("--end-date <date>").option("--limit <number>").option("--field <field>", "Field", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit: options.limit ? Number(options.limit) : undefined, fieldList: maybeArray(options.field) }), parseFormat(options.format), options.output)
})
program.addCommand(fundamental)

const ai = new Command("ai").description("AI APIs")
ai.command("knowledge-batch").requiredOption("--query <text>", "Query", collectList, []).option("--top <number>", "Top", "10").option("--resource-type <number>", "Resource type", collectNumberList, []).option("--knowledge-name <name>", "Knowledge name", collectList, []).option("--start-time <ms>").option("--end-time <ms>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.knowledge-batch", { queries: options.query, top: Number(options.top), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: options.startTime ? Number(options.startTime) : undefined, endTime: options.endTime ? Number(options.endTime) : undefined }), parseFormat(options.format), options.output)
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await saveDownloadResult(await client.call("ai.knowledge-resource.download", undefined, { resourceType: Number(options.resourceType), sourceId: options.sourceId }), `resource-${options.sourceId}`, options.output)
})
ai.command("security-clue").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").requiredOption("--start-time <datetime>").requiredOption("--end-time <datetime>").addOption(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory()).option("--gts-code <code>", "GTS code", collectList, []).option("--source <name>", "Source", collectList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.security-clue.list", { from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, queryMode: options.queryMode, gtsCodeList: maybeArray(options.gtsCode), source: maybeArray(options.source) }), parseFormat(options.format), options.output)
})
ai.command("one-pager").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.one-pager", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("investment-logic").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.investment-logic", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("peer-comparison").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.peer-comparison", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
ai.command("earnings-review").requiredOption("--security-code <code>").requiredOption("--period <period>", "Report period (e.g. 2025q3, 2025interim, 2025annual)").option("--wait", "Wait for content generation (blocking, up to 3 min)").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  // Step 1: get dataId
  const idResult = await client.call("ai.earnings-review.get-id", { securityCode: options.securityCode, period: options.period }) as { dataId?: string }
  const dataId = idResult?.dataId
  if (!dataId) {
    process.stderr.write("Failed to get earnings review ID. The report may not be available yet.\n")
    process.exitCode = 1
    return
  }

  // Non-blocking: return dataId immediately
  if (!options.wait) {
    process.stderr.write(`Earnings review task submitted. dataId: ${dataId}\n`)
    process.stdout.write(`${JSON.stringify({ dataId, status: "pending", hint: `Run 'gangtise ai earnings-review-check --data-id ${dataId}' in ~2 minutes to get results` })}\n`)
    return
  }

  // Blocking (--wait): poll for content
  process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
  let attempts = 0
  const maxAttempts = 12
  const delayMs = 15_000
  while (attempts < maxAttempts) {
    attempts++
    const contentResult = await client.call("ai.earnings-review.get-content", { dataId }) as { data?: { date?: string; content?: string } }
    if (contentResult?.data?.content) {
      await printData(contentResult.data, parseFormat(options.format), options.output)
      return
    }
    if (attempts < maxAttempts) {
      process.stderr.write(`Attempt ${attempts}/${maxAttempts}: content not ready, retrying in 15s...\n`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  process.stderr.write(`Content not available after ${maxAttempts} attempts. Try again later with: gangtise ai earnings-review-check --data-id ${dataId}\n`)
  process.exitCode = 1
})
ai.command("earnings-review-check").requiredOption("--data-id <id>", "dataId from earnings-review").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  try {
    const contentResult = await client.call("ai.earnings-review.get-content", { dataId: options.dataId }) as { data?: { date?: string; content?: string } }
    if (contentResult?.data?.content) {
      await printData(contentResult.data, parseFormat(options.format), options.output)
      return
    }
    process.stdout.write(`${JSON.stringify({ dataId: options.dataId, status: "pending", hint: "Content not ready yet, retry in ~2 minutes" })}\n`)
  } catch (error) {
    if (error instanceof ApiError && (error.code === "410110" || error.message?.includes("生成中"))) {
      process.stdout.write(`${JSON.stringify({ dataId: options.dataId, status: "pending", hint: "Content not ready yet, retry in ~2 minutes" })}\n`)
      return
    }
    throw error
  }
})
ai.command("theme-tracking").requiredOption("--theme-id <id>", "Theme ID (use lookup theme-id list)").requiredOption("--date <date>", "Date (yyyy-MM-dd)").option("--type <name>", "Report type: morning/night", collectList, []).option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const typeList = options.type.length ? options.type : undefined
  await printData(await client.call("ai.theme-tracking", { themeId: options.themeId, date: options.date, type: typeList }), parseFormat(options.format), options.output)
})
ai.command("research-outline").requiredOption("--security-code <code>").option("--format <format>", "Output format", "json").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("ai.research-outline", { securityCode: options.securityCode }), parseFormat(options.format), options.output)
})
const vault = new Command("vault").description("Vault APIs")
vault.command("drive-list").option("--from <number>", "Starting offset", "0").option("--size <number>", "Total rows to return; omit to fetch all").option("--start-time <datetime>").option("--end-time <datetime>").option("--keyword <text>").option("--file-type <number>", "File type", collectNumberList, []).option("--space-type <number>", "Space type", collectNumberList, []).option("--format <format>", "Output format", "table").option("--output <path>").action(async (options) => {
  const client = await createClient()
  await printData(await client.call("vault.drive.list", { from: Number(options.from), size: options.size === undefined ? undefined : Number(options.size), startTime: options.startTime, endTime: options.endTime, keyword: options.keyword, fileTypeList: options.fileType.length ? options.fileType : undefined, spaceTypeList: options.spaceType.length ? options.spaceType : undefined }), parseFormat(options.format), options.output, { endpointKey: "vault.drive.list", idField: "fileId" })
})
vault.command("drive-download").requiredOption("--file-id <id>").option("--output <path>").action(async (options) => {
  const client = await createClient()
  const result = await client.call("vault.drive.download", undefined, { fileId: options.fileId })
  const title = options.output ? undefined : await resolveTitle(client, result, "vault.drive.list", "fileId", options.fileId)
  await saveDownloadResult(result, `file-${options.fileId}`, options.output ?? title)
})
program.addCommand(vault)
program.addCommand(ai)

program.command("raw").description("Raw API calls").addCommand(new Command("call").argument("<endpointKey>").option("--body <json>").option("--query <key=value>", "Query string pair", collectKeyValue, {}).option("--format <format>", "Output format", "json").option("--output <path>").action(async (endpointKey, options) => {
  const client = await createClient()
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
