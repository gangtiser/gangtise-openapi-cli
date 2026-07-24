import { describe, expect, it } from "vitest"

import { ApiError, attachEnvelopeTraceId } from "../../src/core/errors.js"
import { flattenCrossSection, flattenTimeSeries, unwrapIndicatorData } from "../../src/core/indicatorMatrix.js"

// Field names + value shapes below mirror the LIVE EDE responses (verified
// against open.gangtise.com), which differ from the published doc: the real
// keys are securityCodeList/securityNameList/indicatorCodeList/indicatorNameList,
// and `values` is a 2D matrix — [indicator][security] for cross-section,
// [series][date] for time-series.

describe("flattenCrossSection", () => {
  const data = {
    date: "2026-05-18",
    securityCodeList: ["600519.SH", "09992.HK"],
    securityNameList: ["贵州茅台", "泡泡玛特"],
    indicatorCodeList: ["qte_close", "qte_vol", "qte_mkt_cptl"],
    indicatorNameList: ["收盘价", "成交量", "总市值"],
    dataTypes: ["double", "integer", "double"],
    // [indicator][security]: row i = indicator i across [茅台, 泡泡玛特]
    values: [
      [1323.0, 150.7],
      [4966097, 15301079],
      [165675349444, 20209520.2705],
    ],
  }

  it("suffixes an indicator literally named like a reserved column instead of clobbering it", () => {
    const clash = {
      date: "2026-05-18",
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["qte_close", "x_date"],
      indicatorNameList: ["收盘价", "date"],
      values: [[1323.0], [42]],
    }
    const out = flattenCrossSection(clash) as { list: Record<string, unknown>[] }
    // The metadata column must survive; the clashing indicator gets a suffixed header.
    expect(out.list[0].date).toBe("2026-05-18")
    expect(out.list[0]["date (x_date)"]).toBe(42)
  })

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
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["qte_close", "qte_close_adj"],
      indicatorNameList: ["收盘价", "收盘价"],
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

  it("keys indicator columns by code when keyBy is 'code' (stable across duplicate names)", () => {
    // Batch use-case: cf_finc_exp (累计) and cf_finc_exp_qtr (单季) BOTH display as
    // 「财务费用」, and the server may reorder columns vs the request — so mapping a
    // requested code back to its value by name or position is impossible. keyBy:'code'
    // makes every indicator column its unique code.
    const out = flattenCrossSection({
      date: "2026-03-31",
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["cf_finc_exp", "cf_finc_exp_qtr"],
      indicatorNameList: ["财务费用", "财务费用"],
      values: [[100], [40]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
      date: "2026-03-31",
      security: "600519.SH",
      name: "贵州茅台",
      cf_finc_exp: 100,
      cf_finc_exp_qtr: 40,
    })
  })

  it("emits null cells and keeps the security row when the matrix has no data", () => {
    // Post-fix server behaviour: no-data is null per cell; the security is NOT
    // dropped and the call does NOT 500 (previously the whole row vanished).
    const out = flattenCrossSection({
      date: "2025-12-31",
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["bs_dep_ib", "bs_clnt_dep"],
      indicatorNameList: ["存放同业款项", "其中:客户资金存款"],
      values: [[null], [null]],
    }) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(1)
    expect(out.list[0]).toEqual({
      date: "2025-12-31",
      security: "600519.SH",
      name: "贵州茅台",
      存放同业款项: null,
      "其中:客户资金存款": null,
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
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["qte_close", "qte_vol"],
      indicatorNameList: ["收盘价", "成交量"],
      dataTypes: ["double", "integer"],
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
      securityCodeList: ["600519.SH", "09992.HK"],
      securityNameList: ["贵州茅台", "泡泡玛特"],
      indicatorCodeList: ["qte_close"],
      indicatorNameList: ["收盘价"],
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

  it("keys indicator columns by code when keyBy is 'code' (single security)", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorCodeList: ["qte_close", "qte_vol"],
      indicatorNameList: ["收盘价", "成交量"],
      dates: ["2026-05-18"],
      values: [[1323.0], [4966097]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ date: "2026-05-18", qte_close: 1323.0, qte_vol: 4966097 })
  })

  it("keys security columns by code when keyBy is 'code' (multiple securities)", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH", "09992.HK"],
      securityNameList: ["贵州茅台", "泡泡玛特"],
      indicatorCodeList: ["qte_close"],
      indicatorNameList: ["收盘价"],
      dates: ["2026-05-18"],
      values: [[1323.0], [150.7]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ date: "2026-05-18", "600519.SH": 1323.0, "09992.HK": 150.7 })
  })

  it("returns an empty list when the API resolves no rows (no-data range)", () => {
    expect(flattenTimeSeries({
      securityCodeList: [],
      securityNameList: null,
      indicatorCodeList: [],
      indicatorNameList: ["收盘价"],
      dataTypes: ["double"],
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
      data: { securityCodeList: ["600519.SH"], values: [[1]] },
    })).toEqual({ securityCodeList: ["600519.SH"], values: [[1]] })
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
    expect(unwrapIndicatorData({ securityCodeList: ["x"], values: [[1]] })).toEqual({ securityCodeList: ["x"], values: [[1]] })
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

  it("throws when an inner failure envelope omits the data key", () => {
    let err: unknown
    try {
      unwrapIndicatorData({ code: "410004", status: false, msg: "指标无权限" })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("410004")
    expect((err as ApiError).message).toBe("指标无权限")
  })

  it("surfaces the outer envelope's traceId on an inner failure", () => {
    // Probed 2026-07-20: EDE puts traceId on the OUTER envelope only, and the client
    // discards that envelope before this function runs. The id is handed over on the
    // payload instead — without it the EDE failures that most need reporting
    // (999999 / 130001) print with no trace, contradicting the README.
    const raw = attachEnvelopeTraceId({ code: "130001", status: false, msg: "指标无权限" }, "830886132209999872")
    let err: unknown
    try {
      unwrapIndicatorData(raw)
    } catch (e) {
      err = e
    }
    expect((err as ApiError).traceId).toBe("830886132209999872")
  })
})
