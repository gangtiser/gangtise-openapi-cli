import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { stagingSiblings } from "../fixtures/staging.js"
import { countOutputRows, csvEscape, digestBuffer, renderOutput, saveOutputIfNeeded, streamOutputToFile, writeFileAtomic } from "../../src/core/output.js"

describe("streamOutputToFile error handling", () => {
  const dir = path.join(os.tmpdir(), `gangtise-output-test-${process.pid}`)

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("rejects instead of crashing the process when the target is not writable", async () => {
    // Pointing the output at an existing directory makes the write stream emit
    // 'error' (EISDIR); without a listener that used to be an uncaughtException
    // that bypassed the CLI's try/catch entirely.
    const target = path.join(dir, "as-dir")
    await fs.mkdir(target, { recursive: true })
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    await expect(streamOutputToFile({ total: rows.length, list: rows }, "jsonl", target)).rejects.toThrow()
  })

  it("preserves the old file when a streamed re-export fails mid-write", async () => {
    // Re-exporting over an existing file must not destroy it on failure: the
    // write goes to a .part sibling and only replaces the target on success.
    const target = path.join(dir, "atomic.jsonl")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(target, "OLD\n")
    const rows: Array<Record<string, unknown>> = Array.from({ length: 1100 }, (_, i) => ({ id: i }))
    rows[500].boom = 10n // JSON.stringify throws on BigInt mid-stream
    await expect(streamOutputToFile({ total: rows.length, list: rows }, "jsonl", target)).rejects.toThrow()
    expect(await fs.readFile(target, "utf8")).toBe("OLD\n")
    expect(await stagingSiblings(target)).toEqual([])
  })

  it("leaves no .part file behind after a successful streamed write", async () => {
    const target = path.join(dir, "clean.jsonl")
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "jsonl", target)).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect((await fs.readFile(target, "utf8")).trimEnd().split("\n")).toHaveLength(1000)
    expect(await stagingSiblings(target)).toEqual([])
  })

  it("saveOutputIfNeeded preserves the old file when the fresh write cannot be created", async () => {
    const lockedDir = path.join(dir, "locked")
    await fs.mkdir(lockedDir, { recursive: true })
    const target = path.join(lockedDir, "out.txt")
    await fs.writeFile(target, "OLD")
    await fs.chmod(lockedDir, 0o555) // .part creation now fails EACCES
    try {
      await expect(saveOutputIfNeeded("NEW", target)).rejects.toThrow()
      await fs.chmod(lockedDir, 0o755)
      expect(await fs.readFile(target, "utf8")).toBe("OLD")
    } finally {
      await fs.chmod(lockedDir, 0o755).catch(() => {})
    }
  })

  it("saveOutputIfNeeded replaces content on success with no .part left behind", async () => {
    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, "replace.txt")
    await fs.writeFile(target, "OLD")
    await saveOutputIfNeeded("NEW", target)
    expect(await fs.readFile(target, "utf8")).toBe("NEW")
    expect(await stagingSiblings(target)).toEqual([])
  })

  it("caps a runaway cell's display width so one huge field can't pad the whole column", () => {
    // table is the default format: without a cap, a single 50KB cell forces every
    // other row in that column to be padded to ~50K spaces (rows × width blowup).
    const rows = [{ id: 1, note: "x".repeat(50_000) }, { id: 2, note: "short" }]
    const rendered = renderOutput(rows, "table")
    const lines = rendered.split("\n")
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(200)
    expect(rendered).toContain("…")
  })

  it("keeps every table cell whole when rendering for a file", () => {
    // --format table --output: a cut cell in a file is lost data, not layout.
    const rendered = renderOutput([{ id: 1, note: "x".repeat(500) }], "table", { clampCells: false })
    expect(rendered).toContain("x".repeat(500))
    expect(rendered).not.toContain("…")
  })

  it("escapes backslashes before pipes so a literal \\| cell keeps the markdown column count", () => {
    // Escaping only "|" turns a literal `\|` into `\\|`: GFM reads that as an
    // escaped backslash followed by a BARE pipe — the row grows an extra column.
    const rendered = renderOutput([{ a: "x\\|y", b: "z" }], "markdown")
    const dataLine = rendered.split("\n")[2]
    expect(dataLine).toContain("x\\\\\\|y")
  })

  it("strips C1 control characters (single-byte CSI) from table cells", () => {
    // U+009B is a one-byte CSI: 8-bit-control terminals treat it exactly like
    // ESC[ — the C0 filter alone leaves this injection route open.
    const rendered = renderOutput([{ v: "a31mred" }], "table")
    expect(rendered).not.toContain("")
  })

  it("streams ≥1000 jsonl rows to disk and every line parses back", async () => {
    const target = path.join(dir, "big.jsonl")
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i, note: i === 7 ? "换行\n引号\"" : "ok" }))
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "jsonl", target)).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const lines = (await fs.readFile(target, "utf8")).trimEnd().split("\n")
    expect(lines).toHaveLength(1200)
    expect(JSON.parse(lines[7])).toEqual({ id: 7, note: "换行\n引号\"" })
  })

  it("streams csv with escaping and skips non-object rows", async () => {
    const target = path.join(dir, "big.csv")
    const rows: unknown[] = Array.from({ length: 1100 }, (_, i) => ({ a: i, b: i === 3 ? "x,y" : "z" }))
    rows.push(null) // csv branch silently drops non-object rows — lock that in
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "csv", target)).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const lines = (await fs.readFile(target, "utf8")).trimEnd().split("\n")
    expect(lines[0]).toBe("﻿a,b") // header carries the Excel BOM
    expect(lines).toHaveLength(1 + 1100)
    expect(lines[4]).toBe('3,"x,y"')
  })

  it("writes a small result the same way as a large one, newline-terminated, with a digest of the file's bytes", async () => {
    // One path for every size: a small file used to be joined without a final newline, so
    // two of them concatenated with `cat` ran one record into the next.
    const target = path.join(dir, "small.jsonl")
    const digest = await streamOutputToFile({ total: 2, list: [{ a: 1 }, { a: 2 }] }, "jsonl", target)
    const bytes = await fs.readFile(target)
    expect(bytes.toString("utf8")).toBe('{"a":1}\n{"a":2}\n')
    expect(digest).toEqual(digestBuffer(bytes))
  })

  it("shapes an all-scalar csv list into index/value rows, like the in-memory render", async () => {
    const target = path.join(dir, "scalars.csv")
    await streamOutputToFile({ total: 2, list: ["code-0", "code-1"] }, "csv", target)
    expect(await fs.readFile(target, "utf8")).toBe("\ufeffindex,value\n0,code-0\n1,code-1\n")
    expect(renderOutput({ total: 2, list: ["code-0", "code-1"] }, "csv")).toBe("index,value\n0,code-0\n1,code-1")
  })

  it("writes the header of a row-less csv when the columns are known, and nothing otherwise", async () => {
    const withColumns = path.join(dir, "empty-cols.csv")
    await streamOutputToFile({ total: 0, list: [] }, "csv", withColumns, ["securityCode", "tradeDate"])
    expect(await fs.readFile(withColumns, "utf8")).toBe("\ufeffsecurityCode,tradeDate\n")
    const without = path.join(dir, "empty.csv")
    await streamOutputToFile({ total: 0, list: [] }, "csv", without)
    expect(await fs.readFile(without, "utf8")).toBe("")
  })

  it("prefixes the streamed csv with a BOM for Excel", async () => {
    const target = path.join(dir, "bom.csv")
    const rows = Array.from({ length: 1000 }, (_, i) => ({ 名称: `第${i}行` }))
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "csv", target)).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const content = await fs.readFile(target, "utf8")
    expect(content.startsWith("\ufeff")).toBe(true)
  })
})

