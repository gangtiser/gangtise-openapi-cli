import { describe, expect, it } from "vitest"

import { ApiError, attachEnvelopeTraceId } from "../../src/core/errors.js"
import { droppedFromMatrix, flattenCrossSection, flattenTimeSeries, isEmptyMatrix, requireIndicatorMatrix, unwrapIndicatorData } from "../../src/core/indicatorMatrix.js"

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

  it("throws when a row has a different cell count than the indicator list", () => {
    // The server pads a row with null rather than truncating it (probed
    // 2026-08-02 across A/HK/US with 3 of 4 indicators uncovered), so an unequal
    // row is a structural change, not missing data — and silently dropping the
    // extra cell or leaving a phantom column is exactly the failure this API
    // makes invisible.
    expect(() => flattenCrossSection({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }, { code: "qte_vol", name: "成交量" }],
      values: [[1323.0]],
    })).toThrow(ApiError)
  })

  it("accepts a fully null-padded row", () => {
    const out = flattenCrossSection({
      securityCodeList: ["AAPL.O"],
      securityNameList: ["苹果"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }, { code: "qte_mkt_cptl", name: "总市值" }],
      values: [[308.91, null]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0]).toEqual({ security: "AAPL.O", name: "苹果", 收盘价: 308.91, 总市值: null })
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

  it("rejects a payload that is not a matrix at all", () => {
    // Nothing legitimately reaches the flatteners but a cross-section body:
    // `indicator search` prints its unwrapped list directly and `raw call`
    // bypasses them, so null / an array / a foreign object is a protocol failure,
    // not a shape to hand back.
    expect(() => flattenCrossSection(null)).toThrow(ApiError)
    expect(() => flattenCrossSection([1, 2])).toThrow(ApiError)
    expect(() => flattenCrossSection({ foo: 1 })).toThrow(ApiError)
  })

  it("drops a securityNameList that does not line up, keeping the values", () => {
    // Names are consumed positionally: a short list would label 茅台's row
    // 泡泡玛特 (probed 2026-08-02). A name is a caption, not identity — the codes
    // still carry that — so the list is discarded rather than failing a query
    // whose numbers are all correct.
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH", "09992.HK"], securityNameList: ["泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }], values: [[1350.6], [162.6]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list.map((row) => row.security)).toEqual(["600519.SH", "09992.HK"])
    expect(out.list.map((row) => row.收盘价)).toEqual([1350.6, 162.6])
    expect(out.list[0].name).toBeUndefined() // never 泡泡玛特
  })

  it("falls back to the code for a null or non-string name instead of rendering it", () => {
    // A `[null]` entry used to stringify into a column literally headed "null".
    const out = flattenCrossSection({
      securityCodeList: ["600519.SH"], securityNameList: [null],
      indicatorList: [{ code: "qte_close", name: "收盘价" }], values: [[1350.6]],
    }) as { list: Record<string, unknown>[] }
    expect(out.list[0].name).toBe("600519.SH")
  })

  it("omits the name KEY entirely when no securityNameList is sent", () => {
    // Asserting `=== undefined` is not enough: an always-present `name:
    // undefined` is invisible in JSON but renders as a real empty column in
    // CSV/table (`security,name,收盘价` / `600519.SH,,1350.6`). The key itself
    // must be absent, since the renderers derive columns from the row's keys.
    for (const securityNameList of [undefined, null]) {
      const out = flattenCrossSection({
        securityCodeList: ["600519.SH"], securityNameList,
        indicatorList: [{ code: "qte_close", name: "收盘价" }], values: [[1350.6]],
      }) as { list: Record<string, unknown>[] }
      expect(Object.keys(out.list[0])).toEqual(["security", "收盘价"])
    }
  })

  it("refuses to fabricate an identity out of a null code", () => {
    // String(null) renders the literal "null" as a perfectly plausible label.
    expect(() => flattenCrossSection({
      securityCodeList: [null], indicatorList: [{ code: "qte_close" }], values: [[1350.6]],
    })).toThrow(ApiError)
  })

  it("refuses an indicator entry with no usable code", () => {
    // `--key-by code` addresses columns by `code`; an entry without one used to
    // collapse to `{}` and surface as `col0`, unmappable to what was requested.
    expect(() => flattenCrossSection({
      securityCodeList: ["600519.SH"], indicatorList: [null], values: [[1350.6]],
    })).toThrow(ApiError)
    expect(() => flattenCrossSection({
      securityCodeList: ["600519.SH"], indicatorList: [{ name: "收盘价" }], values: [[1350.6]],
    })).toThrow(ApiError)
  })
})

