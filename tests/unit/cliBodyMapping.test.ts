import { execFile } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
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
  contentType: string
  /** Raw bytes, for the multipart upload case (no JSON body to inspect). */
  raw: Buffer
}

const captured: CapturedRequest[] = []
let server: http.Server
let baseUrl: string

// JPEG magic prefix so the download E2E test can assert the binary body
// reaches disk byte-for-byte (not JSON-mangled or re-encoded).
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03])
// "PK\x03\x04" — the file-parse result arrives as a ZIP stream, not JSON.
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00])

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => { chunks.push(Buffer.from(chunk)) })
    req.on("end", () => {
      const raw = Buffer.concat(chunks)
      const contentType = String(req.headers["content-type"] ?? "")
      // Only JSON bodies are parsed: the file-parse upload is multipart/form-data,
      // and JSON.parse on it used to take the whole stub down. It still can —
      // anything thrown in this callback is an uncaught exception that kills the
      // vitest worker, and every remaining test in the file fails with it. That
      // is a burst of ~25 unrelated failures from one malformed request, which is
      // indistinguishable from a real regression. Contain it: a bad body becomes
      // `undefined` (the assertions then fail on their own, pointing at the
      // actual request) instead of taking the file down.
      let body: unknown
      try {
        body = raw.length && contentType.includes("application/json") ? JSON.parse(raw.toString("utf8")) : undefined
      } catch {
        body = undefined
      }
      captured.push({ path: req.url ?? "", body, contentType, raw })
      res.setHeader("content-type", "application/json")
      if ((req.url ?? "").includes("/file-parse/submit")) {
        // Hand-written JSON on purpose: taskId goes out as a BARE 19-digit number,
        // which JSON.parse would round to ...4700 (JSON.stringify here would already
        // have rounded it). The client must re-quote it and keep every digit —
        // a rounded id can never fetch its already-billed parse result.
        res.end('{"code":"000000","msg":"任务提交成功","status":true,"data":{"taskId":1782345678901234567}}')
        return
      }
      if ((req.url ?? "").includes("/file-parse/result")) {
        // taskId PENDING replays the real "still generating" answer (409 + 140001,
        // probed 2026-07-25); anything else hands back the ZIP.
        if ((body as { taskId?: string } | undefined)?.taskId === "PENDING") {
          res.statusCode = 409
          res.end(JSON.stringify({ code: 140001, errorType: "RESULT_GENERATING", msg: "结果生成中，请稍后重试", status: false }))
          return
        }
        res.setHeader("content-type", "application/zip")
        res.end(ZIP_BYTES)
        return
      }
      if ((req.url ?? "").includes("/performance-calendar/getList")) {
        const b = body as { size?: number; securityList?: string[] } | undefined
        // EXACT1000.XX: a result whose total lands exactly ON the cap. Complete, not
        // truncated — the cap check must read `total`, not just the row count.
        if (b?.securityList?.includes("EXACT1000.XX")) {
          const n = Math.min(b?.size ?? 50, 50)
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 1000, list: Array.from({ length: n }, (_, i) => ({ performanceReportId: String(i), title: "t" })) } }))
          return
        }
        // Normal path — the server honors securityList (probed 2026-07-25: an unknown
        // or malformed code returns total 0). One company's calendar is a few rows.
        if (b?.securityList?.length && !b.securityList.includes("IGNORED.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 9, list: Array.from({ length: 9 }, (_, i) => ({ performanceReportId: `s${i}`, title: "t" })) } }))
          return
        }
        // IGNORED.XX stands in for a server that STOPPED filtering by securityList:
        // the "bound" silently covers the whole 3000-row calendar. This is what the
        // implicit row cap has to contain.
        const size = b?.size ?? 50
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 3000, list: Array.from({ length: size }, (_, i) => ({ performanceReportId: String(i), title: "t" })) } }))
        return
      }
      if ((req.url ?? "").includes("/quote/realtime")) {
        // 如实复刻上游对无效字段名的处理（实测 2026-07-24）：值只按**有效**字段返回、
        // 字段名却按**请求**原样回显。realtime 没有 close，传三个字段只回两个值——
        // 按位置拍平会把换手率 28.5573 贴成 close（茅台真实价 1297.41）。CLI 必须拒绝
        // 输出而不是给出这份看着合理、实则是另一个指标的数据。
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 1, fieldList: ["securityCode", "close", "turnoverRate"], list: [["600519.SH", 28.5573]] } }))
        return
      }
      if ((req.url ?? "").includes("/EDB/getData")) {
        // edb-data 走同一个 zipFieldRow，但它是 {fieldList, dataList} 且没有 --field。
        // 实测上游会把无效 indicatorId 从名和值里一起剔掉（等长、安全），所以长度不等
        // 只可能是响应结构变了——仍须拦住，不能拍出错列。
        const mismatched = ((body as { indicatorIdList?: string[] })?.indicatorIdList ?? []).includes("MISMATCH")
        // 带上信封 traceId：结构异常的报障指引承诺给出这个 id，必须真的传到报错文案里。
        res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-edb-1", data: mismatched
          ? { fieldList: ["date", "S00000093", "S99999999"], dataList: [["20260131", "826.1"]] }
          : { fieldList: ["date", "S00000093"], dataList: [["20260131", "826.1"], ["20260228", "580.6"]] } }))
        return
      }
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
      if ((req.url ?? "").includes("/EDE/cross-section")) {
        // EDE double-wraps on success (outer envelope stripped by the client, inner
        // { code, status, data } peeled by unwrapIndicatorData). Two indicators share
        // the display name 「财务费用」 so a name-keyed output collides — the --key-by
        // code path must key columns by the distinct indicatorCode instead.
        // DROPPED.XX stands in for the EDE shape where an indicator with no data
        // for any security vanishes from indicatorList entirely (probed
        // 2026-08-02) — the response is short, not null-padded.
        if (((body as { indicatorCodeList?: string[] } | undefined)?.indicatorCodeList ?? []).includes("EMPTY.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: [], securityNameList: [], indicatorList: [], values: [],
          } } }))
          return
        }
        if (((body as { indicatorCodeList?: string[] } | undefined)?.indicatorCodeList ?? []).includes("DROPPED.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"],
            securityNameList: ["贵州茅台"],
            indicatorList: [{ code: "cf_finc_exp", name: "财务费用", dataType: "double" }],
            values: [[100]],
          } } }))
          return
        }
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
          securityCodeList: ["600519.SH"],
          securityNameList: ["贵州茅台"],
          indicatorList: [
            { code: "cf_finc_exp", name: "财务费用", dataType: "double" },
            { code: "cf_finc_exp_qtr", name: "财务费用", dataType: "double" },
          ],
          values: [[100, 40]],
        } } }))
        return
      }
      if ((req.url ?? "").includes("/EDE/time-series")) {
        // NULLDATA.XX: a success envelope whose inner payload is null. It cannot
        // carry the non-enumerable traceId, so the check has to run before the
        // envelope is discarded or the failure arrives untraceable.
        if (((body as { indicatorCodeList?: string[] } | undefined)?.indicatorCodeList ?? []).includes("NULLDATA.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-null", data: { code: "000000", status: true, data: null } }))
          return
        }
        // BROKEN.XX: every other axis present and well-formed, only `dates` is
        // null. This used to pass straight through — raw envelope on stdout,
        // exit 0, silent stderr — which defeats every shape guard.
        if (((body as { indicatorCodeList?: string[] } | undefined)?.indicatorCodeList ?? []).includes("BROKEN.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-broken", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"],
            indicatorList: [{ code: "BROKEN.XX", name: "坏轴" }],
            dates: null, values: [[1350.6]],
          } } }))
          return
        }
        // Single indicator × two securities → columns are securities; --key-by code
        // must key them by securityCode (600519.SH), not the display name (贵州茅台).
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
          securityCodeList: ["600519.SH", "000858.SZ"],
          securityNameList: ["贵州茅台", "五粮液"],
          indicatorList: [{ code: "finc_pe_ttm", name: "市盈率(TTM)", dataType: "double" }],
          dates: ["2026-05-18"],
          values: [[20.03], [26.36]],
        } } }))
        return
      }
      if ((req.url ?? "").includes("/open-indicator/screener")) {
        // NOAXIS.XX: a matrix payload missing indicatorList entirely.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "NOAXIS.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-noaxis", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], values: [[1350.6]],
          } } }))
          return
        }
        // A duplicate-code screen: the server answers with a value for the first
        // variable and null for the second (probed 2026-08-02).
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).length === 2) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"],
            securityNameList: ["贵州茅台"],
            indicatorList: [{ field: "F1", code: "qte_close", name: "收盘价" }, { field: "F2", code: "qte_close", name: "收盘价" }],
            values: [[1350.6, null]],
          } } }))
          return
        }
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
          securityCodeList: ["600519.SH"],
          securityNameList: ["贵州茅台"],
          indicatorList: [{ field: "F1", code: "qte_mkt_cptl", name: "总市值", dataType: "double" }],
          values: [[16883.6021]],
        } } }))
        return
      }
      res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 0, list: [] } }))
    })
  })
  // A socket-level error (a CLI killed mid-request) would otherwise surface as an
  // unhandled 'error' event and take the worker down the same way.
  server.on("clientError", (_error, socket) => { socket.destroy() })
  server.on("error", () => { /* the assertions report the failure, not a crash */ })
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

