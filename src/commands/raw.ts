import { Command } from "commander"

import { collectKeyValue } from "../core/args.js"
import { ENDPOINTS, listEndpoints } from "../core/endpoints.js"
import { ConfigError, ValidationError } from "../core/errors.js"
import { flagFailedItems } from "../core/normalize.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { createClient, runDownload, assertConfirmed } from "./shared.js"

export const raw = new Command("raw").description("Raw API calls").addCommand(new Command("call").argument("<endpointKey>").option("--body <json>").option("--query <key=value>", "Query string pair", collectKeyValue, {}).option("--yes", "Confirm an irreversible endpoint (required for the ones marked destructive), or fetch every row of a per-row billed list past the credit guard").option("--format <format>", "Output format", "json").option("--output <path>").action(async (endpointKey, options) => {
  const endpoint = ENDPOINTS[endpointKey]
  if (!endpoint) {
    throw new ConfigError(`Unknown endpoint key: ${endpointKey}`)
  }
  // Same gate as the dedicated command. `raw call` is a passthrough for the REQUEST,
  // not a way around a guard on what the request does — and this one protects data
  // that nothing restores. Checked before the client is acquired.
  assertConfirmed(endpointKey, Boolean(options.yes), endpointKey)
  const format = parseOutputFormat(options.format)
  // --yes also confirms a costly fetch without --size on a list billed per row.
  const client = await createClient({ format, output: options.output, yes: Boolean(options.yes) })
  let body: unknown
  if (options.body) {
    try {
      body = JSON.parse(options.body)
    } catch {
      throw new ConfigError(`Invalid JSON in --body: ${options.body}`)
    }
  }
  // Fail loudly on arguments the endpoint kind can't use — they used to be
  // silently dropped, leaving the user to puzzle over server-side errors.
  if (endpoint.kind === "download") {
    // POST download endpoints (file-parse result) take their parameters as a JSON
    // body; GET ones take --query and can't carry a body at all.
    if (body !== undefined && endpoint.method !== "POST") {
      throw new ValidationError(`--body is not supported for GET download endpoints (use --query key=value); ${endpointKey} is kind=download`)
    }
    await runDownload(client, endpointKey, options.query as Record<string, string | number>, {
      output: options.output,
      fallbackName: "download.bin",
      body,
    })
    return
  }
  if (Object.keys(options.query as Record<string, string>).length > 0) {
    throw new ValidationError(`--query is not supported for JSON endpoints (use --body '{...}'); ${endpointKey} is kind=json`)
  }
  try {
    const data = await client.call(endpointKey, body)
    // Result INTERPRETATION, which this path already does elsewhere (envelope
    // unwrapping, `total`, the duplicate-column check). Leaving it out here is what
    // let the same response exit 3 through the dedicated command and 0 through here.
    if (endpoint.itemFailures) flagFailedItems(data, `raw call ${endpointKey}`)
    await printData(data, format, options.output)
  } finally {
    await client.rowSink?.abort()
  }
})).addCommand(new Command("list").description("List all registered endpoint keys (for use with 'raw call')").option("--format <format>", "Output format", "table").option("--output <path>").action((options) => printData(listEndpoints(), parseOutputFormat(options.format), options.output)))
