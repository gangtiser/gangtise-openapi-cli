import { describe, expect, it } from "vitest"

import { ApiError, attachEnvelopeTraceId } from "../../src/core/errors.js"
import { droppedFromMatrix, flattenCrossSection, flattenTimeSeries, unwrapIndicatorData } from "../../src/core/indicatorMatrix.js"

// Field names + value shapes below mirror the LIVE EDE responses as of the
// 2026-08-01 API revision (probed against openapi.gangtise.com): indicator
// metadata arrives as a structured `indicatorList` of {code, name, dataType}
// (plus `field` for the screener), and `values` is a 2D matrix —
// [security][indicator] for cross-section and the screener (TRANSPOSED from the
// previous revision), [series][date] for time-series. There is no longer a
// root-level `date`: the query date lives in each indicator's own parameters.

describe("flattenCrossSection", () => {
  const data = {
    securityCodeList: ["600519.SH", "09992.HK"],
    securityNameList: ["贵州茅台", "泡泡玛特"],
    indicatorList: [
      { code: "qte_close", name: "收盘价", dataType: "double" },
      { code: "qte_vol", name: "成交量", dataType: "integer" },
      { code: "qte_mkt_cptl", name: "总市值", dataType: "double" },
    ],
    // [security][indicator]: row i = security i across [收盘价, 成交量, 总市值]
    values: [
      [1323.0, 4966097, 165675349444],
      [150.7, 15301079, 20209520.2705],
    ],
  }

  it("suffixes an indicator literally named like a reserved column instead of clobbering it", () => {
    const clash = {
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "qte_close", name: "收盘价" },
        { code: "pty_name", name: "name" },
      ],
      values: [[1323.0, "贵州茅台股份有限公司"]],
    }
    const out = flattenCrossSection(clash) as { list: Record<string, unknown>[] }
    // The metadata column must survive; the clashing indicator gets a suffixed header.
    expect(out.list[0].name).toBe("贵州茅台")
    expect(out.list[0]["name (pty_name)"]).toBe("贵州茅台股份有限公司")
  })

  it("emits one row per security with indicator-name columns", () => {
    const out = flattenCrossSection(data) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(2)
    expect(out.list).toEqual([
      { security: "600519.SH", name: "贵州茅台", 收盘价: 1323.0, 成交量: 4966097, 总市值: 165675349444 },
      { security: "09992.HK", name: "泡泡玛特", 收盘价: 150.7, 成交量: 15301079, 总市值: 20209520.2705 },
    ])
  })

  it("keeps security/name first, then indicators in list order", () => {
    const out = flattenCrossSection(data) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["security", "name", "收盘价", "成交量", "总市值"])
  })

  it("reads values row-major per security, matching the transposed matrix", () => {
    // Regression guard for the 2026-08-01 transposition: under the OLD
    // [indicator][security] reading, 茅台 would take 成交量's row and report a
    // 收盘价 of 4966097. Values must follow the security, not the indicator.
    const out = flattenCrossSection(data) as { list: Record<string, unknown>[] }
    expect(out.list[0].收盘价).toBe(1323.0)
    expect(out.list[1].收盘价).toBe(150.7)
  })

  it("disambiguates duplicate indicator names by appending the code", () => {
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "qte_close", name: "收盘价" },
        { code: "qte_close_adj", name: "收盘价" },
      ],
      values: [[1323.0, 1290.0]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
      security: "600519.SH",
      name: "贵州茅台",
      收盘价: 1323.0,
      "收盘价 (qte_close_adj)": 1290.0,
    })
  })

  it("keys indicator columns by code when keyBy is 'code' (stable across duplicate names)", () => {
    // Batch use-case: cf_finc_exp (累计) and cf_finc_exp_qtr (单季) BOTH display as
    // 「财务费用」, and the server DOES reorder columns vs the request (probed
    // 2026-08-01) — so mapping a requested code back to its value by name or
    // position is impossible. keyBy:'code' makes every column its unique code.
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "cf_finc_exp", name: "财务费用" },
        { code: "cf_finc_exp_qtr", name: "财务费用" },
      ],
      values: [[100, 40]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
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
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "bs_dep_ib", name: "存放同业款项" },
        { code: "bs_clnt_dep", name: "其中:客户资金存款" },
      ],
      values: [[null, null]],
    }) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(1)
    expect(out.list[0]).toEqual({
      security: "600519.SH",
      name: "贵州茅台",
      存放同业款项: null,
      "其中:客户资金存款": null,
    })
  })

  it("returns an empty list for a query that matched no securities", () => {
    expect(flattenCrossSection({
      securityCodeList: [],
      securityNameList: [],
      indicatorList: [],
      values: [],
    })).toEqual({ list: [], total: 0 })
  })

  it("throws instead of relabelling when the matrix row count disagrees with the securities", () => {
    // The 2026-08-01 revision transposed this matrix with no version marker; a
    // future re-transpose must fail loudly rather than pair 茅台's row with
    // 泡泡玛特's values.
    expect(() => flattenCrossSection({
      securityCodeList: ["600519.SH", "09992.HK"],
      securityNameList: ["贵州茅台", "泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      values: [[1323.0, 150.7]],
    })).toThrow(ApiError)
  })

  it("returns the input unchanged when the shape is not a value matrix", () => {
    expect(flattenCrossSection(null)).toBeNull()
    expect(flattenCrossSection({ foo: 1 })).toEqual({ foo: 1 })
  })
})