// stdout / stderr 分开返回：错列拦截既要断言报错进了 stderr，也要断言 stdout 一行数据都没吐。
async function cli(args: string[]): Promise<{ code: number; out: string; stdout: string; stderr: string }> {
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
    return { code: 0, out: stdout + stderr, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    const stdout = e.stdout ?? ""
    const stderr = e.stderr ?? ""
    return { code: typeof e.code === "number" ? e.code : 1, out: stdout + stderr, stdout, stderr }
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

  it("knowledge-batch converts date / 10-digit / 13-digit --start-time to 13-digit millis in the body", async () => {
    // Locks the parseTimestamp13 body contract without a paid live call: a date maps
    // to local-midnight millis, 10-digit seconds are ×1000'd, 13-digit millis pass
    // through. (This positive path previously needed a billed knowledge-batch call.)
    await cli(["ai", "knowledge-batch", "--query", "x", "--start-time", "2026-07-20", "--format", "json"])
    await cli(["ai", "knowledge-batch", "--query", "x", "--start-time", "1784476800", "--format", "json"])
    await cli(["ai", "knowledge-batch", "--query", "x", "--start-time", "1784476800000", "--format", "json"])
    expect(captured.map((c) => (c.body as { startTime?: number }).startTime)).toEqual([
      new Date(2026, 6, 20).getTime(), // date → local midnight
      1784476800000, // 10-digit seconds ×1000
      1784476800000, // 13-digit verbatim
    ])
    expect(captured[0].path).toBe("/application/open-data/ai/search/knowledge/batch")
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

  it("rejects --limit above the documented cap before any request goes out (server silently truncates)", async () => {
    // Probed 2026-07-11: edb-search --limit 201 returns exactly 200 rows and
    // indicator search --limit 101 returns exactly 100 — no server error, so the
    // CLI must fail locally, same treatment as the v0.25.0 --top caps.
    const edb = await cli(["alternative", "edb-search", "--keyword", "空调", "--limit", "201"])
    expect(edb.code).not.toBe(0)
    expect(edb.out).toContain("<= 200")
    const ede = await cli(["indicator", "search", "--keyword", "率", "--limit", "101"])
    expect(ede.code).not.toBe(0)
    expect(ede.out).toContain("<= 100")
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

  it("raw call rejects --body on a GET download endpoint before any request goes out", async () => {
    const { code, out } = await cli(["raw", "call", "insight.research.download", "--body", "{\"reportId\":\"1\"}"])
    expect(code).toBe(1)
    expect(out).toContain("--body is not supported for GET download endpoints")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("raw call refuses an upload endpoint instead of sending an empty JSON body", async () => {
    const { code, out } = await cli(["raw", "call", "tool.file-parse.submit"])
    expect(code).toBe(1)
    expect(out).toContain("takes a file upload")
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

  it("indicator cross-section --key-by code keys columns by indicatorCode (not the shared display name)", async () => {
    // cf_finc_exp and cf_finc_exp_qtr both display as 「财务费用」; only the code
    // disambiguates. Proves --key-by actually reaches flattenCrossSection, not merely
    // that the option parses.
    const { code, out } = await cli([
      "indicator", "cross-section",
      "--indicator", "cf_finc_exp", "--indicator", "cf_finc_exp_qtr",
      "--security", "600519.SH", "--date", "2026-03-31",
      "--key-by", "code", "--format", "json",
    ])
    expect(code).toBe(0)
    const row = (JSON.parse(out) as { list: Record<string, unknown>[] }).list[0]
    expect(row).toMatchObject({ cf_finc_exp: 100, cf_finc_exp_qtr: 40 })
    expect(Object.keys(row)).not.toContain("财务费用")
  }, 30_000)

  it("indicator cross-section sends universe + per-indicator tradeDate, not securityCodeList + a root date", async () => {
    // Regression guard for the 2026-08-01 EDE revision: the old body shape is a
    // hard 100001 「缺少必填参数」 server-side, and a root-level `date` is silently
    // ignored (probed: it returns an EMPTY result rather than erroring).
    const { code } = await cli([
      "indicator", "cross-section",
      "--indicator", "cf_finc_exp", "--security", "600519.SH",
      "--date", "2026-03-31", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-indicator/EDE/cross-section")
    expect(captured[0].body).toEqual({
      indicatorCodeList: ["cf_finc_exp"],
      universe: ["600519.SH"],
      indicatorParamList: [
        { indicatorCode: "cf_finc_exp", parameters: [{ paramKey: "tradeDate", paramValue: "2026-03-31" }] },
      ],
    })
  }, 30_000)

  it("indicator screener sends the variable bindings and expression", async () => {
    const { code, out } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_mkt_cptl", "--security", "600519.SH",
      "--expression", "F1 >= 800", "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-indicator/screener")
    expect(captured[0].body).toEqual({
      universe: ["600519.SH"],
      expression: "F1 >= 800",
      indicatorList: [
        { field: "F1", indicatorCode: "qte_mkt_cptl", parameters: [{ paramKey: "tradeDate", paramValue: "2026-07-31" }] },
      ],
    })
    expect((JSON.parse(out) as { list: Record<string, unknown>[] }).list[0]).toEqual({
      security: "600519.SH", name: "贵州茅台", 总市值: 16883.6021,
    })
  }, 30_000)

  it("marks a cross-section partial and exits 3 when the response drops an indicator entirely", async () => {
    // EDE does not null-pad an indicator that has no data for any security — it
    // vanishes from indicatorList. Exit 0 on a short result is how a --key-by code
    // batch mapping silently loses a key.
    const { code, stdout, stderr } = await cli([
      "indicator", "cross-section",
      "--indicator", "cf_finc_exp", "--indicator", "DROPPED.XX",
      "--security", "600519.SH", "--date", "2026-03-31", "--format", "json",
    ])
    expect(code).toBe(3)
    // stdout stays parseable JSON — the diagnosis goes to stderr.
    const payload = JSON.parse(stdout) as { partial?: boolean; omittedIndicators?: string[]; list: unknown[] }
    expect(payload.partial).toBe(true)
    expect(payload.omittedIndicators).toEqual(["DROPPED.XX"])
    expect(payload.list).toHaveLength(1)
    expect(stderr).toContain("DROPPED.XX")
  }, 30_000)

  it("exits 0 without a partial flag when the response is complete", async () => {
    const { code, stdout } = await cli([
      "indicator", "cross-section",
      "--indicator", "cf_finc_exp", "--indicator", "cf_finc_exp_qtr",
      "--security", "600519.SH", "--date", "2026-03-31", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).not.toHaveProperty("partial")
  }, 30_000)

  it("exits 0 without partial metadata when the whole query legitimately has no data", async () => {
    // EMPTY.XX drives the canonical all-empty EDE answer (a non-trading range).
    // Diffing that against the request would list every code as omitted — the
    // result is not partial, there is simply nothing.
    const { code, stdout, stderr } = await cli([
      "indicator", "cross-section",
      "--indicator", "EMPTY.XX", "--security", "600519.SH",
      "--date", "2026-08-01", "--format", "json",
    ])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout) as Record<string, unknown>
    expect(payload).not.toHaveProperty("partial")
    expect(payload).not.toHaveProperty("omittedIndicators")
    expect(payload).not.toHaveProperty("omittedSecurities")
    expect(payload.total).toBe(0)
    expect(stderr).toContain("no data at all") // still flags the ambiguity with a wrong param name
  }, 30_000)

  it("fails loudly with a traceId when a required axis is null instead of passing the payload through", async () => {
    const { code, stdout, stderr } = await cli([
      "indicator", "time-series",
      "--indicator", "BROKEN.XX", "--security", "600519.SH",
      "--start-date", "2026-07-30", "--end-date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("") // nothing renderable reaches stdout
    expect(stderr).toContain("dates")
    expect(stderr).toContain("trace-ede-broken") // support needs the trace on exactly this class of failure
  }, 30_000)

  it("fails loudly with a traceId when a matrix payload omits an axis entirely", async () => {
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:NOAXIS.XX", "--security", "600519.SH",
      "--expression", "F1 > 0", "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("")
    expect(stderr).toContain("indicatorList")
    expect(stderr).toContain("trace-ede-noaxis")
  }, 30_000)

  it("fails loudly with a traceId when a success envelope carries a null payload", async () => {
    const { code, stdout, stderr } = await cli([
      "indicator", "time-series",
      "--indicator", "NULLDATA.XX", "--security", "600519.SH",
      "--start-date", "2026-07-30", "--end-date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("") // `null` must not reach stdout as a "result"
    expect(stderr).toContain("trace-ede-null")
  }, 30_000)

  it("marks a screener result unreliable and exits 3 when one indicator is bound twice", async () => {
    // The server returns a value for at most one of the duplicated variables and
    // null for the rest, so any comparison against the null one filtered on
    // nothing — the rows are present but untrustworthy, which `partial` would
    // mis-describe.
    const { code, stdout } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:qte_close",
      "--security", "600519.SH", "--expression", "F1 > F2",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(3)
    const payload = JSON.parse(stdout) as { unreliable?: boolean; duplicatedIndicators?: string[] }
    expect(payload.unreliable).toBe(true)
    expect(payload.duplicatedIndicators).toEqual(["qte_close"])
  }, 30_000)

  it("indicator time-series --key-by code keys multi-security columns by securityCode", async () => {
    // Guards the src/cli.ts time-series --key-by passthrough (identical pattern to
    // cross-section) so it can't be silently dropped without a failing test.
    const { code, out } = await cli([
      "indicator", "time-series",
      "--indicator", "finc_pe_ttm",
      "--security", "600519.SH", "--security", "000858.SZ",
      "--start-date", "2026-05-18", "--end-date", "2026-05-18",
      "--key-by", "code", "--format", "json",
    ])
    expect(code).toBe(0)
    const row = (JSON.parse(out) as { list: Record<string, unknown>[] }).list[0]
    expect(row).toMatchObject({ "600519.SH": 20.03, "000858.SZ": 26.36 })
    expect(Object.keys(row)).not.toContain("贵州茅台")
  }, 30_000)

  it("quote realtime refuses to print a mis-zipped row instead of mislabeling turnoverRate as close", async () => {
    // 端到端守住 v0.28.3 的错列拦截：normalizeRows 的单测只证明会抛，这里证明**整条
    // 链路**（printer → 渲染 → 退出码）不会把错列数据吐给用户。stdout 一旦出现
    // 28.5573，就说明换手率又被当成收盘价发出去了。
    const { code, stdout, stderr } = await cli([
      "quote", "realtime", "--security", "600519.SH",
      "--field", "securityCode", "--field", "close", "--field", "turnoverRate",
      "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("ValidationError")
    expect(stderr).toContain("响应字段数与 fieldList 不匹配")
    expect(stdout).not.toContain("28.5573")
    expect(stdout.trim()).toBe("")
  }, 30_000)

  it("alternative edb-data flattens an equal-length columnar response", async () => {
    const { code, stdout } = await cli([
      "alternative", "edb-data", "--indicator-id", "S00000093",
      "--start-date", "2026-01-01", "--end-date", "2026-02-28", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      total: 2,
      list: [
        { date: "20260131", S00000093: "826.1" },
        { date: "20260228", S00000093: "580.6" },
      ],
    })
  }, 30_000)

  it("alternative edb-data rejects a mismatched dataList row (same guard, no --field to blame)", async () => {
    const { code, stdout, stderr } = await cli([
      "alternative", "edb-data", "--indicator-id", "MISMATCH", "--indicator-id", "S00000093",
      "--start-date", "2026-01-01", "--end-date", "2026-02-28", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("响应字段数与 fieldList 不匹配")
    // edb-data 没有 --field，文案不能只叫用户去核对 --field
    expect(stderr).toContain("没有 --field 的命令")
    // 报障指引承诺的 traceId 必须真的出现——否则这句指引就是空头支票
    expect(stderr).toContain("trace trace-edb-1")
    expect(stdout.trim()).toBe("")
  }, 30_000)

  it("insight performance-calendar list sends dates as startDate/endDate (not the sibling startTime)", async () => {
    const { code } = await cli([
      "insight", "performance-calendar", "list",
      "--start-date", "2026-07-01", "--end-date", "2026-07-25",
      "--market", "aShares", "--category", "performanceForecast",
      "--security", "000001.SZ", "--size", "5", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/schedule/performance-calendar/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 5,
      startDate: "2026-07-01",
      endDate: "2026-07-25",
      marketList: ["aShares"],
      securityList: ["000001.SZ"],
      categoryList: ["performanceForecast"],
    })
  }, 30_000)

  it("refuses an unbounded performance-calendar list (>120k rows at 0.1 credits each)", async () => {
    const bare = await cli(["insight", "performance-calendar", "list", "--format", "json"])
    expect(bare.code).toBe(1)
    expect(bare.out).toContain("without a bound")
    expect(captured).toHaveLength(0)
    // Any one of the three bounds is enough — a single security's whole calendar is small.
    for (const bound of [["--size", "5"], ["--security", "000001.SZ"], ["--start-date", "2026-07-01", "--end-date", "2026-07-25"]]) {
      captured.length = 0
      const { code } = await cli(["insight", "performance-calendar", "list", ...bound, "--format", "json"])
      expect(code, `bound ${bound.join(" ")}`).toBe(0)
      expect(captured.length, `bound ${bound.join(" ")}`).toBeGreaterThan(0)
    }
  }, 30_000)

  it("caps a --security-only fetch so a server that stopped honoring securityList can't run up the bill", async () => {
    // --security is a bound only while the server actually filters by it. IGNORED.XX
    // makes the stub behave like one that doesn't: 3000 rows hide behind the "bound".
    // The cap must stop at 1000 rows (20 pages × 50) instead of paginating the lot,
    // and the result must read as partial — not as a complete company calendar.
    const capped = await cli(["insight", "performance-calendar", "list", "--security", "IGNORED.XX", "--format", "json"])
    expect(captured).toHaveLength(20)
    expect(capped.code).toBe(3)
    expect(capped.stderr).toContain("capped at 1000 rows")

    // Exactly-at-the-cap is COMPLETE (total 1000 = rows fetched), not truncated:
    // flagging it would make every automated caller read a full answer as partial.
    captured.length = 0
    const exact = await cli(["insight", "performance-calendar", "list", "--security", "EXACT1000.XX", "--format", "json"])
    expect(captured).toHaveLength(20)
    expect(exact.code).toBe(0)
    expect(exact.stderr).not.toContain("capped at")
    expect(JSON.parse(exact.stdout).partial).toBeUndefined()

    // An explicit bound keeps plain fetch-all semantics: 3000 rows = 60 pages, exit 0.
    captured.length = 0
    const bounded = await cli(["insight", "performance-calendar", "list", "--start-date", "2026-07-01", "--end-date", "2026-07-25", "--format", "json"])
    expect(captured).toHaveLength(60)
    expect(bounded.code).toBe(0)
    expect(bounded.stderr).not.toContain("capped at")
  }, 30_000)

  it("rejects a misspelled performance-calendar --category before any request goes out", async () => {
    // A silently-ignored enum here would bill 0.1/条 for an unfiltered full-market pull.
    const { code, out } = await cli(["insight", "performance-calendar", "list", "--category", "performanceReport", "--format", "json"])
    expect(code).toBe(1)
    expect(out).toContain("Invalid --category")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("tool file-parse uploads the PDF as multipart and reports the taskId", async () => {
    const pdfPath = path.join(os.tmpdir(), `gangtise-file-parse-${process.pid}.pdf`)
    try {
      await writeFile(pdfPath, "%PDF-1.4 stub\n")
      const { code, stdout } = await cli(["tool", "file-parse", "--file", pdfPath])
      expect(code).toBe(0)
      expect(captured).toHaveLength(1)
      expect(captured[0].path).toBe("/application/open-tool/file-parse/submit")
      expect(captured[0].contentType).toContain("multipart/form-data")
      const raw = captured[0].raw.toString("utf8")
      expect(raw).toContain('name="file"')
      expect(raw).toContain(`filename="${path.basename(pdfPath)}"`)
      expect(raw).toContain("%PDF-1.4 stub")
      expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ taskId: "1782345678901234567", status: "pending" }))
    } finally {
      await rm(pdfPath, { force: true })
    }
  }, 30_000)

  it("tool file-parse-check streams the result ZIP to --output", async () => {
    const outPath = path.join(os.tmpdir(), `gangtise-file-parse-${process.pid}.zip`)
    try {
      const { code, stdout } = await cli(["tool", "file-parse-check", "--task-id", "T-123", "--output", outPath])
      expect(code).toBe(0)
      // POST download: the taskId travels in the JSON body, not the query string.
      expect(captured[0].path).toBe("/application/open-tool/file-parse/result")
      expect(captured[0].body).toEqual({ taskId: "T-123" })
      expect(await readFile(outPath)).toEqual(ZIP_BYTES)
      expect(stdout.trim()).toBe(outPath)
    } finally {
      await rm(outPath, { force: true })
    }
  }, 30_000)

  it("tool file-parse --wait chains submit → result and writes the ZIP", async () => {
    const pdfPath = path.join(os.tmpdir(), `gangtise-file-parse-wait-${process.pid}.pdf`)
    const outPath = path.join(os.tmpdir(), `gangtise-file-parse-wait-${process.pid}.zip`)
    try {
      await writeFile(pdfPath, "%PDF-1.4 stub\n")
      const { code, stdout } = await cli(["tool", "file-parse", "--file", pdfPath, "--wait", "--output", outPath])
      expect(code).toBe(0)
      expect(captured.map((c) => c.path)).toEqual([
        "/application/open-tool/file-parse/submit",
        "/application/open-tool/file-parse/result",
      ])
      // The taskId from submit has to reach the result call — otherwise --wait
      // would poll a task nobody created while the paid one runs unclaimed.
      expect(captured[1].body).toEqual({ taskId: "1782345678901234567" })
      expect(await readFile(outPath)).toEqual(ZIP_BYTES)
      expect(stdout.trim()).toBe(outPath)
    } finally {
      await rm(pdfPath, { force: true })
      await rm(outPath, { force: true })
    }
  }, 30_000)

  it("tool file-parse-check reports pending (140001) instead of failing", async () => {
    const { code, stdout } = await cli(["tool", "file-parse-check", "--task-id", "PENDING"])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ taskId: "PENDING", status: "pending" }))
  }, 30_000)
})
