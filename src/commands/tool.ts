import { Command, Option } from "commander"

import { POLL_MAX_ATTEMPTS } from "../core/asyncContent.js"
import { collectList, maybeArray, parseNumberOption, parseOptionalNumberOption } from "../core/args.js"
import { ValidationError } from "../core/errors.js"
import { fetchFileParseResult, pollFileParseResult, submitFileParse } from "../core/fileParse.js"
import { markFailed } from "../core/exitStatus.js"
import { emit, withClient } from "./shared.js"

export const tool = new Command("tool").description("Research tool APIs: PDF parsing")
tool.command("file-parse").description("Parse a PDF into Markdown + images (async; 0.8 credits/page, billed at submit)")
  .requiredOption("--file <path>", "PDF to upload (max 100MB / 500 pages)")
  .option("--wait", "Wait for the parse to finish and save the result ZIP (blocking, up to ~5 min)")
  .option("--output <path>", "Where to save the result ZIP (used with --wait)")
  .action((options) => withClient(async (client) => {
    const taskId = await submitFileParse(client, options.file)
    if (!options.wait) {
      process.stderr.write(`File parse task submitted. taskId: ${taskId}\n`)
      process.stdout.write(`${JSON.stringify({ taskId, status: "pending", hint: `Run 'gangtise tool file-parse-check --task-id ${taskId}' in ~3 minutes to download the result ZIP` })}\n`)
      return
    }
    process.stderr.write(`Got taskId: ${taskId}, waiting for the parse to finish...\n`)
    if (await pollFileParseResult(client, taskId, options.output) !== "ok") {
      // Fetching the result is free and the task keeps running server-side —
      // re-checking later costs nothing, resubmitting re-bills the whole file.
      process.stderr.write(`Parse result not available after ${POLL_MAX_ATTEMPTS} attempts. Try again later with: gangtise tool file-parse-check --task-id ${taskId}\n`)
      markFailed()
    }
  }))
tool.command("file-parse-check").description("Download a finished file-parse result ZIP by taskId (free)")
  .requiredOption("--task-id <id>", "taskId from 'tool file-parse'")
  .option("--output <path>", "Where to save the result ZIP")
  .action((options) => withClient(async (client) => {
    if (await fetchFileParseResult(client, options.taskId, options.output) === "pending") {
      // 🔴 Deliberately a bare stdout write, NOT printData — do not "make this
      // consistent" with the ai *-check commands. Their --output is a render target;
      // this one is "where to save the result ZIP" (and there is no --format here at
      // all), so routing a pending JSON through it would leave a .zip that is not a
      // zip. The status line belongs on stdout precisely because --output is spoken
      // for.
      process.stdout.write(`${JSON.stringify({ taskId: options.taskId, status: "pending", hint: "Parse not finished yet, retry in ~1 minute" })}\n`)
    }
  }))

tool.command("web-search").description("Search the public web for research: deduped, source-tiered (T0-T3) results with optional page content (1 credit/call)")
  .requiredOption("--query <text>", "Search query, 1-200 chars. Sent verbatim — no intent rewriting server-side, so spell out what you want")
  .option("--size <number>", "Results to return, 1-20 (1-5 with --include-content)", "10")
  .addOption(new Option("--freshness <window>", "Time window over publishTime; results with no resolvable publish date are dropped by day/week/month").choices(["day", "week", "month", "none"]))
  .addOption(new Option("--min-tier <tier>", "Lowest source tier to keep; T3 = no filtering").choices(["T0", "T1", "T2", "T3"]))
  .option("--site <domain>", "Restrict to a registered domain or subdomain, e.g. csrc.gov.cn (repeatable, max 10, OR-ed)", collectList, [])
  .option("--include-content", "Return page body as Markdown; caps --size at 5")
  .option("--max-content-chars <number>", "Max chars per body, 1000-20000 (only with --include-content)")
  .option("--format <format>", "Output format", "table").option("--output <path>")
  .action((options) => emit(options, (client) => {
    // The size ceiling drops to 5 with bodies on. Checked here so a rejected call
    // doesn't spend the credit, and so the message names the flag that lowered the cap
    // instead of an unexplained "expected a number <= 5".
    const size = parseNumberOption(options.size, "--size", { integer: true, min: 1, max: 20 })
    if (options.includeContent && size > 5) throw new ValidationError(`--size ${size} with --include-content: this endpoint caps size at 5 when page bodies are requested. Lower --size, or drop --include-content to fetch up to 20 snippets.`)
    // Counted after de-duplication, as the server counts it.
    const sites = [...new Set(options.site as string[])]
    if (sites.length > 10) throw new ValidationError(`--site takes at most 10 distinct domains, got ${sites.length}`)
    return client.call("tool.web-search", {
      query: options.query, size, freshness: options.freshness, minTier: options.minTier,
      siteList: maybeArray(sites), includeContent: options.includeContent || undefined,
      maxContentChars: parseOptionalNumberOption(options.maxContentChars, "--max-content-chars", { integer: true, min: 1000, max: 20000 }),
    })
  }))