describe("isEmptyMatrix", () => {
  it("recognises a wholly empty response as empty, not as a dropped axis", () => {
    // A weekend-only TD range answers with everything empty. Diffing that against
    // the request would call every requested code "omitted" — false metadata.
    expect(isEmptyMatrix({ securityCodeList: [], securityNameList: [], indicatorList: [], values: [] })).toBe(true)
  })

  it("does not call a partial response empty", () => {
    expect(isEmptyMatrix({ securityCodeList: ["600519.SH"], indicatorList: [], values: [[]] })).toBe(false)
    expect(isEmptyMatrix({ securityCodeList: [], indicatorList: [{ code: "qte_close" }], values: [] })).toBe(false)
  })

  it("does not treat a non-matrix payload as empty", () => {
    expect(isEmptyMatrix({ foo: 1 })).toBe(false)
    expect(isEmptyMatrix(null)).toBe(false)
  })

  it("rejects a malformed payload that merely has empty axis lists", () => {
    // A no-data answer is exactly five empty arrays (probed 2026-08-02). Anything
    // looser would let a protocol regression exit 0 as "legitimately empty",
    // bypassing every shape guard in this release.
    expect(isEmptyMatrix({ securityCodeList: [], indicatorList: [], dates: [], values: null })).toBe(false)
    expect(isEmptyMatrix({ securityCodeList: [], indicatorList: [], dates: [] })).toBe(false)
    expect(isEmptyMatrix({ securityCodeList: [], indicatorList: [], dates: ["2026-08-01"], values: [] })).toBe(false)
    expect(isEmptyMatrix({ securityCodeList: [], indicatorList: [], values: [[1]] })).toBe(false)
  })

  it("accepts a cross-section empty response, which carries no dates key", () => {
    expect(isEmptyMatrix({ securityCodeList: [], securityNameList: [], indicatorList: [], values: [] })).toBe(true)
  })
})

