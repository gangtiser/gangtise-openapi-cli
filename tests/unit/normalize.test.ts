import { describe, expect, it } from "vitest"

import { attachEnvelopeTraceId } from "../../src/core/errors.js"
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

  // 上游对「fieldList 含该接口不存在的字段名」有两套处理：day-kline / minute-kline /
  // fund-flow / 三大报表是「名值同丢或补 null」（长度仍相等，安全）；realtime /
  // main-business / valuation-analysis 却是**值只按有效字段返回、字段名按请求原样回显**。
  // 后者长度不等，按位置拍平就把值贴到错误的字段上——实测 realtime 传
  // ["securityCode","close","turnoverRate"]（realtime 无 close）返回 2 个值，
  // 换手率 28.5573 被贴成 close，读起来就是「茅台收盘价 28.56」（真实价 1297.41）。
  // 静默错列比缺字段危险得多，必须直接失败。
  it("throws instead of mis-zipping when the row is shorter than fieldList (invalid field name)", () => {
    expect(() => normalizeRows({
      total: 1,
      fieldList: ["securityCode", "close", "turnoverRate"],
      list: [["600519.SH", 28.5573]],
    })).toThrowError(/字段数与 fieldList 不匹配/)
  })

  it("carries the envelope traceId into the mismatch error so a structural-anomaly report is actionable", () => {
    const raw = attachEnvelopeTraceId({
      fieldList: ["date", "S00000093", "S99999999"],
      list: [["20260131", "826.1"]],
    }, "trace-123")

    expect(() => normalizeRows(raw)).toThrowError(/trace trace-123/)
  })

  it("leaves non-array rows in a fieldList response untouched", () => {
    const raw = { total: 1, fieldList: ["a"], list: [{ already: "object" }] }
    expect(normalizeRows(raw)).toEqual({ total: 1, list: [{ already: "object" }] })
  })

  it("keeps { total, list } for group ID responses (chatroom now returns total + list)", () => {
    const result = normalizeRows({
      total: 2,
      list: [
        { chatroomName: "AI学习群", chatroomId: "wvbiijgwgejyeuwp" },
        { chatroomName: "投研分享群", chatroomId: "wvbiijgwgekdfj" },
      ],
    })

    expect(result).toEqual({
      total: 2,
      list: [
        { chatroomName: "AI学习群", chatroomId: "wvbiijgwgejyeuwp" },
        { chatroomName: "投研分享群", chatroomId: "wvbiijgwgekdfj" },
      ],
    })
  })

  it("unwraps constants rows preserving category metadata", () => {
    const result = normalizeRows({
      category: "citicIndustry",
      structureType: "flat",
      maxLevel: 1,
      constantCount: 2,
      constants: [
        { constantId: "100800121", constantName: "银行" },
        { constantId: "100800122", constantName: "房地产" },
      ],
    })

    expect(result).toEqual({
      category: "citicIndustry",
      structureType: "flat",
      maxLevel: 1,
      constantCount: 2,
      list: [
        { constantId: "100800121", constantName: "银行" },
        { constantId: "100800122", constantName: "房地产" },
      ],
    })
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
