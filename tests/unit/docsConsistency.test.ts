import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ENDPOINTS } from "../../src/core/endpoints.js"

// The README "自动翻页" list is a hand-written copy of the ENDPOINTS registry
// state. It has drifted twice (v0.18.0 missed entries, v0.25.0 listed a
// non-paginated command) — this test turns that recurring human error into a
// build failure. Keys map to CLI command strings; the few commands whose name
// doesn't follow the `group.name.list` → "group name list" rule are special-cased.
const SPECIAL_COMMANDS: Record<string, string> = {
  "ai.security-clue.list": "ai security-clue",
  "ai.hot-topic": "ai hot-topic",
}

function commandForKey(key: string): string {
  if (SPECIAL_COMMANDS[key]) return SPECIAL_COMMANDS[key]
  const parts = key.split(".")
  // vault list commands are single hyphenated names ("vault drive-list"),
  // insight ones are `<name> list` subcommands ("insight qa list").
  if (parts.length === 3 && parts[2] === "list" && parts[0] === "vault") return `vault ${parts[1]}-list`
  if (parts.length === 3 && parts[2] === "list") return `${parts[0]} ${parts[1]} list`
  throw new Error(`No README command mapping for paginated endpoint "${key}" — add it to SPECIAL_COMMANDS`)
}

describe("README ↔ ENDPOINTS consistency", () => {
  it("自动翻页 list matches exactly the pagination-enabled endpoints", () => {
    const readme = fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf8")
    const section = readme.split("以下列表接口会自动翻页：")[1]?.split("规则：")[0]
    expect(section, "README 自动翻页 section not found").toBeTruthy()

    const documented = new Set(
      [...(section ?? "").matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]),
    )
    const paginated = new Set(
      Object.values(ENDPOINTS)
        .filter((ep) => ep.pagination?.enabled)
        .map((ep) => commandForKey(ep.key)),
    )

    const missingFromReadme = [...paginated].filter((cmd) => !documented.has(cmd))
    const extraInReadme = [...documented].filter((cmd) => !paginated.has(cmd))
    expect(missingFromReadme, "paginated endpoints missing from the README list").toEqual([])
    expect(extraInReadme, "README lists commands that do not auto-paginate").toEqual([])
  })
})