describe("row shaping and header escaping", () => {
  it("drops a stray null row instead of degrading the whole table to index/value", () => {
    const result = renderOutput({ total: 3, list: [{ a: 1 }, null, { a: 2 }] }, "csv")
    const lines = result.split("\n")
    expect(lines[0]).toBe("a")
    expect(lines).toHaveLength(3) // header + 2 object rows; the null row is skipped
  })

  // insight foreign-opinion/independent-opinion answer `--industry` with 200 + data:null.
  // That used to fall through to [{ value: null }]: jsonl emitted {"value":null} so
  // `wc -l` reported one record, and table/markdown drew a blank row that reads as data.
  it("renders a null payload as no rows at all, not one {value: null} record", () => {
    expect(renderOutput(null, "jsonl")).toBe("")
    expect(renderOutput(null, "csv")).toBe("")
    expect(renderOutput(null, "table")).not.toContain("value")
  })

  it("still renders falsy scalars as a value row (only null/undefined mean no data)", () => {
    expect(renderOutput(0, "csv").split("\n")[0]).toBe("value")
    expect(renderOutput("", "csv").split("\n")[0]).toBe("value")
  })

  it("still renders an all-scalar list as index/value pairs", () => {
    const result = renderOutput(["600519.SH", "000858.SZ"], "csv")
    expect(result.split("\n")[0]).toBe("index,value")
  })

  it("escapes csv column names containing commas", () => {
    const result = renderOutput([{ "PE(TTM,扣非)": 12.5 }], "csv")
    expect(result.split("\n")[0]).toBe('"PE(TTM,扣非)"')
  })

  it("escapes pipes in markdown column names", () => {
    const result = renderOutput([{ "a|b": 1 }], "markdown")
    expect(result.split("\n")[0]).toBe("| a\\|b |")
  })

  it("strips control chars from table cells so server data can't inject terminal escapes", () => {
    const ESC = String.fromCharCode(27)
    const result = renderOutput([{ note: `x${ESC}[31mred` }], "table")
    expect(result.includes(ESC)).toBe(false)
    expect(result).toContain("x[31mred")
  })

  it("pads table columns by display width so CJK rows align", () => {
    const result = renderOutput([{ 名称: "贵州茅台", note: "a" }, { 名称: "五粮液", note: "b" }], "table")
    const lines = result.split("\n")
    // 贵州茅台 = 8 display cols, 五粮液 = 6 + 2 pad spaces → the note column starts
    // at the same VISUAL offset; in code units the shorter CJK row has one extra char.
    expect(lines[2].indexOf("a") - lines[3].indexOf("b")).toBe(-1)
  })
})

