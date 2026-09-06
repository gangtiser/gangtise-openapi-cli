import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** Build dist from clean once per vitest invocation so the spawn-based CLI tests
 * (cli.test, cliBodyMapping.test) run `node dist/src/cli.js` (~150ms/spawn) instead of tsx
 * (~1s/spawn — it used to dominate 96% of the suite's wall clock).
 *
 * Always a clean build, never a "dist is newer than src" shortcut: that shortcut trusted
 * mtimes, and a source restored with its old mtime (cp -p), a tsconfig change, or a
 * deleted dist module all left a stale dist in place — so a mutation check could turn
 * red or green on the wrong build. The few seconds tsc takes are the price of the
 * spawn tests testing this checkout.
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
  fs.rmSync(path.join(root, "dist"), { recursive: true, force: true })
  await run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: root, timeout: 120_000 })
}
