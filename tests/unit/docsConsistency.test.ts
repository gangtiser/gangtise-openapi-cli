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

// The `no-replay` roster is stated THREE times: the registry (the truth), and a
// customer-facing sentence in each of README.md and SKILL.md that names the endpoints in
// prose and ends with "共 N 个". Prose cannot be diffed against a Set, so each document
// also carries an HTML comment listing the endpoint keys verbatim — invisible to readers,
// exact for a machine. Both halves are checked here: the key set AND the count in the
// prose, because a stale "18" next to a corrected list is the same silent drift.
//
// This matters more than the pagination list above: the sentence it guards is the one
// telling customers WHICH endpoints will not be replayed on a 5xx, and the reason is
// double-billing. A 19th endpoint added without touching the docs leaves that promise
// quietly wrong, and `endpoints.test.ts` going red over its own roster looks like the
// only thing that needed updating.
//
// The maintenance instruction lives HERE, in the assertion messages, and NOT in the
// comment blocks themselves: README.md and gangtise-openapi/ both ship in the npm package,
// so anything written there is customer-facing — internal test paths and "otherwise the
// build goes red" belong on this side of the line. The published blocks say only what
// they are.
const SYNC_HINT = "同步改动：src/core/endpoints.ts 的 retry:\"no-replay\" 集合 + README.md 与 gangtise-openapi/SKILL.md 里的 no-replay-endpoints 注释块 + 正文那句「共 N 个」"
function noReplayKeysIn(file: string): string[] {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8")
  const block = /<!--\s*no-replay-endpoints\b[\s\S]*?-->/.exec(text)
  expect(block, `${file}: no-replay-endpoints comment block not found`).toBeTruthy()
  return (block?.[0] ?? "")
    .split("\n")
    .map((line) => line.trim())
    // Endpoint keys only: skip the opening/closing comment markers and the prose lines
    // between them. Registry keys are dotted lowercase identifiers.
    .filter((line) => /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(line))
    .sort()
}

function statedCountIn(file: string): number {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8")
  const line = text.split("\n").find((l) => /不重放|不自动重放/.test(l) && /共\s*\d+\s*个/.test(l))
  expect(line, `${file}: no-replay sentence with a "共 N 个" count not found`).toBeTruthy()
  return Number(/共\s*(\d+)\s*个/.exec(line ?? "")?.[1])
}

describe("no-replay roster ↔ ENDPOINTS consistency", () => {
  const registry = Object.values(ENDPOINTS)
    .filter((ep) => ep.retry === "no-replay")
    .map((ep) => ep.key)
    .sort()

  for (const file of ["README.md", "gangtise-openapi/SKILL.md"]) {
    it(`${file} lists exactly the no-replay endpoints`, () => {
      expect(noReplayKeysIn(file), `${file} 的 no-replay 清单与注册表不一致。${SYNC_HINT}`).toEqual(registry)
    })

    it(`${file} states the right no-replay endpoint count`, () => {
      expect(statedCountIn(file), `${file} 正文的「共 N 个」与注册表不一致。${SYNC_HINT}`).toBe(registry.length)
    })
  }
})
