import { describe, expect, it } from "vitest"

import { ApiError } from "../../src/core/errors.js"
import { flattenCrossSection, flattenTimeSeries, unwrapIndicatorData } from "../../src/core/indicatorMatrix.js"

// Field names + value shapes below mirror the LIVE EDE responses (verified
// against open.gangtise.com), which differ from the published doc: the real
// keys are securityCode/securityName/indicators/indicatorName/dataType, and
// cross-section `values` is a flat [numInd*numSec][1] array in indicator-major
// order while time-series `values` is a 2D [series][date] matrix.

describe("flattenCrossSection", () => {
  const data = {
    date: "2026-05-18",
    securityCode: ["600519.SH", "09992.HK"],
    securityName: ["贵州茅台", "泡泡玛特"],
    indicators: ["qte_close", "qte_vol", "qte_mkt_cptl"],
    indicatorName: ["收盘价", "成交量", "总市值"],
    dataType: ["double", "integer", "double"],
    // indicator-major: [close×茅台, close×泡泡, vol×茅台, vol×泡泡, cap×茅台, cap×泡泡]
    values: [[1323.0], [150.7], [4966097], [15301079], [165675349444], [20209520.2705]],
  }

  it("emits one row per security with indicator-name columns", () => {
    const out = flattenCrossSection(data) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(2)
    expect(out.list).toEqual([
      { date: "2026-05-18", security: "600519.SH", name: "贵州茅台", 收盘价: 1323.0, 成交量: 4966097, 总市值: 165675349444 },
      { date: "2026-05-18", security: "09992.HK", name: "泡泡玛特", 收盘价: 150.7, 成交量: 15301079, 总市值: 20209520.2705 },
    ])
  })

  it("keeps date/security/name first, then indicators in list order", () => {
    const out = flattenCrossSection(data) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "security", "name", "收盘价", "成交量", "总市值"])
  })

  it("disambiguates duplicate indicator names by appending the code", () => {
    const out = flattenCrossSection({
      date: "2026-05-18",
      securityCode: ["600519.SH"],
      securityName: ["贵州茅台"],
      indicators: ["qte_close", "qte_close_adj"],
      indicatorName: ["收盘价", "收盘价"],
      values: [[1323.0], [1290.0]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
      date: "2026-05-18",
      security: "600519.SH",
      name: "贵州茅台",
      收盘价: 1323.0,
      "收盘价 (qte_close_adj)": 1290.0,
    })
  })

  it("returns the input unchanged when the shape is not a value matrix", () => {
    expect(flattenCrossSection(null)).toBeNull()
    expect(flattenCrossSection({ foo: 1 })).toEqual({ foo: 1 })
  })
})

describe("flattenTimeSeries", () => {
  it("uses indicator columns when there is a single security", () => {
    const out = flattenTimeSeries({
      securityCode: ["600519.SH"],
      securityName: ["贵州茅台"],
      indicators: ["qte_close", "qte_vol"],
      indicatorName: ["收盘价", "成交量"],
      dataType: ["double", "integer"],
      dates: ["2026-05-18", "2026-05-19", "2026-05-20"],
      values: [
        [1323.0, 1324.3, 1315.0],
        [4966097, 4325464, 4748733],
      ],
    }) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(3)
    expect(out.list).toEqual([
      { date: "2026-05-18", 收盘价: 1323.0, 成交量: 4966097 },
      { date: "2026-05-19", 收盘价: 1324.3, 成交量: 4325464 },
      { date: "2026-05-20", 收盘价: 1315.0, 成交量: 4748733 },
    ])
  })

  it("uses security columns when there are multiple securities", () => {
    const out = flattenTimeSeries({
      securityCode: ["600519.SH", "09992.HK"],
      securityName: ["贵州茅台", "泡泡玛特"],
      indicators: ["qte_close"],
      indicatorName: ["收盘价"],
      dates: ["2026-05-18", "2026-05-19"],
      values: [
        [1323.0, 1324.3],
        [150.7, 152.5],
      ],
    }) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(2)
    expect(out.list).toEqual([
      { date: "2026-05-18", 贵州茅台: 1323.0, 泡泡玛特: 150.7 },
      { date: "2026-05-19", 贵州茅台: 1324.3, 泡泡玛特: 152.5 },
    ])
  })

  it("returns an empty list when the API resolves no rows (no-data range)", () => {
    expect(flattenTimeSeries({
      securityCode: [],
      securityName: null,
      indicators: [],
      indicatorName: ["收盘价"],
      dataType: ["double"],
      dates: [],
      values: [],
    })).toEqual({ list: [], total: 0 })
  })

  it("returns the input unchanged when the shape is not a value matrix", () => {
    expect(flattenTimeSeries(undefined)).toBeUndefined()
    expect(flattenTimeSeries({ foo: 1 })).toEqual({ foo: 1 })
  })
})

describe("unwrapIndicatorData", () => {
  // The live EDE endpoints double-wrap on success: the client strips the outer
  // envelope, leaving an inner { code, status, data } we must peel once more.
  it("peels the inner envelope around a matrix payload", () => {
    expect(unwrapIndicatorData({
      code: "000000",
      msg: "操作成功",
      status: true,
      data: { securityCode: ["600519.SH"], values: [[1]] },
    })).toEqual({ securityCode: ["600519.SH"], values: [[1]] })
  })

  it("peels the inner envelope around a list payload (search)", () => {
    expect(unwrapIndicatorData({
      code: "000000",
      status: true,
      data: [{ indicatorCode: "qte_close" }],
    })).toEqual([{ indicatorCode: "qte_close" }])
  })

  it("returns the value unchanged when it is not an envelope", () => {
    expect(unwrapIndicatorData([{ a: 1 }])).toEqual([{ a: 1 }])
    expect(unwrapIndicatorData({ securityCode: ["x"], values: [[1]] })).toEqual({ securityCode: ["x"], values: [[1]] })
    expect(unwrapIndicatorData(null)).toBeNull()
  })

  it("throws an ApiError carrying the inner code/msg when the inner envelope reports a failure", () => {
    let err: unknown
    try {
      unwrapIndicatorData({ code: "410001", msg: "参数错误", status: false, data: null })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("410001")
    expect((err as ApiError).message).toBe("参数错误")
  })
})
