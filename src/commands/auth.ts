import { Command } from "commander"

import { readTokenCache, redactTokenCache } from "../core/auth.js"
import { loadConfig } from "../core/config.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { emit } from "./shared.js"

export const auth = new Command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login")
      .option("--show-token", "Show the raw access token (default: redacted)")
      .option("--format <format>", "Output format", "json")
      .action((options) => emit(options, async (client) => {
        const result = await client.login()
        // `source` is the load-bearing field: with GANGTISE_TOKEN set, that token is
        // what every other command sends, and no login happened. Without it the output
        // reads like "logged in as X" while requests go out as someone else.
        const note = result.source === "env-token"
          ? "GANGTISE_TOKEN is set, so this is the token every command will send — no login was performed. Unset it to use GANGTISE_ACCESS_KEY / GANGTISE_SECRET_KEY instead."
          : undefined
        const base = { source: result.source, ...(note ? { note } : {}) }
        return options.showToken
          ? { ...base, authorization: result.authorization, cache: result.cache }
          : { ...base, authorization: "<redacted>", cache: redactTokenCache(result.cache) }
      })),
  )
  .addCommand(
    new Command("status")
      .option("--format <format>", "Output format", "json")
      .action(async (options) => {
        const config = loadConfig()
        const cache = await readTokenCache(config.tokenCachePath)
        await printData({ hasEnvToken: Boolean(config.token), hasCachedToken: Boolean(cache?.accessToken), cache: redactTokenCache(cache) }, parseOutputFormat(options.format))
      }),
  )

export const lookup = new Command("lookup").description("Local lookup tables (IDs not covered by 'reference constant-list')")
const addLookupList = (name: string, endpointKey: string, description?: string) => {
  const cmd = new Command(name)
  if (description) cmd.description(description)
  lookup.addCommand(cmd.addCommand(new Command("list").option("--format <format>", "Output format", "table").action((options) => emit(options, (client) => client.call(endpointKey)))))
}
addLookupList("broker-org", "lookup.broker-orgs.list")
addLookupList("meeting-org", "lookup.meeting-orgs.list")
