/** The exit codes the CLI reports, and the one place their precedence is decided.
 *
 *   0  complete, including a legitimately empty result
 *   1  failed: nothing trustworthy was produced
 *   3  incomplete: rows are missing (`partial` on the result)
 *   4  the rows are complete, but the --output file was replaced by another export
 *
 * Several modules learn about incompleteness at different moments (a malformed first
 * page, a partial marker at render time, a replaced file after the sidecar is written),
 * so the code accumulates on `process.exitCode`. A later signal never softens an
 * earlier, heavier one: 1 outranks 3, and 3 outranks 4 — 3 is the more useful diagnosis
 * when both hold, since only it says which part of the data is missing. */
export const EXIT_FAILED = 1
export const EXIT_INCOMPLETE = 3
export const EXIT_SUPERSEDED = 4

export function markFailed(): void {
  process.exitCode = EXIT_FAILED
}

export function markIncomplete(): void {
  if (process.exitCode !== EXIT_FAILED) process.exitCode = EXIT_INCOMPLETE
}

export function markSuperseded(): void {
  if (process.exitCode !== EXIT_FAILED && process.exitCode !== EXIT_INCOMPLETE) process.exitCode = EXIT_SUPERSEDED
}

/** The code decided so far, for leaving early on a path that is not itself a failure. */
export function decidedExitCode(): number {
  return Number(process.exitCode ?? 0)
}
