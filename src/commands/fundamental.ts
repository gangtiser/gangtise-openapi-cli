import { Command, Option } from "commander"

import { collectList, dateArg, localDateString, maybeArray, parseOptionalNumberOption } from "../core/args.js"
import { normalizeRows } from "../core/normalize.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { emit, withClient, flagIfLimitTruncated, field, required, date, list, format, output, query } from "./shared.js"

export const fundamental = new Command("fundamental").description("Fundamental APIs")

const addFinancialReport = (name: string, endpointKey: string, periodHelp = "Period") => query(fundamental, name, {
  endpoint: endpointKey,
  fields: [
    required("--security-code <code>", undefined, "securityCode"),
    date("--start-date <date>", "Start date (yyyy-MM-dd)", "startDate"),
    date("--end-date <date>", "End date (yyyy-MM-dd)", "endDate"),
    list("--fiscal-year <year>", "Fiscal year", "fiscalYear"),
    list("--period <period>", periodHelp, "period"),
    list("--report-type <type>", "Report type", "reportType"),
    list("--field <field>", "Field", "fieldList"),
    format(), output(),
  ],
})
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
query(fundamental, "main-business", {
  endpoint: "fundamental.main-business",
  fields: [
    required("--security-code <code>", undefined, "securityCode"),
    date("--start-date <date>", "Start date (yyyy-MM-dd)", "startDate"),
    date("--end-date <date>", "End date (yyyy-MM-dd)", "endDate"),
    field(new Option("--breakdown <type>", "Breakdown: product/industry/region").choices(["product", "industry", "region"]).default("product"), (v) => ({ breakdown: v })),
    list("--period <type>", "Period: interim/annual", "periodList"),
    list("--field <field>", "Field", "fieldList"),
    format(), output(),
  ],
})
const VALUATION_DEFAULT_LIMIT = 2000
/** The fieldList actually sent: each name once, and no `tradeDate` unless it is all that
 * was asked for. The endpoint always answers with `tradeDate` first; asking for it anyway,
 * or naming a column twice, repeats that value in every row while the echoed field list
 * names it once, and an unknown name drops its value (probed 2026-09-25, three samples
 * each). One of each cancels out — `tradeDate,value,percentileRank,foo` came back with
 * every value one column to the right and the widths equal, so the width check passed it
 * at exit 0. With nothing that can add a value, an unknown name always leaves the rows
 * short, which the width check refuses. `tradeDate` alone is kept: dropping it would ask
 * for every column, and the endpoint answers it with no rows. */
function valuationFieldsToSend(fields: string[]): string[] {
  const unique = [...new Set(fields)]
  const values = unique.filter((field) => field !== "tradeDate")
  return values.length > 0 ? values : unique
}
/** Every column but `tradeDate`. A fieldList with none of them — `tradeDate` alone, or
 * only names the endpoint does not know — is answered with an empty list, not an error
 * (probed 2026-09-25, three samples each). */
const VALUATION_VALUE_COLUMNS = ["value", "percentileRank", "average", "median", "upper1Std", "lower1Std"]
/** `tradeDate` of the first row, whatever shape the rows came in; undefined when absent
 * (e.g. --field left it out). */