describe("droppedFromMatrix", () => {
  it("reports the indicators and securities the response left out entirely", () => {
    // Probed 2026-08-02: EDE does NOT pad with null — an indicator empty for
    // every security disappears from indicatorList, a security empty for every
    // indicator disappears from securityCodeList.
    expect(droppedFromMatrix(
      { securityCodeList: ["600519.SH"], indicatorList: [{ code: "qte_close" }], values: [[1350.6]] },
      ["600519.SH", "09992.HK"],
      ["qte_close", "qte_mkt_cptl", "shr_tot"],
    )).toEqual({ securities: ["09992.HK"], indicators: ["qte_mkt_cptl", "shr_tot"] })
  })

  it("does not report a sector ID as dropped (the server expands it into constituents)", () => {
    expect(droppedFromMatrix(
      { securityCodeList: ["600519.SH", "000858.SZ"], indicatorList: [{ code: "qte_close" }], values: [[1], [2]] },
      ["1000000287"],
      ["qte_close"],
    )).toEqual({ securities: [], indicators: [] })
  })

  it("reports nothing when the response is complete", () => {
    expect(droppedFromMatrix(
      { securityCodeList: ["600519.SH"], indicatorList: [{ code: "qte_close" }], values: [[1350.6]] },
      ["600519.SH"],
      ["qte_close"],
    )).toEqual({ securities: [], indicators: [] })
  })
})

// The screener returns the cross-section payload plus a `field` on every
// indicator entry, so it reuses flattenCrossSection.
describe("flattenCrossSection (screener payload)", () => {
  it("emits one row per matched security with the screened indicator columns", () => {
    const out = flattenCrossSection({
      securityCodeList: ["000858.SZ", "600519.SH"],
      securityNameList: ["五粮液", "贵州茅台"],
      indicatorList: [
        { field: "F1", code: "qte_mkt_cptl", name: "总市值", dataType: "double" },
        { field: "F2", code: "finc_pe_ttm", name: "市盈率(TTM)", dataType: "double" },
      ],
      values: [
        [3817.1733, 28.4929],
        [17546.4346, 21.2131],
      ],
    }) as { list: Record<string, unknown>[]; total: number }
    expect(out.total).toBe(2)
    expect(out.list[0]).toEqual({ security: "000858.SZ", name: "五粮液", 总市值: 3817.1733, "市盈率(TTM)": 28.4929 })
  })

  it("labels EVERY column of a repeated indicator with its variable, not just the second", () => {
    // A screener may bind one code twice (the same price on two dates). Leaving
    // the first column bare makes `收盘价` read as "the" close price when it is
    // only whichever variable the server listed first.
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { field: "F1", code: "qte_close", name: "收盘价" },
        { field: "F2", code: "qte_close", name: "收盘价" },
      ],
      values: [[1323.0, 1685.01]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
      security: "600519.SH",
      name: "贵州茅台",
      "收盘价 (F1)": 1323.0,
      "收盘价 (F2)": 1685.01,
    })
  })

  it("keeps both columns distinct under keyBy 'code' when one code is bound twice", () => {
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { field: "F1", code: "qte_close", name: "收盘价" },
        { field: "F2", code: "qte_close", name: "收盘价" },
      ],
      values: [[1323.0, 1685.01]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({
      security: "600519.SH",
      name: "贵州茅台",
      "qte_close (F1)": 1323.0,
      "qte_close (F2)": 1685.01,
    })
  })

  it("leaves a screener's distinct indicators unsuffixed", () => {
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { field: "F1", code: "qte_mkt_cptl", name: "总市值" },
        { field: "F2", code: "finc_pe_ttm", name: "市盈率(TTM)" },
      ],
      values: [[16883.6021, 20.4118]],
    }) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["security", "name", "总市值", "市盈率(TTM)"])
  })

  it("returns an empty list when nothing passed the filter", () => {
    expect(flattenCrossSection({
      securityCodeList: [],
      securityNameList: [],
      indicatorList: [],
      values: [],
    })).toEqual({ list: [], total: 0 })
  })
})

