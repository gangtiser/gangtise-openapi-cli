import { Command, Option } from "commander"

import { collectList, dateArg, screenerExpressionFields, parseNumberOption, parseScreenerIndicators } from "../core/args.js"
import { buildIndicatorCrossSectionBody, buildIndicatorScreenerBody, buildIndicatorTimeSeriesBody } from "../core/commandBodies.js"
import { checkScreenerBindings, droppedFromMatrix, flattenCrossSection, flattenTimeSeries, isEmptyMatrix, requireIndicatorMatrix, unwrapIndicatorData } from "../core/indicatorMatrix.js"
import { resolveCalendarType } from "../core/calendarType.js"
import { ValidationError } from "../core/errors.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { withClient } from "./shared.js"

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
    process.stderr.write("[gangtise] note: the query returned no data at all. A missing value comes back as a null cell and an unrecognised code or parameter name as an error (100003), so an empty answer is neither. Cross-check the codes against 'gangtise indicator search --format json' and 'gangtise reference securities-search'; if they are right, report it with the command.\n")
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

export const indicator = new Command("indicator").description("Data indicator (EDE) APIs: search codes, cross-section, time-series, screener")
indicator.command("search")
  .requiredOption("--keyword <text>", "Search keyword, e.g. '收盘价' '成交量' '营业收入' (not free-form questions)")
  .option("--limit <number>", "Max results (default: 50, max: 100)", "50")
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const raw = await client.call("indicator.search", {
    keyword: options.keyword,
    limit: parseNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 100 }),
  })
  await printData(unwrapIndicatorData(raw), format, options.output)
}))
indicator.command("cross-section")
  .option("--indicator <code>", "Indicator code, e.g. qte_close (REQUIRED, repeat for multiple)", collectList, [])
  .option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, [])
  .requiredOption("--date <date>", "Data date (yyyy-MM-dd); sent as each indicator's tradeDate. Report-period indicators (is_*, financial statements) REJECT tradeDate and require --indicator-param 'code:reportDate=yyyy-MM-dd' instead — check parameterList in 'indicator search'", dateArg("--date"))
  .option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)")
  .option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)")
  .option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustType=2 for 前复权 (repeat); read exact keys from 'indicator search'. Bare 'code:' (nothing after the colon) declares the indicator takes NO date — required by any indicator whose parameterList has no date key at all, which otherwise rejects the tradeDate --date injects: the pty_* / scr_* static-attribute families (pty_op_scope, scr_exchg_mkt, scr_isin …), plus div_cash_paid_ratio / div_cash_yr (add 'code:fiscalYear=YYYY' too) and pty_shr_reg. It composes with real params, so 'code:' + 'code:scale=8' keeps the scale", collectList, [])
  .addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode, unique & order-stable for batch code→value mapping").choices(["name", "code"]).default("name"))
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
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
indicator.command("time-series")
  .option("--indicator <code>", "Indicator code, e.g. qte_close (REQUIRED, repeat for multiple)", collectList, [])
  .option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, [])
  .requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date"))
  .requiredOption("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date"))
  .option("--calendar-type <type>", "Calendar: ND=natural TD=trading WD=weekday. Omit it and the CLI picks: a free 'indicator search' reads each parameterList and sends TD only when EVERY indicator is trading-day typed, otherwise it leaves the server on ND (report-period indicators land on dates a trading calendar lacks, and TD would answer them with an all-null grid). An explicit value is sent as given, with no lookup")
  .option("--currency <code>", "Currency: DFT/CNY/HKD/USD/EUR/GBP/JPY/TWD/MOP/AUD (default DFT)")
  .option("--scale <code>", "Scale: 0=个 3=千 4=万 6=百万 8=亿 9=十亿 (default 0)")
  .option("--indicator-param <spec>", "Per-indicator param 'code:key=value', e.g. qte_close:adjustType=2 for 前复权 (repeat); read exact keys from 'indicator search'", collectList, [])
  .addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode/securityCode, unique & order-stable for batch mapping").choices(["name", "code"]).default("name"))
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
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
indicator.command("screener")
  .description("Screen securities by an expression over indicator values (条件选股)")
  .option("--indicator <spec>", "Bind a variable to an indicator, 'F1:code', e.g. F1:qte_mkt_cptl (REQUIRED, repeat)", collectList, [])
  .option("--security <code>", "Security code, e.g. 600519.SH, or a sector ID from 'gangtise reference sector-search' (REQUIRED, repeat; union, deduped)", collectList, [])
  .requiredOption("--expression <expr>", "Filter over the bound variables, e.g. 'F1 >= 800 && (F2 >= 20 && F2 <= 30)'; also supports contains/notcontains on string indicators")
  .requiredOption("--date <date>", "Data date (yyyy-MM-dd); sent as every indicator's tradeDate unless it already has one. Report-period indicators (is_*) reject tradeDate: give them --indicator-param 'F1:reportDate=yyyy-MM-dd'", dateArg("--date"))
  .option("--indicator-param <spec>", "Per-variable param 'F1:key=value', e.g. F1:scale=8 (repeat); read exact keys from 'indicator search'. Bare 'F1:' (nothing after the colon) declares that the indicator takes NO date — required by any indicator whose parameterList has no date key at all, which otherwise rejects the tradeDate --date injects: the pty_* / scr_* static-attribute families (pty_op_scope, scr_exchg_sctr, scr_isin …), plus div_cash_paid_ratio / div_cash_yr (add 'F1:fiscalYear=YYYY' too) and pty_shr_reg. It composes with real params, so 'F1:' + 'F1:scale=8' keeps the scale", collectList, [])
  .addOption(new Option("--key-by <mode>", "Column key: name=display name (default) | code=indicatorCode").choices(["name", "code"]).default("name"))
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
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
  // An empty screen is a normal answer AND what a report-period indicator gives on a
  // date off the period end (all null, so nothing passes) or an indicator that does
  // not cover these securities. Keyed on "nothing matched"
  // rather than the strict canonical-empty shape — a response that returns zero
  // securities while still echoing `indicatorList` is just as empty to the
  // caller, and just as ambiguous, but would slip past isEmptyMatrix.
  // flattenCrossSection above already asserted this is an array of non-empty
  // strings, so only its length is left to read.
  if ((data as { securityCodeList: unknown[] }).securityCodeList.length === 0) {
    process.stderr.write("[gangtise] note: nothing matched the expression. That is a normal answer — but it is ALSO what a report-period indicator (is_* etc.) gives on a date that is not a period end (every value null, so nothing passes), or an indicator that does not cover these securities. Check the date (reportDate for report-period indicators) and the coverage (scopeList) in 'gangtise indicator search --format json'.\n")
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
