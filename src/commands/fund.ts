import { Command } from "commander"

import { collectNames } from "../core/args.js"
import { date, format, list, output, query, requiredList, value, type Field } from "./shared.js"

// ─── fund ───
// One request per command, no paging (see the fund block in endpoints.ts). The enum
// options are not checked locally: the server rejects an unknown value with 100003 before
// billing anything (probed 2026-09-30 on all four), so a local list could only go stale.
export const fund = new Command("fund").description("Fund APIs: profiles, NAV, fees, managers, scale, holders, holdings and allocation, ETF creation/redemption")

const code = (): Field => requiredList("--security <code>", "Fund code, e.g. 005827.OF / 159967.SZ / 510300.SH (repeatable, comma-separated accepted)", "fundCodeList")
/** `what` is the date the range filters on: report dates (quarter ends) or trade dates. */
const range = (what: string): Field[] => [
  date("--start-date <date>", `${what} range start (yyyy-MM-dd); omit both ends for everything in your account's history window`, "startDate"),
  date("--end-date <date>", `${what} range end (yyyy-MM-dd)`, "endDate"),
]
const positionType = (): Field => value("--position-type <type>", "top = top holdings, disclosed every quarter (server default); all = full book, interim and annual reports only", "positionType")

query(fund, "basic-info", {
  description: "Fund profiles: category, manager, custodian, dates, subscription rules, benchmark, risk level, tracked index",
  endpoint: "fund.basic-info",
  fields: [code(), list("--field <field>", "Field to return (repeatable); omit for all. An unsupported name rejects the whole call with 100003", "fieldList"), format(), output()],
})
query(fund, "nav", {
  description: "Daily NAV: unit, accumulated and adjusted NAV, adjustment factor; money-market funds add 7-day annualized yield and income per 10k units",
  endpoint: "fund.nav",
  fields: [code(), ...range("Trade date"), format(), output()],
})
query(fund, "fee-rate", {
  description: "Current fee rates by type, one row per condition band (holding period, amount)",
  endpoint: "fund.fee-rate",
  fields: [code(), list("--fee-type <type>", "purchaseFee / redemptionFee / managementFee / custodianFee / saleFee (repeatable); omit for all", "feeTypeList"), format(), output()],
})
query(fund, "manager-info", {
  description: "Fund manager profiles by name: career, funds and assets under management, introduction",
  endpoint: "fund.manager-info",
  fields: [requiredList("--manager <name>", "Manager name, e.g. 张坤 (repeatable). Exact match; every manager with that name comes back — tell them apart by currentCompany", "managerNameList", collectNames), format(), output()],
})
query(fund, "manager-history", {
  description: "Past and present managers of a fund: tenure, days managed, return over tenure (endDate null = current)",
  endpoint: "fund.manager-history",
  fields: [code(), format(), output()],
})
query(fund, "asset-size", {
  description: "Shares at start and end of each report period, subscriptions, redemptions, net assets",
  endpoint: "fund.asset-size",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "holder-structure", {
  description: "Holder count and institutional / individual / employee holdings per report date",
  endpoint: "fund.holder-structure",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "top10-holders", {
  description: "Top 10 holders of a listed fund (LOF / ETF) per report date",
  endpoint: "fund.top10-holders",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "asset-allocation", {
  description: "Asset allocation per report date: amount and % of total assets by asset type",
  endpoint: "fund.asset-allocation",
  fields: [code(), ...range("Report date"), list("--asset-level <level>", "level1 / level2 (repeatable); omit for both", "assetLevelList"), format(), output()],
})
query(fund, "stock-portfolio", {
  description: "Stock holdings per report date: shares, value, % of float and of NAV, change vs the previous report",
  endpoint: "fund.stock-portfolio",
  fields: [code(), ...range("Report date"), positionType(), format(), output()],
})
query(fund, "industry-allocation", {
  description: "Stock holdings grouped by level-1 industry (SW or CITIC), as % of NAV",
  endpoint: "fund.industry-allocation",
  fields: [code(), ...range("Report date"), value("--industry-standard <name>", "swIndustry = SW level 1 (server default) / citicIndustry = CITIC level 1", "industryStandard"), positionType(), format(), output()],
})
query(fund, "bond-portfolio", {
  description: "Bond holdings per report date: quantity, value, % of NAV",
  endpoint: "fund.bond-portfolio",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "bond-type-allocation", {
  description: "Bond holdings grouped by bond type, as % of NAV",
  endpoint: "fund.bond-type-allocation",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "fund-portfolio", {
  description: "Fund-of-funds holdings of other funds: value and % of NAV",
  endpoint: "fund.fund-portfolio",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "fund-type-allocation", {
  description: "Fund-of-funds holdings grouped by fund category (level 1), as % of NAV",
  endpoint: "fund.fund-type-allocation",
  fields: [code(), ...range("Report date"), format(), output()],
})
query(fund, "etf-pcf-header", {
  description: "ETF creation/redemption parameters for the latest trade date: unit size, daily limits, cash components",
  endpoint: "fund.etf-pcf-header",
  fields: [code(), format(), output()],
})
query(fund, "etf-pcf-components", {
  description: "ETF creation/redemption component list for the latest trade date: quantities, weights, cash substitution",
  endpoint: "fund.etf-pcf-components",
  fields: [code(), format(), output()],
})
query(fund, "etf-share-change", {
  description: "ETF shares and scale per trade date, with the change vs the previous one",
  endpoint: "fund.etf-share-change",
  fields: [code(), ...range("Trade date"), format(), output()],
})