describe("flattenTimeSeries", () => {
  it("uses indicator columns when there is a single security", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "qte_close", name: "收盘价", dataType: "double" },
        { code: "qte_vol", name: "成交量", dataType: "integer" },
      ],
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
      indicatorList: [{ code: "qte_close", name: "收盘价", dataType: "double" }],
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
      indicatorList: [
        { code: "qte_close", name: "收盘价" },
        { code: "qte_vol", name: "成交量" },
      ],
      dates: ["2026-05-18"],
      values: [[1323.0], [4966097]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ date: "2026-05-18", qte_close: 1323.0, qte_vol: 4966097 })
  })

  it("keys security columns by code when keyBy is 'code' (multiple securities)", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH", "09992.HK"],
      securityNameList: ["贵州茅台", "泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-05-18"],
      values: [[1323.0], [150.7]],
    }, "code") as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ date: "2026-05-18", "600519.SH": 1323.0, "09992.HK": 150.7 })
  })

  it("falls back to the security code when the response omits the name list", () => {
    // Guard against deriving the column count from securityNameList: a missing
    // name list must still yield one column per security, not zero.
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH", "09992.HK"],
      securityNameList: null,
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-05-18"],
      values: [[1323.0], [150.7]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ date: "2026-05-18", "600519.SH": 1323.0, "09992.HK": 150.7 })
  })

  it("keeps the security axis when the server drops an uncovered security from a multi-security request", () => {
    // Probed 2026-08-02: finc_pe_ttm over 600519.SH + 09992.HK returns only the
    // A-share, because HK has no PE coverage. Deriving the axis from the response
    // would flip to the indicator axis and render a bare 市盈率(TTM) column with
    // nothing saying whose series it is.
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "finc_pe_ttm", name: "市盈率(TTM)" }],
      dates: ["2026-07-30", "2026-07-31"],
      values: [[20.5804, 20.4118]],
    }, "name", 2) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "贵州茅台"])
    expect(out.list[0].贵州茅台).toBe(20.5804)
  })

  it("uses the security axis when ONE universe entry expands into many securities", () => {
    // A sector ID is a single --security entry that the server expands into its
    // constituents, so the request count says nothing about the axis. Reading it
    // as single-security both mislabels the columns and — once the shape guard
    // exists — kills the query outright, which is the only way a sector ID is
    // allowed to be used on this endpoint (v0.30.1 regression).
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH", "000858.SZ", "000568.SZ"],
      securityNameList: ["贵州茅台", "五粮液", "泸州老窖"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-31"],
      values: [[1350.6], [78.0], [10.56]],
    }, "name", 1) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "贵州茅台", "五粮液", "泸州老窖"])
  })

  it("uses the indicator axis for a multi-indicator response regardless of the request count", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [
        { code: "qte_close", name: "收盘价" },
        { code: "qte_vol", name: "成交量" },
      ],
      dates: ["2026-07-31"],
      values: [[1350.6], [5512752]],
    }, "name", 1) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "收盘价", "成交量"])
  })

  it("uses the indicator axis for a genuinely single-security request", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "finc_pe_ttm", name: "市盈率(TTM)" }],
      dates: ["2026-07-30"],
      values: [[20.5804]],
    }, "name", 1) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "市盈率(TTM)"])
  })

  it("returns an empty list when the API resolves no rows (no-data range)", () => {
    expect(flattenTimeSeries({
      securityCodeList: [],
      securityNameList: null,
      indicatorList: [],
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