describe("renderOutput", () => {
  it("renders field-list style rows as JSON", () => {
    const result = renderOutput(
      [
        { securityCode: "600519.SH", close: 1542.58 },
        { securityCode: "000001.SZ", close: 12.3 },
      ],
      "json",
    )

    expect(result).toContain("600519.SH")
    expect(result).toContain("1542.58")
  })

  it("renders table output", () => {
    const result = renderOutput([{ foo: "bar", value: 1 }], "table")

    expect(result).toContain("foo")
    expect(result).toContain("bar")
  })

  it("csv escapes formula-injection prefixes and quotes special chars", () => {
    const result = renderOutput([{ a: "=cmd", b: "x,y", c: 'he"llo' }], "csv")
    const lines = result.split("\n")
    expect(lines[0]).toBe("a,b,c")
    expect(lines[1]).toBe(`'=cmd,"x,y","he""llo"`)
  })

  it("does not formula-escape legitimate numbers (negative / scientific)", () => {
    const result = renderOutput([{ close: "1323", pctChange: "-3.5", flow: "-1.2e8", calc: "-1+cmd", at: "@x" }], "csv")
    const lines = result.split("\n")
    // -3.5 / -1.2e8 stay numeric (Excel/pandas can SUM); only the non-numeric
    // "-1+cmd" and "@x" still get the formula-injection prefix.
    expect(lines[1]).toBe("1323,-3.5,-1.2e8,'-1+cmd,'@x")
  })

  it("leaves number-shaped values with separators, a percent sign, or a lone sign alone", () => {
    // Real cells the old finite-number test escaped: a percent change, a thousands-separated
    // amount, a "-" placeholder. Anything with an operator or a letter past the exponent is
    // still escaped.
    for (const kept of ["-3.5%", "+5.2%", "-1,234.5", "-", "+", "-1e3"]) expect(csvEscape(kept), kept).not.toMatch(/^'/)
    for (const escaped of ["-1+cmd", "-e", "-A1", "+SUM(1)", "=1", "@x"]) expect(csvEscape(escaped), escaped).toMatch(/^'/)
  })

  it("renders a very large table without overflowing the call stack", () => {
    // renderTable used Math.max(...cellWidths); spreading a per-row array this big
    // overflows the stack. table is the DEFAULT format for huge results
    // (e.g. `quote day-kline --security all`), so this must not throw.
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ id: i, name: `n${i}` }))
    expect(() => renderOutput(rows, "table")).not.toThrow()
  }, 30_000) // what is pinned is "does not throw", not speed; the suite's spawn-heavy files share the CPU

  it("collapses newlines in table cells so multi-line fields keep alignment", () => {
    const result = renderOutput([{ brief: "line1\nline2\rline3" }], "table")
    expect(result).toContain("line1 line2 line3")
    expect(result).not.toContain("\nline2")
  })

  it("collapses newlines in markdown cells", () => {
    expect(renderOutput([{ a: "x\ny" }], "markdown")).toContain("| x y |")
  })

  it("quotes a csv field containing a carriage return", () => {
    expect(renderOutput([{ a: "x\ry" }], "csv").split("\n")[1]).toBe('"x\ry"')
  })

  describe("list wrapper { total, list }", () => {
    const wrapped = {
      total: 100,
      list: [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
      ],
    }

    it("json preserves full wrapper structure", () => {
      const result = renderOutput(wrapped, "json")
      const parsed = JSON.parse(result)
      expect(parsed.total).toBe(100)
      expect(parsed.list).toHaveLength(2)
    })

    it("jsonl outputs each list item as a line", () => {
      const result = renderOutput(wrapped, "jsonl")
      const lines = result.split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0])).toEqual({ id: "1", name: "A" })
      expect(JSON.parse(lines[1])).toEqual({ id: "2", name: "B" })
    })

    it("table renders list items as rows", () => {
      const result = renderOutput(wrapped, "table")
      expect(result).toContain("id")
      expect(result).toContain("name")
      expect(result).toContain("A")
      expect(result).toContain("B")
      expect(result).not.toContain("total")
    })

    it("csv renders list items as rows", () => {
      const result = renderOutput(wrapped, "csv")
      const lines = result.split("\n")
      expect(lines[0]).toBe("id,name")
      expect(lines).toHaveLength(3)
    })

    it("markdown renders list items as rows", () => {
      const result = renderOutput(wrapped, "markdown")
      expect(result).toContain("| id | name |")
      expect(result).toContain("| 1 | A |")
    })
  })
})

