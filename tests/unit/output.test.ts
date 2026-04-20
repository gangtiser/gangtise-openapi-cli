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
