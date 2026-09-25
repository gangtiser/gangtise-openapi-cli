import { Command } from "commander"

import { collectList, dateArg, maybeArray, parseChoiceList, parseFrom, parseSize, parseTimestamp13 } from "../core/args.js"
import { ValidationError } from "../core/errors.js"
import { fetchOpinionDetails } from "../core/opinionDetail.js"
import { rowCount } from "../core/rowSink.js"
import { emit, addDownloadCommand, confirmCostly, multiChoice, value, required, list, numberList, choiceList, count, rankType, searchType, top, flag, format, output, from, size, startTime, endTime, timeFilters, query } from "./shared.js"
import type { Field } from "./shared.js"

export const insight = new Command("insight").description("Insight APIs")
/** Where the research-area filter takes the CITIC industry set and the gangtise direction
 * set but not the SW set, which comes back empty rather than rejected. */
const RESEARCH_AREA_CITIC_OR_DIRECTION = "Research area ID: citicIndustry code (1008001xx) or gangtiseIndustry direction code (122000xxx: macro/strategy/fixed-income/quant/overseas). swIndustry (104xx0000) returns 0 here"
const SW_INDUSTRY_ONLY = "Industry ID -- swIndustry codes only (104xx0000); citicIndustry codes are rejected with 100005 even where constant-category declares them"

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

