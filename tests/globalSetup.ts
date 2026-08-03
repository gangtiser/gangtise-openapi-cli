import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** Build dist once per vitest invocation so the spawn-based CLI tests (cli.test,
 * cliBodyMapping.test) can run `node dist/src/cli.js` (~150ms/spawn) instead of
 * tsx (~1s/spawn — it used to dominate 96% of the suite's wall clock). Skipped
 * when dist is already newer than every source file, so repeat runs pay one stat
 * sweep instead of a tsc build.
 *
 * KNOWN LOCAL HAZARD — running `npm run build` / `npm run prepare` WHILE the
 * suite is running makes the spawn-based tests fail in a block. `prebuild` does
 * `rmSync('dist', {recursive: true})`, so for the few seconds tsc takes to
 * rewrite it, every `node dist/src/cli.js` spawn dies with
 * `Cannot find module .../dist/src/cli.js` — exit 1, nothing captured, and each
 * remaining case in that file fails the same way. Diagnosed 2026-08-03 after
 * ~6 sightings; the signature (7–27 failures, only on full runs, never on a
 * single file) had previously been misread as a product flake. Two concurrent
 * vitest invocations do it too. CI runs the suite once, serially, so it is not
 * affected. Locally: don't build while testing. */
export default async function buildCliOnce(): Promise<void> {
  const root = process.cwd()
  const out = path.join(root, "dist", "src", "cli.js")
  const srcDir = path.join(root, "src")

  const newestSrcMtime = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((newest, entry) => Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs), 0)

  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > newestSrcMtime) return

  await run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: root, timeout: 120_000 })
}
