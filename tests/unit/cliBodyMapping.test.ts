import { execFile } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

// End-to-end option→body mapping tests: run the real CLI via tsx against a local
// HTTP stub that records each request. This is the layer cli.test.ts (help/validation
// only) never reaches — a mis-wired flag (e.g. --broker feeding industryList) returns
// unfiltered data in production while every unit test stays green. One spawn per case,
// so keep this to one representative command per wiring pattern, not one per command.
const run = promisify(execFile)
const CLI = path.resolve(process.cwd(), "dist/src/cli.js")

interface CapturedRequest {
  path: string
  body: unknown
}

const captured: CapturedRequest[] = []
let server: http.Server
let baseUrl: string

// JPEG magic prefix so the download E2E test can assert the binary body
// reaches disk byte-for-byte (not JSON-mangled or re-encoded).
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03])

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      captured.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : undefined })
      res.setHeader("content-type", "application/json")
      if ((req.url ?? "").includes("/daily")) {
        // Fixed 3-row columnar payload for the limit-capped quote endpoints (fund-flow,
        // kline) so a truncation test can drive rows-vs-limit: --limit 3 hits the cap
        // (partial), --limit 5000/6000 stays under it. Body-mapping tests (no --limit or
        // a large one) get 3 < cap → exit 0, so their assertions are unaffected.
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 3, fieldList: ["securityCode", "tradeDate", "mainNetInflow"], list: [["600519.SH", "2026-06-03", 1], ["000001.SZ", "2026-06-03", 2], ["000002.SZ", "2026-06-03", 3]] } }))
        return
      }
      if ((req.url ?? "").includes("/report-image/download/file")) {
        res.setHeader("content-type", "image/jpeg")
        res.end(JPEG_BYTES)
        return
      }
      res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 0, list: [] } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
})

beforeEach(() => {
  captured.length = 0
})

async function cli(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      timeout: 25_000,
      env: {
        ...process.env,
        GANGTISE_BASE_URL: baseUrl,
        // A pre-injected token skips login; the isolated cache path guards against
        // any accidental read/write of the developer's real ~/.config token.
        GANGTISE_TOKEN: "test-token",
        GANGTISE_TOKEN_CACHE_PATH: path.join(os.tmpdir(), `gangtise-body-map-${process.pid}`, "token.json"),
        GANGTISE_ACCESS_KEY: "",
        GANGTISE_SECRET_KEY: "",
      },
    })
    return { code: 0, out: stdout + stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: typeof e.code === "number" ? e.code : 1, out: (e.stdout ?? "") + (e.stderr ?? "") }
  }
}

