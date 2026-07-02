import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** Build dist once per vitest invocation so the spawn-based CLI tests (cli.test,
 * cliBodyMapping.test) can run `node dist/src/cli.js` (~150ms/spawn) instead of
 * tsx (~1s/spawn — it used to dominate 96% of the suite's wall clock). Skipped
 * when dist is already newer than every source file, so repeat runs pay one stat
 * sweep instead of a tsc build. */
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
