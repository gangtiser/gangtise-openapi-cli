#!/usr/bin/env node
// K28 skill scenario eval. Drives `codex exec` (gpt-6-astra, reasoning effort high by
// default) through the scenarios in evals/scenarios.json as a DRY RUN: the agent reads the
// installed skill and answers with the commands it would run, never executing them
// (read-only sandbox, and the prompt says so). Each answer is scored against the
// scenario's regex checks across five dimensions — 命令 / 参数 / 证券 / 单位 / 完整性 — so a
// skill change can be measured before and after instead of eyeballed.
//
//   npm run skill-eval                      # all scenarios
//   npm run skill-eval -- --only S02,S09    # a subset
//   npm run skill-eval -- --model gpt-6-astra --effort high --concurrency 2
//   npm run skill-eval -- --skill-dir ~/.codex/skills/gangtise-openapi
//
// Results go to evals/results/<timestamp>.json (raw answers kept for审计) and a summary
// table to stdout. Exit 0 whenever the harness ran; the score is the deliverable.
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const MODEL = opt("model", "gpt-6-astra")
const EFFORT = opt("effort", "high")
const CONCURRENCY = Number(opt("concurrency", "2"))
const SKILL_DIR = opt("skill-dir", path.join(os.homedir(), ".codex/skills/gangtise-openapi"))
const ONLY = opt("only", "")?.split(",").filter(Boolean) ?? []
const TIMEOUT_MS = Number(opt("timeout", "420000"))
// --live: the agent may really run commands (network on, credentials inherited, the
// repo's own build of the CLI on PATH). Spend is pre-approved by the user for the run —
// the prompt says so, so the skill's "confirm high-credit operations" rule is satisfied
// up front and the agent is expected to proceed.
const LIVE = args.includes("--live")
const LOCAL_CLI = path.join(ROOT, "dist/src/cli.js")
const LOCAL_VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version

const suite = JSON.parse(readFileSync(path.join(ROOT, "evals/scenarios.json"), "utf8"))
const scenarios = suite.scenarios.filter((s) => ONLY.length === 0 || ONLY.includes(s.id))
const SCHEMA = path.join(ROOT, "evals/response.schema.json")

function buildPrompt(userText, cliPath) {
  return [
    "你是接入了 gangtise-openapi skill 的投研助手。skill 安装在 " + SKILL_DIR + "/（先完整读 SKILL.md，需要细节时再读 references/ 下对应文件）。",
    LIVE
      ? "这是一次实跑评测：请真的执行 gangtise 命令拿结果。用户已预先授权本次全部积分消耗——按 skill 规则本该先确认的高积分操作，把预估积分写进 notes 后直接执行，不要停下等确认。"
      : "这是一次干跑评测：**绝对不要执行任何 gangtise 命令**，只允许读文件。",
    LIVE
      ? "请把你实际执行过的完整命令按顺序逐条列出（含所有参数），并在 notes 里概括拿到的结果（行数、退出码、关键数值及单位、有没有 partial / missingFields 之类标记）。"
      : "请把你会依次执行的完整命令逐条列出（含所有参数）。需要先查 ID / 证券代码的，把那条查询命令也列出，后续命令里尚未知的值用 <占位符>。",
    "若按 skill 的规则应当先向用户确认（高积分、歧义、格式未定），把要确认的内容写进 notes，并仍给出确认后会执行的命令。",
    "如果 skill 说明某个字段 / 接口不适用，在 notes 里写明并给出替代口径。",
    ...(LIVE ? [
      "本次评测的 gangtise 可执行文件是 " + cliPath + "（已放在 PATH 最前；若 `which gangtise` 不是它，一律用这个绝对路径调用，不要用别处安装的版本）。先执行一次 `gangtise --version`，把输出原样写进 notes 的第一行，格式 `cli=<版本>`。",
    ] : []),
    "",
    "用户：「" + userText + "」",
    "",
    "严格按给定的 JSON schema 输出：commands（字符串数组，每条一个完整命令行）、notes（简短说明：路由理由、单位、需要确认的点）。",
  ].join("\n")
}

/** Live runs must exercise THIS checkout's CLI, not whatever `gangtise` is on the global
 * PATH (a published older version would not carry the guards under test). Prepending to
 * PATH is not enough on its own: the agent's login shell re-sources rc files that put
 * /usr/local/bin back in front, so the prompt also names the wrapper by absolute path
 * and asks for a `gangtise --version` self-check that is verified after the run. */
function installWrapper(cwd) {
  const bin = path.join(cwd, "bin")
  mkdirSync(bin, { recursive: true })
  const wrapper = path.join(bin, "gangtise")
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${LOCAL_CLI}" "$@"\n`, { mode: 0o755 })
  return { bin, wrapper }
}

