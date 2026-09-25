import { Command, Option } from "commander"

import { checkAsyncContent, pollAsyncContent, POLL_MAX_ATTEMPTS } from "../core/asyncContent.js"
import { collectList, numberListArg, collectText, dateArg, datetimeArg, maybeArray, parseChoiceList, parseFrom, parseNumberOption, parseSize, parseTimestamp13 } from "../core/args.js"
import { ValidationError } from "../core/errors.js"
import { markFailed } from "../core/exitStatus.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { emit, withClient, runDownload, confirmCostly, multiChoice, field, required, date, list, choiceList, flag, format, output, from, size, requestBody, query } from "./shared.js"
import { checkMarketKeywords } from "./quote.js"
import type { Field } from "./shared.js"

export const ai = new Command("ai").description("AI APIs")

/** An AI generation task: submit it — optionally waiting for the content — plus a
 * `<name>-check` command that fetches it later by dataId. Earnings review and viewpoint
 * debate share every step but what they submit. */
function addGenerationTask(name: string, spec: { submit: string; content: string; label: string; idFailure: string; fields: Field[] }): void {
  const command = ai.command(name)
  for (const f of [...spec.fields, flag("--wait", "Wait for content generation (blocking, up to ~5 min)"), format("json"), output()]) command.addOption(f.option)
  command.action((options) => withClient(async (client) => {
    const format = parseOutputFormat(options.format)
    const idResult = await client.call(spec.submit, requestBody(spec.fields, options)) as { dataId?: string }
    const dataId = idResult?.dataId
    if (!dataId) {
      process.stderr.write(`${spec.idFailure}\n`)
      markFailed()
      return
    }

    if (!options.wait) {
      process.stderr.write(`${spec.label} task submitted. dataId: ${dataId}\n`)
      // Through printData, not a bare stdout.write: the submit-only path still has to
      // honour --output and --format. Writing straight to stdout meant a caller who
      // passed --output got exit 0 and no file, and the automation that was supposed
      // to read the dataId out of it had nothing to read.
      await printData({ dataId, status: "pending", hint: `Run 'gangtise ai ${name}-check --data-id ${dataId}' in ~2 minutes to get results` }, format, options.output)
      return
    }

    process.stderr.write(`Got dataId: ${dataId}, waiting for content generation...\n`)
    const outcome = await pollAsyncContent(client, spec.content, dataId, format, options.output)
    if (outcome !== "ok") {
      // "failed" already printed its terminal "Do not retry" line — only a timeout
      // gets the retry hint.
      if (outcome === "timeout") {
        process.stderr.write(`Content not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise ai ${name}-check --data-id ${dataId}\n`)
      }
      markFailed()
    }
  }))
  ai.command(`${name}-check`).requiredOption("--data-id <id>", `dataId from ${name}`).option("--format <format>", "Output format", "json").option("--output <path>").action((options) => withClient((client) => checkAsyncContent(client, spec.content, options.dataId, parseOutputFormat(options.format), options.output)))
}
ai.command("knowledge-batch")
  .option("--query <text>", "Query text; repeat for up to 5. Each --query is taken whole — commas inside it are part of the question, not separators", collectText, [])
  .option("--top <number>", "Max results (default: 10, max: 20)", "10")
  .option("--resource-type <number>", "Resource type", numberListArg("--resource-type"), [])
  .option("--knowledge-name <name>", "Knowledge name", collectList, [])
  .option("--start-time <datetime>", "13/10-digit epoch or YYYY-MM-DD[ HH:mm[:ss]] (space or T)")
  .option("--end-time <datetime>", "13/10-digit epoch or YYYY-MM-DD[ HH:mm[:ss]] (space or T)")
  .option("--format <format>", "Output format", "json")
  .option("--output <path>")
  .action((options) => {
  if (!options.query.length) throw new ValidationError("--query is required: pass at least one --query")
  return emit(options, (client) => client.call("ai.knowledge-batch", { queries: options.query, top: parseNumberOption(options.top, "--top", { integer: true, min: 1, max: 20 }), resourceTypes: options.resourceType.length ? options.resourceType : undefined, knowledgeNames: maybeArray(options.knowledgeName), startTime: parseTimestamp13(options.startTime, "--start-time"), endTime: parseTimestamp13(options.endTime, "--end-time") }))
})
ai.command("knowledge-resource-download").requiredOption("--resource-type <number>").requiredOption("--source-id <id>").option("--output <path>").action((options) => withClient(async (client) => {
  await runDownload(client, "ai.knowledge-resource.download", { resourceType: parseNumberOption(options.resourceType, "--resource-type", { integer: true, min: 0 }), sourceId: options.sourceId }, {
    output: options.output,
    fallbackName: `resource-${options.sourceId}`,
  })
}))
query(ai, "security-clue", {
  endpoint: "ai.security-clue.list",
  fields: [
    from(), size(),
    field(new Option("--start-time <datetime>", "Start time").argParser(datetimeArg("--start-time")).makeOptionMandatory(), (v) => ({ startTime: v })),
    field(new Option("--end-time <datetime>", "End time").argParser(datetimeArg("--end-time")).makeOptionMandatory(), (v) => ({ endTime: v })),
    field(new Option("--query-mode <mode>").choices(["bySecurity", "byIndustry"]).makeOptionMandatory(), (v) => ({ queryMode: v })),
    list("--gts-code <code>", "GTS code", "gtsCodeList"),
    // Checked locally: an unknown value is not refused but ignored — the answer is the
    // unfiltered set (probed 2026-09-25: no source and "bogusSource" both total 8,
    // "announcement" 0), so a misspelling reads as an ordinary, fully billed answer.
    choiceList("--source <name>", "Source: researchReport/conference/announcement/view (repeat)", "source", ["researchReport", "conference", "announcement", "view"]),
    format(), output(),
  ],
})
query(ai, "one-pager", { endpoint: "ai.one-pager", fields: [required("--security-code <code>", undefined, "securityCode"), format("json"), output()] })
query(ai, "investment-logic", { endpoint: "ai.investment-logic", fields: [required("--security-code <code>", undefined, "securityCode"), format("json"), output()] })
query(ai, "peer-comparison", { endpoint: "ai.peer-comparison", fields: [required("--security-code <code>", undefined, "securityCode"), format("json"), output()] })
addGenerationTask("earnings-review", {
  submit: "ai.earnings-review.get-id",
  content: "ai.earnings-review.get-content",
  label: "Earnings review",
  idFailure: "Failed to get earnings review ID. The report may not be available yet.",
  fields: [required("--security-code <code>", undefined, "securityCode"), required("--period <period>", "Report period (e.g. 2025q3, 2025interim, 2025annual)", "period")],
})
query(ai, "theme-tracking", {
  endpoint: "ai.theme-tracking",
  fields: [
    required("--theme-id <id>", "Theme ID (use 'reference concept-search')", "themeId"),
    date("--date <date>", "Date (yyyy-MM-dd)", "date", { required: true }),
    list("--type <name>", "Report type: morning/night", "type"),
    format("json"), output(),
  ],
})
query(ai, "research-outline", { endpoint: "ai.research-outline", fields: [required("--security-code <code>", undefined, "securityCode"), format("json"), output()] })
/** Hot-topic report types. Checked locally: an unknown category is not refused (probed
 * 2026-09-25, on a window with no data — whether it is ignored or filters to nothing was not
 * measured), so a misspelling reads as an ordinary answer. */
