import { Command } from "commander"
import { describe, expect, it } from "vitest"

import { collectList } from "../../src/core/args.js"
import { buildIndicatorCrossSectionBody, buildIndicatorScreenerBody, buildIndicatorTimeSeriesBody, buildQuoteKlineBody, buildStockPoolStocksBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "../../src/core/commandBodies.js"

describe("command request body builders", () => {
  it("builds quote kline bodies with securities, dates, limit, and fields", () => {
    expect(buildQuoteKlineBody({
      security: ["000001.SH", "399001.SZ"],
      startDate: "2024-05-01",
      endDate: "2024-05-20",
      limit: "5000",
      field: ["securityCode", "tradeDate", "open", "close", "volume"],
    })).toEqual({
      securityList: ["000001.SH", "399001.SZ"],
      startDate: "2024-05-01",
      endDate: "2024-05-20",
      limit: 5000,
      fieldList: ["securityCode", "tradeDate", "open", "close", "volume"],
    })
  })

  it("builds wechat message list bodies with all filters", () => {
    expect(buildWechatMessageListBody({
      from: "5",
      size: "50",
      startTime: "2024-03-01 00:00:00",
      endTime: "2024-03-02 23:59:59",
      keyword: "AI应用",
      security: ["000001.SZ", "000063.SH"],
      wechatGroupId: ["ueKEGyhdjFGkjyebh", "TYkuhyhdjFGkjyebh"],
      industry: ["100800101", "100800102"],
      category: ["text", "url"],
      tag: ["roadShow", "meetingSummary"],
    })).toEqual({
      from: 5,
      size: 50,
      startTime: "2024-03-01 00:00:00",
      endTime: "2024-03-02 23:59:59",
      keyword: "AI应用",
      securityList: ["000001.SZ", "000063.SH"],
      wechatGroupIdList: ["ueKEGyhdjFGkjyebh", "TYkuhyhdjFGkjyebh"],
      industryIdList: ["100800101", "100800102"],
      categoryList: ["text", "url"],
      tagList: ["roadShow", "meetingSummary"],
    })
  })

  it("builds wechat chatroom list bodies with comma-joined room names", () => {
    expect(buildWechatChatroomListBody({
      from: "0",
      size: "50",
      roomName: ["AI学习群", "柚子消息共享群", "投研分享群"],
    })).toEqual({
      from: 0,
      size: 50,
      roomName: "AI学习群,柚子消息共享群,投研分享群",
    })
  })

  it("builds indicator cross-section bodies with codes, universe, currency/scale, and params", () => {
    expect(buildIndicatorCrossSectionBody({
      indicator: ["qte_close", "qte_vol"],
      security: ["600519.SH", "09992.HK"],
      date: "2026-05-18",
      currency: "DFT",
      scale: "0",
      indicatorParam: ["qte_close:adjustType=1"],
    })).toEqual({
      indicatorCodeList: ["qte_close", "qte_vol"],
      universe: ["600519.SH", "09992.HK"],
      currency: "DFT",
      scale: "0",
      // No root-level `date` any more: --date fans out to each indicator's tradeDate.
      indicatorParamList: [
        { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustType", paramValue: "1" }, { paramKey: "tradeDate", paramValue: "2026-05-18" }] },
        { indicatorCode: "qte_vol", parameters: [{ paramKey: "tradeDate", paramValue: "2026-05-18" }] },
      ],
    })
  })

  it("does not override a caller-supplied tradeDate with --date", () => {
    expect(buildIndicatorCrossSectionBody({
      indicator: ["qte_close"],
      security: ["600519.SH"],
      date: "2026-05-18",
      indicatorParam: ["qte_close:tradeDate=2024-01-02"],
    })).toMatchObject({
      indicatorParamList: [
        { indicatorCode: "qte_close", parameters: [{ paramKey: "tradeDate", paramValue: "2024-01-02" }] },
      ],
    })
  })

  it("still sends tradeDate when the caller supplied only sDate (interval start, not a substitute)", () => {
    // qte_vol_intvl declares tradeDate REQUIRED (the interval end) and sDate
    // optional (the start). Treating sDate as a replacement dropped --date and
    // moved the interval end silently: probed 2026-08-02, 茅台 with sDate alone
    // returned 2,265,873,849 vs 65,687,435 with tradeDate=2024-01-31 — both exit 0.
    expect(buildIndicatorCrossSectionBody({
      indicator: ["qte_vol_intvl"],
      security: ["600519.SH"],
      date: "2024-01-31",
      indicatorParam: ["qte_vol_intvl:sDate=2024-01-02"],
    })).toMatchObject({
      indicatorParamList: [
        { indicatorCode: "qte_vol_intvl", parameters: [{ paramKey: "sDate", paramValue: "2024-01-02" }, { paramKey: "tradeDate", paramValue: "2024-01-31" }] },
      ],
    })
  })

  it("leaves a report-period indicator on its own reportDate instead of adding tradeDate", () => {
    // Probed 2026-08-01: is_op_rev_mom answers a tradeDate with an EMPTY result,
    // not an error — injecting one alongside reportDate would silently blank the
    // column.
    expect(buildIndicatorCrossSectionBody({
      indicator: ["is_op_rev_mom"],
      security: ["600519.SH"],
      date: "2026-05-18",
      indicatorParam: ["is_op_rev_mom:reportDate=2024-12-31"],
    })).toMatchObject({
      indicatorParamList: [
        { indicatorCode: "is_op_rev_mom", parameters: [{ paramKey: "reportDate", paramValue: "2024-12-31" }] },
      ],
    })
  })

  it("omits empty indicator/security lists and unset options from the cross-section body", () => {
    expect(buildIndicatorCrossSectionBody({
      indicator: [],
      security: [],
      date: "2026-05-18",
      indicatorParam: [],
    })).toEqual({
      indicatorCodeList: undefined,
      universe: undefined,
      currency: undefined,
      scale: undefined,
      indicatorParamList: [],
    })
  })

  it("builds indicator time-series bodies with date range, calendar type, and params", () => {
    expect(buildIndicatorTimeSeriesBody({
      indicator: ["qte_close"],
      security: ["600519.SH", "09992.HK"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      calendarType: "TD",
      currency: "CNY",
      scale: "4",
      indicatorParam: ["qte_close:adjustType=1"],
    })).toEqual({
      indicatorCodeList: ["qte_close"],
      universe: ["600519.SH", "09992.HK"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      calendarType: "TD",
      currency: "CNY",
      scale: "4",
      indicatorParamList: [
        { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustType", paramValue: "1" }] },
      ],
    })
  })

  it("omits calendar type and currency/scale from the time-series body when unset, keeping an empty param list", () => {
    expect(buildIndicatorTimeSeriesBody({
      indicator: ["qte_close"],
      security: ["600519.SH"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      indicatorParam: [],
    })).toEqual({
      indicatorCodeList: ["qte_close"],
      universe: ["600519.SH"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      calendarType: undefined,
      currency: undefined,
      scale: undefined,
      // The endpoint requires the key even with nothing to configure.
      indicatorParamList: [],
    })
  })

  it("builds a screener body with variable bindings, expression, and per-variable params", () => {
    expect(buildIndicatorScreenerBody({
      indicator: ["F1:qte_mkt_cptl", "F2:finc_pe_ttm"],
      security: ["600519.SH", "1000000287"],
      expression: "F1 >= 800 && F2 <= 30",
      date: "2026-07-31",
      indicatorParam: ["F1:scale=8"],
    })).toEqual({
      universe: ["600519.SH", "1000000287"],
      expression: "F1 >= 800 && F2 <= 30",
      indicatorList: [
        { field: "F1", indicatorCode: "qte_mkt_cptl", parameters: [{ paramKey: "scale", paramValue: "8" }, { paramKey: "tradeDate", paramValue: "2026-07-31" }] },
        { field: "F2", indicatorCode: "finc_pe_ttm", parameters: [{ paramKey: "tradeDate", paramValue: "2026-07-31" }] },
      ],
    })
  })

  it("keeps two variables on the same indicator separate, each with its own date", () => {
    // This asserts the BODY only. The API specifies one code under two variables
    // (the same price on two dates), but the server currently resolves all of
    // them from the earliest date among the bindings and nulls the rest — probed
    // 2026-08-03, and a fix is in flight.
    // `indicator screener` warns on stderr; the body must already be correct so
    // the feature works the moment the server does.
    expect(buildIndicatorScreenerBody({
      indicator: ["F1:qte_close", "F2:qte_close"],
      security: ["600519.SH"],
      expression: "F1 > F2",
      date: "2026-07-31",
      indicatorParam: ["F2:tradeDate=2024-01-02"],
    })).toEqual({
      universe: ["600519.SH"],
      expression: "F1 > F2",
      indicatorList: [
        { field: "F1", indicatorCode: "qte_close", parameters: [{ paramKey: "tradeDate", paramValue: "2026-07-31" }] },
        { field: "F2", indicatorCode: "qte_close", parameters: [{ paramKey: "tradeDate", paramValue: "2024-01-02" }] },
      ],
    })
  })

  it("still attaches a date to a screener indicator that declares no parameters", () => {
    // pty_op_scope's parameterList is empty, so `parameters: []` would look
    // right — the date rides along anyway. One rule for the whole list beats a
    // per-indicator exception, and a parameterless indicator answers normally
    // with a stray tradeDate attached.
    //
    // Through 2026-08-02 this was also load-bearing: the screener DROPPED any
    // indicator sent with `parameters: []`, so the official doc's own
    // `F3 contains '酒'` example could not work as written. Re-probed 2026-08-03:
    // fixed server-side. The behaviour is kept for the reasons above, and because
    // it survives a rollback.
    expect(buildIndicatorScreenerBody({
      indicator: ["F1:pty_op_scope"],
      security: ["600519.SH"],
      expression: "F1 contains '酒'",
      date: "2026-07-31",
      indicatorParam: [],
    })).toEqual({
      universe: ["600519.SH"],
      expression: "F1 contains '酒'",
      indicatorList: [{ field: "F1", indicatorCode: "pty_op_scope", parameters: [{ paramKey: "tradeDate", paramValue: "2026-07-31" }] }],
    })
  })

  it("rejects a screener param that binds to no variable", () => {
    expect(() => buildIndicatorScreenerBody({
      indicator: ["F1:qte_close"],
      security: ["600519.SH"],
      expression: "F1 > 0",
      date: "2026-07-31",
      indicatorParam: ["F2:tradeDate=2026-07-31"],
    })).toThrow(/F2/)
  })

  it("rejects an expression referencing a variable no --indicator binds", () => {
    // The server does catch this (100003), but only after a billed round trip.
    expect(() => buildIndicatorScreenerBody({
      indicator: ["F1:qte_close"],
      security: ["600519.SH"],
      expression: "F1 > 0 && F2 <= 30",
      date: "2026-07-31",
      indicatorParam: [],
    })).toThrow(/F2/)
  })

  it("does not mistake an F-token inside a string literal for a variable reference", () => {
    expect(buildIndicatorScreenerBody({
      indicator: ["F1:pty_op_scope"],
      security: ["600519.SH"],
      expression: "F1 contains 'F2 系列'",
      date: "2026-07-31",
      indicatorParam: [],
    })).toMatchObject({ expression: "F1 contains 'F2 系列'" })
  })
})

// Drives a real Commander command wired exactly as cli.ts wires
// `vault stock-pool-stocks`, so the test covers the collectList option default
// interaction (Commander passes the option default in as `previous` on the
// first collect — a non-empty default would leak into every explicit value).
function resolveStockPoolBody(argv: string[]): unknown {
  let body: unknown
  const program = new Command()
  program
    .command("stock-pool-stocks")
    .option("--pool-id <id>", "Pool ID; repeat for multiple; omit for all pools", collectList)
    .action((options) => {
      body = buildStockPoolStocksBody(options)
    })
  program.parse(argv, { from: "user" })
  return body
}

describe("stock-pool-stocks pool-id filtering", () => {
  it("filters by an explicit pool id without injecting 'all'", () => {
    expect(resolveStockPoolBody(["stock-pool-stocks", "--pool-id", "123"])).toEqual({ poolIdList: ["123"] })
  })

  it("keeps multiple pool ids", () => {
    expect(resolveStockPoolBody(["stock-pool-stocks", "--pool-id", "111", "--pool-id", "222"])).toEqual({ poolIdList: ["111", "222"] })
  })

  it("falls back to all pools when --pool-id is omitted", () => {
    expect(resolveStockPoolBody(["stock-pool-stocks"])).toEqual({ poolIdList: ["all"] })
  })

  it("treats an explicit --pool-id all as all pools", () => {
    expect(resolveStockPoolBody(["stock-pool-stocks", "--pool-id", "all"])).toEqual({ poolIdList: ["all"] })
  })
})
