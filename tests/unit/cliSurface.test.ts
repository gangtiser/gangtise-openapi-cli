import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, inject, it } from "vitest"

import { ENDPOINTS } from "../../src/core/endpoints.js"

// The CLI's whole surface, pinned: the help text of every command node, and — for every
// leaf command — what one synthesized invocation sends and prints against a local stub.
//
// cliBodyMapping.test.ts checks one representative per wiring pattern with hand-written
// assertions; this file is the exhaustive, mechanical complement. It exists so that a
// structural change to how commands are declared (splitting cli.ts, generating options
// from a table) can be shown to change NOTHING a user can observe: same options, same
// help, same request bodies, same exit codes. After an intentional change to a command,
// update with `npx vitest run tests/unit/cliSurface.test.ts -u` and read the diff.
//
// Two invocations per leaf:
//   bare — no options at all (pins which options are required, and in what order they
//          are checked)
//   full — every option the help lists, each with a synthesized value (pins the
//          option → request-body mapping)
// Request bodies are compared with their keys sorted: key order is not part of the
// contract, and a refactor that builds the body in a different order changes nothing.
// The tests run concurrently, so each one snapshots through its own context's `expect` —
// the global one attributes a snapshot to whichever test happens to be current.
const run = promisify(execFile)
const CLI = inject("cliPath")

interface OptionInfo { long: string; arg?: string; choices?: string[] }
interface Node { path: string[]; help: string; options: OptionInfo[]; leaf: boolean }

const BASE_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  // A fixed zone: a few commands default a date to "today" (normalized below), and the
  // A-share announcement timestamps are anchored to Beijing time regardless.
  TZ: "Asia/Shanghai",
  GANGTISE_TOKEN: "Bearer surface-test-token",
  GANGTISE_ACCESS_KEY: "",
  GANGTISE_SECRET_KEY: "",
  // One request at a time, so the recorded request order is deterministic.
  GANGTISE_PAGE_CONCURRENCY: "1",
}

async function helpOf(pathArgs: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, [CLI, ...pathArgs, "--help"], { env: { ...BASE_ENV, GANGTISE_BASE_URL: "http://127.0.0.1:1" }, cwd: os.tmpdir(), timeout: 20_000 })
  return stdout
}

function subcommandsOf(help: string): string[] {
  const section = help.split(/\nCommands:\n/)[1]
  if (!section) return []
  return section.split("\n")
    .map((line) => /^ {2}(\S+)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name) && name !== "help")
}