describe("malformed matrices", () => {
  it("throws rather than passing through a response with axis lists but no values array", () => {
    // Returning it untouched would print the raw envelope and exit 0 —
    // indistinguishable from success.
    expect(() => flattenCrossSection({ securityCodeList: [], indicatorList: [], values: null })).toThrow(ApiError)
    expect(() => flattenTimeSeries({ securityCodeList: [], indicatorList: [], dates: [] }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("throws on dates with no matrix instead of emitting identity-less rows", () => {
    // This shape used to yield [{ date }] — a row with no security and no
    // indicator, exit 0.
    expect(() => flattenTimeSeries({
      securityCodeList: [], indicatorList: [], dates: ["2026-08-01"], values: [],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("throws when one axis is null while the rest of the matrix is intact", () => {
    // The pass-through guard used to fire on ANY unparsable axis, so a response
    // with real securities, indicators and values but `dates: null` printed the
    // raw envelope and exited 0.
    expect(() => flattenTimeSeries({
      securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close" }], dates: null, values: [[1350.6]],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("throws when a matrix payload omits an axis entirely", () => {
    expect(() => flattenCrossSection({ securityCodeList: ["600519.SH"], values: [[1350.6]] })).toThrow(ApiError)
    expect(() => flattenCrossSection({ indicatorList: [{ code: "qte_close" }], values: [[1350.6]] })).toThrow(ApiError)
  })

  it("labels time-series columns by code when the names do not line up", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH", "09992.HK"], securityNameList: ["泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }], dates: ["2026-07-31"],
      values: [[1350.6], [162.6]],
    }, "name", ["600519.SH", "09992.HK"]) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "600519.SH", "09992.HK"])
    expect(out.list[0]["600519.SH"]).toBe(1350.6) // 茅台's value never lands under 泡泡玛特
  })

  it("refuses a null date rather than labelling a row \"null\"", () => {
    expect(() => flattenTimeSeries({
      securityCodeList: ["600519.SH"], indicatorList: [{ code: "qte_close" }],
      dates: [null], values: [[1350.6]],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("rejects data that carries only one identity axis", () => {
    // securityCodeList empty alongside a populated matrix: every row belongs to
    // no security, and the row/column counts still line up so no other guard
    // notices.
    expect(() => flattenTimeSeries({
      securityCodeList: [], indicatorList: [{ code: "qte_close" }],
      dates: ["2026-07-31"], values: [[1350.6]],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("rejects a response carrying both axes plural, which the endpoint forbids", () => {
    // Multi-indicator × multi-security is rejected as a REQUEST (100003); as a
    // RESPONSE it is unattributable — whichever axis becomes the columns, the
    // other identity is silently lost, and the dropped-axis check sees nothing
    // missing so it would not even flag.
    expect(() => flattenTimeSeries({
      securityCodeList: ["600519.SH", "09992.HK"], securityNameList: ["贵州茅台", "泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }, { code: "qte_vol", name: "成交量" }],
      dates: ["2026-07-31"], values: [[1350.6], [162.6]],
    }, "name", ["600519.SH", "09992.HK"])).toThrow(ApiError)
  })
})

describe("requireIndicatorMatrix", () => {
  it("rejects a success envelope carrying a null payload, keeping the envelope traceId", () => {
    // `data: null` cannot hold the non-enumerable traceId itself, so the check
    // has to run before the envelope is discarded.
    const envelope = attachEnvelopeTraceId({ code: "000000", status: true, data: null }, "826455848369786880")
    try {
      requireIndicatorMatrix(envelope)
      expect.unreachable("expected a protocol failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).traceId).toBe("826455848369786880")
    }
  })

  it("rejects an array payload (that is a search result, not a matrix)", () => {
    expect(() => requireIndicatorMatrix({ code: "000000", status: true, data: [{ indicatorCode: "qte_close" }] })).toThrow(ApiError)
  })

  it("returns the inner payload unchanged for a well-formed matrix", () => {
    const matrix = { securityCodeList: [], indicatorList: [], values: [] }
    expect(requireIndicatorMatrix({ code: "000000", status: true, data: matrix })).toEqual(matrix)
  })
})

describe("unwrapIndicatorData traceId hand-off", () => {
  it("carries the envelope traceId onto the inner payload so shape errors stay traceable", () => {
    const envelope = attachEnvelopeTraceId({ code: "000000", status: true, data: { securityCodeList: [], indicatorList: [], values: null } }, "826455848369786880")
    const inner = unwrapIndicatorData(envelope)
    try {
      flattenCrossSection(inner)
      expect.unreachable("expected a shape mismatch")
    } catch (error) {
      expect((error as ApiError).traceId).toBe("826455848369786880")
    }
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
    }, "name", ["600519.SH", "09992.HK"]) as { list: Record<string, unknown>[] }
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
    }, "name", ["600519.SH"]) as { list: Record<string, unknown>[] }
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
    }, "name", ["600519.SH"]) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "收盘价", "成交量"])
  })

  it("keeps the security axis when a sector expands to a single constituent", () => {
    // A sector may hold one member, or the rest may have been dropped for lack
    // of data. Either way the caller asked "which securities" — an indicator-named
    // column would erase whose series this is, and the sector ID is skipped by the
    // dropped-row check so nothing else would flag it.
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-31"],
      values: [[1350.6]],
    }, "name", ["1000000287"]) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "贵州茅台"])
  })

  it("keeps the security axis for a sector mixed with a plain code", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-31"],
      values: [[1350.6]],
    }, "name", ["1000000287", "002594.SZ"]) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "贵州茅台"])
  })

  it("uses the indicator axis for a genuinely single-security request", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "finc_pe_ttm", name: "市盈率(TTM)" }],
      dates: ["2026-07-30"],
      values: [[20.5804]],
    }, "name", ["600519.SH"]) as { list: Record<string, unknown>[] }
    expect(Object.keys(out.list[0])).toEqual(["date", "市盈率(TTM)"])
  })

  it("throws when a series is shorter than the date list", () => {
    // A cross-market TD query pads every security to the union of trading days —
    // each market's own holidays come back as null (probed 2026-08-02: 09992.HK
    // null on 07-01, AAPL.O null on 07-03). A short series is a layout change.
    expect(() => flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-30", "2026-07-31"],
      values: [[1350.6]],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("throws when a series is not an array at all", () => {
    expect(() => flattenTimeSeries({
      securityCodeList: ["600519.SH"],
      securityNameList: ["贵州茅台"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-31"],
      values: [1350.6],
    }, "name", ["600519.SH"])).toThrow(ApiError)
  })

  it("keeps a holiday-padded null series", () => {
    const out = flattenTimeSeries({
      securityCodeList: ["09992.HK"],
      securityNameList: ["泡泡玛特"],
      indicatorList: [{ code: "qte_close", name: "收盘价" }],
      dates: ["2026-07-01", "2026-07-02"],
      values: [[null, 162.6]],
    }, "name", ["600519.SH"]) as { list: Record<string, unknown>[] }
    expect(out.list.map((row) => row.收盘价)).toEqual([null, 162.6])
  })

  it("carries the response through as ApiError details so the traceId survives", () => {
    const payload = { securityCodeList: ["600519.SH", "09992.HK"], securityNameList: ["贵州茅台", "泡泡玛特"], indicatorList: [{ code: "qte_close" }], values: [[1]] }
    attachEnvelopeTraceId(payload, "826455848369786880")
    try {
      flattenCrossSection(payload)
      expect.unreachable("expected a shape mismatch")
    } catch (error) {
      expect((error as ApiError).traceId).toBe("826455848369786880")
    }
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

  it("rejects a payload that is not a matrix at all", () => {
    expect(() => flattenTimeSeries(undefined)).toThrow(ApiError)
    expect(() => flattenTimeSeries({ foo: 1 })).toThrow(ApiError)
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
