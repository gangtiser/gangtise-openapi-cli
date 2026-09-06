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
const { ExportSink, attachRowSink } = await import("../../src/core/rowSink.js")

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

  it("reports an export incomplete when exit 3 was set without a partial marker (a first page of unexpected shape)", async () => {
    const out = path.join(dir, "shape.jsonl")
    process.exitCode = 3
    await printData({ total: "12", list: [{ a: 1 }] }, "jsonl", out)
    expect(await readMeta(out)).toMatchObject({ complete: false, exitCode: 3, rows: 1 })
    expect((await readMeta(out)).result.partial).toBeUndefined()
  })

  it("stages the sidecar before publishing: when it cannot be written, the previous export and its sidecar stay untouched", async () => {
    const out = path.join(dir, "staged.jsonl")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(out, "OLD-COMPLETE-DATA\n")
    await fs.writeFile(`${out}.meta.json`, '{"complete":true,"marker":"old"}')
    await fs.mkdir(`${out}.meta.json.part`) // the staging write now fails with EISDIR
    const sink = new ExportSink(out)
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ i })))
    await expect(printData(attachRowSink({ total: 1000, list: [], partial: true }, sink), "jsonl", out)).rejects.toThrow()
    await sink.abort()
    expect(await fs.readFile(out, "utf8")).toBe("OLD-COMPLETE-DATA\n")
    expect(JSON.parse(await fs.readFile(`${out}.meta.json`, "utf8"))).toEqual({ complete: true, marker: "old" })
    await expect(fs.access(`${out}.part`)).rejects.toThrow()
    // the in-memory path behaves the same
    await expect(printData({ total: 1, list: [{ a: 1 }], partial: true }, "jsonl", out)).rejects.toThrow()
    expect(await fs.readFile(out, "utf8")).toBe("OLD-COMPLETE-DATA\n")
  })

  it("removes a stale sidecar rather than leave it beside new data when the final rename fails", async () => {
    const out = path.join(dir, "stale.jsonl")
    await fs.mkdir(`${out}.meta.json`, { recursive: true }) // rename onto a directory fails
    await expect(printData({ total: 1, list: [{ a: 1 }] }, "jsonl", out)).rejects.toThrow()
    expect(await fs.readFile(out, "utf8")).toBe('{"a":1}')
    await expect(fs.access(`${out}.meta.json.part`)).rejects.toThrow()
  })

  it("redacts credentials inside a JSON argument and tokens in the result", async () => {
    const out = path.join(dir, "login.jsonl")
    const saved = process.argv
    process.argv = [saved[0], saved[1], "raw", "call", "auth.login", "--body", '{"accessKey":"SYNTHETIC_KEY_VALUE","secretKey":"SYNTHETIC_SECRET_VALUE"}', "--format", "jsonl", "--output", out]
    try {
      await printData({ accessToken: "SYNTHETIC_TOKEN_VALUE", expiresIn: 3600 }, "jsonl", out)
    } finally {
      process.argv = saved
    }
    const text = await fs.readFile(`${out}.meta.json`, "utf8")
    for (const secret of ["SYNTHETIC_KEY_VALUE", "SYNTHETIC_SECRET_VALUE", "SYNTHETIC_TOKEN_VALUE"]) expect(text).not.toContain(secret)
    const meta = await readMeta(out)
    expect(JSON.parse((meta.command as string[])[4])).toEqual({ accessKey: "[redacted]", secretKey: "[redacted]" })
    expect(meta.result).toEqual({ accessToken: "[redacted]", expiresIn: 3600 })
    // the data file itself is untouched — redaction is a sidecar concern
    expect(await fs.readFile(out, "utf8")).toContain("SYNTHETIC_TOKEN_VALUE")
  })

  it("redacts whichever way the argument was spelled: --body=<json>, leading whitespace, leading newline", async () => {
    const body = '{"accessKey":"SYNTHETIC_KEY_VALUE","secretKey":"SYNTHETIC_SECRET_VALUE"}'
    const spellings: string[][] = [["--body", `  ${body}`], ["--body", `\n${body}`], [`--body=${body}`]]
    const saved = process.argv
    try {
      for (const [i, spelling] of spellings.entries()) {
        const out = path.join(dir, `login-${i}.jsonl`)
        process.argv = [saved[0], saved[1], "raw", "call", "auth.login", ...spelling, "--format", "jsonl", "--output", out]
        await printData({ accessToken: "SYNTHETIC_TOKEN_VALUE" }, "jsonl", out)
        const text = await fs.readFile(`${out}.meta.json`, "utf8")
        expect(text, spelling.join(" ")).not.toContain("SYNTHETIC_KEY_VALUE")
        expect(text, spelling.join(" ")).not.toContain("SYNTHETIC_SECRET_VALUE")
        expect(text).toContain("[redacted]")
      }
    } finally {
      process.argv = saved
    }
  })

  it("cleans up a sidecar fragment when the staging write itself fails part-way", async () => {
    const out = path.join(dir, "enospc.jsonl")
    await fs.mkdir(dir, { recursive: true })
    const real = fs.writeFile
    const spy = vi.spyOn(fs, "writeFile").mockImplementationOnce(async (file, data) => {
      await real(file, String(data).slice(0, 41), "utf8") // a fragment hits the disk, then the write fails
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })
    })
    try {
      await expect(printData({ total: 1, list: [{ a: 1 }] }, "jsonl", out)).rejects.toThrow("ENOSPC")
    } finally {
      spy.mockRestore()
    }
    await expect(fs.access(`${out}.meta.json.part`)).rejects.toThrow()
    await expect(fs.access(out)).rejects.toThrow() // data was never published either
  })

  it("counts a bare list the way the jsonl renderer writes it (null rows dropped when object rows exist)", async () => {
    // A result with no metadata normalises to a bare array; the renderer sends that
    // through toRows, so the file has one record and the sidecar must say one.
    const bare = path.join(dir, "bare.jsonl")
    await printData({ list: [{ id: 1 }, null] }, "jsonl", bare)
    expect((await fs.readFile(bare, "utf8")).split("\n").filter(Boolean)).toHaveLength(1)
    expect(await readMeta(bare)).toMatchObject({ rows: 1 })
    const columnar = path.join(dir, "bare-columnar.jsonl")
    await printData({ fieldList: ["id"], list: [[1], null] }, "jsonl", columnar)
    expect((await fs.readFile(columnar, "utf8")).split("\n").filter(Boolean)).toHaveLength(1)
    expect(await readMeta(columnar)).toMatchObject({ rows: 1 })
    // …and a {total, list} result keeps its null rows in both places, on both sides of the threshold
    for (const n of [999, 1000]) {
      const withTotal = path.join(dir, `with-total-${n}.jsonl`)
      const list: unknown[] = Array.from({ length: n - 1 }, (_, i) => ({ id: i }))
      list.push(null)
      await printData({ total: n, list }, "jsonl", withTotal)
      expect((await fs.readFile(withTotal, "utf8")).split("\n").filter(Boolean)).toHaveLength(n)
      expect(await readMeta(withTotal)).toMatchObject({ rows: n })
    }
  })

  it("counts the data rows the file holds, under the renderer's shaping rules", async () => {
    const single = path.join(dir, "single.jsonl")
    await printData({ summary: "one record" }, "jsonl", single)
    expect(await readMeta(single)).toMatchObject({ rows: 1 })
    const nullCsv = path.join(dir, "null-row.csv")
    await printData({ total: 2, list: [{ id: 1 }, null] }, "csv", nullCsv)
    expect(await readMeta(nullCsv)).toMatchObject({ rows: 1 }) // csv drops the null row
    const nullJsonl = path.join(dir, "null-row.jsonl")
    await printData({ total: 2, list: [{ id: 1 }, null] }, "jsonl", nullJsonl)
    expect(await readMeta(nullJsonl)).toMatchObject({ rows: 2 }) // jsonl writes every item
    const empty = path.join(dir, "empty.jsonl")
    await printData(null, "jsonl", empty)
    expect(await readMeta(empty)).toMatchObject({ rows: 0 })
    const scalars = path.join(dir, "scalars.csv")
    await printData({ total: 3, list: ["a", "b", "c"] }, "csv", scalars)
    expect(await readMeta(scalars)).toMatchObject({ rows: 3 }) // index/value pairs
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
    const sink = new ExportSink(out)
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
    const sink = new ExportSink(buffered)
    await sink.push([[1], [2]])
    await printData(attachRowSink({ total: 2, fieldList: ["id"], list: [] }, sink), "jsonl", buffered)
    expect(await fs.readFile(buffered, "utf8")).toBe(await fs.readFile(plain, "utf8"))
    expect(await readMeta(buffered)).toMatchObject({ rows: 2, complete: true })
    expect(stderr()).toContain("Total: 2, showing: 2")
  })

  it("merges the titles the sink saw into the download-name cache", async () => {
    const out = path.join(dir, "titles.jsonl")
    const cache = { endpointKey: "insight.research.list", idField: "reportId" }
    const sink = new ExportSink(out, "jsonl", cache)
    sink.setFieldList(["reportId", "title"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => [`r${i}`, `T${i}`]))
    await printData(attachRowSink({ total: 1000, fieldList: ["reportId", "title"], list: [] }, sink), "jsonl", out, cache)
    expect(writeMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(writeMock.mock.calls[0][1] as Record<string, string>)).toHaveLength(1000)
  })
})
