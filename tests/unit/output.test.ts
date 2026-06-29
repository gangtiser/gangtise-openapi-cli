import { describe, expect, it } from "vitest"

import { renderOutput } from "../../src/core/output.js"

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
