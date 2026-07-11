import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ENDPOINTS, listEndpoints, resolveTimeoutMs } from "../../src/core/endpoints.js"

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

  // (key-matches-record-key and no-duplicate-keys guards removed: `key` is now
  // derived from the record key in endpoints.ts, so drift is structurally impossible.)

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

  it("includes quote day-kline-us endpoint", () => {
    const ep = ENDPOINTS["quote.day-kline-us"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/kline-us/daily")
    expect(ep.kind).toBe("json")
  })

  it("includes quote realtime endpoint", () => {
    const ep = ENDPOINTS["quote.realtime"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/quote/realtime")
    expect(ep.kind).toBe("json")
  })

  it("fund-flow endpoint uses open-quote path and is unpaginated", () => {
    const ep = ENDPOINTS["quote.fund-flow"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-quote/fund-flow/daily")
    expect(ep.kind).toBe("json")
    expect(ep.pagination).toBeUndefined()
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

  it("alternative concept endpoints use correct keys and paths", () => {
    const info = ENDPOINTS["alternative.concept-info"]
    expect(info).toBeDefined()
    expect(info.key).toBe("alternative.concept-info")
    expect(info.method).toBe("POST")
    expect(info.path).toBe("/application/open-alternative/concept/info")
    expect(info.kind).toBe("json")

    const securities = ENDPOINTS["alternative.concept-securities"]
    expect(securities).toBeDefined()
    expect(securities.key).toBe("alternative.concept-securities")
    expect(securities.method).toBe("POST")
    expect(securities.path).toBe("/application/open-alternative/concept/securities")
    expect(securities.kind).toBe("json")
  })

  it("official-account endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["insight.official-account.list"]
    expect(list).toBeDefined()
    expect(list.key).toBe("insight.official-account.list")
    expect(list.method).toBe("POST")
    expect(list.path).toBe("/application/open-insight/officialAccount/getList")
    expect(list.kind).toBe("json")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["insight.official-account.download"]
    expect(download).toBeDefined()
    expect(download.key).toBe("insight.official-account.download")
    expect(download.method).toBe("GET")
    expect(download.path).toBe("/application/open-insight/officialAccount/download/file")
    expect(download.kind).toBe("download")
  })

  it("reference constant/concept/sector endpoints use correct keys and paths", () => {
    const category = ENDPOINTS["reference.constant-category"]
    expect(category.method).toBe("GET")
    expect(category.path).toBe("/application/open-reference/constants/category")
    expect(category.kind).toBe("json")

    const constants = ENDPOINTS["reference.constant-list"]
    expect(constants.method).toBe("POST")
    expect(constants.path).toBe("/application/open-reference/constants/getList")

    const concepts = ENDPOINTS["reference.concept-search"]
    expect(concepts.method).toBe("POST")
    expect(concepts.path).toBe("/application/open-reference/concepts/search")

    const sectors = ENDPOINTS["reference.sector-search"]
    expect(sectors.method).toBe("POST")
    expect(sectors.path).toBe("/application/open-reference/sectors/search")

    const constituents = ENDPOINTS["reference.sector-constituents"]
    expect(constituents.method).toBe("POST")
    expect(constituents.path).toBe("/application/open-reference/sectors/constituents")
  })

  it("only local-data lookup endpoints remain (API-covered ones removed)", () => {
    const lookupKeys = Object.keys(ENDPOINTS).filter((k) => k.startsWith("lookup.")).sort()
    expect(lookupKeys).toEqual([
      "lookup.broker-orgs.list",
      "lookup.meeting-orgs.list",
    ])
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
    // Server switched to { total, list }; auto-paginates by total (no sequential/listKey).
    expect(chatroom.pagination).toEqual({ enabled: true, maxPageSize: 50 })
  })

  it("indicator (EDE) endpoints use correct keys and paths and are unpaginated", () => {
    const search = ENDPOINTS["indicator.search"]
    expect(search).toBeDefined()
    expect(search.key).toBe("indicator.search")
    expect(search.method).toBe("POST")
    expect(search.path).toBe("/application/open-indicator/EDE/search")
    expect(search.kind).toBe("json")

    const crossSection = ENDPOINTS["indicator.cross-section"]
    expect(crossSection).toBeDefined()
    expect(crossSection.key).toBe("indicator.cross-section")
    expect(crossSection.method).toBe("POST")
    expect(crossSection.path).toBe("/application/open-indicator/EDE/cross-section")
    expect(crossSection.kind).toBe("json")

    const timeSeries = ENDPOINTS["indicator.time-series"]
    expect(timeSeries).toBeDefined()
    expect(timeSeries.key).toBe("indicator.time-series")
    expect(timeSeries.method).toBe("POST")
    expect(timeSeries.path).toBe("/application/open-indicator/EDE/time-series")
    expect(timeSeries.kind).toBe("json")

    for (const ep of [search, crossSection, timeSeries]) {
      expect(ep.pagination, `${ep.key}.pagination`).toBeUndefined()
    }
  })

  it("US announcement endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["insight.announcement-us.list"]
    expect(list).toBeDefined()
    expect(list.key).toBe("insight.announcement-us.list")
    expect(list.method).toBe("POST")
    expect(list.path).toBe("/application/open-insight/announcement-us/getList")
    expect(list.kind).toBe("json")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["insight.announcement-us.download"]
    expect(download).toBeDefined()
    expect(download.key).toBe("insight.announcement-us.download")
    expect(download.method).toBe("GET")
    expect(download.path).toBe("/application/open-insight/announcement-us/download/file")
    expect(download.kind).toBe("download")
  })

  it("US financial report endpoints use correct keys and paths", () => {
    expect(ENDPOINTS["fundamental.income-statement-us"].path).toBe("/application/open-fundamental/financial-report/income-statement/us")
    expect(ENDPOINTS["fundamental.balance-sheet-us"].path).toBe("/application/open-fundamental/financial-report/balance-sheet/us")
    expect(ENDPOINTS["fundamental.cash-flow-us"].path).toBe("/application/open-fundamental/financial-report/cash-flow-statement/us")
    for (const k of ["fundamental.income-statement-us", "fundamental.balance-sheet-us", "fundamental.cash-flow-us"]) {
      expect(ENDPOINTS[k].method, `${k}.method`).toBe("POST")
      expect(ENDPOINTS[k].kind, `${k}.kind`).toBe("json")
    }
  })

  it("stock-summary endpoint uses open-ai path and is unpaginated", () => {
    const ep = ENDPOINTS["ai.stock-summary.list"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-ai/stock-summary/getList")
    expect(ep.kind).toBe("json")
    expect(ep.pagination).toBeUndefined()
  })

  it("chiefs-search endpoint uses correct key and path", () => {
    const ep = ENDPOINTS["reference.chiefs-search"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-reference/chiefs/search")
    expect(ep.kind).toBe("json")
  })

  it("institution-search endpoint uses correct key and path", () => {
    const ep = ENDPOINTS["reference.institution-search"]
    expect(ep).toBeDefined()
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-reference/institutions/search")
    expect(ep.kind).toBe("json")
    expect(ep.pagination).toBeUndefined()
  })

  it("QA (Q&A) endpoint uses the Q&A-data path and paginates at maxPageSize 500", () => {
    const ep = ENDPOINTS["insight.qa.list"]
    expect(ep).toBeDefined()
    expect(ep.key).toBe("insight.qa.list")
    expect(ep.method).toBe("POST")
    // The '&' in the path is intentional — it is the vendor's literal path segment.
    expect(ep.path).toBe("/application/open-insight/Q&A-data/getList")
    expect(ep.kind).toBe("json")
    expect(ep.pagination).toEqual({ enabled: true, maxPageSize: 500 })
  })

  it("report-image endpoints use correct keys, paths, and kinds", () => {
    const list = ENDPOINTS["insight.report-image.list"]
    expect(list).toBeDefined()
    expect(list.key).toBe("insight.report-image.list")
    expect(list.method).toBe("POST")
    expect(list.path).toBe("/application/open-insight/report-image/getList")
    expect(list.kind).toBe("json")
    // top-based (max 20), flat data array, no `total` → intentionally not auto-paginated.
    expect(list.pagination).toBeUndefined()

    const download = ENDPOINTS["insight.report-image.download"]
    expect(download).toBeDefined()
    expect(download.key).toBe("insight.report-image.download")
    expect(download.method).toBe("GET")
    expect(download.path).toBe("/application/open-insight/report-image/download/file")
    expect(download.kind).toBe("download")
  })

  it("official-account-search endpoint uses the open-reference path and is unpaginated", () => {
    const ep = ENDPOINTS["reference.official-account-search"]
    expect(ep).toBeDefined()
    expect(ep.key).toBe("reference.official-account-search")
    expect(ep.method).toBe("POST")
    expect(ep.path).toBe("/application/open-reference/officialAccount/search")
    expect(ep.kind).toBe("json")
    expect(ep.pagination).toBeUndefined()
  })

  it("marks per-call billed generation/submission endpoints as no-replay", () => {
    // Billing probed 2026-07-11: the platform charges per call with NO cache-hit
    // exemption, so replaying a 5xx/timeout on these fixed-price endpoints
    // double-bills. Per-ROW billed lists stay on the default policy — a failed
    // response returned no rows, so nothing was billed.
    const NO_REPLAY_KEYS = [
      "ai.one-pager",
      "ai.investment-logic",
      "ai.peer-comparison",
      "ai.theme-tracking",
      "ai.research-outline",
      "ai.management-discuss-announcement",
      "ai.management-discuss-earnings-call",
      "ai.hot-topic",
      "ai.knowledge-batch",
      "ai.earnings-review.get-id",
      "ai.viewpoint-debate.get-id",
      "alternative.concept-info",
      "alternative.concept-securities",
    ]
    for (const key of NO_REPLAY_KEYS) {
      expect(ENDPOINTS[key], key).toBeDefined()
      expect(ENDPOINTS[key].retry, key).toBe("no-replay")
    }
    // Per-row billed / read-only endpoints keep the default full-retry policy.
    expect(ENDPOINTS["ai.stock-summary.list"].retry).toBeUndefined()
    expect(ENDPOINTS["ai.earnings-review.get-content"].retry).toBeUndefined()
    expect(ENDPOINTS["ai.viewpoint-debate.get-content"].retry).toBeUndefined()
    expect(ENDPOINTS["insight.qa.list"].retry).toBeUndefined()
  })

  // Endpoint keys appear as bare string literals throughout cli.ts
  // (client.call("..."), addDownloadCommand({ endpointKey: "..." }), addKlineCommand(...)).
  // A typo only surfaces at runtime as "Unknown endpoint key"; this catches it at
  // test time. The regex matches a whole literal that is a lowercase dotted key
  // like "insight.research.list"; import paths ("./core/x.js") and code samples
  // ("000001.SZ") begin with "." or a digit and are excluded.
  it("every endpoint key referenced in cli.ts is registered", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/cli.ts"), "utf8")
    const groups = new Set(Object.keys(ENDPOINTS).map((key) => key.split(".")[0]))
    const KEY = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/
    const referenced = new Set<string>()
    for (const m of src.matchAll(/"([^"]*)"/g)) {
      // Require the first segment to be a real command group, so file-name
      // literals like "download.bin" don't masquerade as endpoint keys.
      if (KEY.test(m[1]) && groups.has(m[1].split(".")[0])) referenced.add(m[1])
    }

    expect(referenced.size).toBeGreaterThan(20) // sanity: the regex actually matched keys
    const missing = [...referenced].filter((key) => !(key in ENDPOINTS))
    expect(missing).toEqual([])
  })
})

describe("resolveTimeoutMs", () => {
  it("raises to the endpoint floor when the config timeout is lower", () => {
    expect(resolveTimeoutMs(30_000, { timeoutMs: 120_000 })).toBe(120_000)
  })

  it("keeps a higher user-configured timeout (floor never lowers it)", () => {
    expect(resolveTimeoutMs(200_000, { timeoutMs: 120_000 })).toBe(200_000)
  })

  it("uses the config timeout when the endpoint sets no floor", () => {
    expect(resolveTimeoutMs(30_000, {})).toBe(30_000)
  })
})

describe("AI generation endpoint timeouts", () => {
  // Synchronous generation blocks well past the 30s default; a timeout there
  // triggers a retry, and each retry can re-bill the generation. Give them a floor.
  it("gives synchronous generation endpoints a 120s timeout floor", () => {
    for (const key of [
      "ai.one-pager", "ai.investment-logic", "ai.peer-comparison",
      "ai.theme-tracking", "ai.research-outline",
      "ai.management-discuss-announcement", "ai.management-discuss-earnings-call",
    ]) {
      expect(ENDPOINTS[key].timeoutMs, `${key}.timeoutMs`).toBe(120_000)
    }
  })

  it("leaves fast list and async-polling AI endpoints on the default timeout", () => {
    for (const key of [
      "ai.hot-topic", "ai.stock-summary.list",
      "ai.earnings-review.get-id", "ai.earnings-review.get-content",
      "ai.viewpoint-debate.get-id", "ai.viewpoint-debate.get-content",
    ]) {
      expect(ENDPOINTS[key].timeoutMs, `${key}.timeoutMs`).toBeUndefined()
    }
  })
})

describe("listEndpoints", () => {
  it("returns every registered endpoint with its key/method/path/description", () => {
    const all = listEndpoints()
    expect(all.length).toBe(Object.keys(ENDPOINTS).length)
    expect(all.find((e) => e.key === "ai.one-pager")).toMatchObject({
      method: "POST",
      path: "/application/open-ai/agent/one-pager",
    })
  })
})