function optionsOf(help: string): OptionInfo[] {
  const section = help.split(/\nOptions:\n/)[1]?.split(/\n\n/)[0] ?? ""
  const out: Array<OptionInfo & { desc: string }> = []
  for (const line of section.split("\n")) {
    const m = /^ {2}(?:-\w, )?(--[\w-]+)(?: (<[^>]+>|\[[^\]]+\]))?(?: {2,}(.*))?$/.exec(line)
    if (m) out.push({ long: m[1], arg: m[2], desc: m[3] ?? "" })
    else if (out.length > 0) out[out.length - 1].desc += ` ${line.trim()}`
  }
  return out.map(({ desc, ...option }) => {
    const choices = /\(choices: ((?:"[^"]*"(?:,\s*)?)+)/.exec(desc)
    return choices ? { ...option, choices: [...choices[1].matchAll(/"([^"]*)"/g)].map((c) => c[1]) } : option
  })
}

async function walk(pathArgs: string[]): Promise<Node[]> {
  const help = await helpOf(pathArgs)
  const children = subcommandsOf(help)
  const node: Node = { path: pathArgs, help, options: optionsOf(help), leaf: children.length === 0 }
  const below = await Promise.all(children.map((child) => walk([...pathArgs, child])))
  return [node, ...below.flat()]
}

const NODES = await walk([])
const LEAVES = NODES.filter((node) => node.leaf && node.path.length > 0)

// ─── value synthesis ───

/** Per-command substitutions where a generic value would stop at a local check before any
 * request goes out, which would pin the check instead of the mapping. Keyed "group cmd". */
const VALUE_OVERRIDES: Record<string, Record<string, string[]>> = {
  "insight summary list": { "--source": ["1"] },
  "vault my-conference-list": { "--source": ["2"] },
  "insight pamirs-summary list": { "--category": ["companyAnalysis"], "--market": ["hkStocks"] },
  "insight performance-calendar list": { "--category": ["performanceExpress"], "--market": ["hkStocks"] },
  "reference securities-search": { "--category": ["index"] },
  "reference institution-search": { "--category": ["leadInstitution"] },
  "reference official-account-search": { "--category": ["broker"] },
  "indicator screener": { "--indicator": ["F1:qte_close"], "--indicator-param": ["F1:scale=8"], "--expression": ["F1 > 0"] },
  "indicator cross-section": { "--indicator-param": ["qte_close:adjustType=2"] },
  "indicator time-series": { "--indicator-param": ["qte_close:adjustType=2"] },
  "tool web-search": { "--size": ["3"] },
}

/** Options left out of the full invocation. Mutually exclusive pairs keep the side
 * that reaches the request; `--output` would move the result off stdout. */
const OMIT: Record<string, string[]> = {
  "bond issuer-info": ["--issuer"],
  "bond issuer-rating-change": ["--issuer"],
  "bond announcement": ["--start-date", "--end-date"],
}

function synthesize(option: OptionInfo, tmp: string): string[] {
  const name = option.long.slice(2)
  if (option.choices) return [option.choices[option.choices.length - 1]]
  if (name === "file") return [path.join(tmp, "sample.pdf")]
  if (name === "date") return ["2026-06-02"]
  if (name === "report-date") return ["2025-06-30"]
  if (name.startsWith("start-") && name.endsWith("date")) return ["2026-06-01"]
  if (name.startsWith("end-") && name.endsWith("date")) return ["2026-06-03"]
  if (name.startsWith("start-") && name.endsWith("time")) return ["2026-06-01 09:30:00"]
  if (name.startsWith("end-") && name.endsWith("time")) return ["2026-06-03 15:00:00"]
  const fixed: Record<string, string> = {
    from: "2", size: "3", limit: "5", top: "3", "page-no": "1", "page-size": "5",
    security: "600519.SH", "security-code": "600519.SH", indicator: "qte_close", keyword: "kw", query: "q1",
    "fiscal-year": "2025", period: "annual", scale: "8", currency: "CNY", "calendar-type": "TD",
    "min-pages": "1", "max-pages": "9", "resource-type": "1", "answer-important": "1", permission: "1",
    "space-type": "2", "file-type": "1", "max-content-chars": "1000", site: "example.com",
    "target-folder-id": "root", "target-parent-id": "root", "parent-id": "root", "folder-id": "F1",
    viewpoint: "vp", expression: "F1 > 0", "indicator-param": "qte_close:adjustType=2",
  }
  if (name in fixed) return [fixed[name]]
  return [`${name}-v`]
}

function fullArgs(node: Node, tmp: string): string[] {
  const key = node.path.join(" ")
  const skip = new Set(["--help", "--output", "--format", ...(OMIT[key] ?? [])])
  const args: string[] = []
  for (const option of node.options) {
    if (skip.has(option.long) || option.long.startsWith("--no-")) continue
    if (!option.arg) {
      args.push(option.long)
      continue
    }
    for (const value of VALUE_OVERRIDES[key]?.[option.long] ?? synthesize(option, tmp)) args.push(option.long, value)
  }
  return node.options.some((o) => o.long === "--format") ? [...args, "--format", "json"] : args
}

// ─── stub ───

/** The one date the stub puts in its answers; like a command-line date, never normalized. */
const STUB_DATE = "2026-06-02"
const ENDPOINT_BY_PATH = new Map(Object.values(ENDPOINTS).map((endpoint) => [endpoint.path, endpoint]))
const ok = (data: unknown) => JSON.stringify({ code: "000000", msg: "ok", status: true, data })
const ede = (data: unknown) => ok({ code: "000000", status: true, data })

function respond(pathname: string, body: Record<string, unknown> | undefined, res: http.ServerResponse): void {
  const endpoint = ENDPOINT_BY_PATH.get(pathname)
  if (endpoint?.kind === "download") {
    res.setHeader("content-type", pathname.includes("file-parse") ? "application/zip" : "application/octet-stream")
    res.end(Buffer.from("BIN"))
    return
  }
  res.setHeader("content-type", "application/json")
  if (pathname.endsWith("/EDE/search")) {
    res.end(ok([{ indicatorCode: "qte_close", indicatorName: "收盘价", parameterList: [{ paramKey: "tradeDate", required: true }], scopeList: [] }]))
  } else if (pathname.endsWith("/EDE/cross-section")) {
    res.end(ede({ securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], indicatorList: [{ code: "qte_close", name: "收盘价", dataType: "double" }], values: [[1.5]] }))
  } else if (pathname.endsWith("/EDE/time-series")) {
    res.end(ede({ securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], indicatorList: [{ code: "qte_close", name: "收盘价", dataType: "double" }], dates: [STUB_DATE], values: [[1.5]] }))
  } else if (pathname.endsWith("/open-indicator/screener")) {
    res.end(ede({ securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], indicatorList: [{ field: "F1", code: "qte_close", name: "收盘价", dataType: "double" }], values: [[1.5]] }))
  } else if (endpoint?.key.endsWith(".get-content")) {
    res.end(ok({ dataId: body?.dataId, content: "generated" }))
  } else if (pathname.includes("-getid")) {
    res.end(ok({ dataId: "TASK-1" }))
  } else if (pathname.includes("/file-parse/submit")) {
    res.end(ok({ taskId: "TASK-2" }))
  } else if (pathname.includes("/drive/uploadFile")) {
    res.end(ok({ fileId: "50001", title: "t.pdf", folderId: "101", spaceType: 1, fileSize: "3" }))
  } else if (endpoint?.key.endsWith(".detail")) {
    const [idKey, ids] = Object.entries(body ?? {})[0] as [string, string[]]
    const idField = idKey.replace(/List$/, "")
    res.end(ok(ids.map((id) => ({ [idField]: id, title: "t", content: "c" }))))
  } else if (endpoint?.itemFailures) {
    res.end(ok({ successList: ["ok"], failList: [] }))
  } else {
    res.end(ok({ total: 1, list: [{ id: "1", title: "t", value: 1 }] }))
  }
}

