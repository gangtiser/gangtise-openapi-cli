import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type { Command } from "commander"
import { describe, expect, inject, it } from "vitest"

import { ai } from "../../src/commands/ai.js"
import { alternative } from "../../src/commands/alternative.js"
import { auth, lookup } from "../../src/commands/auth.js"
import { bond } from "../../src/commands/bond.js"
import { fundamental } from "../../src/commands/fundamental.js"
import { indicator } from "../../src/commands/indicator.js"
import { insight } from "../../src/commands/insight.js"
import { quote } from "../../src/commands/quote.js"
import { raw } from "../../src/commands/raw.js"
import { reference } from "../../src/commands/reference.js"
import { tool } from "../../src/commands/tool.js"
import { vault } from "../../src/commands/vault.js"
import { multiChoiceValues } from "../../src/commands/shared.js"
import { ENDPOINTS } from "../../src/core/endpoints.js"
import { commandForKey } from "../fixtures/commandForKey.js"

// Every `gangtise <group> <command> … --option` written in the shipped docs (README and the
// agent skill) names an option that command really has. An agent copies these snippets as
// they stand, so a renamed or removed option in a doc is a command that fails for everyone
// who follows it — and nothing else notices, because the docs are not executed.
//
// A snippet runs from the command name to the next separator (pipe, `;`, `&&`, a backtick,
// another `gangtise`, a comment `#`, or Chinese punctuation that starts prose), so options
// named in the surrounding explanation are not attributed to the command.

const run = promisify(execFile)
const CLI = inject("cliPath")
const ROOT = process.cwd()

async function helpOf(pathArgs: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, [CLI, ...pathArgs, "--help"], {
    env: { PATH: process.env.PATH, GANGTISE_TOKEN: "Bearer docs-options-test", GANGTISE_BASE_URL: "http://127.0.0.1:1" },
    cwd: os.tmpdir(),
    timeout: 20_000,
  })
  return stdout
}

function subcommandsOf(help: string): string[] {
  const section = help.split(/\nCommands:\n/)[1]
  if (!section) return []
  return section.split("\n")
    .map((line) => /^ {2}(\S+)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name) && name !== "help")
}

async function leafOptions(): Promise<Map<string, Set<string>>> {
  const leaves = new Map<string, Set<string>>()
  const walk = async (pathArgs: string[]): Promise<void> => {
    const help = await helpOf(pathArgs)
    const children = subcommandsOf(help)
    if (children.length === 0) {
      const options = new Set([...help.matchAll(/^ {2}(?:-\w, )?(--[a-z0-9-]+)/gm)].map((m) => m[1]))
      options.add("--help")
      leaves.set(pathArgs.join(" "), options)
      return
    }
    await Promise.all(children.map((child) => walk([...pathArgs, child])))
  }
  await walk([])
  return leaves
}

function docFiles(): string[] {
  const out = [path.join(ROOT, "README.md")]
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".md")) out.push(full)
    }
  }
  walk(path.join(ROOT, "gangtise-openapi"))
  return out
}

/** Doc lines with shell continuations (`\` at the end) folded into one. */
function logicalLines(text: string): Array<{ line: number; text: string }> {
  const raw = text.split("\n")
  const out: Array<{ line: number; text: string }> = []
  for (let i = 0; i < raw.length; i++) {
    const start = i
    let joined = raw[i]
    while (joined.trimEnd().endsWith("\\") && i + 1 < raw.length) {
      i++
      joined = `${joined.trimEnd().slice(0, -1)} ${raw[i]}`
    }
    out.push({ line: start + 1, text: joined })
  }
  return out
}

