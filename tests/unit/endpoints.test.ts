import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ENDPOINTS, listEndpoints, NO_REPLAY_ABOVE_CREDITS, resolveTimeoutMs, worstRequestCredits } from "../../src/core/endpoints.js"

describe("ENDPOINTS", () => {
  it("all entries have valid keys, methods, paths, kinds, and descriptions", () => {
    for (const [name, ep] of Object.entries(ENDPOINTS)) {
      expect(ep.key, `${name}.key`).toBeTruthy()
      expect(["GET", "POST"], `${name}.method`).toContain(ep.method)
      expect(ep.path, `${name}.path`).toMatch(/^\//)
      expect(["json", "download", "upload"], `${name}.kind`).toContain(ep.kind)
      expect(ep.description, `${name}.description`).toBeTruthy()
    }
  })

  it("marks as unverified exactly the row ids known only from the response description", () => {
    // An unverified id is not trusted to flag a changed row (client.ts), so dropping the
    // mark from one of these lists would let a non-unique id mark every fetch partial.
    const unverified = Object.values(ENDPOINTS).filter((ep) => ep.rowIdUnverified).map((ep) => ep.key).sort()
    expect(unverified).toEqual(["insight.forum.list", "insight.independent-opinion.list", "insight.roadshow.list", "insight.site-visit.list", "insight.strategy.list"])
    for (const ep of Object.values(ENDPOINTS)) if (ep.rowIdUnverified) expect(ep.rowId, ep.key).toBeDefined()
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

  // Every download takes its parameters in the query string — except the file-parse
  // result endpoint, which the spec defines as POST + `{taskId}` JSON and answers
  // with the ZIP bytes. New POST downloads must be added here deliberately: the
  // client only sends a body when the method is POST.
  it("download endpoints use GET, except the documented POST ones", () => {
    const POST_DOWNLOADS = new Set(["tool.file-parse.result"])
    const downloadEndpoints = Object.values(ENDPOINTS).filter((ep) => ep.kind === "download")
    for (const ep of downloadEndpoints) {
      expect(ep.method, `${ep.key}.method`).toBe(POST_DOWNLOADS.has(ep.key) ? "POST" : "GET")
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
    expect(info.path).toBe("/application/open-alternative/concept/v2/info")
    expect(info.kind).toBe("json")

    const securities = ENDPOINTS["alternative.concept-securities"]
    expect(securities).toBeDefined()
    expect(securities.key).toBe("alternative.concept-securities")
    expect(securities.method).toBe("POST")
    expect(securities.path).toBe("/application/open-alternative/concept/v2/securities")
    expect(securities.kind).toBe("json")

    // `--full` reaches the v1 paths, which still carry keyEvents / isKey / inclusionReason.
    expect(ENDPOINTS["alternative.concept-info-full"].path).toBe("/application/open-alternative/concept/info")
    expect(ENDPOINTS["alternative.concept-securities-full"].path).toBe("/application/open-alternative/concept/securities")
  })

  it("opinion lists default to the v2 brief-only paths; bodies come from getDetail", () => {
    expect(ENDPOINTS["insight.opinion.list"].path).toBe("/application/open-insight/chief-opinion/v2/getList")
    expect(ENDPOINTS["insight.opinion.list-with-content"].path).toBe("/application/open-insight/chief-opinion/getList")
    expect(ENDPOINTS["insight.opinion.detail"].path).toBe("/application/open-insight/chief-opinion/getDetail")
    expect(ENDPOINTS["insight.foreign-opinion.list"].path).toBe("/application/open-insight/foreign-opinion/v2/getList")
    expect(ENDPOINTS["insight.foreign-opinion.list-with-content"].path).toBe("/application/open-insight/foreign-opinion/getList")
    expect(ENDPOINTS["insight.foreign-opinion.detail"].path).toBe("/application/open-insight/foreign-opinion/getDetail")
    // Detail is a fixed-size batch (≤20 IDs), never paged.
    expect(ENDPOINTS["insight.opinion.detail"].pagination).toBeUndefined()
    expect(ENDPOINTS["insight.foreign-opinion.detail"].pagination).toBeUndefined()
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
    // maxWindow: `total` stops at 10000 and an offset past it is refused (140002), probed 2026-09-25.
    expect(message.pagination).toEqual({ enabled: true, maxPageSize: 50, maxWindow: 10000 })

    const chatroom = ENDPOINTS["vault.wechat-chatroom.list"]
    expect(chatroom.key).toBe("vault.wechat-chatroom.list")
    expect(chatroom.path).toBe("/application/open-vault/wechatgroupmsg/chatroomId")
    expect(chatroom.kind).toBe("json")
    expect(chatroom.method).toBe("POST")
    // Server switched to { total, list }; auto-paginates by total (no sequential/listKey).
    expect(chatroom.pagination).toEqual({ enabled: true, maxPageSize: 50 })
  })

  it("performance-calendar endpoints use correct keys and paths", () => {
    const list = ENDPOINTS["insight.performance-calendar.list"]
    expect(list.method).toBe("POST")
    expect(list.path).toBe("/application/open-insight/schedule/performance-calendar/getList")
    expect(list.kind).toBe("json")
    expect(list.pagination).toEqual({ enabled: true, maxPageSize: 50 })

    const download = ENDPOINTS["insight.performance-calendar.download"]
    expect(download.method).toBe("GET")
    expect(download.path).toBe("/application/open-insight/schedule/performance-calendar/download/file")
    expect(download.kind).toBe("download")
  })

  it("file-parse endpoints: submit is a no-replay upload, result is a POST download", () => {
    const submit = ENDPOINTS["tool.file-parse.submit"]
    expect(submit.method).toBe("POST")
    expect(submit.path).toBe("/application/open-tool/file-parse/submit")
    expect(submit.kind).toBe("upload")
    // Billed per page at submit time — a replayed upload bills the whole file again.
    expect(submit.retry).toBe("no-replay")
    expect(resolveTimeoutMs(30_000, submit)).toBe(300_000)

    const result = ENDPOINTS["tool.file-parse.result"]
    expect(result.method).toBe("POST")
    expect(result.path).toBe("/application/open-tool/file-parse/result")
    expect(result.kind).toBe("download")
    // Fetching the result is free: leave it on the default retry policy.
    expect(result.retry).toBeUndefined()
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

  it("marks the replay-unsafe endpoints as no-replay", () => {
    // A replay of a request the server may already have executed double-bills, so
    // these never resend a 5xx/timeout. Most are per-call billed with NO cache-hit
    // exemption (probed 2026-07-11); `ai.hot-topic` is the exception — priced per
    // returned item, marked because replaying a page could re-bill rows already
    // delivered. So do NOT read this list as "the per-call billed endpoints":
    // reading the flag that way is what once made the total-cap probe skip
    // `ai.hot-topic` (see client.ts). Ordinary lists stay on the default policy —
    // a failed response returned no rows, so nothing was billed.
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
      "alternative.concept-info-full",
      "alternative.concept-securities-full",
      // 30 credits per returned body: the detail batches and the v1 lists behind
      // --with-content.
      "insight.opinion.detail",
      "insight.foreign-opinion.detail",
      "insight.opinion.list-with-content",
      "insight.foreign-opinion.list-with-content",
      // 50/篇 downloads — same price tier as the AI Agent calls.
      "insight.summary.download",
      "insight.foreign-report.download",
      "vault.my-conference.download",
      // Price undocumented (the spec states an entitlement, not a per-call
      // charge); classed with its summary sibling so a replay cannot double-bill.
      "insight.pamirs-summary.download",
      // Billed per page AT SUBMIT — a replayed submit re-parses and re-charges.
      "tool.file-parse.submit",
      // 1 credit per call, charged on a successful answer.
      "tool.web-search",
      // 5 credits per ROW: replaying a page re-bills rows already delivered.
      "insight.highlight.list",
      // 3 per row and up to 6000 codes per call: one replay can re-bill 18000 credits.
      "ai.stock-summary.list",
      // 0.5 per row with rows bounded only by the account's history window.
      "fundamental.earning-forecast",
      // The whole bond family is metered (0.4 per call, or per row / bond /
      // issuer on three of them) — metered plus replayable is what double-bills.
      "bond.basic-info",
      "bond.issuer-info",
      "bond.daily-quote",
      "bond.valuation",
      "bond.cash-flow",
      "bond.announcement",
      "bond.issuance-detail",
      "bond.rating-overview",
      "bond.rating-change",
      "bond.issuer-rating-change",
      "bond.issuance-plan",
      "bond.exercise-notice",
      // The one entry here that is NOT about billing (creating a pool is free):
      // duplicate pool names are rejected, so replaying a create whose first
      // attempt succeeded answers 230006 and reports the success as a failure.
      "vault.stock-pool.create",
      // Free drive writes, marked for their side effects (probed 2026-09-24): upload /
      // create-folder / copy make a second same-name item on replay, and a replayed
      // delete reports the delete that already landed as a failure.
      "vault.drive.upload",
      "vault.drive.create-folder",
      "vault.drive.copy",
      "vault.drive.delete-file",
      "vault.drive.delete-folder",
    ]
    // Set EQUALITY, not one-way containment. A one-way check only proves the
    // listed endpoints are marked; it stays green when a NEW no-replay endpoint
    // is added to the registry without being listed here — which is how
    // `tool.file-parse.submit` (billed per page at submit) sat protected but
    // unguarded, one registry edit away from silently losing the marker.
    const actual = Object.values(ENDPOINTS).filter((ep) => ep.retry === "no-replay").map((ep) => ep.key)
    expect([...actual].sort(), "registry no-replay set must match this list exactly — add new ones here deliberately").toEqual([...NO_REPLAY_KEYS].sort())
    // Read-only endpoints and cheap per-row lists keep the default full-retry policy.
    expect(ENDPOINTS["ai.security-clue.list"].retry).toBeUndefined()
    expect(ENDPOINTS["ai.earnings-review.get-content"].retry).toBeUndefined()
    expect(ENDPOINTS["ai.viewpoint-debate.get-content"].retry).toBeUndefined()
    expect(ENDPOINTS["insight.qa.list"].retry).toBeUndefined()
    // The idempotent stock-pool writes keep the default policy: re-adding a security
    // already in the pool, removing one that isn't, and deleting a missing pool id all
    // succeed server-side, so a replay after a 5xx cannot do damage or double-charge.
    // Drive rename / moveFile / moveFolder answered identically when repeated (probed 2026-09-24).
    for (const key of ["vault.stock-pool.delete", "vault.stock-pool.rename", "vault.stock-pool.add-stock", "vault.stock-pool.remove-stock", "vault.drive.rename", "vault.drive.move-file", "vault.drive.move-folder"]) {
      expect(ENDPOINTS[key], key).toBeDefined()
      expect(ENDPOINTS[key].retry, key).toBeUndefined()
    }
  })

  it("keeps every endpoint whose single request can bill past the line on no-replay", () => {
    // A per-row / per-document endpoint re-bills what a replayed request delivers again.
    // Past NO_REPLAY_ABOVE_CREDITS for one request, that risk outweighs the retry.
    const costly = Object.values(ENDPOINTS).filter((ep) => ep.billing && (ep.billing.per === "row" || ep.billing.per === "document") && worstRequestCredits(ep) > NO_REPLAY_ABOVE_CREDITS)
    expect(costly.map((ep) => ep.key)).toContain("ai.stock-summary.list") // guards the guard: not vacuous
    expect(costly.filter((ep) => ep.retry !== "no-replay").map((ep) => ep.key)).toEqual([])
    // The line is strict: ai.security-clue.list (500 × 5 = 2500) stays under it.
    expect(worstRequestCredits(ENDPOINTS["ai.security-clue.list"])).toBe(2500)
  })

  it("declares a per-request bound on every per-row endpoint that is not paginated", () => {
    // Without one, worstRequestCredits would price a batch or a date-range endpoint as a
    // single row and the no-replay line above could never see it.
    const unbounded = Object.values(ENDPOINTS)
      .filter((ep) => ep.billing?.per === "row" && !ep.pagination?.enabled && ep.billing.maxUnits === undefined)
      .map((ep) => ep.key)
    expect(unbounded).toEqual([])
  })

  it("keeps every endpoint billed per call or per submitted page on no-replay", () => {
    // A replay after a timeout the server already answered runs — and bills — the call
    // again.
    const replayBillable = Object.values(ENDPOINTS).filter((ep) => ep.billing && (ep.billing.per === "call" || ep.billing.per === "page"))
    expect(replayBillable.length).toBeGreaterThan(0)
    const offenders = replayBillable.filter((ep) => ep.retry !== "no-replay").map((ep) => ep.key)
    expect(offenders).toEqual([])
  })

  it("prices every billed endpoint above zero, in a known unit", () => {
    for (const ep of Object.values(ENDPOINTS)) {
      if (!ep.billing) continue
      expect(["call", "page", "row", "document"], ep.key).toContain(ep.billing.per)
      expect(ep.billing.price, ep.key).toBeGreaterThan(0)
    }
  })

  it("marks exactly the irreversible endpoints destructive", () => {
    // ⚠️ Set equality here catches ONE direction only: a marker appearing on an
    // endpoint nobody listed. It cannot catch the opposite — a new irreversible
    // endpoint added WITHOUT the marker never enters the filtered set, so this
    // assertion stays green (verified by injecting exactly such an endpoint). The
    // omission direction is covered by the classification test below, which needs an
    // independent signal rather than the marker itself.
    const destructive = Object.keys(ENDPOINTS).filter((k) => ENDPOINTS[k].destructive)
    expect(destructive.sort()).toEqual(["vault.drive.delete-file", "vault.drive.delete-folder", "vault.stock-pool.delete"])
    // The warning lives on the endpoint because the gate is generic: a shared string
    // would tell whoever adds the second destructive endpoint that they are about to
    // lose stock pools. Every marked endpoint must carry its own.
    for (const key of destructive) {
      expect(ENDPOINTS[key].destructive?.warning, key).toBeTruthy()
    }
    // The other four writes are recoverable by running their opposite, so they must
    // NOT ask — a confirmation on every write trains callers to pass --yes blindly,
    // and then the one that matters is unguarded in practice.
    for (const key of ["vault.stock-pool.create", "vault.stock-pool.rename", "vault.stock-pool.add-stock", "vault.stock-pool.remove-stock"]) {
      expect(ENDPOINTS[key].destructive, key).toBeUndefined()
    }
  })

  it("classifies every deletion-flavoured endpoint as destructive or explicitly not", () => {
    // The independent signal the test above lacks: whether the endpoint DELETES
    // something is visible in its path, not in the marker we are trying to verify.
    // Every such endpoint must be a deliberate decision on someone's part — a new one
    // that is neither marked nor listed here fails, which is the "added it and forgot
    // the guard" case the `--yes` gate exists for.
    //
    // Reversible by running the opposite command, so deliberately NOT destructive:
    // asking for confirmation on every write trains callers to pass --yes reflexively,
    // and then the one that matters is unguarded in practice.
    const REVIEWED_REVERSIBLE = ["vault.stock-pool.remove-stock"]
    const deletionFlavoured = Object.keys(ENDPOINTS)
      .filter((k) => /delete|remove|destroy|drop|purge/i.test(ENDPOINTS[k].path) || /delete|remove|destroy/i.test(k))
    expect(deletionFlavoured.length, "the heuristic matched nothing — it has stopped working").toBeGreaterThan(0)
    for (const key of deletionFlavoured) {
      const classified = Boolean(ENDPOINTS[key].destructive) || REVIEWED_REVERSIBLE.includes(key)
      expect(classified, `${key} deletes something but is neither marked destructive nor listed as reversible`).toBe(true)
    }
  })

  it("marks exactly the batch writes that report per-item failures inside a success", () => {
    // Same one-directional limit as the destructive set above, and here there is no
    // independent signal in the registry: "answers {successList, failList}" is a
    // response shape, not something a path reveals. So this guards against the marker
    // spreading, not against a new batch endpoint forgetting it — a new one has to be
    // caught by the reviewer, or by its own end-to-end test.
    const itemFailures = Object.keys(ENDPOINTS).filter((k) => ENDPOINTS[k].itemFailures)
    expect(itemFailures.sort()).toEqual([
      "vault.drive.copy",
      "vault.drive.delete-file",
      "vault.drive.move-file",
      "vault.stock-pool.add-stock",
      "vault.stock-pool.delete",
      "vault.stock-pool.remove-stock",
    ])
    // create / rename answer with {poolId, poolName} — no failList to judge.
    for (const key of ["vault.stock-pool.create", "vault.stock-pool.rename"]) {
      expect(ENDPOINTS[key].itemFailures, key).toBeUndefined()
    }
  })

  it("marks every indicator endpoint as no-999999 (replaying a billed EDE query buys nothing)", () => {
    // Probed 2026-07-11 (no-data answered HTTP 500 + 999999 back then; since
    // 2026-08-07 no-data is a null cell keeping its row and column, so 999999 is
    // a real fault — either way replaying a billed EDE query buys nothing).
    // Historically:
    // 999999 — retrying wastes 3 requests + ~4s on every empty query.
    for (const key of ["indicator.search", "indicator.cross-section", "indicator.time-series", "indicator.screener"]) {
      expect(ENDPOINTS[key], key).toBeDefined()
      expect(ENDPOINTS[key].retry, key).toBe("no-999999")
    }
  })

  // Endpoint keys appear as bare string literals throughout src/cli.ts and src/commands/
  // (client.call("..."), addDownloadCommand({ endpointKey: "..." }), addKlineCommand(...)).
  // A typo only surfaces at runtime as "Unknown endpoint key"; this catches it at
  // test time. The regex matches a whole literal that is a lowercase dotted key
  // like "insight.research.list"; import paths ("./core/x.js") and code samples
  // ("000001.SZ") begin with "." or a digit and are excluded.
  it("every endpoint key referenced by a command is registered", () => {
    const commandsDir = path.resolve(process.cwd(), "src/commands")
    const src = [path.resolve(process.cwd(), "src/cli.ts"), ...readdirSync(commandsDir).map((file) => path.join(commandsDir, file))]
      .map((file) => readFileSync(file, "utf8")).join("\n")
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
      // Not a generation, but not replayed either (up to 18000 credits a call), so a
      // large batch must not fail on the 30s default.
      "ai.stock-summary.list",
    ]) {
      expect(ENDPOINTS[key].timeoutMs, `${key}.timeoutMs`).toBe(120_000)
    }
  })

  it("leaves fast list and async-polling AI endpoints on the default timeout", () => {
    for (const key of [
      "ai.hot-topic",
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