query(opinion, "list", {
  endpoint: (options) => options.withContent ? "insight.opinion.list-with-content" : "insight.opinion.list",
  fields: [
    rankType(),
    list("--research-area <id>", RESEARCH_AREA_CITIC_OR_DIRECTION, "researchAreaList"),
    list("--chief <id>", "Chief ID", "chiefList"),
    list("--security <code>", "Security code", "securityList"),
    list("--broker <id>", "Broker ID", "brokerList"),
    list("--industry <id>", "Industry ID", "industryList"),
    list("--concept <id>", "Concept ID", "conceptList"),
    list("--llm-tag <tag>", "Semantic tag", "llmTagList"),
    list("--source <source>", "Source", "sourceList"),
    flag("--with-content", "Return the full body inline (v1 list, 30 credits/row) instead of the 200-char brief (1 credit/row). v1 shape: title and body sit under contentList.title / contentList.content, and there is no brief"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})

query(summary, "list", {
  endpoint: "insight.summary.list",
  cache: { endpointKey: "insight.summary.list", idField: "summaryId" },
  fields: [
    searchType(), rankType(),
    numberList("--source <number>", "Source type", "sourceList"),
    list("--research-area <id>", "Research area ID; this endpoint accepts all three code sets: citicIndustry (1008001xx), swIndustry (104xx0000), gangtiseIndustry direction (122000xxx)", "researchAreaList"),
    list("--security <code>", "Security code", "securityList"),
    list("--institution <id>", "Institution ID", "institutionList"),
    list("--category <name>", "Category", "categoryList"),
    list("--market <name>", "Market", "marketList"),
    list("--participant-role <name>", "Participant role", "participantRoleList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
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
query(pamirsSummary, "list", {
  description: "List Pamirs expert summaries (requires the expert-summary database)",
  endpoint: "insight.pamirs-summary.list",
  cache: { endpointKey: "insight.pamirs-summary.list", idField: "summaryId" },
  fields: [
    searchType(), rankType(),
    list("--research-area <id>", "Research area ID: accepts BOTH industry code sets -- citicIndustry (1008001xx) and swIndustry (104xx0000) -- but NOT gangtiseIndustry direction codes (122000xxx), which return 0 on this endpoint only", "researchAreaList"),
    list("--security <code>", "Security code, e.g. 000001.SZ", "securityList"),
    choiceList("--category <name>", `Category: ${PAMIRS_CATEGORIES.join(" / ")}`, "categoryList", PAMIRS_CATEGORIES),
    choiceList("--market <name>", `Market: ${PAMIRS_MARKETS.join(" / ")}`, "marketList", PAMIRS_MARKETS),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
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
const addScheduleList = (command: Command, endpointKey: string, fields: ScheduleFields) => query(command, "list", {
  endpoint: endpointKey,
  fields: [
    fields.researchArea && list("--research-area <id>", RESEARCH_AREA_CITIC_OR_DIRECTION, "researchAreaList"),
    fields.institution && list("--institution <id>", "Lead institution ID", "institutionList"),
    fields.security && list("--security <code>", "Security code", "securityList"),
    fields.object && list("--object <type>", "Object type: company/industry", "objectList"),
    fields.category && list("--category <name>", fields.category, "categoryList"),
    fields.market && list("--market <name>", fields.market, "marketList"),
    fields.participantRole && list("--participant-role <name>", "Participant role: management/expert", "participantRoleList"),
    fields.brokerType && list("--broker-type <name>", "Lead broker type: cnBroker/otherBroker", "brokerTypeList"),
    fields.permission && numberList("--permission <number>", "Permission: 1=public 2=private", "permission"),
    fields.location && list("--location <id>", "Location ID (domesticCity constant, via 'reference constant-list')", "locationList"),
    format(), output("Output path"),
    ...timeFilters(),
  ].filter((f): f is Field => Boolean(f)),
})
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
// not use timeFilters(). It also takes no --keyword / --rank-type / --search-type.
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
  .addOption(multiChoice("--market <name>", `Market: ${PERFORMANCE_MARKETS.join("/")}`, PERFORMANCE_MARKETS))
  .addOption(multiChoice("--category <name>", `Event type: ${PERFORMANCE_CATEGORIES.join("/")}`, PERFORMANCE_CATEGORIES))
  .option("--format <format>", "Output format", "table").option("--output <path>", "Output path")
  .addOption(confirmCostly().option)
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
      throw new ValidationError("insight performance-calendar list without a bound would auto-paginate the whole calendar (over a hundred thousand rows at 0.1 credits each): pass --start-date and --end-date, or --security, or an explicit --size")
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

query(research, "list", {
  endpoint: "insight.research.list",
  cache: { endpointKey: "insight.research.list", idField: "reportId" },
  fields: [
    searchType(), rankType(),
    list("--broker <id>", "Broker ID", "brokerList"),
    list("--security <code>", "Security code", "securityList"),
    list("--industry <id>", "Industry ID", "industryList"),
    list("--category <name>", "Report category", "categoryList"),
    list("--llm-tag <tag>", "Semantic tag", "llmTagList"),
    list("--rating <name>", "Rating", "ratingList"),
    list("--rating-change <name>", "Rating change", "ratingChangeList"),
    count("--min-pages <number>", "Min report pages", "minReportPages"),
    count("--max-pages <number>", "Max report pages", "maxReportPages"),
    list("--source <type>", "Source type", "sourceList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(research, { endpointKey: "insight.research.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "research", fileType: { description: "File type: 1=PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.research.list" })

query(foreignReport, "list", {
  endpoint: "insight.foreign-report.list",
  cache: { endpointKey: "insight.foreign-report.list", idField: "reportId" },
  fields: [
    searchType(), rankType(),
    list("--security <code>", "Security code", "securityList"),
    list("--region <id>", "Region ID", "regionList"),
    list("--category <name>", "Report category", "categoryList"),
    list("--industry <id>", "Industry ID", "industryList"),
    list("--broker <id>", "Broker ID", "brokerList"),
    list("--llm-tag <tag>", "Semantic tag", "llmTagList"),
    list("--rating <name>", "Rating", "ratingList"),
    list("--rating-change <name>", "Rating change", "ratingChangeList"),
    count("--min-pages <number>", "Min report pages", "minReportPages"),
    count("--max-pages <number>", "Max report pages", "maxReportPages"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(foreignReport, { endpointKey: "insight.foreign-report.download", idOption: "--report-id", idField: "reportId", fallbackPrefix: "foreign-report", fileType: { description: "File type: 1=PDF 2=Markdown 3=CN-PDF 4=CN-Markdown", choices: ["1", "2", "3", "4"], default: "1" }, titleListEndpoint: "insight.foreign-report.list" })

// Contract: A-share announcement startTime/endTime go out as 13-digit epoch millis
// (parseTimestamp13), while HK/US announcement and every other insight list send the
// datetime string straight through. All three filter correctly — verified live against
// a narrow past window (each returns in-window rows). A-share's API also accepts the
// string form, but the 13-digit conversion is kept as the historical spec contract;
// don't "unify" it away without re-confirming the A-share announcement spec.
query(announcement, "list", {
  endpoint: "insight.announcement.list",
  cache: { endpointKey: "insight.announcement.list", idField: "announcementId" },
  fields: [
    searchType(), rankType(),
    list("--security <code>", "Security code", "securityList"),
    list("--category <id>", "Category ID", "categoryList"),
    format(), output("Output path"),
    ...timeFilters(parseTimestamp13),
  ],
})
addDownloadCommand(announcement, { endpointKey: "insight.announcement.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement", fileType: { description: "File type: 1=PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement.list" })

query(announcementHk, "list", {
  endpoint: "insight.announcement-hk.list",
  cache: { endpointKey: "insight.announcement-hk.list", idField: "announcementId" },
  fields: [
    searchType(), rankType(),
    list("--security <code>", "Security code (e.g. 01913.HK)", "securityList"),
    list("--category <id>", "Category ID", "categoryList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(announcementHk, { endpointKey: "insight.announcement-hk.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement-hk", fileType: { description: "File type: 1=original 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement-hk.list" })

query(announcementUs, "list", {
  endpoint: "insight.announcement-us.list",
  cache: { endpointKey: "insight.announcement-us.list", idField: "announcementId" },
  fields: [
    searchType(), rankType(),
    list("--security <code>", "Security code (e.g. TSLA.O)", "securityList"),
    list("--category <id>", "Category ID (constant-list usShareAnnouncementCategory)", "categoryList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(announcementUs, { endpointKey: "insight.announcement-us.download", idOption: "--announcement-id", idField: "announcementId", fallbackPrefix: "announcement-us", fileType: { description: "File type: 1=original PDF 2=Markdown", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.announcement-us.list" })

query(foreignOpinion, "list", {
  endpoint: (options) => options.withContent ? "insight.foreign-opinion.list-with-content" : "insight.foreign-opinion.list",
  fields: [
    rankType(),
    list("--security <code>", "Security code (e.g. UBER.N)", "securityList"),
    list("--region <code>", "Region code -- this endpoint accepts only cn/cnHk/cnTw/us/jp/uk; the other 13 values of regionCategory (sea/gl/fr/de/kr/in/ca/me/othAs/othEur/latAm/oce/af) are rejected here with 100005 though they all work on foreign-report", "regionList"),
    list("--industry <id>", SW_INDUSTRY_ONLY, "industryList"),
    list("--broker <id>", "Broker ID", "brokerList"),
    list("--rating <name>", "Rating", "ratingList"),
    list("--rating-change <name>", "Rating change", "ratingChangeList"),
    flag("--with-content", "Return the full body inline (v1 list, 30 credits/row) as content / contentTranslate, instead of the 200-char brief (1 credit/row)"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})

opinion.command("detail").description("Full bodies of domestic chief opinions by ID (30 credits per returned opinion; batched 20 per call)")
  .requiredOption("--chief-opinion-id <id>", "chiefOpinionId from 'insight opinion list' (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => fetchOpinionDetails(client, "insight.opinion.detail", "chiefOpinionIdList", "chiefOpinionId", options.chiefOpinionId)))

foreignOpinion.command("detail").description("Full bodies (content + contentTranslate) of foreign opinions by ID (30 credits per returned opinion; batched 20 per call)")
  .requiredOption("--foreign-opinion-id <id>", "foreignOpinionId from 'insight foreign-opinion list' (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => fetchOpinionDetails(client, "insight.foreign-opinion.detail", "foreignOpinionIdList", "foreignOpinionId", options.foreignOpinionId)))

query(independentOpinion, "list", {
  endpoint: "insight.independent-opinion.list",
  fields: [
    rankType(),
    list("--security <code>", "Security code (e.g. GSK.N)", "securityList"),
    list("--industry <id>", SW_INDUSTRY_ONLY, "industryList"),
    list("--rating <name>", "Rating", "ratingList"),
    list("--rating-change <name>", "Rating change", "ratingChangeList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(independentOpinion, { endpointKey: "insight.independent-opinion.download", idOption: "--independent-opinion-id", idField: "independentOpinionId", fallbackPrefix: "independent-opinion", fileType: { description: "File type: 1=original HTML 2=CN-translated HTML", choices: ["1", "2"], required: true } })

query(officialAccount, "list", {
  endpoint: "insight.official-account.list",
  cache: { endpointKey: "insight.official-account.list", idField: "articleId" },
  fields: [
    searchType(), rankType(),
    list("--account-id <id>", "Official account ID", "accountIdList"),
    list("--security <code>", "Security code (e.g. 000001.SZ)", "securityList"),
    list("--category <type>", "Article type: news/law/report/view/data/event/meeting/notice/recruit/investEdu/brand/notes/other", "categoryList"),
    list("--industry <id>", "Industry ID (constant-list citicIndustry/swIndustry)", "industryList"),
    format(), output("Output path"),
    ...timeFilters(),
  ],
})
addDownloadCommand(officialAccount, { endpointKey: "insight.official-account.download", idOption: "--article-id", idField: "articleId", fallbackPrefix: "official-account", fileType: { description: "File type: 1=txt(default) 2=HTML", choices: ["1", "2"], default: "1" }, titleListEndpoint: "insight.official-account.list" })

// QA request keys are BARE (source/questionCategory/answerImportant), not the *List
// convention — the body below mirrors the spec exactly. Datetimes pass through as strings.
query(qa, "list", {
  endpoint: "insight.qa.list",
  fields: [
    required("--security-code <code>", "Security code, e.g. 601012.SH", "securityCode"),
    from(), size("Total rows to return; omit to fetch all (max page 500)"),
    startTime("Start time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)"), endTime("End time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)"),
    list("--source <type>", "Source: conference/interactive/survey (repeat)", "source"),
    list("--question-category <name>", "Question category (repeat): productAndBusiness/capacityAndProjects/ordersAndCustomers/financialData/materialEvents/capitalOperations/shareholdersAndDividends/corporateGovernance/marketAndValuation/macroAndIndustry/risksAndOthers", "questionCategory"),
    numberList("--answer-important <flag>", "Answer involves key info: 1=yes 0=no (repeat; omit for all)", "answerImportant"),
    format(), output(),
  ],
})

query(reportImage, "list", {
  endpoint: "insight.report-image.list",
  fields: [
    required("--keyword <text>", "Search keyword, e.g. 'AI' '新能源汽车'", "keyword"),
    top(20),
    value("--source-id <id>", "Report source ID, to filter to one report (from a report list or knowledge base)", "sourceId"),
    startTime("Start time (yyyy-MM-dd HH:mm:ss; yyyy-MM-dd auto-completed)"), endTime("End time (yyyy-MM-dd HH:mm:ss; yyyy-MM-dd auto-completed)"),
    format(), output(),
  ],
})
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
query(highlight, "list", {
  description: "Meeting highlights feed: key takeaways per meeting, newest first (5 credits/row)",
  endpoint: "insight.highlight.list",
  fields: [
    from(), size("Total rows to return; omit to fetch all (max page 50). Billed per row — bound this on wide ranges"),
    startTime("Start time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)"), endTime("End time (yyyy-MM-dd or yyyy-MM-dd HH:mm:ss)"),
    list("--security <code>", "Security code, e.g. 000001.SZ / 09992.HK / AAPL.O (repeatable)", "securityList"),
    list("--research-area <id>", "Research area ID: citicIndustry (1008001xx) or gangtiseIndustry direction (122000xxx). swIndustry codes are NOT accepted here", "researchAreaList"),
    format(), output(),
  ],
})
insight.addCommand(highlight)
