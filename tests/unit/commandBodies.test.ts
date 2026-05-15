import { describe, expect, it } from "vitest"

import { buildQuoteKlineBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "../../src/core/commandBodies.js"

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
})
