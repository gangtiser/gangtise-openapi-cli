import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn().mockResolvedValue(undefined) }))

// Stub the on-disk title-cache write so tests never touch ~/.config; keep the
// real extractTitles so we still exercise the title-extraction wiring.
vi.mock("../../src/core/titleCache.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/titleCache.js")>("../../src/core/titleCache.js")
  return { ...actual, writeTitleCache: writeMock }
})

const { printData } = await import("../../src/core/printer.js")
const { JsonlRowSink, attachRowSink } = await import("../../src/core/rowSink.js")

describe("printData", () => {
  // ReturnType<typeof vi.spyOn> resolves to the generic default instantiation,
  // which the overloaded stdout/stderr write spy is not assignable to (TS2322).
  let outSpy: MockInstance<typeof process.stdout.write>
  let errSpy: MockInstance<typeof process.stderr.write>
  const dir = path.join(os.tmpdir(), `gangtise-printer-test-${process.pid}`)

  beforeEach(() => {
    writeMock.mockClear()
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(async () => {
    outSpy.mockRestore()
    errSpy.mockRestore()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const stdout = () => outSpy.mock.calls.map((c) => String(c[0])).join("")
  const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("")

  it("renders a plain array to stdout", async () => {
    await printData([{ a: 1, b: 2 }], "table")
    expect(stdout()).toContain("a")
    expect(stdout()).toContain("b")
  })

  // A null payload (insight foreign-opinion --industry answers 200 + data:null) must
  // put NOTHING on stdout for the machine formats. Asserting renderOutput() === "" is
  // not enough: printData used to append "\n" unconditionally, so the pipe still got
  // one blank line — `wc -l` reported 1, which is the phantom record all over again.
  it("writes nothing at all for a null payload in machine formats", async () => {
    for (const format of ["jsonl", "csv"] as const) {
      outSpy.mockClear()
      await printData(null, format)
      expect(stdout()).toBe("")
    }
  })

  it("still prints json null and the table (empty) marker", async () => {
    await printData(null, "json")
    expect(stdout()).toBe("null\n")
    outSpy.mockClear()
    await printData(null, "table")
    expect(stdout()).toBe("(empty)\n")
  })

  it("does not swallow falsy scalars — only null/undefined mean no output", async () => {
    await printData(0, "csv")
    expect(stdout()).not.toBe("")
  })

  it("sets exit code 3 for partial results so scripts can tell them from complete ones", async () => {
    const prevExitCode = process.exitCode
    try {
      await printData({ total: 100, list: [{ id: 1 }], partial: true, failedPages: [{ from: 50, size: 50 }] }, "table")
      expect(process.exitCode).toBe(3)
    } finally {
      process.exitCode = prevExitCode
    }
  })

  it("writes csv files with a BOM so Excel decodes Chinese as UTF-8", async () => {
    const out = path.join(dir, "bom.csv")
    await printData({ total: 1, list: [{ 名称: "贵州茅台" }] }, "csv", out)
    const content = await fs.readFile(out, "utf8")
    expect(content.startsWith("\ufeff")).toBe(true)
    expect(content).toContain("贵州茅台")
  })

  it("keeps stdout csv BOM-free for pipes", async () => {
    await printData({ total: 1, list: [{ a: 1 }] }, "csv")
    expect(stdout().startsWith("\ufeff")).toBe(false)
  })

  it("leaves the exit code alone for complete results", async () => {
    const prevExitCode = process.exitCode
    try {
      await printData({ total: 2, list: [{ id: 1 }, { id: 2 }] }, "table")
      expect(process.exitCode).toBe(prevExitCode)
    } finally {
      process.exitCode = prevExitCode
    }
  })

  it("prints a Total/showing summary to stderr for paginated wrappers", async () => {
    await printData({ total: 100, list: [{ id: 1 }, { id: 2 }] }, "table")
    expect(stderr()).toContain("Total: 100, showing: 2")
  })

  it("suppresses the Total summary for json output", async () => {
    await printData({ total: 100, list: [{ id: 1 }] }, "json")
    expect(stderr()).toBe("")
  })

  it("writes to a file and echoes the path when output is set", async () => {
    const out = path.join(dir, "out.json")
    await printData({ total: 1, list: [{ id: 7 }] }, "json", out)
    expect(stdout().trim()).toBe(out)
    const parsed = JSON.parse(await fs.readFile(out, "utf8"))
    expect(parsed.list[0]).toEqual({ id: 7 })
  })

  it("writes titles to the cache when a cache config and matching items are present", async () => {
    await printData({ total: 1, list: [{ reportId: "55", title: "T" }] }, "table", undefined, {
      endpointKey: "insight.research.list",
      idField: "reportId",
    })
    expect(writeMock).toHaveBeenCalledWith("insight.research.list", { "55": "T" })
  })

  it("does not write to the cache when items carry no titles", async () => {
    await printData({ total: 1, list: [{ reportId: "55" }] }, "table", undefined, {
      endpointKey: "insight.research.list",
      idField: "reportId",
    })
    expect(writeMock).not.toHaveBeenCalled()
  })

  it("nudges toward jsonl --output for a very large non-streamed result", async () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: i }))
    await printData({ total: rows.length, list: rows }, "table")
    // Must point at --output too: jsonl only streams to a file; jsonl to stdout still
    // builds one big string, so "--format jsonl" alone wouldn't fix the memory issue.
    expect(stderr()).toContain("--format jsonl --output")
  })

  it("still nudges for jsonl WITHOUT --output (stdout jsonl builds one big string)", async () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: i }))
    await printData({ total: rows.length, list: rows }, "jsonl")
    expect(stderr()).toContain("--format jsonl --output")
  })

  it("does not nudge for jsonl WITH --output (it streams row-by-row to disk)", async () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: i }))
    await printData({ total: rows.length, list: rows }, "jsonl", path.join(dir, "big.jsonl"))
    expect(stderr()).not.toContain("in memory")
  })

  it("nudges for a huge all-scalar csv --output (streamOutputToFile declines it, so it still builds a big string)", async () => {
    // csv streaming needs object rows; an all-scalar list falls back to renderOutput,
    // which builds the whole string — the '--output' alone must NOT silence the hint.
    const rows = Array.from({ length: 50_000 }, (_, i) => `code-${i}`)
    await printData({ total: rows.length, list: rows }, "csv", path.join(dir, "scalars.csv"))
    expect(stderr()).toContain("in memory")
  })
})

