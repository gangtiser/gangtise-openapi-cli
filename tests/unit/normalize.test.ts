import { describe, expect, it } from "vitest"

import { normalizeRows } from "../../src/core/normalize.js"

describe("normalizeRows", () => {
  it("preserves total metadata with plain list rows", () => {
    const result = normalizeRows({
      total: 218,
      list: [
        { reportId: "1", title: "A" },
        { reportId: "2", title: "B" },
      ],
    })

    expect(result).toEqual({
      total: 218,
      list: [
        { reportId: "1", title: "A" },
        { reportId: "2", title: "B" },
      ],
    })
  })

  it("unwraps plain list without metadata", () => {
    const result = normalizeRows({
      list: [
        { reportId: "1", title: "A" },
      ],
    })

    expect(result).toEqual([
      { reportId: "1", title: "A" },
    ])
  })

  it("preserves metadata when mapping fieldList rows", () => {
    const result = normalizeRows({
      total: 2,
      fieldList: ["securityCode", "title"],
      list: [
        ["000001.SZ", "A"],
        ["000002.SZ", "B"],
      ],
    })

    expect(result).toEqual({
      total: 2,
      list: [
        { securityCode: "000001.SZ", title: "A" },
        { securityCode: "000002.SZ", title: "B" },
      ],
    })
  })

  it("unwraps fieldList rows without metadata", () => {
    const result = normalizeRows({
      fieldList: ["securityCode", "title"],
      list: [
        ["000001.SZ", "A"],
      ],
    })

    expect(result).toEqual([
      { securityCode: "000001.SZ", title: "A" },
    ])
  })

  it("unwraps chatRoomList rows for group ID responses", () => {
    const result = normalizeRows({
      chatRoomList: [
        { chatroomName: "AI学习群", chatroomId: "wvbiijgwgejyeuwp" },
        { chatroomName: "投研分享群", chatroomId: "wvbiijgwgekdfj" },
      ],
    })

    expect(result).toEqual([
      { chatroomName: "AI学习群", chatroomId: "wvbiijgwgejyeuwp" },
      { chatroomName: "投研分享群", chatroomId: "wvbiijgwgekdfj" },
    ])
  })

  it("returns arrays as-is", () => {
    const input = [{ a: 1 }, { a: 2 }]
    expect(normalizeRows(input)).toEqual(input)
  })

  it("returns primitives as-is", () => {
    expect(normalizeRows(null)).toBeNull()
    expect(normalizeRows("hello")).toBe("hello")
    expect(normalizeRows(42)).toBe(42)
  })
})
