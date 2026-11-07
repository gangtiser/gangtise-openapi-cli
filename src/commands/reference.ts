import { Command } from "commander"

import { value, required, requiredList, date, choiceList, top, format, output, query } from "./shared.js"

export const reference = new Command("reference").description("Reference data APIs")

query(reference, "securities-search", {
  endpoint: "reference.securities-search",
  fields: [
    required("--keyword <text>", "Search keyword (name/code/pinyin/English)", "keyword"),
    choiceList("--category <type>", "Category: stock/dr/index/fund/bond. Convertible bonds can come back under any category — keep the rows whose returned category matches", "category", ["stock", "dr", "index", "fund", "bond"]),
    top(10),
    format(), output(),
  ],
})
query(reference, "constant-category", {
  description: "List constant categories and which API params accept them",
  endpoint: "reference.constant-category",
  fields: [format(), output()],
})
query(reference, "constant-list", {
  endpoint: "reference.constant-list",
  fields: [
    required("--category <code>", "Category code from 'reference constant-category' (e.g. citicIndustry/swIndustry/regionCategory)", "category"),
    format(), output(),
  ],
})
query(reference, "concept-search", {
  endpoint: "reference.concept-search",
  fields: [required("--keyword <text>", "Search keyword (name/pinyin/group name)", "keyword"), top(10), format(), output()],
})
query(reference, "sector-search", {
  endpoint: "reference.sector-search",
  fields: [value("--keyword <text>", "Search keyword (name/pinyin)", "keyword"), top(10), format(), output()],
})
query(reference, "sector-constituents", {
  endpoint: "reference.sector-constituents",
  fields: [required("--sector-id <id>", "Sector ID from 'reference sector-search'", "sectorId"), format(), output()],
})
/** Says on stderr which requested indices came back without a row. The endpoint answers an
 * unknown code, a non-trading day and a date it holds no weights for alike — an empty list,
 * no error — and in the dates sampled it held weights for month-end trading days only
 * (probed 2026-11-07), so an empty answer otherwise reads as "this index has no constituents". */
function noteMissingIndices(data: unknown, requested: string[], tradeDate: string): void {
  const rows = (data as { list?: unknown } | null)?.list
  if (!Array.isArray(rows)) return
  // The server reads a code case-insensitively and answers it upper-case (000300.sh → 000300.SH).
  const found = new Set(rows.map((row) => String((row as { indexCode?: unknown } | null)?.indexCode).toUpperCase()))
  const missing = requested.filter((code) => !found.has(code.toUpperCase()))
  if (!missing.length) return
  process.stderr.write(`[gangtise] note: no constituent weights for ${missing.join(", ")} on ${tradeDate}. Weights come for the last trading day of each month — another date, like an unknown index code, comes back empty without an error. Check the date, and the code with 'reference securities-search --category index'.\n`)
}
query(reference, "index-weight", {
  description: "Index constituents and their weights (%) on the last trading day of a month (free)",
  endpoint: "reference.index-weight",
  fields: [
    requiredList("--index <code>", "Index code, e.g. 000300.SH / 000905.SH / 399006.SZ (repeat or comma-separate)", "indexCodeList"),
    date("--date <date>", "Trading date (yyyy-MM-dd): the last trading day of a month, e.g. 2026-10-30; any other date returns no rows", "tradeDate", { required: true }),
    format(), output(),
  ],
  shape: async (data, _client, options) => {
    noteMissingIndices(data, options.index as string[], options.date as string)
    return data
  },
})
query(reference, "chiefs-search", {
  endpoint: "reference.chiefs-search",
  fields: [required("--keyword <text>", "Search keyword (chief name / institution / team)", "keyword"), top(10), format(), output()],
})
query(reference, "institution-search", {
  endpoint: "reference.institution-search",
  fields: [
    required("--keyword <text>", "Search keyword (institution name / abbreviation)", "keyword"),
    choiceList("--category <name>", "Category: domesticBroker/foreignInstitution/leadInstitution/opinionInstitution/foreignOpinionInstitution (repeat); omit for all", "categoryList", ["domesticBroker", "foreignInstitution", "leadInstitution", "opinionInstitution", "foreignOpinionInstitution"]),
    top(10),
    format(), output(),
  ],
})
// Note: request key is BARE `category` here (spec), unlike institution-search's `categoryList`.
query(reference, "official-account-search", {
  endpoint: "reference.official-account-search",
  fields: [
    required("--keyword <text>", "Search keyword (account name / institution / keyword, e.g. 东吴证券)", "keyword"),
    choiceList("--category <name>", "Category: listedCompany/broker/government/media (repeat); omit for all incl. uncategorized", "category", ["listedCompany", "broker", "government", "media"]),
    top(10),
    format(), output(),
  ],
})
