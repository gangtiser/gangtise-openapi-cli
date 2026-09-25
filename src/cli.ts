#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander"

import { unknownChoiceMessage } from "./core/args.js"
import { ApiError } from "./core/errors.js"
import { removeStagingFiles } from "./core/output.js"
import { isVerbose, setVerbose } from "./core/transport.js"
import { checkForUpdate } from "./core/updateCheck.js"
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

/** Options whose value set is the CLI's own (an output switch), so the list is complete. */
const CLI_OWN_CHOICES = new Set(["--key-by"])

/** Every other `.choices()` option mirrors an enum the server owns. Commander's refusal
 * ("Allowed choices are …") reads as if the value were wrong; swap in one that says the list
 * is what this version knows. Help keeps listing the choices — only the parser changes. */
function relabelServerChoices(command: Command): void {
  for (const option of command.options) {
    const known = option.argChoices
    // A variadic option's parser accumulates values; a plain replacement would keep only
    // the last one, so such an option keeps commander's own parser and wording.
    if (!known || option.variadic || CLI_OWN_CHOICES.has(option.long ?? "")) continue
    option.argParser((value: string) => {
      if (!known.includes(value)) throw new InvalidArgumentError(unknownChoiceMessage(known))
      return value
    })
  }
  command.commands.forEach(relabelServerChoices)
}
relabelServerChoices(program)

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

/** Ctrl-C / kill: first remove this process's own staging files — each write names its own,
 * so no later run would ever overwrite or clean them up — then die of the same signal, as Node
 * does by default (SIGHUP: the terminal closed or the ssh session dropped). Dying of it, not
 * exiting with 128 + n, is what the caller acts on: bash and sh stop a script whose foreground
 * command was killed by SIGINT, and carry on after one that exited, even with 130 — so an exit
 * here would let a loop of commands keep sending requests after Ctrl-C. `once` has already removed this listener, so the re-sent signal takes the
 * default action before `kill` returns; the exit after it runs only where that action is
 * ignored (a container's PID 1), and then leaves at once with the shell's 128 + n. */
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.once(signal, () => {
    removeStagingFiles()
    // Windows has no signal to die of (process.kill terminates with exit code 1 there, and
    // throws for SIGHUP), so it exits with the shell's number instead.
    if (process.platform !== "win32") process.kill(process.pid, signal)
    process.exit(code)
  })
}

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
    // Only for a person at a terminal: scripts and agents call --version to check an install
    // and should not wait on the registry (1–5 s measured); a terminal reuses the answer for a
    // day (updateCheck.ts). The check is bounded as a whole,
    // then the process leaves — an aborted fetch could otherwise keep a socket or a DNS lookup
    // holding it open past the fetch's own timeout.
    if (process.stdout.isTTY) {
      await Promise.race([checkForUpdate(CLI_VERSION), new Promise((resolve) => setTimeout(resolve, 2500))])
      process.exit(0)
    }
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