function rowsIn(data: unknown): number {
  const normalized = normalizeRows(data)
  const list = Array.isArray(normalized) ? normalized : (normalized as { list?: unknown } | null)?.list
  return Array.isArray(list) ? list.length : 0
}
function firstRowTradeDate(data: unknown): string | undefined {
  const normalized = normalizeRows(data)
  const list = Array.isArray(normalized) ? normalized : (normalized as { list?: unknown } | null)?.list
  const first = Array.isArray(list) ? list[0] : undefined
  const value = first && typeof first === "object" ? (first as Record<string, unknown>).tradeDate : undefined
  return typeof value === "string" ? value : undefined
}
fundamental.command("valuation-analysis")
  .requiredOption("--security-code <code>")
  .addOption(new Option("--indicator <name>", "Indicator").choices(["peTtm", "pbMrq", "peg", "psTtm", "pcfTtm", "em"]).makeOptionMandatory())
  .option("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date"))
  .option("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date"))
  .option("--limit <number>", "Max rows (default: 2000). One row per calendar day, weekends included, and the most recent are kept — a range longer than the limit loses its START (flagged partial, exit 3)")
  .option("--field <field>", "Field", collectList, [])
  .option("--skip-null", "Drop rows where value or percentileRank is null")
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const requested = maybeArray<string>(options.field)
  // --skip-null judges `value` and `percentileRank`, so both must come back even when
  // --field asked for neither: a column that was not requested reads as `undefined` here,
  // the filter counts that as null, and EVERY row is dropped — an empty result with exit 0
  // that looks like "no data for this security". Fetch the columns the filter needs on top
  // of --field, then drop them again before output so --field still decides the columns.
  const filterFields = options.skipNull && requested ? ["value", "percentileRank"].filter((field) => !requested.includes(field)) : []
  const fieldList = requested && valuationFieldsToSend([...requested, ...filterFields])
  // Sent explicitly, so the sent limit and the truncation cap are the same number by
  // construction. Omitted, the server applies this same default and keeps the MOST RECENT
  // rows: a ten-year --start-date silently came back as its last 2000 days, exit 0
  // (probed 2026-09-24: 茅台 peTtm 2016-01-01..2026-09-24 → 2000 rows from 2021-04-04;
  // --limit 5000 → all 3920). The series has one row per calendar day, weekends included.
  const limit = parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }) ?? VALUATION_DEFAULT_LIMIT
  let data: unknown = await client.call("fundamental.valuation-analysis", { securityCode: options.securityCode, indicator: options.indicator, startDate: options.startDate, endDate: options.endDate, limit, fieldList })
  if (fieldList && !fieldList.some((field) => VALUATION_VALUE_COLUMNS.includes(field)) && rowsIn(data) === 0) {
    process.stderr.write(`[gangtise] note: no rows came back, and --field names no value column (${fieldList.join(", ")}). This endpoint answers such a request with an empty list rather than an error, so it says nothing about whether data exists: add one of ${VALUATION_VALUE_COLUMNS.join(" / ")}, or drop --field.\n`)
  }
  // The series is ascending with one row per calendar day, so its first date settles what
  // a full page cannot: a first row ON --start-date means nothing was cut (a range of
  // exactly `limit` days), and a first row AFTER it on a page that did not fill means the
  // server started late on its own — a later listing, or a range that reaches past the
  // account's history window, which this endpoint clips without an error (probed
  // 2026-09-24: 2015-01-01..2016-03-31 starts at the 2016-01-01 bound, exit 0).
  const firstDate = firstRowTradeDate(data)
  if (!(options.startDate && firstDate === options.startDate)) {
    flagIfLimitTruncated(data, limit, "fundamental valuation-analysis", "--start-date", `The API keeps the most recent rows, so it is the START of the range that is missing. The series has one row per calendar day (weekends included): raise --limit to at least the number of days in the range (e.g. --limit 4000 for ten years within your account's history window), or move --start-date later.`)
  }
  if (options.startDate && firstDate && firstDate > options.startDate && !(data as { partial?: boolean }).partial) {
    process.stderr.write(`[gangtise] note: the series starts at ${firstDate}, later than --start-date ${options.startDate}. Either the security listed later, or the range reaches past your account's history window — this endpoint returns what lies inside the window without an error.\n`)
  }
  if (options.skipNull) {
    // `expects: "list"` guarantees `{…, list}`, but normalizeRows hands back the bare row
    // array when nothing else rides along (no `indicator` echo) — filter that form too.
    const normalized = normalizeRows(data)
    const rec = (Array.isArray(normalized) ? { list: normalized } : normalized) as Record<string, unknown> | null
    if (rec && typeof rec === "object") {
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
query(fundamental, "top-holders", {
  endpoint: "fundamental.top-holders",
  fields: [
    required("--security-code <code>", undefined, "securityCode"),
    field(new Option("--holder-type <type>", "Holder type: top10/top10Float").choices(["top10", "top10Float"]).makeOptionMandatory(), (v) => ({ holderType: v })),
    date("--start-date <date>", "Start date (yyyy-MM-dd)", "startDate"),
    date("--end-date <date>", "End date (yyyy-MM-dd)", "endDate"),
    list("--fiscal-year <year>", "Fiscal year", "fiscalYear"),
    list("--period <period>", "Period: q1/interim/q3/annual/latest", "period"),
    format(), output(),
  ],
})
fundamental.command("earning-forecast")
  .requiredOption("--security-code <code>")
  .option("--start-date <date>", "Start date (default: 1 year before end-date)", dateArg("--start-date"))
  .option("--end-date <date>", "End date (default: today)", dateArg("--end-date"))
  .option("--consensus <name>", "Consensus indicator: netIncome/netIncomeYoy/eps/pe/bps/pb/peg/roe/ps", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, (client) => {
  const endDate = options.endDate ?? localDateString(new Date())
  // Anchor the default window to endDate (as the help text promises), not to today —
  // a historical --end-date without --start-date should mean "the year before it".
  const startDate = options.startDate ?? new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return client.call("fundamental.earning-forecast", { securityCode: options.securityCode, startDate, endDate, consensusList: maybeArray(options.consensus) })
}))