interface Recorded { method: string; path: string; body: unknown }

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

async function withStub<T>(fn: (baseUrl: string, requests: Recorded[]) => Promise<T>): Promise<T> {
  const requests: Recorded[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => {
      const raw = Buffer.concat(chunks)
      const contentType = String(req.headers["content-type"] ?? "")
      let body: unknown
      if (contentType.includes("multipart/form-data")) body = "<multipart>"
      else if (raw.length) {
        try { body = JSON.parse(raw.toString("utf8")) } catch { body = "<unparsable>" }
      }
      const url = new URL(req.url ?? "/", "http://stub")
      requests.push({ method: req.method ?? "", path: url.pathname + url.search, body: sortKeys(body) })
      respond(url.pathname, body as Record<string, unknown> | undefined, res)
    })
  })
  server.on("clientError", (_error, socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`, requests)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// ─── normalization ───

function isoDay(offsetDays: number, local: boolean): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  if (!local) return d.toISOString().slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** Dates a command derives from "now" (a default end date, a year before it). */
const MOVING_DATES = [...new Set([0, -1, -365, -366, -367].flatMap((offset) => [isoDay(offset, true), isoDay(offset, false)]))]

/** `movingDates` excludes any date the invocation itself passed: a literal from the
 * command line is not derived from the clock, and replacing it would make the snapshot
 * depend on the day the suite runs (the synthesized 2026-06-0x fall inside the window a
 * year later). */
function normalize(text: string, tmp: string, baseUrl: string, movingDates: string[]): string {
  let out = text.split(tmp).join("<TMP>").split(baseUrl).join("<STUB>")
  for (const day of movingDates) out = out.split(day).join("<MOVING-DATE>")
  return out
}

async function invoke(args: string[]): Promise<Record<string, unknown>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-surface-"))
  await fs.writeFile(path.join(tmp, "sample.pdf"), "%PDF-1.4\n%surface\n")
  const argv = args.map((arg) => arg.replace("<TMP>", tmp))
  try {
    return await withStub(async (baseUrl, requests) => {
      let code = 0
      let stdout = ""
      let stderr = ""
      try {
        const out = await run(process.execPath, [CLI, ...argv], {
          cwd: tmp, timeout: 30_000,
          env: { ...BASE_ENV, GANGTISE_BASE_URL: baseUrl, HOME: tmp, GANGTISE_TOKEN_CACHE_PATH: path.join(tmp, "token.json") },
        })
        stdout = out.stdout
        stderr = out.stderr
      } catch (error) {
        const e = error as { code?: number; stdout?: string; stderr?: string }
        code = typeof e.code === "number" ? e.code : -1
        stdout = e.stdout ?? ""
        stderr = e.stderr ?? ""
      }
      const files = (await fs.readdir(tmp)).filter((f) => f !== "sample.pdf").sort()
      const movingDates = MOVING_DATES.filter((day) => day !== STUB_DATE && !args.some((arg) => arg.includes(day)))
      const norm = (text: string) => normalize(text, tmp, baseUrl, movingDates)
      return {
        argv: args,
        exit: code,
        requests: JSON.parse(norm(JSON.stringify(requests))),
        stdout: norm(stdout),
        stderr: norm(stderr),
        ...(files.length ? { filesWritten: files } : {}),
      }
    })
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

/** Leaf commands with no row in references/response-schema.md, and why. Everything else
 * must have one: that file is where an agent looks up a command's return shape, and a new
 * command used to ship without it unnoticed. */
const NO_RESPONSE_SCHEMA_ROW: Record<string, string> = {
  "auth login": "credentials, not data",
  "auth status": "credentials, not data",
  "raw call": "returns whatever the named endpoint returns",
  "raw list": "the endpoint registry itself",
  "ai earnings-review-check": "the async-task pattern at the top of the file",
  "ai viewpoint-debate-check": "the async-task pattern at the top of the file",
  "tool file-parse-check": "the download pattern at the top of the file",
  "ai knowledge-resource-download": "the download pattern at the top of the file",
}

/** Whether a first-column cell of response-schema.md covers a leaf command. The file
 * groups siblings in one row, in three spellings the matcher has to read:
 * `insight roadshow / site-visit / strategy / forum list`, `ai management-discuss-*`, and
 * `fundamental income-statement / cash-flow（含 quarterly / -hk / -us）`. */
function schemaRowCovers(cell: string, leaf: string): boolean {
  const words = cell.replace(/[（）()]/g, " ").split(/[\s/]+/).filter(Boolean)
  const [group, ...rest] = leaf.split(" ")
  if (words[0] !== group) return false
  return rest.every((segment) => words.includes(segment)
    || words.some((w) => w.endsWith("*") && segment.startsWith(w.slice(0, -1)))
    || words.some((base) => segment.startsWith(`${base}-`) && (words.includes(`-${segment.slice(base.length + 1)}`) || words.includes(segment.slice(base.length + 1)))))
}

describe("CLI surface", () => {
  it("every leaf command has a row in references/response-schema.md (or a stated reason not to)", async () => {
    const doc = await fs.readFile(path.resolve(process.cwd(), "gangtise-openapi/references/response-schema.md"), "utf8")
    const cells = [...doc.matchAll(/^\| ([a-z][^|]*?) \|/gm)].map((m) => m[1])
    const leaves = LEAVES.map((node) => node.path.join(" "))
    const missing = leaves.filter((leaf) => !(leaf in NO_RESPONSE_SCHEMA_ROW) && !cells.some((cell) => schemaRowCovers(cell, leaf)))
    expect(missing, "add a row for these commands to gangtise-openapi/references/response-schema.md").toEqual([])
    // The exemptions must name real commands, or a renamed one would slip through.
    expect(Object.keys(NO_RESPONSE_SCHEMA_ROW).filter((leaf) => !leaves.includes(leaf))).toEqual([])
  })

  it("has the expected shape of command tree", () => {
    expect(LEAVES.length).toBeGreaterThan(100)
    expect(NODES.map((node) => node.path.join(" ") || "<root>")).toMatchSnapshot()
  })

  describe.concurrent("help", () => {
    for (const node of NODES) {
      it(`help: gangtise ${node.path.join(" ")}`.trim(), ({ expect }) => {
        expect(node.help).toMatchSnapshot()
      })
    }
  })

  describe.concurrent("invocations", () => {
    for (const node of LEAVES) {
      const label = node.path.join(" ")
      if (label === "raw call") continue
      it(`bare: ${label}`, async ({ expect }) => {
        expect(await invoke(node.path)).toMatchSnapshot()
      }, 60_000)
      it(`full: ${label}`, async ({ expect }) => {
        expect(await invoke([...node.path, ...fullArgs(node, "<TMP>")])).toMatchSnapshot()
      }, 60_000)
    }
    const RAW: Record<string, string[]> = {
      "no endpoint": [],
      "json endpoint": ["insight.research.list", "--body", "{\"size\":2,\"keyword\":\"kw\"}"],
      "download endpoint": ["insight.research.download", "--query", "reportId=1", "--query", "fileType=1"],
      "destructive without --yes": ["vault.stock-pool.delete", "--body", "{\"poolIdList\":[\"1\"]}"],
      "destructive with --yes": ["vault.stock-pool.delete", "--body", "{\"poolIdList\":[\"1\"]}", "--yes"],
      "unknown endpoint": ["no.such.endpoint"],
    }
    for (const [label, args] of Object.entries(RAW)) {
      it(`raw call: ${label}`, async ({ expect }) => {
        expect(await invoke(["raw", "call", ...args])).toMatchSnapshot()
      }, 60_000)
    }
  })
})