function runCodex(prompt, outFile, cwd, bin) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (LIVE && bin) env.PATH = `${bin}:${env.PATH ?? ""}`
    const argv = [
      "exec", "-m", MODEL, "-c", `model_reasoning_effort="${EFFORT}"`,
      ...(LIVE ? ["--dangerously-bypass-approvals-and-sandbox", "-c", "shell_environment_policy.inherit=all"] : ["--sandbox", "read-only"]),
      "--ephemeral", "--skip-git-repo-check", "--color", "never",
      "-C", cwd, "--output-schema", SCHEMA, "-o", outFile, prompt,
    ]
    const started = Date.now()
    const child = spawn("codex", argv, { stdio: ["ignore", "pipe", "pipe"], env })
    let stderr = ""
    child.stderr.on("data", (d) => { stderr += d })
    child.stdout.on("data", () => {})
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stderr: stderr.slice(-2000), ms: Date.now() - started })
    })
  })
}

function evaluate(scenario, answer) {
  const commands = (answer?.commands ?? []).join("\n")
  const notes = answer?.notes ?? ""
  const all = `${commands}\n${notes}`
  const text = { commands, notes, all }
  return scenario.checks.map((check) => {
    const hay = text[check.where] ?? all
    let pass
    if (check.must) pass = new RegExp(check.must, "i").test(hay)
    else if (check.mustNot) pass = !new RegExp(check.mustNot, "i").test(hay)
    else if (check.before) {
      const lines = (answer?.commands ?? [])
      const idx = (re) => lines.findIndex((l) => new RegExp(re, "i").test(l))
      const a = idx(check.before[0]); const b = idx(check.before[1])
      pass = a !== -1 && b !== -1 && a < b
    } else pass = false
    return { ...check, pass }
  })
}

async function runOne(scenario) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gangtise-skill-eval-"))
  const outFile = path.join(cwd, "answer.json")
  try {
    const { bin, wrapper } = LIVE ? installWrapper(cwd) : { bin: undefined, wrapper: undefined }
    const run = await runCodex(buildPrompt(scenario.prompt, wrapper), outFile, cwd, bin)
    let answer = null; let parseError
    try { answer = JSON.parse(readFileSync(outFile, "utf8")) } catch (e) { parseError = e instanceof Error ? e.message : String(e) }
    const checks = evaluate(scenario, answer)
    // Live only: which CLI did the agent actually run? A mismatch voids the scenario's
    // evidence about this checkout, whatever the checks say.
    const cliVersion = LIVE ? (/cli=\s*v?(\d+\.\d+\.\d+)/.exec(answer?.notes ?? "")?.[1] ?? null) : undefined
    const cliMismatch = LIVE ? cliVersion !== LOCAL_VERSION : false
    return { id: scenario.id, title: scenario.title, prompt: scenario.prompt, answer, parseError, exitCode: run.code, ms: run.ms, stderr: run.stderr, checks, cliVersion, cliMismatch }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

async function pool(items, width, fn) {
  const out = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); process.stderr.write(`  ${items[i].id} done (${(out[i].ms / 1000).toFixed(0)}s, ${out[i].checks.filter((c) => c.pass).length}/${out[i].checks.length})\n`) }
  }))
  return out
}

process.stderr.write(`skill-eval: ${scenarios.length} scenarios, model=${MODEL} effort=${EFFORT} concurrency=${CONCURRENCY} mode=${LIVE ? "live" : "dry-run"}\n`)
const results = await pool(scenarios, CONCURRENCY, runOne)

const dims = ["命令", "参数", "证券", "单位", "完整性"]
const tally = Object.fromEntries(dims.map((d) => [d, { pass: 0, total: 0 }]))
for (const r of results) for (const c of r.checks) { tally[c.dim].total++; if (c.pass) tally[c.dim].pass++ }
const totalPass = results.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0)
const totalChecks = results.reduce((n, r) => n + r.checks.length, 0)

const lines = []
lines.push("| 场景 | 通过 | 未过的检查 |")
lines.push("| :-- | :-- | :-- |")
for (const r of results) {
  const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.dim}:${c.must ?? c.mustNot ?? c.before?.join("→")}`)
  lines.push(`| ${r.id} ${r.title} | ${r.checks.filter((c) => c.pass).length}/${r.checks.length}${r.parseError ? " ⚠️无法解析回复" : ""}${r.cliMismatch ? ` ⚠️跑的不是本仓 CLI（cli=${r.cliVersion ?? "未报告"}）` : ""} | ${failed.join("；") || "—"} |`)
}
lines.push("")
lines.push("| 维度 | 通过率 |")
lines.push("| :-- | :-- |")
for (const d of dims) if (tally[d].total) lines.push(`| ${d} | ${tally[d].pass}/${tally[d].total} |`)
lines.push(`| **合计** | **${totalPass}/${totalChecks}（${(100 * totalPass / totalChecks).toFixed(0)}%）** |`)
const table = lines.join("\n")
process.stdout.write(`${table}\n`)

mkdirSync(path.join(ROOT, "evals/results"), { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const file = path.join(ROOT, "evals/results", `${stamp}.json`)
writeFileSync(file, `${JSON.stringify({ model: MODEL, effort: EFFORT, mode: LIVE ? "live" : "dry-run", skillDir: SKILL_DIR, ranAt: stamp, summary: { totalPass, totalChecks, tally }, results }, null, 2)}\n`)
process.stderr.write(`results: ${path.relative(ROOT, file)}\n`)
