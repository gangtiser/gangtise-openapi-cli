import { Command, Option } from "commander"

import { collectList, dateArg, maybeArray, parseNumberOption } from "../core/args.js"
import { ValidationError } from "../core/errors.js"
import { emit } from "./shared.js"

// ─── bond ───
// Every bond endpoint is metered (0.4 credits per call, or per row / bond / issuer on
// three of them), so the code list is checked locally before spending anything.
// They answer COLUMNAR (`{fieldList, list}` with array rows); `normalizeRows` zips
// that into objects, so nothing here needs to handle it.
export const bond = new Command("bond").description("Bond APIs: profiles, issuers, quotes, valuations, cash flows, ratings, announcements")

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
