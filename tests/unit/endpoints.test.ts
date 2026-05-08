import { describe, expect, it } from "vitest"

import { ENDPOINTS, type EndpointDefinition } from "../../src/core/endpoints.js"

describe("ENDPOINTS", () => {
  it("all entries have valid keys, methods, paths, kinds, and descriptions", () => {
    for (const [name, ep] of Object.entries(ENDPOINTS)) {
      expect(ep.key, `${name}.key`).toBeTruthy()
      expect(["GET", "POST"], `${name}.method`).toContain(ep.method)
      expect(ep.path, `${name}.path`).toMatch(/^\//)
      expect(["json", "download"], `${name}.kind`).toContain(ep.kind)
      expect(ep.description, `${name}.description`).toBeTruthy()
    }
  })

  it("pagination entries have enabled:true and maxPageSize > 0", () => {
    for (const [name, ep] of Object.entries(ENDPOINTS)) {
      if (ep.pagination) {
        expect(ep.pagination.enabled, `${name}.pagination.enabled`).toBe(true)
        expect(ep.pagination.maxPageSize, `${name}.pagination.maxPageSize`).toBeGreaterThan(0)
      }
    }
  })

  it("every map key matches the endpoint's key field", () => {
    for (const [mapKey, ep] of Object.entries(ENDPOINTS)) {
      expect(ep.key).toBe(mapKey)
    }
  })

  it("no duplicate keys", () => {
    const keys = Object.values(ENDPOINTS).map((ep: EndpointDefinition) => ep.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("lookup endpoints use /guide/ prefix for local routing", () => {
    const lookupEndpoints = Object.values(ENDPOINTS).filter((ep) => ep.key.startsWith("lookup."))
    for (const ep of lookupEndpoints) {
      expect(ep.path, `${ep.key}.path`).toMatch(/^\/guide\//)
    }
  })

  it("download endpoints use GET method", () => {
    const downloadEndpoints = Object.values(ENDPOINTS).filter((ep) => ep.kind === "download")
    for (const ep of downloadEndpoints) {
      expect(ep.method, `${ep.key}.method`).toBe("GET")
    }
  })

  it("paginated list endpoints use POST method", () => {
    const paginatedEndpoints = Object.values(ENDPOINTS).filter((ep) => ep.pagination?.enabled)
    for (const ep of paginatedEndpoints) {
      expect(ep.method, `${ep.key}.method`).toBe("POST")
    }
  })

  it("includes all expected fundamental endpoints", () => {
    const fundamentalKeys = Object.values(ENDPOINTS)
      .filter((ep) => ep.key.startsWith("fundamental."))
      .map((ep) => ep.key)
    expect(fundamentalKeys).toContain("fundamental.income-statement")
    expect(fundamentalKeys).toContain("fundamental.balance-sheet")
    expect(fundamentalKeys).toContain("fundamental.cash-flow")
    expect(fundamentalKeys).toContain("fundamental.main-business")
    expect(fundamentalKeys).toContain("fundamental.valuation-analysis")
    expect(fundamentalKeys).toContain("fundamental.earning-forecast")
    expect(fundamentalKeys).toContain("fundamental.top-holders")
  })

  it("income-statement uses the /accumulated path", () => {
    expect(ENDPOINTS["fundamental.income-statement"].path).toBe(
      "/application/open-fundamental/financial-report/income-statement/accumulated",
    )
  })

  it("balance-sheet uses the /accumulated path", () => {
    expect(ENDPOINTS["fundamental.balance-sheet"].path).toBe(
      "/application/open-fundamental/financial-report/balance-sheet/accumulated",
    )
  })

  it("cash-flow uses the /accumulated path", () => {
    expect(ENDPOINTS["fundamental.cash-flow"].path).toBe(
      "/application/open-fundamental/financial-report/cash-flow-statement/accumulated",
    )
  })

  it("includes earnings-review get-id and get-content endpoints", () => {
    expect(ENDPOINTS["ai.earnings-review.get-id"]).toBeDefined()
    expect(ENDPOINTS["ai.earnings-review.get-content"]).toBeDefined()
  })

  it("includes quote day-kline and day-kline-hk endpoints", () => {
    expect(ENDPOINTS["quote.day-kline"]).toBeDefined()
    expect(ENDPOINTS["quote.day-kline-hk"]).toBeDefined()
  })

  it("includes quote index-day-kline endpoint", () => {
    const ep = ENDPOINTS["quote.index-day-kline"]
    expect(ep).toBeDefined()
    expect(ep.key).toBe("quote.index-day-kline")
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/index/kline/daily")
    expect(ep.kind).toBe("json")
  })

  it("A-share day-kline uses /open-quote/kline/daily path", () => {
    const ep = ENDPOINTS["quote.day-kline"]
    expect(ep.key).toBe("quote.day-kline")
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/kline/daily")
    expect(ep.kind).toBe("json")
  })

  it("HK stock day-kline uses /open-quote/kline-hk/daily path", () => {
    const ep = ENDPOINTS["quote.day-kline-hk"]
    expect(ep.key).toBe("quote.day-kline-hk")
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/kline-hk/daily")
    expect(ep.kind).toBe("json")
  })

  it("includes hot-topic endpoint with pagination", () => {
    const ep = ENDPOINTS["ai.hot-topic"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-ai/hot-topic/getList")
    expect(ep.pagination).toEqual({ enabled: true, maxPageSize: 20 })
  })

  it("includes management-discuss-announcement endpoint", () => {
    const ep = ENDPOINTS["ai.management-discuss-announcement"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-ai/management-discuss/from-announcement")
    expect(ep.kind).toBe("json")
  })

  it("includes management-discuss-earnings-call endpoint", () => {
    const ep = ENDPOINTS["ai.management-discuss-earnings-call"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-ai/management-discuss/from-earningsCall")
    expect(ep.kind).toBe("json")
  })

  it("includes viewpoint-debate get-id and get-content endpoints", () => {
    const getId = ENDPOINTS["ai.viewpoint-debate.get-id"]
    expect(getId).toBeDefined()
    expect(getId.method).toBe("POST")
    expect(getId.path).toBe("/application/open-ai/agent/viewpoint-debate-getid")
    const getContent = ENDPOINTS["ai.viewpoint-debate.get-content"]
    expect(getContent).toBeDefined()
    expect(getContent.method).toBe("POST")
    expect(getContent.path).toBe("/application/open-ai/agent/viewpoint-debate-getcontent")
  })

  it("includes minute-kline endpoint", () => {
    const ep = ENDPOINTS["quote.minute-kline"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/kline/minute")
    expect(ep.kind).toBe("json")
  })

  it("includes income-statement-quarterly endpoint", () => {
    const ep = ENDPOINTS["fundamental.income-statement-quarterly"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-fundamental/financial-report/income-statement/quarterly")
    expect(ep.kind).toBe("json")
  })

  it("includes cash-flow-quarterly endpoint", () => {
    const ep = ENDPOINTS["fundamental.cash-flow-quarterly"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-fundamental/financial-report/cash-flow-statement/quarterly")
    expect(ep.kind).toBe("json")
  })

  it("vault drive endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["vault.drive.list"]
    expect(list.key).toBe("vault.drive.list")
    expect(list.path).toBe("/application/open-vault/drive/getList")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["vault.drive.download"]
    expect(download.key).toBe("vault.drive.download")
    expect(download.path).toBe("/application/open-vault/drive/download/file")
    expect(download.kind).toBe("download")
    expect(download.method).toBe("GET")
  })

  it("includes earning-forecast endpoint", () => {
    const ep = ENDPOINTS["fundamental.earning-forecast"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-fundamental/earning-forecast")
    expect(ep.kind).toBe("json")
  })

  it("includes top-holders endpoint", () => {
    const ep = ENDPOINTS["fundamental.top-holders"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-fundamental/capital-structure/top-holders")
    expect(ep.kind).toBe("json")
  })

  it("vault record endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["vault.record.list"]
    expect(list.key).toBe("vault.record.list")
    expect(list.path).toBe("/application/open-vault/record/getList")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["vault.record.download"]
    expect(download.key).toBe("vault.record.download")
    expect(download.path).toBe("/application/open-vault/record/download/file")
    expect(download.kind).toBe("download")
    expect(download.method).toBe("GET")
  })

  it("vault my-conference endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["vault.my-conference.list"]
    expect(list.key).toBe("vault.my-conference.list")
    expect(list.path).toBe("/application/open-vault/my-conference/getList")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["vault.my-conference.download"]
    expect(download.key).toBe("vault.my-conference.download")
    expect(download.path).toBe("/application/open-vault/my-conference/download/file")
    expect(download.kind).toBe("download")
    expect(download.method).toBe("GET")
  })

  it("vault wechat message endpoints use correct keys and paths", () => {
    const message = ENDPOINTS["vault.wechat-message.list"]
    expect(message.key).toBe("vault.wechat-message.list")
    expect(message.path).toBe("/application/open-vault/wechatgroupmsg/list")
    expect(message.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const chatroom = ENDPOINTS["vault.wechat-chatroom.list"]
    expect(chatroom.key).toBe("vault.wechat-chatroom.list")
    expect(chatroom.path).toBe("/application/open-vault/wechatgroupmsg/chatroomId")
    expect(chatroom.kind).toBe("json")
    expect(chatroom.method).toBe("POST")
  })
})
