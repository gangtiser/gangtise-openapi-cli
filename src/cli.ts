#!/usr/bin/env node
import { Command } from "commander"

import { isVersionNewer } from "./core/args.js"
import { ApiError } from "./core/errors.js"
import { isVerbose, setVerbose } from "./core/transport.js"
import { CLI_VERSION } from "./version.js"
import { ai } from "./commands/ai.js"
import { alternative } from "./commands/alternative.js"
import { auth, lookup } from "./commands/auth.js"
import { bond } from "./commands/bond.js"
import { fundamental } from "./commands/fundamental.js"
import { indicator } from "./commands/indicator.js"
import { insight } from "./commands/insight.js"
import { quote } from "./commands/quote.js"
import { raw } from "./commands/raw.js"
import { reference } from "./commands/reference.js"
import { tool } from "./commands/tool.js"
import { vault } from "./commands/vault.js"
import { decidedExitCode, markFailed } from "./core/exitStatus.js"

const program = new Command()

program
  .name("gangtise")
  .description("Gangtise OpenAPI CLI")
  .version(CLI_VERSION)
  .option("--verbose", "Print per-request timings to stderr (also: GANGTISE_VERBOSE=1)")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts().verbose) setVerbose(true)
  })

// Registration order is the order `gangtise --help` lists the groups in.
for (const group of [auth, lookup, insight, quote, fundamental, bond, reference, vault, ai, alternative, indicator, tool, raw]) {
  program.addCommand(group)
}

async function checkForUpdate(timeoutMs = 2000): Promise<void> {
  try {
    const response = await fetch("https://registry.npmjs.org/gangtise-openapi-cli/latest", { signal: AbortSignal.timeout(timeoutMs) })
    const latest = (await response.json() as { version?: string }).version
    // Ordered compare, not inequality: during the just-published window the
    // registry still serves the PREVIOUS version — don't suggest a "downgrade".
    if (latest && isVersionNewer(latest, CLI_VERSION)) {
      process.stderr.write(`Update available: ${CLI_VERSION} → ${latest}\nRun: npm update -g gangtise-openapi-cli\n`)
    }
  } catch { /* best-effort: offline or a slow registry must not break --version */ }
}

/** Last-resort reporting for anything that escapes main()'s try/catch: an error
 * thrown inside an event callback or a rejected promise nobody awaited. Node's
 * default is a multi-line crash dump on stdout/stderr AND a non-zero exit — so a
 * command whose data was already printed correctly would end up looking like a
 * hard failure, with a stack trace where a message belongs. This release is
 * about exit codes meaning what they say; that is the one path that lies.
 *
 * The stack is kept behind --verbose: reaching here at all means a CLI bug
 * rather than an API failure, and one line is not enough to locate one. */
/** Milliseconds to let already-queued stdout reach the pipe before leaving. */
const FATAL_FLUSH_MS = 200
let leaving = false

function reportFatal(error: unknown): void {
  // `error.stack` already opens with "Name: message" — printing both duplicates
  // the first line.
  const stack = error instanceof Error ? error.stack : undefined
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const text = `${isVerbose() && stack ? stack : message}\n`
  if (leaving) {
    process.stderr.write(text)
    return
  }
  leaving = true
  markFailed()
  // Terminating is not optional: a fatal error with a live handle (a timer, an
  // open socket) would otherwise keep the process running forever on `exitCode`
  // alone. But `process.exit()` on the spot truncates whatever is still queued —
  // to a pipe BOTH streams are written asynchronously — and a handler meant to
  // stop this release from lying about exit codes must not start dropping output
  // to do it. So wait for the diagnostic itself AND for anything stdout still
  // owes, each bounded by the same deadline.
  //
  // stderr is not merely "check the length": the write is issued right here, so
  // its callback is the only thing that knows when it actually reached the pipe.
  // Exiting on the spot truncated a large diagnostic to one 64 KiB buffer.
  let pending = 1
  const leave = (): void => { if (--pending === 0) process.exit(1) }
  if (process.stdout.writableLength > 0) {
    pending++
    process.stdout.once("drain", leave)
  }
  setTimeout(() => process.exit(1), FATAL_FLUSH_MS)
  process.stderr.write(text, leave)
}
process.on("uncaughtException", reportFatal)
process.on("unhandledRejection", reportFatal)

/** Teardown races on a closed stdout: the reader went away, which is not this
 * process's failure. `gangtise ... | head` is the everyday case — it truncates
 * the output, so a same-class race has no principled reason to exit 1. It must not
 * exit 0 either when the result was already judged incomplete: under `pipefail` a
 * partial export piped into `head` would otherwise report success. Without a handler
 * the final write crashes Node with an unhandled 'error' event; rethrowing from this
 * callback did the same by another route (a crash dump appended AFTER the correct
 * JSON had already been written). */
const READER_GONE = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "EBADF"])
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error?.code && READER_GONE.has(error.code)) process.exit(decidedExitCode())
  reportFatal(error)
})

async function main() {
  // Positional check, not argv.includes: "--version" appearing later (e.g. as
  // another option's value) must not short-circuit the whole command.
  const firstArg = process.argv[2]
  if (firstArg === "--version" || firstArg === "-V") {
    process.stdout.write(`${CLI_VERSION}\n`)
    await checkForUpdate()
    return
  }
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof ApiError) {
      const hint = error.hint ? ` ${error.hint}` : ""
      // traceId is what Gangtise support needs to look a failure up; without it a
      // 999999 report is unactionable on their side.
      const trace = error.traceId ? ` [trace ${error.traceId}]` : ""
      process.stderr.write(`API error${error.code ? ` (${error.code})` : ""}${trace}: ${error.message}${hint}\n`)
      markFailed()
      return
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.name}: ${error.message}\n`)
      markFailed()
      return
    }
    process.stderr.write("Unknown error\n")
    markFailed()
  }
}

void main()
