import { Command } from "commander"
import { describe, expect, it } from "vitest"

import { collectList } from "../../src/core/args.js"
import { buildIndicatorCrossSectionBody, buildIndicatorTimeSeriesBody, buildQuoteKlineBody, buildStockPoolStocksBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "../../src/core/commandBodies.js"

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

  it("builds indicator cross-section bodies with codes, date, currency/scale, and params", () => {
    expect(buildIndicatorCrossSectionBody({
      indicator: ["qte_close", "qte_vol"],
      security: ["600519.SH", "09992.HK"],
      date: "2026-05-18",
      currency: "DFT",
      scale: "0",
      indicatorParam: ["qte_close:adjustmentType=1"],
    })).toEqual({
      indicatorCodeList: ["qte_close", "qte_vol"],
      securityCodeList: ["600519.SH", "09992.HK"],
      date: "2026-05-18",
      currency: "DFT",
      scale: "0",
      indicatorParamList: [
        { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustmentType", paramValue: "1" }] },
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
      securityCodeList: undefined,
      date: "2026-05-18",
      currency: undefined,
      scale: undefined,
      indicatorParamList: undefined,
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
      indicatorParam: ["qte_close:adjustmentType=1"],
    })).toEqual({
      indicatorCodeList: ["qte_close"],
      securityCodeList: ["600519.SH", "09992.HK"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      calendarType: "TD",
      currency: "CNY",
      scale: "4",
      indicatorParamList: [
        { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustmentType", paramValue: "1" }] },
      ],
    })
  })

  it("omits calendar type, currency/scale, and params from the time-series body when unset", () => {
    expect(buildIndicatorTimeSeriesBody({
      indicator: ["qte_close"],
      security: ["600519.SH"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      indicatorParam: [],
    })).toEqual({
      indicatorCodeList: ["qte_close"],
      securityCodeList: ["600519.SH"],
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      calendarType: undefined,
      currency: undefined,
      scale: undefined,
      indicatorParamList: undefined,
    })
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