const HOT_TOPIC_CATEGORIES = ["morningBriefing", "noonBriefing", "afternoonFlash", "eveningBriefing"]

ai.command("hot-topic")
  .option("--from <number>", "Starting offset", "0")
  .option("--size <number>", "Total rows to return; omit to fetch all")
  .option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date"))
  .option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date"))
  .addOption(multiChoice("--category <name>", "Report type: morningBriefing/noonBriefing/afternoonFlash/eveningBriefing", HOT_TOPIC_CATEGORIES))
  .option("--with-related-securities", "Include related securities info")
  .option("--no-with-related-securities", "Exclude related securities info")
  .option("--with-close-reading", "Include close reading content")
  .option("--no-with-close-reading", "Exclude close reading content")
  .option("--format <format>", "Output format", "json")
  .option("--output <path>")
  .addOption(confirmCostly().option)
  .action((options) => emit(options, (client) => {
  return client.call("ai.hot-topic", {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    startDate: options.startDate,
    endDate: options.endDate,
    categoryList: parseChoiceList(options.category, "--category", HOT_TOPIC_CATEGORIES) ?? HOT_TOPIC_CATEGORIES,
    withRelatedSecurities: options.withRelatedSecurities !== false,
    withCloseReading: options.withCloseReading !== false,
  })
}))
query(ai, "management-discuss-announcement", {
  endpoint: "ai.management-discuss-announcement",
  fields: [
    date("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)", "reportDate", { required: true }),
    required("--security-code <code>", "Security code (e.g. 000001.SZ)", "securityCode"),
    field(new Option("--dimension <name>", "Discussion dimension: businessOperation/financialPerformance/developmentAndRisk/all").choices(["businessOperation", "financialPerformance", "developmentAndRisk", "all"]).makeOptionMandatory(), (v) => ({ discussionDimension: v })),
    format("json"), output(),
  ],
})
query(ai, "management-discuss-earnings-call", {
  endpoint: "ai.management-discuss-earnings-call",
  fields: [
    date("--report-date <date>", "Report date (yyyy-MM-dd, e.g. 2025-06-30)", "reportDate", { required: true }),
    required("--security-code <code>", "Security code (e.g. 000001.SZ)", "securityCode"),
    field(new Option("--dimension <name>", "Discussion dimension").choices(["businessOperation", "financialPerformance", "developmentAndRisk"]).makeOptionMandatory(), (v) => ({ discussionDimension: v })),
    format("json"), output(),
  ],
})
addGenerationTask("viewpoint-debate", {
  submit: "ai.viewpoint-debate.get-id",
  content: "ai.viewpoint-debate.get-content",
  label: "Viewpoint debate",
  idFailure: "Failed to get viewpoint debate ID.",
  fields: [required("--viewpoint <text>", "Viewpoint text (max 1000 chars)", "viewpoint")],
})
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

ai.command("stock-summary")
  .description("Stock highlights: refined research summary per security (A-share / HK)")
  .option("--security <code>", `Security code (e.g. 600519.SH / 00700.HK), up to ${STOCK_SUMMARY_MAX_SECURITIES} per call; market keywords are NOT supported by this endpoint`, collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => {
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