describe("renderOutput table display width", () => {
  it("counts an astral emoji as 2 columns so the divider stays aligned", () => {
    // Header "x" is width 1; the emoji cell is width 2 → the column (and its divider)
    // must be 2 wide. Counting the emoji as 1 (UTF-16/codepoint count) misaligns it.
    const [, divider] = renderOutput([{ x: "🚀" }], "table").split("\n")
    expect(divider).toBe("--")
  })
})


describe("jsonl record selection is one rule across the streaming threshold", () => {
  it("a bare array keeps object rows only, whether streamed (>= 1000) or rendered (< 1000)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-jsonl-items-"))
    try {
      const rows = (n: number) => [...Array.from({ length: n - 1 }, (_, i) => ({ id: i })), null]
      const small = renderOutput(rows(999), "jsonl").split("\n").filter(Boolean)
      expect(small).toHaveLength(998)
      const target = path.join(dir, "big.jsonl")
      expect(await streamOutputToFile(rows(1000), "jsonl", target)).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
      expect((await fs.readFile(target, "utf8")).split("\n").filter(Boolean)).toHaveLength(999)
      expect(countOutputRows(rows(1000), "jsonl")).toBe(999)
      // a {list} result keeps every item on both paths
      expect(renderOutput({ total: 2, list: [{ id: 1 }, null] }, "jsonl").split("\n")).toHaveLength(2)
      expect(countOutputRows({ total: 2, list: [{ id: 1 }, null] }, "jsonl")).toBe(2)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("writeFileAtomic", () => {
  const dir = path.join(os.tmpdir(), `gangtise-atomic-${process.pid}`)
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("leaves neither a fragment nor the old file damaged when the write fails part-way", async () => {
    // The title cache wrote its staging file outside the cleanup: a full disk left the
    // fragment behind for good.
    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, "cache.json")
    await fs.writeFile(target, "OLD")
    const realWrite = fs.writeFile
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async (file, _data, opts) => {
      await realWrite(file as string, "PARTIAL", opts as never)
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" })
    })
    await expect(writeFileAtomic(target, "NEW", { mode: 0o600, suffix: "tmp" })).rejects.toThrow("no space")
    expect(await fs.readdir(dir)).toEqual(["cache.json"])
    expect(await fs.readFile(target, "utf8")).toBe("OLD")
  })

  it("publishes the new content with the requested mode", async () => {
    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, "token.json")
    await writeFileAtomic(target, "NEW", { mode: 0o600 })
    expect(await fs.readFile(target, "utf8")).toBe("NEW")
    if (process.platform !== "win32") expect((await fs.stat(target)).mode & 0o777).toBe(0o600)
  })
})
