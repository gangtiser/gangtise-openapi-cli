import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import type { TestProject } from "vitest/node"

const run = promisify(execFile)

declare module "vitest" {
  export interface ProvidedContext {
    /** Absolute path of the CLI entry compiled for THIS vitest invocation. */
    cliPath: string
  }
}

/** Where each run compiles to. Inside the repo on purpose: the compiled CLI imports
 * `commander` / `undici`, and Node only finds them by walking up to this repo's
 * node_modules — an OS temp dir has none. */
const BUILD_ROOT = ".test-dist"

/** Build the CLI from clean once per vitest invocation, into a directory of its own, so
 * the spawn-based tests (cli.test, cliBodyMapping.test) run `node <build>/src/cli.js`
 * (~150ms/spawn) instead of tsx (~1s/spawn).
 *
 * Always a clean build, never a "build is newer than src" shortcut: that shortcut trusted
 * mtimes, and a source restored with its old mtime (cp -p), a tsconfig change, or a
 * deleted module all left a stale build in place — so a mutation check could turn red or
 * green on the wrong build.
 *
 * A directory per run, not the shared `dist/`: two concurrent invocations (two sessions,
 * or `npm run build` during a run) used to wipe each other's build mid-suite, which showed
 * up as a block of `Cannot find module .../cli.js` failures in exactly these two files —
 * indistinguishable at a glance from a regression. */
export default async function buildCliOnce(project: TestProject): Promise<() => void> {
  const root = process.cwd()
  const buildRoot = path.join(root, BUILD_ROOT)
  sweepStale(buildRoot)

  const outDir = path.join(buildRoot, `${process.pid}-${randomBytes(4).toString("hex")}`)
  fs.mkdirSync(outDir, { recursive: true })
  try {
    await run("npx", ["tsc", "-p", "tsconfig.json", "--outDir", outDir], { cwd: root, timeout: 120_000 })
  } catch (error) {
    // No teardown runs when setup throws, so a failed compile would otherwise stay behind.
    fs.rmSync(outDir, { recursive: true, force: true })
    throw error
  }
  project.provide("cliPath", path.join(outDir, "src", "cli.js"))

  return () => fs.rmSync(outDir, { recursive: true, force: true })
}

/** Removes the build dirs whose owning vitest process is gone — a run killed with Ctrl-C
 * never reaches its teardown. Keyed on the pid in the dir name rather than on age, so a
 * long-lived run (watch mode) is never swept from under itself. */
function sweepStale(buildRoot: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(buildRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const pid = Number(/^(\d+)-/.exec(entry.name)?.[1])
    if (!entry.isDirectory() || !pid || isAlive(pid)) continue
    fs.rmSync(path.join(buildRoot, entry.name), { recursive: true, force: true })
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
