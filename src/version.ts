import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The version in the package.json that ships next to this module. Found by walking up from
 * here rather than by a fixed relative path, because the module runs from three depths:
 * `dist/src/` (installed or built), `.test-dist/<run>/src/` (the test build) and `src/`
 * (`npm run dev`). Reading it at run time means a fresh checkout builds without running
 * `prepare` first. */
function packageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const file = path.join(dir, "package.json")
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string }
      if (pkg.name === "gangtise-openapi-cli" && pkg.version) return pkg.version
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("gangtise-openapi-cli: its package.json was not found above " + fileURLToPath(import.meta.url))
    dir = parent
  }
}

export const CLI_VERSION = packageVersion()