describe("cli option→body mapping (real CLI against a local stub)", () => {
  it("insight research list maps every filter flag to its list field", async () => {
    const { code } = await cli([
      "insight", "research", "list",
      "--broker", "C100000026", "--category", "macro", "--rating", "buy",
      "--start-time", "2026-04-01 00:00:00", "--end-time", "2026-04-09 23:59:59",
      "--size", "5", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].path).toBe("/application/open-insight/broker-report/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 5,
      startTime: "2026-04-01 00:00:00",
      endTime: "2026-04-09 23:59:59",
      searchType: 1,
      rankType: 1,
      brokerList: ["C100000026"],
      categoryList: ["macro"],
      ratingList: ["buy"],
    })
  }, 30_000)

  it("insight announcement list converts both date forms to the same local-midnight epoch millis", async () => {
    const { code } = await cli([
      "insight", "announcement", "list",
      "--security", "000001.SZ",
      "--start-time", "2026-04-01", "--end-time", "2026-04-02 00:00:00",
      "--size", "3", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/announcement/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 3,
      startTime: new Date(2026, 3, 1).getTime(),
      endTime: new Date(2026, 3, 2).getTime(),
      searchType: 1,
      rankType: 1,
      securityList: ["000001.SZ"],
    })
  }, 30_000)

  it("insight roadshow list (addScheduleList factory) only sends the fields its endpoint supports", async () => {
    const { code } = await cli([
      "insight", "roadshow", "list",
      "--research-area", "122000001", "--market", "aShares",
      "--size", "2", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/schedule/roadshow/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 2,
      researchAreaList: ["122000001"],
      marketList: ["aShares"],
    })
  }, 30_000)

  it("vault drive-list maps comma-separated number lists", async () => {
    const { code } = await cli([
      "vault", "drive-list",
      "--file-type", "1,2", "--keyword", "年报",
      "--size", "4", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-vault/drive/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 4,
      keyword: "年报",
      fileTypeList: [1, 2],
    })
  }, 30_000)

  it("quote day-kline (single security) sends the kline body without pagination fields", async () => {
    const { code } = await cli([
      "quote", "day-kline",
      "--security", "600519.SH",
      "--start-date", "2026-01-01", "--end-date", "2026-01-31",
      "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-quote/kline/daily")
    expect(captured[0].body).toEqual({
      securityList: ["600519.SH"],
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      limit: 6000, // omitting --limit sends the API-default cap explicitly (== truncation cap)
    })
  }, 30_000)

  it("quote minute-kline sends the API-default limit (6000) when --limit is omitted", async () => {
    // Regression: the truncation cap must equal the limit actually sent. Omitting --limit
    // sends 6000 (the real server default) — an earlier build assumed 5000 and would
    // false-flag complete 5000–5999-row results as truncated.
    const { code } = await cli([
      "quote", "minute-kline", "--security", "600519.SH",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 15:00:00",
      "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-quote/kline/minute")
    expect(captured[0].body).toEqual({
      securityCode: "600519.SH",
      startTime: "2026-06-01 09:30:00",
      endTime: "2026-06-01 15:00:00",
      limit: 6000,
    })
  }, 30_000)

  it("quote fund-flow maps securities, date range, limit and fields to the request body", async () => {
    const { code } = await cli([
      "quote", "fund-flow",
      "--security", "600519.SH", "--security", "aShares",
      "--start-date", "2026-06-01", "--end-date", "2026-06-05",
      "--limit", "5000", "--field", "mainNetInflow", "--field", "largeInflow",
      "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-quote/fund-flow/daily")
    expect(captured[0].body).toEqual({
      securityList: ["600519.SH", "aShares"],
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      limit: 5000,
      fieldList: ["mainNetInflow", "largeInflow"],
    })
  }, 30_000)

  it("quote fund-flow flags partial (exit 3) + warns when returned rows hit the limit", async () => {
    // Explicit security → single-request path; stub returns 3 rows and --limit 3 means
    // rows == cap → truncation signal. (Full-market aShares is date-sharded instead.)
    const { code, out } = await cli([
      "quote", "fund-flow", "--security", "600519.SH",
      "--start-date", "2026-06-03", "--end-date", "2026-06-03", "--limit", "3", "--format", "json",
    ])
    expect(code).toBe(3)
    expect(out).toContain("truncated")
  }, 30_000)

  it("quote fund-flow stays exit 0 when returned rows are under the limit", async () => {
    // Explicit security; stub returns 3 rows and --limit 6000 means rows < cap → complete.
    const { code } = await cli([
      "quote", "fund-flow", "--security", "600519.SH",
      "--start-date", "2026-06-03", "--end-date", "2026-06-03", "--limit", "6000", "--format", "json",
    ])
    expect(code).toBe(0)
  }, 30_000)

  it("quote fund-flow rejects --limit above the 10000 API ceiling before any request", async () => {
    const { code, out } = await cli([
      "quote", "fund-flow", "--security", "aShares", "--limit", "10001", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("<= 10000")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("quote fund-flow --security aShares date-shards the full market into per-day requests", async () => {
    // Full-market fund-flow errors server-side on a multi-day single request, so the CLI
    // splits it into one request per day (shardDays: 1) and merges — never one big call.
    const { code } = await cli([
      "quote", "fund-flow", "--security", "aShares",
      "--start-date", "2026-06-29", "--end-date", "2026-07-01", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(3) // 3 calendar days → 3 per-day shards
    expect(captured.every((c) => c.path === "/application/open-quote/fund-flow/daily")).toBe(true)
    expect(captured.map((c) => (c.body as { startDate: string }).startDate).sort())
      .toEqual(["2026-06-29", "2026-06-30", "2026-07-01"])
    expect((captured[0].body as { limit?: number }).limit).toBe(10000) // full-market lift, not the 6000 default
  }, 30_000)

  it("quote fund-flow --security aShares without a date range is rejected locally", async () => {
    // Full-market fund-flow must date-shard, which needs an explicit range; without it the
    // CLI rejects up front (exit 1, no request) instead of letting the server 430012.
    const { code, out } = await cli([
      "quote", "fund-flow", "--security", "aShares", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("requires both --start-date and --end-date")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("quote index-day-kline flags partial (exit 3) for explicit securities when rows hit the limit", async () => {
    // Same truncation guard as fund-flow, applied through the addKlineCommand factory.
    const { code, out } = await cli([
      "quote", "index-day-kline", "--security", "000001.SH",
      "--start-date", "2026-06-01", "--end-date", "2026-06-03", "--limit", "3", "--format", "json",
    ])
    expect(code).toBe(3)
    expect(out).toContain("truncated")
  }, 30_000)

  it("quote index-day-kline --security all does not false-flag partial when the result fits the limit", async () => {
    // --limit omitted → full-market path uses the 10000 cap; the stub's 3 rows are well
    // under it, so the result must NOT be flagged partial (true negative). A result that
    // actually hits the limit IS flagged — covered in quoteSharding.test.ts.
    const { code } = await cli([
      "quote", "index-day-kline", "--security", "all",
      "--start-date", "2026-06-03", "--end-date", "2026-06-03", "--format", "json",
    ])
    expect(code).toBe(0)
  }, 30_000)

  it("reference institution-search maps keyword, categories and top", async () => {
    const { code } = await cli([
      "reference", "institution-search",
      "--keyword", "招商", "--category", "domesticBroker", "--category", "opinionInstitution",
      "--top", "5", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-reference/institutions/search")
    expect(captured[0].body).toEqual({
      keyword: "招商",
      categoryList: ["domesticBroker", "opinionInstitution"],
      top: 5,
    })
  }, 30_000)

  it("insight qa list maps filters to BARE source/questionCategory/answerImportant keys (not *List) and keeps the & path", async () => {
    // QA's request keys are bare (source/questionCategory/answerImportant), unlike the
    // *List convention elsewhere — sending sourceList etc. would silently drop the filter.
    // Also asserts the literal '&' in the path survives the round-trip to the server.
    const { code } = await cli([
      "insight", "qa", "list",
      "--security-code", "601012.SH",
      "--source", "interactive", "--source", "survey",
      "--question-category", "productAndBusiness", "--question-category", "financialData",
      "--answer-important", "1",
      "--start-time", "2026-05-01 00:00:00", "--end-time", "2026-06-16 23:59:59",
      "--size", "5", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/Q&A-data/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 5,
      securityCode: "601012.SH",
      startTime: "2026-05-01 00:00:00",
      endTime: "2026-06-16 23:59:59",
      source: ["interactive", "survey"],
      questionCategory: ["productAndBusiness", "financialData"],
      answerImportant: [1],
    })
  }, 30_000)

  it("insight report-image list maps keyword, top and sourceId (string datetimes, no epoch conversion)", async () => {
    const { code } = await cli([
      "insight", "report-image", "list",
      "--keyword", "AI", "--top", "3", "--source-id", "297236012319510528",
      "--start-time", "2024-01-01 00:00:00", "--end-time", "2024-12-31 23:59:59",
      "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/report-image/getList")
    expect(captured[0].body).toEqual({
      keyword: "AI",
      top: 3,
      sourceId: "297236012319510528",
      startTime: "2024-01-01 00:00:00",
      endTime: "2024-12-31 23:59:59",
    })
  }, 30_000)

  it("reference official-account-search maps keyword, BARE category (not categoryList), and top", async () => {
    const { code } = await cli([
      "reference", "official-account-search",
      "--keyword", "东吴证券", "--category", "broker", "--category", "media",
      "--top", "5", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-reference/officialAccount/search")
    expect(captured[0].body).toEqual({
      keyword: "东吴证券",
      category: ["broker", "media"],
      top: 5,
    })
  }, 30_000)

  it("rejects --top above the documented cap before any request goes out (server silently truncates)", async () => {
    // Probed 2026-07-10: report-image --top 21 returns 20 rows, official-account-search
    // --top 11 returns 10 — no server error either way, so the CLI must fail locally.
    const insightCap = await cli(["insight", "report-image", "list", "--keyword", "AI", "--top", "21"])
    expect(insightCap.code).not.toBe(0)
    expect(insightCap.out).toContain("<= 20")
    const referenceCap = await cli(["reference", "official-account-search", "--keyword", "东吴", "--top", "11"])
    expect(referenceCap.code).not.toBe(0)
    expect(referenceCap.out).toContain("<= 10")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("rejects a misspelled reference-search --category before any request goes out", async () => {
    // Probed 2026-07-10: the server never rejects a bogus category — securities-search
    // silently IGNORES the filter (returns all categories), institution-search and
    // official-account-search silently return empty. All three are wrong-data traps.
    for (const args of [
      ["reference", "securities-search", "--keyword", "茅台", "--category", "stocks"],
      ["reference", "institution-search", "--keyword", "中金", "--category", "domesticBrokers"],
      ["reference", "official-account-search", "--keyword", "东吴", "--category", "brokers"],
    ]) {
      const { code, out } = await cli(args)
      expect(code).not.toBe(0)
      expect(out).toContain("--category")
    }
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("insight report-image download sends chunkId as a query param and writes the JPEG body to --output", async () => {
    const outPath = path.join(os.tmpdir(), `gangtise-report-image-${process.pid}.jpg`)
    try {
      const { code } = await cli(["insight", "report-image", "download", "--chunk-id", "image_10_384_8", "--output", outPath])
      expect(code).toBe(0)
      expect(captured).toHaveLength(1)
      expect(captured[0].path).toBe("/application/open-insight/report-image/download/file?chunkId=image_10_384_8")
      expect(await readFile(outPath)).toEqual(JPEG_BYTES)
    } finally {
      await rm(outPath, { force: true })
    }
  }, 30_000)

  it("vault my-conference-list maps --source to a numeric sourceList", async () => {
    const { code } = await cli([
      "vault", "my-conference-list",
      "--source", "1", "--source", "2", "--category", "earningsCall",
      "--size", "3", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-vault/my-conference/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 3,
      categoryList: ["earningsCall"],
      sourceList: [1, 2],
    })
  }, 30_000)

  it("ai stock-summary maps --security to securityList", async () => {
    const { code } = await cli(["ai", "stock-summary", "--security", "600519.SH", "--format", "json"])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-ai/stock-summary/getList")
    expect(captured[0].body).toEqual({ securityList: ["600519.SH"] })
  }, 30_000)

  it("raw call rejects --query on a JSON endpoint before any request goes out", async () => {
    const { code, out } = await cli(["raw", "call", "ai.one-pager", "--query", "a=b"])
    expect(code).toBe(1)
    expect(out).toContain("--query is not supported for JSON endpoints")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("raw call rejects --body on a download endpoint before any request goes out", async () => {
    const { code, out } = await cli(["raw", "call", "insight.research.download", "--body", "{\"reportId\":\"1\"}"])
    expect(code).toBe(1)
    expect(out).toContain("--body is not supported for download endpoints")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("a non-leading --version falls through to commander instead of the pre-parse hijack", async () => {
    // Old code did argv.includes("--version") BEFORE parsing: any command line
    // containing the token anywhere printed the bare version (plus a 2s network
    // update check) and swallowed everything else. Now only argv[2] triggers the
    // manual path; elsewhere commander's standard option handling decides.
    const midVersion = await cli(["reference", "securities-search", "--keyword", "--version", "--format", "json"])
    expect(midVersion.code).toBe(0)
    expect(midVersion.out.trim()).toMatch(/^\d+\.\d+\.\d+$/) // commander's own version flag, no update-check hijack
    expect(captured).toHaveLength(0)
  }, 30_000)
})
