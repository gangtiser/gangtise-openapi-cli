import { Command, Option } from "commander"

import { collectList, dateArg, parseNumberOption } from "../core/args.js"
import { assertColumnarHeader, zipFieldRow } from "../core/normalize.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { withClient, field, required, flag, format, output, query } from "./shared.js"

export const alternative = new Command("alternative").description("Alternative data APIs")
query(alternative, "edb-search", {
  endpoint: "alternative.edb-search",
  fields: [
    required("--keyword <text>", "Search keyword (e.g. '空调')", "keyword"),
    field(new Option("--limit <number>", "Max results (default: 100, max: 200)").default("100"), (v: string) => ({ limit: parseNumberOption(v, "--limit", { integer: true, min: 1, max: 200 }) })),
    format(), output(),
  ],
})
alternative.command("edb-data")
  .option("--indicator-id <id>", "Indicator ID (repeat, max 10)", collectList, [])
  .requiredOption("--start-date <date>", "Start date (yyyy-MM-dd)", dateArg("--start-date"))
  .requiredOption("--end-date <date>", "End date (yyyy-MM-dd)", dateArg("--end-date"))
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(async (client) => {
  const format = parseOutputFormat(options.format)
  const raw = await client.call("alternative.edb-data", {
    indicatorIdList: options.indicatorId,
    startDate: options.startDate,
    endDate: options.endDate,
  }) as { fieldList?: string[], dataList?: unknown[][] } | null
  let data: unknown = raw
  if (raw && Array.isArray(raw.fieldList) && Array.isArray(raw.dataList)) {
    const fields = raw.fieldList as string[]
    // This flattening happens before normalizeRows ever sees the rows, so the header
    // rules (unique names) have to be applied here too — or a duplicated indicator
    // column would silently keep only its last value.
    assertColumnarHeader(fields, raw)
    const list = raw.dataList.map((row) => zipFieldRow(fields, row, raw))
    data = { list, total: list.length }
  }
  await printData(data, format, options.output)
}))
const CONCEPT_ID = "Concept (theme index) ID, e.g. 121000130 机器人; discover via 'gangtise reference concept-search'"
query(alternative, "concept-info", {
  description: "Concept profile: definition, investment logic, industry space, competitive landscape (50 credits/call)",
  endpoint: (options) => options.full ? "alternative.concept-info-full" : "alternative.concept-info",
  fields: [
    required("--concept-id <id>", CONCEPT_ID, "conceptId"),
    flag("--full", "Also return catalyst events (keyEvents) via the v1 endpoint — 500 credits/call instead of 50"),
    format("json"), output(),
  ],
})
query(alternative, "concept-securities", {
  description: "Concept constituents, grouped (50 credits/call; free when the concept has none)",
  endpoint: (options) => options.full ? "alternative.concept-securities-full" : "alternative.concept-securities",
  fields: [
    required("--concept-id <id>", CONCEPT_ID, "conceptId"),
    flag("--full", "Also return the key-stock flag (isKey) and inclusion reason via the v1 endpoint — 500 credits/call instead of 50"),
    format("json"), output(),
  ],
})