/** Each documented command snippet: the command it calls and the text of its arguments. */
function snippetsIn(leaves: Set<string>): Array<{ where: string; command: string; segment: string }> {
  const groups = [...new Set([...leaves].map((key) => key.split(" ")[0]))]
  const mention = new RegExp(`(?:gangtise\\s+)?\\b(${groups.join("|")})\\s+([a-z0-9-]+)(?:\\s+([a-z0-9-]+))?`, "g")
  const out: Array<{ where: string; command: string; segment: string }> = []
  for (const file of docFiles()) {
    for (const { line, text } of logicalLines(fs.readFileSync(file, "utf8"))) {
      for (const m of text.matchAll(mention)) {
        const [, group, a, b] = m
        const command = b && leaves.has(`${group} ${a} ${b}`) ? `${group} ${a} ${b}` : leaves.has(`${group} ${a}`) ? `${group} ${a}` : undefined
        if (!command) continue
        const rest = text.slice((m.index ?? 0) + m[0].length)
        out.push({ where: `${path.relative(ROOT, file)}:${line}`, command, segment: rest.split(/\||;|&&|`|\bgangtise\b|\s#|（|，|。|→/)[0] })
      }
    }
  }
  return out
}

/** For every leaf command, the options that take values from a fixed set, with that set and
 * whether one occurrence may carry several comma-separated values. */
function choicesByCommand(): Map<string, Map<string, { known: readonly string[]; several: boolean }>> {
  const out = new Map<string, Map<string, { known: readonly string[]; several: boolean }>>()
  const walk = (command: Command, prefix: string[]): void => {
    const name = [...prefix, command.name()]
    if (command.commands.length === 0) {
      const options = new Map<string, { known: readonly string[]; several: boolean }>()
      for (const option of command.options) {
        if (!option.long) continue
        if (option.argChoices) options.set(option.long, { known: option.argChoices, several: false })
        const several = multiChoiceValues.get(option)
        if (several) options.set(option.long, { known: several, several: true })
      }
      out.set(name.join(" "), options)
    }
    for (const child of command.commands) walk(child, name)
  }
  for (const group of [auth, lookup, insight, quote, fundamental, bond, reference, vault, ai, alternative, indicator, tool, raw]) walk(group, [])
  return out
}

describe("options named in the shipped docs", () => {
  it("exist on the command each snippet calls", async () => {
    const leaves = await leafOptions()
    const snippets = snippetsIn(new Set(leaves.keys()))
    const problems: string[] = []
    for (const { where, command, segment } of snippets) {
      for (const [, option] of segment.matchAll(/(?<![\w-])(--[a-z0-9-]+)/g)) {
        if (!leaves.get(command)?.has(option)) problems.push(`${where} [${command}] ${option}`)
      }
    }
    // Guards the guard: a parser that stops matching anything would pass vacuously.
    expect(snippets.length).toBeGreaterThan(200)
    expect(problems, "文档里写的选项在该命令的 --help 里不存在（改名、删除或写错）").toEqual([])
  }, 120_000)

  it("put --yes on exactly the per-row billed lists, the destructive commands and raw call, and document it", async () => {
    // The credit guard tells the caller to add --yes; a list that lacks the option turns
    // that advice into an unknown-option error. A stray --yes elsewhere confirms nothing.
    const leaves = await leafOptions()
    const billedLists = Object.values(ENDPOINTS).filter((ep) => ep.pagination?.enabled && ep.billing?.per === "row").map((ep) => commandForKey(ep.key))
    const destructive = Object.values(ENDPOINTS).filter((ep) => ep.destructive).map((ep) => { const [group, name, action] = ep.key.split("."); return `${group} ${name}-${action}` })
    const expected = new Set([...billedLists, ...destructive, "raw call"])
    const actual = new Set([...leaves].filter(([, options]) => options.has("--yes")).map(([command]) => command))
    expect([...actual].sort()).toEqual([...expected].sort())
    // Each group whose lists carry the credit guard says so in its command reference.
    for (const group of new Set(billedLists.map((command) => command.split(" ")[0]))) {
      const doc = fs.readFileSync(path.join(ROOT, "gangtise-openapi", "references", "commands", `${group}.md`), "utf8")
      expect(doc, `references/commands/${group}.md 应说明按条计费列表的 --yes`).toContain("--yes")
    }
  }, 120_000)

  it("give an enum option a value the command accepts", () => {
    // The CLI refuses an enum value it does not know before sending anything, so a doc that
    // shows a value outside the list is a command that fails for whoever copies it.
    const choices = choicesByCommand()
    const problems: string[] = []
    let checked = 0
    let checkedSeveral = 0
    for (const { where, command, segment } of snippetsIn(new Set(choices.keys()))) {
      for (const [, option, value] of segment.matchAll(/(?<![\w-])(--[a-z0-9-]+)[ =]+"?([^\s"<>$|\/]+)/g)) {
        const spec = choices.get(command)?.get(option)
        if (!spec || value.startsWith("-")) continue
        checked++
        if (spec.several) checkedSeveral++
        for (const one of spec.several ? value.split(/[,，]/).filter(Boolean) : [value]) {
          if (!spec.known.includes(one)) problems.push(`${where} [${command}] ${option} ${one}（可选：${spec.known.join(" / ")}）`)
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
    // Guards the guard: the repeatable enums are registered through multiChoice, and a
    // registration that stopped reaching commander would check none of them.
    expect(checkedSeveral).toBeGreaterThan(0)
    expect(problems, "文档示例里的枚举取值不在该选项的可选值里").toEqual([])
  })
})
