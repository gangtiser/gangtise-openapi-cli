import { describe, expect, it } from "vitest"

import { normalizeRows } from "../../src/core/normalize.js"

describe("normalizeRows", () => {
  it("returns plain list rows even when total metadata exists", () => {
    const result = normalizeRows({
      total: 218,
      list: [
        { reportId: "1", title: "A" },
        { reportId: "2", title: "B" },
      ],
    })

    expect(result).toEqual([
      { reportId: "1", title: "A" },
      { reportId: "2", title: "B" },
    ])
  })

  it("maps fieldList rows and drops wrapper metadata", () => {
    const result = normalizeRows({
      total: 2,
      fieldList: ["securityCode", "title"],
      list: [
        ["000001.SZ", "A"],
        ["000002.SZ", "B"],
      ],
    })

    expect(result).toEqual([
      { securityCode: "000001.SZ", title: "A" },
      { securityCode: "000002.SZ", title: "B" },
    ])
  })
})
