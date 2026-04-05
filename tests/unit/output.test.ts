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
})
