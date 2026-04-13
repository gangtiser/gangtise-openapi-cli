import { describe, expect, it } from "vitest"

import { ENDPOINTS, ENDPOINT_REGISTRY, type EndpointDefinition } from "../../src/core/endpoints.js"

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

  it("every endpoint key is registered in ENDPOINT_REGISTRY", () => {
    for (const ep of Object.values(ENDPOINTS)) {
      expect(ENDPOINT_REGISTRY[ep.key]).toBeDefined()
      expect(ENDPOINT_REGISTRY[ep.key].key).toBe(ep.key)
    }
  })

  it("no duplicate keys in ENDPOINT_REGISTRY", () => {
    const keys = Object.values(ENDPOINTS).map((ep) => ep.key)
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
  })

  it("income-statement uses the /accumulated path", () => {
    expect(ENDPOINTS.fundamentalIncomeStatement.path).toBe(
      "/application/open-fundamental/financial-report/income-statement/accumulated",
    )
  })

  it("balance-sheet uses the /accumulated path", () => {
    expect(ENDPOINTS.fundamentalBalanceSheet.path).toBe(
      "/application/open-fundamental/financial-report/balance-sheet/accumulated",
    )
  })

  it("cash-flow uses the /accumulated path", () => {
    expect(ENDPOINTS.fundamentalCashFlow.path).toBe(
      "/application/open-fundamental/financial-report/cash-flow-statement/accumulated",
    )
  })

  it("includes earnings-review get-id and get-content endpoints", () => {
    expect(ENDPOINT_REGISTRY["ai.earnings-review.get-id"]).toBeDefined()
    expect(ENDPOINT_REGISTRY["ai.earnings-review.get-content"]).toBeDefined()
  })

  it("includes quote day-kline and day-kline-hk endpoints", () => {
    expect(ENDPOINT_REGISTRY["quote.day-kline"]).toBeDefined()
    expect(ENDPOINT_REGISTRY["quote.day-kline-hk"]).toBeDefined()
  })

  it("A-share day-kline uses /open-quote/kline/daily path", () => {
    expect(ENDPOINTS.quoteDayKline.key).toBe("quote.day-kline")
    expect(ENDPOINTS.quoteDayKline.method).toBe("POST")
    expect(ENDPOINTS.quoteDayKline.path).toBe("/application/open-quote/kline/daily")
    expect(ENDPOINTS.quoteDayKline.kind).toBe("json")
  })

  it("HK stock day-kline uses /open-quote/kline-hk/daily path", () => {
    expect(ENDPOINTS.quoteDayKlineHk.key).toBe("quote.day-kline-hk")
    expect(ENDPOINTS.quoteDayKlineHk.method).toBe("POST")
    expect(ENDPOINTS.quoteDayKlineHk.path).toBe("/application/open-quote/kline-hk/daily")
    expect(ENDPOINTS.quoteDayKlineHk.kind).toBe("json")
  })

  it("vault drive endpoints use correct keys and paths", () => {
    expect(ENDPOINTS.vaultDriveList.key).toBe("vault.drive.list")
    expect(ENDPOINTS.vaultDriveList.path).toBe("/application/open-vault/drive/getList")
    expect(ENDPOINTS.vaultDriveList.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    expect(ENDPOINTS.vaultDriveDownload.key).toBe("vault.drive.download")
    expect(ENDPOINTS.vaultDriveDownload.path).toBe("/application/open-vault/drive/download/file")
    expect(ENDPOINTS.vaultDriveDownload.kind).toBe("download")
    expect(ENDPOINTS.vaultDriveDownload.method).toBe("GET")
  })
})