describe("printData export metadata sidecar and streamed results", () => {
  const dir = path.join(os.tmpdir(), `gangtise-printer-meta-${process.pid}`)
  let outSpy: MockInstance<typeof process.stdout.write>
  let errSpy: MockInstance<typeof process.stderr.write>
  beforeEach(() => {
    writeMock.mockClear()
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })
  afterEach(async () => {
    outSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = undefined
    await fs.rm(dir, { recursive: true, force: true })
  })
  const stdout = () => outSpy.mock.calls.map((c) => String(c[0])).join("")
  const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("")
  const readMeta = async (file: string) => JSON.parse(await fs.readFile(`${file}.meta.json`, "utf8")) as Record<string, unknown> & { result: Record<string, unknown>; command: unknown }

  it("writes <output>.meta.json beside a csv export with rows, columns and every completeness marker", async () => {
    const out = path.join(dir, "rows.csv")
    await printData({ total: 2, fieldList: ["a", "b"], list: [[1, 2], [3, 4]], partial: true, failedShards: [{ startDate: "2026-08-11", endDate: "2026-08-11" }] }, "csv", out)
    const meta = await readMeta(out)
    expect(meta).toMatchObject({
      file: "rows.csv", format: "csv", rows: 2, complete: false, exitCode: 3, columns: ["a", "b"],
      result: { total: 2, partial: true, failedShards: [{ startDate: "2026-08-11", endDate: "2026-08-11" }] },
    })
    expect(meta.result.list).toBeUndefined()
    expect(Array.isArray(meta.command)).toBe(true)
    expect(meta.cliVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(typeof meta.timezone).toBe("string")
    expect(process.exitCode).toBe(3)
  })

  it("marks a clean jsonl export complete and writes no sidecar for json, table or markdown files", async () => {
    const jsonl = path.join(dir, "ok.jsonl")
    await printData({ total: 1, list: [{ a: 1 }] }, "jsonl", jsonl)
    expect(await readMeta(jsonl)).toMatchObject({ rows: 1, complete: true, exitCode: 0, result: { total: 1 } })
    for (const [format, name] of [["json", "x.json"], ["table", "x.txt"], ["markdown", "x.md"]] as const) {
      const f = path.join(dir, name)
      await printData({ total: 1, list: [{ a: 1 }] }, format, f)
      await expect(fs.access(`${f}.meta.json`)).rejects.toThrow()
    }
  })

  it("finishes a streamed result: file renamed into place, Total line and sidecar count the streamed rows, exit 3 on partial", async () => {
    const out = path.join(dir, "streamed.jsonl")
    const sink = new JsonlRowSink(out)
    sink.setFieldList(["id"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => [i]))
    expect(sink.opened).toBe(true)
    const data = attachRowSink({ total: 1200, fieldList: ["id"], list: [], partial: true, failedPages: [{ from: 1000, size: 50 }] }, sink)
    await printData(data, "jsonl", out)
    expect(stderr()).toContain("Total: 1200, showing: 1000")
    expect(process.exitCode).toBe(3)
    const lines = (await fs.readFile(out, "utf8")).split("\n").filter(Boolean)
    expect(lines).toHaveLength(1000)
    expect(JSON.parse(lines[999])).toEqual({ id: 999 })
    await expect(fs.access(`${out}.part`)).rejects.toThrow()
    expect(await readMeta(out)).toMatchObject({ rows: 1000, complete: false, exitCode: 3, columns: ["id"], result: { total: 1200, partial: true, failedPages: [{ from: 1000, size: 50 }] } })
    expect(stdout()).toBe(`${out}\n`)
  })

  it("renders a result whose sink never opened through the ordinary path, byte-identical to a plain run", async () => {
    const plain = path.join(dir, "plain.jsonl")
    await printData({ total: 2, fieldList: ["id"], list: [[1], [2]] }, "jsonl", plain)
    const buffered = path.join(dir, "buffered.jsonl")
    const sink = new JsonlRowSink(buffered)
    await sink.push([[1], [2]])
    await printData(attachRowSink({ total: 2, fieldList: ["id"], list: [] }, sink), "jsonl", buffered)
    expect(await fs.readFile(buffered, "utf8")).toBe(await fs.readFile(plain, "utf8"))
    expect(await readMeta(buffered)).toMatchObject({ rows: 2, complete: true })
    expect(stderr()).toContain("Total: 2, showing: 2")
  })

  it("merges the titles the sink saw into the download-name cache", async () => {
    const out = path.join(dir, "titles.jsonl")
    const cache = { endpointKey: "insight.research.list", idField: "reportId" }
    const sink = new JsonlRowSink(out, cache)
    sink.setFieldList(["reportId", "title"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => [`r${i}`, `T${i}`]))
    await printData(attachRowSink({ total: 1000, fieldList: ["reportId", "title"], list: [] }, sink), "jsonl", out, cache)
    expect(writeMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(writeMock.mock.calls[0][1] as Record<string, string>)).toHaveLength(1000)
  })
})
