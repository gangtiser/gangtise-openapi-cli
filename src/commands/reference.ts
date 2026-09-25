import { Command } from "commander"

import { value, required, choiceList, top, format, output, query } from "./shared.js"

export const reference = new Command("reference").description("Reference data APIs")

query(reference, "securities-search", {
  endpoint: "reference.securities-search",
  fields: [
    required("--keyword <text>", "Search keyword (name/code/pinyin/English)", "keyword"),
    choiceList("--category <type>", "Category: stock/dr/index/fund", "category", ["stock", "dr", "index", "fund"]),
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
