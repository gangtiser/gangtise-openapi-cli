import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { renderOutput, streamOutputToFile } from "../../src/core/output.js"

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

  it("streams ≥1000 jsonl rows to disk and every line parses back", async () => {
    const target = path.join(dir, "big.jsonl")
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i, note: i === 7 ? "换行\n引号\"" : "ok" }))
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "jsonl", target)).toBe(true)
    const lines = (await fs.readFile(target, "utf8")).trimEnd().split("\n")
    expect(lines).toHaveLength(1200)
    expect(JSON.parse(lines[7])).toEqual({ id: 7, note: "换行\n引号\"" })
  })

  it("streams csv with escaping and skips non-object rows", async () => {
    const target = path.join(dir, "big.csv")
    const rows: unknown[] = Array.from({ length: 1100 }, (_, i) => ({ a: i, b: i === 3 ? "x,y" : "z" }))
    rows.push(null) // csv branch silently drops non-object rows — lock that in
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "csv", target)).toBe(true)
    const lines = (await fs.readFile(target, "utf8")).trimEnd().split("\n")
    expect(lines[0]).toBe("﻿a,b") // header carries the Excel BOM
    expect(lines).toHaveLength(1 + 1100)
    expect(lines[4]).toBe('3,"x,y"')
  })

  it("returns false below the 1000-row streaming threshold (caller falls back to join)", async () => {
    expect(await streamOutputToFile({ total: 2, list: [{ a: 1 }] }, "jsonl", path.join(dir, "small.jsonl"))).toBe(false)
  })

  it("prefixes the streamed csv with a BOM for Excel", async () => {
    const target = path.join(dir, "bom.csv")
    const rows = Array.from({ length: 1000 }, (_, i) => ({ 名称: `第${i}行` }))
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "csv", target)).toBe(true)
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

  it("renders a very large table without overflowing the call stack", () => {
    // renderTable used Math.max(...cellWidths); spreading a per-row array this big
    // overflows the stack. table is the DEFAULT format for huge results
    // (e.g. `quote day-kline --security all`), so this must not throw.
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ id: i, name: `n${i}` }))
    expect(() => renderOutput(rows, "table")).not.toThrow()
  })

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
