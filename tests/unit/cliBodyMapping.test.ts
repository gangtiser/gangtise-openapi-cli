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
        const b = body as { from?: number; size?: number; securityList?: string[] } | undefined
        // Model a real server: rows run out at `total`. A stub that serves a full page at
        // ANY offset would trip the cap probe (which is exactly what that probe is for),
        // and would also make every pagination assertion here vacuous.
        const page = (total: number, mk: (i: number) => unknown, cap = 50) => {
          const from = b?.from ?? 0
          const want = Math.min(b?.size ?? cap, cap)
          const count = Math.max(0, Math.min(want, total - from))
          return JSON.stringify({ code: "000000", msg: "ok", data: { total, list: Array.from({ length: count }, (_, i) => mk(from + i)) } })
        }
        // EXACT1000.XX: a result whose total lands exactly ON the cap. Complete, not
        // truncated — the cap check must read `total`, not just the row count.
        if (b?.securityList?.includes("EXACT1000.XX")) {
          res.end(page(1000, (i) => ({ performanceReportId: String(i), title: "t" })))
          return
        }
        // Normal path — the server honors securityList (probed 2026-07-25: an unknown
        // or malformed code returns total 0). One company's calendar is a few rows.
        if (b?.securityList?.length && !b.securityList.includes("IGNORED.XX")) {
          res.end(page(9, (i) => ({ performanceReportId: `s${i}`, title: "t" })))
          return
        }
        // IGNORED.XX stands in for a server that STOPPED filtering by securityList:
        // the "bound" silently covers the whole 3000-row calendar. This is what the
        // implicit row cap has to contain.
        res.end(page(3000, (i) => ({ performanceReportId: String(i), title: "t" })))
        return
      }
      if ((req.url ?? "").includes("/quote/realtime")) {
        const requested = (body as { securityList?: string[]; fieldList?: string[] } | undefined)
        if (requested?.fieldList?.includes("close")) {
          // 2026-07-24 形态，留给错列护栏：值只按**有效**字段返回、字段名却按**请求**原样
          // 回显。realtime 没有 close，传三个字段只回两个值——按位置拍平会把换手率 28.5573
          // 贴成 close（茅台真实价 1297.41）。上游 2026-09-05 起已改成名和值一起丢（见下），
          // 但 main-business 仍是这个形态，护栏必须继续守住。
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 1, fieldList: ["securityCode", "close", "turnoverRate"], list: [["600519.SH", 28.5573]] } }))
          return
        }
        // 当前契约（实测 2026-09-05）：15 列，不认识的字段名连名带值一起丢、不报错；
        // tradeStatus 仅 A 股 / 港股个股有值；美股 amount 为 null；全球指数 volume /
        // amount / amplitude 三个都是 null。
        const KNOWN = ["securityCode", "exchange", "tradeDate", "tradeTime", "tradeStatus", "open", "high", "low", "latestPrice", "preClose", "change", "pctChange", "volume", "amount", "amplitude"]
        const fieldList = requested?.fieldList ? KNOWN.filter((f) => requested.fieldList!.includes(f)) : KNOWN
        const isGlobalIndex = (code: string) => code.endsWith(".SPI") || code.endsWith(".NKI") || code.endsWith(".HI")
        const isStock = (code: string) => /\.(SH|SZ|BJ|HK)$/.test(code) && !code.startsWith("5") && !code.startsWith("15")
        const cell = (code: string, field: string): unknown => {
          if (field === "securityCode") return code
          if (field === "exchange") return code.split(".")[1]
          if (field === "tradeDate") return "2026-09-04"
          if (field === "tradeTime") return "15:00:00"
          if (field === "tradeStatus") return isStock(code) ? "收盘" : null
          if (["volume", "amount", "amplitude"].includes(field) && isGlobalIndex(code)) return null
          if (field === "amount" && code.endsWith(".O")) return null
          return field === "volume" ? 1000 : 1.5
        }
        const list = (requested?.securityList ?? ["600519.SH"]).map((code) => fieldList.map((f) => cell(code, f)))
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: list.length, fieldList, list } }))
        return
      }
      if ((req.url ?? "").includes("/kline/minute")) {
        // Like the kline stub: ONLY the requested columns come back (minute rows carry
        // tradeTime, not tradeDate — probed 2026-09-05), unknown names are dropped without
        // an error, and three fixed rows let a truncation test drive rows-vs-limit.
        const KNOWN = ["securityCode", "tradeTime", "open", "high", "low", "close", "change", "pctChange", "volume", "amount"]
        const requested = (body as { fieldList?: string[] } | undefined)?.fieldList
        const fieldList = requested ? KNOWN.filter((f) => requested.includes(f)) : ["securityCode", "tradeTime", "close"]
        const code = (body as { securityCode?: string } | undefined)?.securityCode ?? "600519.SH"
        const list = [1, 2, 3].map((n) => fieldList.map((f) => (f === "securityCode" ? code : f === "tradeTime" ? `2026-06-01 09:3${n - 1}:00` : n)))
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 3, fieldList, list } }))
        return
      }
      if ((req.url ?? "").includes("/daily") && ((body as { securityList?: string[] } | undefined)?.securityList ?? []).includes("NULLDATA.XX")) {
        // A successful envelope carrying `data: null` — not a valid answer for any quote
        // endpoint (an empty range is `{total: 0, list: []}`), so it must not print as one.
        // The traceId rides on the envelope only: the error must still surface it.
        res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-null-1", data: null }))
        return
      }
      if ((req.url ?? "").includes("/fund-flow/daily")) {
        // fund-flow always prepends securityCode / tradeDate, then the requested fields it
        // recognises; an unknown name is dropped without an error (probed 2026-09-05).
        // Three fixed rows so a truncation test can drive rows-vs-limit with --limit 3.
        const KNOWN = ["mainNetInflow", "largeInflow", "xlargeInflow", "mainInflow", "smallNetInflow"]
        const requested = (body as { fieldList?: string[] } | undefined)?.fieldList
        const extra = requested ? requested.filter((f) => KNOWN.includes(f)) : ["mainNetInflow"]
        const fieldList = ["securityCode", "tradeDate", ...extra]
        const list = [["600519.SH", 1], ["000001.SZ", 2], ["000002.SZ", 3]].map(([code, n]) => [code, "2026-06-03", ...extra.map(() => n)])
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 3, fieldList, list } }))
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
        // The kline endpoints (unified and retired). Unlike fund-flow, ONLY the requested
        // columns come back — no implicit securityCode / tradeDate (probed 2026-09-05:
        // `--field close` answers `[close]` alone) — and an unknown name is dropped without
        // an error. Three fixed rows so a truncation test can drive rows-vs-limit; body-
        // mapping tests (no --limit or a large one) get 3 < cap → exit 0.
        const KNOWN = ["securityCode", "tradeDate", "open", "high", "low", "close", "preClose", "change", "pctChange", "volume", "amount", "adjustFactor"]
        const requested = (body as { fieldList?: string[] } | undefined)?.fieldList
        const fieldList = requested ? KNOWN.filter((f) => requested.includes(f)) : ["securityCode", "tradeDate", "close"]
        const list = [["600519.SH", 1], ["000001.SZ", 2], ["000002.SZ", 3]].map(([code, n]) => fieldList.map((f) => (f === "securityCode" ? code : f === "tradeDate" ? "2026-06-03" : n)))
        res.end(JSON.stringify({ code: "000000", msg: "ok", data: { total: 3, fieldList, list } }))
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
        // DROPPED.XX stands in for the EDE shape where an indicator vanishes from
        // indicatorList entirely — since 2026-08-07 that means the server did not
        // resolve the code (one it merely has no data for keeps a null column).
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
        // MISSFILTER.XX: a hit whose F2 column vanished. F2 is what the
        // expression filters on, so the rows cannot be shown to satisfy it.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "MISSFILTER.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-missfilter", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"],
            // Echo every requested binding EXCEPT the one standing in for the
            // uncovered indicator, so the same stub serves the 2- and 3-binding
            // cases (F2 && (F1 || F3) needs F1 and F3 to come back).
            indicatorList: ((body as { indicatorList?: { field: string; indicatorCode: string }[] } | undefined)?.indicatorList ?? [])
              .filter((i) => i.indicatorCode !== "MISSFILTER.XX")
              .map((i) => ({ field: i.field, code: i.indicatorCode, name: "收盘价" })),
            values: [Array(Math.max(0, ((body as { indicatorList?: unknown[] } | undefined)?.indicatorList ?? []).length - 1)).fill(1350.6)],
          } } }))
          return
        }
        // NOCOLUMN.XX: a hit with NO indicator columns at all.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "NOCOLUMN.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], indicatorList: [], values: [[]],
          } } }))
          return
        }
        // MISSAUX.XX: same shape, but the vanished F2 is only an output column —
        // the expression never reads it, so information is lost, not correctness.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "MISSAUX.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"],
            indicatorList: [{ field: "F1", code: "qte_close", name: "收盘价" }], values: [[1350.6]],
          } } }))
          return
        }
        // NOMATCH.XX: zero securities but indicatorList still echoed — empty to
        // the caller, yet not the canonical all-empty shape.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "NOMATCH.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: [], securityNameList: [],
            indicatorList: [{ field: "F1", code: "NOMATCH.XX", name: "无命中" }], values: [],
          } } }))
          return
        }
        // DRIFT.XX: the server answers a requested F1 under a variable nobody
        // asked for. Every value looks fine; only the binding gives it away.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "DRIFT.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-drift", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"],
            indicatorList: [{ field: "F9", code: "DRIFT.XX", name: "漂移" }], values: [[1350.6]],
          } } }))
          return
        }
        // NOAXIS.XX: a matrix payload missing indicatorList entirely.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).some((i) => i.indicatorCode === "NOAXIS.XX")) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", traceId: "trace-ede-noaxis", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"], securityNameList: ["贵州茅台"], values: [[1350.6]],
          } } }))
          return
        }
        // A duplicate-code screen: one indicator under two variables, each with
        // its own date. The server used to answer every such binding from the
        // earliest date and null the rest; re-probed 2026-08-08 it returns each
        // variable's own value, which is what this stub now mirrors.
        if (((body as { indicatorList?: { indicatorCode: string }[] } | undefined)?.indicatorList ?? []).length === 2) {
          res.end(JSON.stringify({ code: "000000", msg: "ok", data: { code: "000000", status: true, data: {
            securityCodeList: ["600519.SH"],
            securityNameList: ["贵州茅台"],
            indicatorList: [{ field: "F1", code: "qte_close", name: "收盘价" }, { field: "F2", code: "qte_close", name: "收盘价" }],
            values: [[1350.6, 1361.76]],
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

  it("insight pamirs-summary list sends only its own filter set, not summary's wider one", async () => {
    // Pamirs takes a strict subset of `summary list`'s filters — no sourceList /
    // institutionList / participantRoleList. Copying summary's builder would send
    // those anyway, and the server drops unknown body fields silently, so the
    // caller would see a wider result set than the flags they passed describe.
    const { code } = await cli([
      "insight", "pamirs-summary", "list",
      "--keyword", "AI智能体", "--search-type", "2", "--rank-type", "2",
      "--category", "companyAnalysis", "--market", "aShares",
      "--security", "000001.SZ", "--research-area", "100800111",
      "--size", "2", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/pamirs-summary/getList")
    expect(captured[0].body).toEqual({
      from: 0,
      size: 2,
      searchType: 2,
      rankType: 2,
      keyword: "AI智能体",
      researchAreaList: ["100800111"],
      securityList: ["000001.SZ"],
      categoryList: ["companyAnalysis"],
      marketList: ["aShares"],
    })
  }, 30_000)

  it("insight pamirs-summary download sends summaryId and fileType as query params", async () => {
    const { code } = await cli([
      "insight", "pamirs-summary", "download",
      "--summary-id", "5551234", "--file-type", "2",
      "--output", path.join(os.tmpdir(), `gangtise-pamirs-${process.pid}.html`),
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-insight/pamirs-summary/download/file?summaryId=5551234&fileType=2")
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
    // Two plain codes. This used to pass `600519.SH` + `aShares`, which asserted that a
    // keyword mixed with a code goes out verbatim — a request the server answers by
    // silently dropping the keyword and returning only the code (exit 0, no warning).
    // That combination is now rejected locally; see the dedicated guard test below.
    const { code } = await cli([
      "quote", "fund-flow",
      "--security", "600519.SH", "--security", "000858.SZ",
      "--start-date", "2026-06-01", "--end-date", "2026-06-05",
      "--limit", "5000", "--field", "mainNetInflow", "--field", "largeInflow",
      "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-quote/fund-flow/daily")
    expect(captured[0].body).toEqual({
      securityList: ["600519.SH", "000858.SZ"],
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

  it("quote day-kline shards each market keyword at its own granularity", async () => {
    // The unified day-kline covers three markets whose whole-market row counts differ
    // (measured 2026-08-13: A 5543 rows/trading day, US 5919, HK 2810), so one shard size
    // can't serve all three without either wasting requests or blowing the 10K-row cap.
    // 2026-08-10..14 is Mon–Fri, so no weekend shard is dropped and the counts are exact.
    const range = ["--start-date", "2026-08-10", "--end-date", "2026-08-14", "--format", "json"]

    for (const [keyword, expectedShards] of [["aShares", 5], ["usStocks", 5], ["hkStocks", 3]] as const) {
      captured.length = 0
      const { code } = await cli(["quote", "day-kline", "--security", keyword, ...range])
      expect(code, `${keyword} should succeed`).toBe(0)
      expect(captured, `${keyword} shard count`).toHaveLength(expectedShards)
      expect(captured.every((c) => c.path === "/application/open-quote/kline/daily")).toBe(true)
      // Whole-market requests must also carry the lifted row cap, not the 6000 default.
      expect((captured[0].body as { limit?: number }).limit).toBe(10000)
    }
  }, 60_000)

  it("pins the shard granularity of the retired per-market endpoints, including index=15", async () => {
    // The index endpoint used to split `all` into 30-day windows, which ALWAYS maxed out:
    // ~531 index rows per trading day x ~22 trading days in 30 days is ~11.7K against a
    // 10K cap, so every shard silently lost rows (surfaced as exit 3 + truncatedShards).
    // 15 days caps a window at 11 trading days (~5.8K). Nothing else guards that number —
    // without this test, changing it back to 30 keeps the whole suite green.
    // 2026-08-03..09-16 is 45 days: 15->3 shards, 2->23, 1->45.
    const range = ["--start-date", "2026-08-03", "--end-date", "2026-09-16", "--format", "json"]

    for (const [command, expectedShards] of [
      ["index-day-kline", 3],
      ["day-kline-hk", 23],
      ["day-kline-us", 33], // 1 day/shard, weekends skipped: 45 days -> 33 weekdays
    ] as const) {
      captured.length = 0
      const { code } = await cli(["quote", command, "--security", "all", ...range])
      expect(code, `${command} should succeed`).toBe(0)
      expect(captured, `${command} shard count`).toHaveLength(expectedShards)
    }
  }, 60_000)

  it("canonicalises fund-flow's keyword, the one endpoint where the server is case-sensitive", async () => {
    // Probed 2026-08-15: five of the six quote endpoints fold keyword case server-side,
    // but fund-flow accepts ONLY the literal `aShares` — `ashares` comes back as
    // `120001 非有效A股`. So here canonicalisation is not tidiness: drop it and this query
    // stops working entirely.
    //
    // Why this is a separate test from the day-kline case above: NOT because that one
    // would stay green (mutation-tested — stubbing canonicalizeMarketKeywords to identity
    // reddens both), but because the two failures differ in kind. On day-kline the server
    // still folds, so the user gets a DEGRADED result — unsharded, capped at 6000 rows or
    // rejected as "query too large". On fund-flow the server is literal, so `ashares`
    // becomes a hard `120001`. This test pins the only endpoint where dropping
    // canonicalisation turns a working query into a broken one.
    const { code } = await cli([
      "quote", "fund-flow", "--security", "ASHARES",
      "--start-date", "2026-06-29", "--end-date", "2026-07-01", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(3) // still recognised as whole-market → per-day shards
    expect((captured[0].body as { securityList: string[] }).securityList).toEqual(["aShares"])
  }, 30_000)

  it("folds a cased 'ALL' to the whole-market keyword, matching how the server resolves it", async () => {
    // `ALL` also happens to be Allstate's NYSE ticker root, but the SERVER resolves a bare
    // `ALL` to the whole US market (probed: ALL / all / All each return the full market;
    // ALLSTATE returns 0; ALL.N returns the one stock). Matching case-sensitively here
    // would not protect that user — it would only stop us from sharding a request the
    // server already treats as whole-market. So fold, and shard it correctly.
    const { code } = await cli([
      "quote", "day-kline-us", "--security", "ALL",
      "--start-date", "2026-08-13", "--end-date", "2026-08-13", "--format", "json",
    ])
    expect(code).toBe(0)
    expect((captured[0].body as { securityList: string[] }).securityList).toEqual(["all"])
    expect((captured[0].body as { limit?: number }).limit).toBe(10000) // whole-market lift
  }, 30_000)

  it("quote day-kline rejects the retired 'all' keyword locally, naming the replacements", async () => {
    // The server dropped ["all"] on 2026-08-14 and answers it with 120001 "invalid
    // security code" — which reads as a typo and sends the user looking for a bad code.
    // Fail before the request with the three keywords that actually work.
    const { code, out } = await cli([
      "quote", "day-kline", "--security", "all",
      "--start-date", "2026-08-13", "--end-date", "2026-08-13", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("aShares / hkStocks / usStocks")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("quote day-kline-hk still accepts 'all' — the retired per-market endpoints kept it", async () => {
    // Only the unified endpoint changed. Rejecting `all` everywhere would break scripts
    // against endpoints that still answer it.
    const { code } = await cli([
      "quote", "day-kline-hk", "--security", "all",
      "--start-date", "2026-08-13", "--end-date", "2026-08-13", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(1)
    expect((captured[0].body as { securityList: string[] }).securityList).toEqual(["all"])
  }, 30_000)

  it("rejects a market keyword mixed with security codes before any request", async () => {
    // The API rejects the combination as a bare 120001 that points at the codes rather
    // than at the mixing, so say which rule was broken.
    const { code, out } = await cli([
      "quote", "day-kline", "--security", "aShares", "--security", "600519.SH",
      "--start-date", "2026-08-13", "--end-date", "2026-08-13", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("must be passed alone")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("rejects a market keyword mixed with codes on fund-flow, which otherwise silently drops it", async () => {
    // Worse than the kline case: the server does NOT reject this combination on fund-flow.
    // It drops `aShares` and answers with only the explicit codes — one row, exit 0, no
    // warning — so "whole market plus this one" silently becomes "only this one".
    const { code, out } = await cli([
      "quote", "fund-flow", "--security", "aShares", "--security", "600519.SH",
      "--start-date", "2026-08-13", "--end-date", "2026-08-13", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("must be passed alone")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("matches market keywords case-insensitively so a case variant still shards", async () => {
    // The API itself is case-insensitive (`ashares` returns the full A-share market), so an
    // exact-match-only CLI would drop `ashares` onto the single-request path with the
    // 6000-row default — silently truncated, or rejected as "query too large".
    const { code } = await cli([
      "quote", "day-kline", "--security", "ashares",
      "--start-date", "2026-08-10", "--end-date", "2026-08-14", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(5) // sharded per trading day, not one big request
    // Canonicalised before dispatch so the body carries the documented spelling.
    expect((captured[0].body as { securityList: string[] }).securityList).toEqual(["aShares"])
  }, 60_000)

  it("rejects two market keywords on quote realtime before any request", async () => {
    const { code, out } = await cli([
      "quote", "realtime", "--security", "aShares", "--security", "hkStocks", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(out).toContain("must be passed alone")
    expect(captured).toHaveLength(0)
  }, 30_000)

  it("rejects a market keyword on ai stock-summary, which is now codes-only", async () => {
    // The endpoint dropped whole-market batches on 2026-08-14. It bills 3 credits/row, so
    // the failure must land before the request, not after a partial charge.
    const { code, out } = await cli(["ai", "stock-summary", "--security", "aShares", "--format", "json"])
    expect(code).toBe(1)
    expect(out).toContain("explicit security codes only")
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

  it("rejects an out-of-enum --search-type / --rank-type / pamirs --category|--market before any request goes out", async () => {
    // Probed 2026-08-08: the server drops an unrecognised enum VALUE exactly the
    // way it drops an unrecognised FIELD — silently, answering with the UNFILTERED
    // set and exit 0. A bad --search-type additionally takes --keyword down with
    // it: `summary list --keyword 茅台 --search-type 99` returned 196988 (the whole
    // library) instead of 135, i.e. a full dump read as a keyword hit.
    for (const args of [
      ["insight", "summary", "list", "--keyword", "茅台", "--search-type", "99", "--size", "1"],
      ["insight", "research", "list", "--search-type", "5", "--size", "1"],
      ["insight", "opinion", "list", "--rank-type", "7", "--size", "1"],
      ["insight", "pamirs-summary", "list", "--category", "BOGUS", "--size", "1"],
      ["insight", "pamirs-summary", "list", "--market", "BOGUS", "--size", "1"],
    ]) {
      const { code } = await cli(args)
      expect(code, args.join(" ")).not.toBe(0)
    }
    expect(captured).toHaveLength(0)
  }, 40_000)

  it("rejects an out-of-range --file-type per command, without narrowing foreign-report's 3/4", async () => {
    // The type system forces every download spec to declare `choices`, but not to
    // declare the RIGHT ones. Pin both edges of the one command whose range is
    // wider than 1-2: foreign-report accepts 4 (CN-Markdown) and must not accept 5.
    for (const args of [
      ["insight", "summary", "download", "--summary-id", "1", "--file-type", "3"],
      ["insight", "pamirs-summary", "download", "--summary-id", "1", "--file-type", "99"],
      ["insight", "independent-opinion", "download", "--independent-opinion-id", "1", "--file-type", "3"],
      ["insight", "foreign-report", "download", "--report-id", "1", "--file-type", "5"],
    ]) {
      const { code, out } = await cli(args)
      expect(code, args.join(" ")).not.toBe(0)
      // Assert the REASON, not just the failure: every other flag here is valid,
      // so without this the test would still pass with the whitelist removed
      // (a typo'd id flag, a missing required option — anything exits non-zero).
      expect(out, args.join(" ")).toContain("--file-type")
    }
    expect(captured, "no request may go out for a rejected --file-type").toHaveLength(0)
    // 4 is in range for foreign-report: it must reach the server (the stub answers,
    // so this also proves the guard is not silently rejecting every value).
    const { code } = await cli([
      "insight", "foreign-report", "download", "--report-id", "1", "--file-type", "4",
      "--output", path.join(os.tmpdir(), `gangtise-ft-${process.pid}.md`),
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].path).toContain("fileType=4")
  }, 40_000)

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

  // --- the orphan --indicator-param guard, through the real CLI ---
  //
  // commandBodies.test.ts calls the builders directly, which proves the guard's LOGIC
  // and nothing about whether `--indicator-param` still reaches it. Both commands hand
  // the whole commander `options` object to their builder, so today the flag rides along
  // for free — but a refactor into an explicit object (the shape `emit`/`withClient`
  // already pushed other commands toward) drops it silently: no param on the wire, the
  // guard never fires, and the request that goes out is the one the caller thinks they
  // narrowed. These two are what would go red.
  //
  // Zero requests is the load-bearing half. Exit 1 alone would also be satisfied by the
  // server rejecting the body, which is exactly the round trip the guard exists to save.
  for (const [command, dateArgs] of [
    ["cross-section", ["--date", "2026-03-31"]],
    ["time-series", ["--start-date", "2026-07-30", "--end-date", "2026-07-31"]],
  ] as const) {
    it(`indicator ${command} rejects an --indicator-param whose code no --indicator names, before any request`, async () => {
      const { code, out } = await cli([
        "indicator", command,
        "--indicator", "is_op_rev", "--security", "600519.SH", ...dateArgs,
        // `is_op_rve` — the transposition a real caller makes, not a sentinel.
        "--indicator-param", "is_op_rve:reportDate=2025-06-30", "--format", "json",
      ])
      expect(code, out).toBe(1)
      expect(out).toContain("is_op_rve")
      expect(captured, "the guard must fire before the request, not after").toHaveLength(0)
    }, 30_000)
  }

  it("indicator cross-section forwards a valid --indicator-param instead of injecting tradeDate over it", async () => {
    // The positive half: proves the flag actually arrives, so the negative tests above
    // cannot be satisfied by an --indicator-param that never reaches the builder at all.
    // reportDate also has to SUPPRESS the --date injection — sending both is what the
    // server rejects outright.
    const { code, out } = await cli([
      "indicator", "cross-section",
      "--indicator", "cf_finc_exp", "--security", "600519.SH", "--date", "2026-03-31",
      "--indicator-param", "cf_finc_exp:reportDate=2025-12-31", "--format", "json",
    ])
    expect(code, out).toBe(0)
    expect(captured[0].body).toMatchObject({
      indicatorParamList: [
        { indicatorCode: "cf_finc_exp", parameters: [{ paramKey: "reportDate", paramValue: "2025-12-31" }] },
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
    // An indicator code the server cannot resolve vanishes from indicatorList
    // (one it merely has no data for keeps a null column, since 2026-08-07).
    // Exit 0 on a short result is how a --key-by code
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

  it("exits 0 without partial metadata on the canonical all-empty answer", async () => {
    // EMPTY.XX drives the canonical all-empty EDE answer. Since 2026-08-07 that
    // shape means nothing in the request resolved (real no-data keeps its rows
    // and columns with null cells), but the CLI's handling is unchanged:
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

  it("refuses a screener result whose variable bindings drifted from the request", async () => {
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:DRIFT.XX", "--security", "600519.SH",
      "--expression", "F1 > 0", "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("") // a screening result nobody can trace to a filter must not print
    expect(stderr).toContain("F9")
    expect(stderr).toContain("trace-ede-drift")
  }, 30_000)

  it("keeps a disjunction result whose other operand still had a column", async () => {
    // The real shape (probed 2026-08-03): finc_pe_ttm has no HK coverage, so the
    // response carries only the other operand's column and the row matched
    // through it. Killing this was the regression Claude caught.
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:MISSFILTER.XX",
      "--security", "600519.SH", "--expression", "F1 > 0 || F2 > 0",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(3) // data intact; the F2 condition simply never applied
    const payload = JSON.parse(stdout) as { partial?: boolean; list: unknown[] }
    expect(payload.partial).toBe(true)
    expect(payload.list).toHaveLength(1)
    expect(stderr).toContain("F2")
  }, 30_000)

  it("refuses a disjunction with no evaluable branch left", async () => {
    // Both operands lost their column: nothing in `F1 > 0 || F2 > 0` could have
    // been evaluated, so the returned row is unexplainable.
    const { code, stdout } = await cli([
      "indicator", "screener",
      "--indicator", "F1:NOCOLUMN.XX", "--indicator", "F2:qte_vol",
      "--security", "600519.SH", "--expression", "F1 > 0 || F2 > 0",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("")
  }, 30_000)

  it("refuses a mixed expression whose mandatory conjunct lost its column", async () => {
    // `F2 && (F1 || F3)`: F2 has to hold for every matched row, so its absence is
    // fatal even though a `||` sits beside it. A guard that only asked "does the
    // expression contain ||" would wrongly let this through.
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:MISSFILTER.XX", "--indicator", "F3:qte_vol",
      "--security", "600519.SH", "--expression", "F2 > 0 && (F1 > 0 || F3 > 0)",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("")
    expect(stderr).toContain("F2")
  }, 30_000)

  it("refuses a screener hit whose filtered-on variable produced no column", async () => {
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:MISSFILTER.XX",
      "--security", "600519.SH", "--expression", "F1 > 0 && F2 > 0",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stdout.trim()).toBe("") // rows claiming to pass F2 must not print when F2 is absent
    expect(stderr).toContain("F2")
  }, 30_000)

  it("degrades to partial when a screener column is only an output, not a filter", async () => {
    const { code, stdout } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:MISSAUX.XX",
      "--security", "600519.SH", "--expression", "F1 > 0",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(3)
    const payload = JSON.parse(stdout) as { partial?: boolean; omittedIndicators?: string[]; list: unknown[] }
    expect(payload.partial).toBe(true)
    expect(payload.omittedIndicators).toEqual(["MISSAUX.XX"])
    expect(payload.list).toHaveLength(1) // the rows are still correct, just missing a column
  }, 30_000)

  it("flags the empty-result ambiguity even when the response still echoes indicatorList", async () => {
    // Zero securities is empty to the caller whether or not the axis lists were
    // cleared, and just as ambiguous with a wrong parameter name.
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:NOMATCH.XX", "--security", "600519.SH",
      "--expression", "F1 > 0", "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(0)
    expect((JSON.parse(stdout) as { total: number }).total).toBe(0)
    expect(stderr).toContain("nothing matched")
  }, 30_000)

  it("passes a screen that binds one indicator to two variables straight through", async () => {
    // Binding one code to several variables (the same price on two dates) is an
    // intended capability that the server mis-resolved until 2026-08-08, so the
    // CLI used to force the result to `unreliable` + exit 3. Now that each
    // variable carries its own value, that guard would be a false alarm on a
    // correct answer: no flag, no warning, exit 0, both columns distinct.
    const { code, stdout, stderr } = await cli([
      "indicator", "screener",
      "--indicator", "F1:qte_close", "--indicator", "F2:qte_close",
      "--indicator-param", "F1:tradeDate=2026-07-31", "--indicator-param", "F2:tradeDate=2026-07-30",
      "--security", "600519.SH", "--expression", "F1 > 0 && F2 > 0",
      "--date", "2026-07-31", "--format", "json",
    ])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout) as { unreliable?: boolean; partial?: boolean; list: Record<string, unknown>[] }
    expect(payload.unreliable).toBeUndefined()
    expect(payload.partial).toBeUndefined()
    // Each variable keeps its own number — the whole point of the fix. Columns
    // are disambiguated by variable because the display names collide.
    expect(Object.values(payload.list[0])).toContain(1350.6)
    expect(Object.values(payload.list[0])).toContain(1361.76)
    expect(stderr).not.toContain("EARLIEST")
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

  it("quote realtime flags a requested column the server silently dropped (exit 3 + missingFields)", async () => {
    // 2026-09-05 起 realtime 对不认识 / 已下线的字段名是名和值一起丢、HTTP 200——长度仍相等，
    // 错列护栏管不到它。缺列必须从「退出 0、少一列」变成「partial + missingFields + 退出 3」。
    const { code, stdout, stderr } = await cli([
      "quote", "realtime", "--security", "600519.SH",
      "--field", "securityCode", "--field", "latestPrice", "--field", "turnoverRate",
      "--format", "json",
    ])
    expect(code).toBe(3)
    expect(stderr).toContain("turnoverRate")
    const parsed = JSON.parse(stdout) as { partial?: boolean; missingFields?: string[]; list: Record<string, unknown>[] }
    expect(parsed.partial).toBe(true)
    expect(parsed.missingFields).toEqual(["turnoverRate"])
    expect(parsed.list[0]).toEqual({ securityCode: "600519.SH", latestPrice: 1.5 })
  }, 30_000)

  it("quote realtime passes the current 15-column contract through (tradeStatus, null pattern) at exit 0", async () => {
    // Pins the shape the docs describe: tradeStatus only on A/HK stocks, US amount null,
    // global-index volume / amount / amplitude null — and that none of it trips a guard.
    const { code, stdout } = await cli([
      "quote", "realtime", "--security", "600519.SH", "--security", "AAPL.O", "--security", "512800.SH", "--security", "SPX.SPI",
      "--format", "json",
    ])
    expect(code).toBe(0)
    const rows = (JSON.parse(stdout) as { list: Record<string, unknown>[] }).list
    const by = Object.fromEntries(rows.map((r) => [r.securityCode as string, r]))
    expect(Object.keys(by["600519.SH"])).toHaveLength(15)
    expect(by["600519.SH"]).toMatchObject({ tradeStatus: "收盘", amount: 1.5 })
    expect(by["AAPL.O"]).toMatchObject({ tradeStatus: null, amount: null, volume: 1000 })
    expect(by["512800.SH"]).toMatchObject({ tradeStatus: null, amount: 1.5 })
    expect(by["SPX.SPI"]).toMatchObject({ tradeStatus: null, volume: null, amount: null, amplitude: null, latestPrice: 1.5 })
    expect(Object.keys(by["600519.SH"])).not.toContain("turnoverRate")
  }, 30_000)

  it("quote day-kline (single security) rejects a null payload instead of printing null at exit 0", async () => {
    // The sharded path already treats a shard without `list` as failed; the single-request
    // path used to hand `null` straight to the printer.
    const { code, stdout, stderr } = await cli([
      "quote", "day-kline", "--security", "NULLDATA.XX",
      "--start-date", "2026-06-01", "--end-date", "2026-06-05", "--format", "json",
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("returned no list payload")
    expect(stderr).toContain("trace trace-null-1")
    expect(stdout.trim()).toBe("")
  }, 30_000)

  // One wiring test per quote command and per exit (single request / sharded merge): the
  // helper's unit tests and the realtime E2E above prove nothing about the other three
  // call sites — removing the minute-kline hook alone left the whole suite green.
  it("quote day-kline (single security) flags a dropped --field column, and returns only the requested columns", async () => {
    const { code, stdout } = await cli([
      "quote", "day-kline", "--security", "600519.SH", "--security", "000858.SZ",
      "--start-date", "2026-06-01", "--end-date", "2026-06-05",
      "--field", "close", "--field", "turnoverRate", "--format", "json",
    ])
    expect(code).toBe(3)
    const parsed = JSON.parse(stdout) as { missingFields?: string[]; list: Record<string, unknown>[] }
    expect(parsed.missingFields).toEqual(["turnoverRate"])
    // No implicit identity columns on kline: the caller has to ask for securityCode.
    expect(parsed.list[0]).toEqual({ close: 1 })
  }, 30_000)

  it("quote day-kline (sharded aShares) flags a dropped --field column on the merged result", async () => {
    const { code, stdout } = await cli([
      "quote", "day-kline", "--security", "aShares",
      "--start-date", "2026-08-10", "--end-date", "2026-08-14",
      "--field", "securityCode", "--field", "close", "--field", "bogus", "--format", "json",
    ])
    expect(code).toBe(3)
    const parsed = JSON.parse(stdout) as { missingFields?: string[]; list: unknown[] }
    expect(parsed.missingFields).toEqual(["bogus"])
    expect(parsed.list).toHaveLength(15) // 5 shards × 3 rows
  }, 30_000)

  it("quote minute-kline identity columns are securityCode + tradeTime (tradeDate is not a minute column)", async () => {
    // Pins the docs' example: the minute row's time column is tradeTime; asking for
    // tradeDate here is a missing column, not an implicit one.
    const ok = await cli([
      "quote", "minute-kline", "--security", "600519.SH",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--field", "securityCode", "--field", "tradeTime", "--field", "close", "--format", "json",
    ])
    expect(ok.code).toBe(0)
    expect((JSON.parse(ok.stdout) as { list: Record<string, unknown>[] }).list[0]).toEqual({ securityCode: "600519.SH", tradeTime: "2026-06-01 09:30:00", close: 1 })
    const wrong = await cli([
      "quote", "minute-kline", "--security", "600519.SH",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--field", "securityCode", "--field", "tradeDate", "--field", "close", "--format", "json",
    ])
    expect(wrong.code).toBe(3)
    expect((JSON.parse(wrong.stdout) as { missingFields?: string[] }).missingFields).toEqual(["tradeDate"])
  }, 30_000)

  it("the three retired kline commands reject a null payload the same way, trace included", async () => {
    for (const command of ["day-kline-hk", "day-kline-us", "index-day-kline"]) {
      const { code, stdout, stderr } = await cli([
        "quote", command, "--security", "NULLDATA.XX",
        "--start-date", "2026-06-01", "--end-date", "2026-06-05", "--format", "json",
      ])
      expect(code, command).toBe(1)
      expect(stderr, command).toContain("returned no list payload")
      expect(stderr, command).toContain("trace trace-null-1")
      expect(stdout.trim(), command).toBe("")
    }
  }, 60_000)

  it("quote minute-kline with several --security issues one request each and merges them in order", async () => {
    const { code, stdout } = await cli([
      "quote", "minute-kline", "--security", "600519.SH", "--security", "000858.SZ",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--field", "securityCode", "--field", "tradeTime", "--field", "close", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured.map((c) => (c.body as { securityCode: string }).securityCode)).toEqual(["600519.SH", "000858.SZ"])
    const parsed = JSON.parse(stdout) as { total: number; list: Record<string, unknown>[] }
    expect(parsed.total).toBe(6)
    expect(parsed.list.map((r) => r.securityCode)).toEqual(["600519.SH", "600519.SH", "600519.SH", "000858.SZ", "000858.SZ", "000858.SZ"])
  }, 30_000)

  it("quote minute-kline with several --security flags the ones that filled their row cap", async () => {
    const { code, stdout, out } = await cli([
      "quote", "minute-kline", "--security", "600519.SH", "--security", "000858.SZ",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--limit", "3", "--format", "json",
    ])
    expect(code).toBe(3)
    expect((JSON.parse(stdout) as { truncatedSecurities?: string[] }).truncatedSecurities).toEqual(["600519.SH", "000858.SZ"])
    expect(out).toContain("--limit")
  }, 30_000)

  it("quote day-kline batches per security when securities × trading days would exceed the limit", async () => {
    // 3 securities × 261 trading days (a full year) = 783 rows > --limit 500: one request
    // per security, each with the caller's limit, merged in input order. Below the limit
    // the single-request path is kept (asserted by the existing single-security test).
    const { code, stdout } = await cli([
      "quote", "day-kline", "--security", "600519.SH", "--security", "000858.SZ", "--security", "300750.SZ",
      "--start-date", "2026-01-01", "--end-date", "2026-12-31", "--limit", "500",
      "--field", "securityCode", "--field", "close", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(3)
    expect(captured.map((c) => (c.body as { securityList: string[] }).securityList)).toEqual([["600519.SH"], ["000858.SZ"], ["300750.SZ"]])
    expect(captured.every((c) => (c.body as { limit: number }).limit === 500)).toBe(true)
    expect((JSON.parse(stdout) as { total: number }).total).toBe(9) // 3 parts × the stub's 3 rows
  }, 30_000)

  it("quote day-kline keeps one request when the estimate fits the limit", async () => {
    const { code } = await cli([
      "quote", "day-kline", "--security", "600519.SH", "--security", "000858.SZ",
      "--start-date", "2026-08-10", "--end-date", "2026-08-14", "--format", "json",
    ])
    expect(code).toBe(0)
    expect(captured).toHaveLength(1)
    expect((captured[0].body as { securityList: string[] }).securityList).toEqual(["600519.SH", "000858.SZ"])
  }, 30_000)

  it("quote minute-kline flags a dropped --field column", async () => {
    const { code, stdout } = await cli([
      "quote", "minute-kline", "--security", "600519.SH",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--field", "close", "--field", "bogus", "--format", "json",
    ])
    expect(code).toBe(3)
    expect((JSON.parse(stdout) as { missingFields?: string[] }).missingFields).toEqual(["bogus"])
  }, 30_000)

  it("quote fund-flow (single security) flags a dropped --field column while keeping its implicit identity columns", async () => {
    const { code, stdout } = await cli([
      "quote", "fund-flow", "--security", "600519.SH",
      "--start-date", "2026-06-03", "--end-date", "2026-06-03",
      "--field", "mainNetInflow", "--field", "bogus", "--format", "json",
    ])
    expect(code).toBe(3)
    const parsed = JSON.parse(stdout) as { missingFields?: string[]; list: Record<string, unknown>[] }
    expect(parsed.missingFields).toEqual(["bogus"])
    expect(parsed.list[0]).toEqual({ securityCode: "600519.SH", tradeDate: "2026-06-03", mainNetInflow: 1 })
  }, 30_000)

  it("quote fund-flow (sharded aShares) flags a dropped --field column on the merged result", async () => {
    const { code, stdout } = await cli([
      "quote", "fund-flow", "--security", "aShares",
      "--start-date", "2026-06-29", "--end-date", "2026-07-01",
      "--field", "mainNetInflow", "--field", "bogus", "--format", "json",
    ])
    expect(code).toBe(3)
    expect((JSON.parse(stdout) as { missingFields?: string[] }).missingFields).toEqual(["bogus"])
  }, 30_000)

  it("quote minute-kline names its own range flags in the truncation warning", async () => {
    // The shared warning used to say --start-date/--end-date for every limit-capped quote
    // command; minute-kline's range flags are --start-time/--end-time.
    const { code, out } = await cli([
      "quote", "minute-kline", "--security", "600519.SH",
      "--start-time", "2026-06-01 09:30:00", "--end-time", "2026-06-01 09:32:00",
      "--limit", "3", "--format", "json",
    ])
    expect(code).toBe(3)
    expect(out).toContain("--start-time/--end-time")
    expect(out).not.toContain("--start-date/--end-date")
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
    // 61 requests, not 60: an unbounded fetch-all also probes one row past `total` so a
    // server-capped total can't pass a truncated export off as complete. The EXACT1000
    // case above stays at 20 because the implicit row cap sends an explicit `size`, and
    // a size-bounded request makes no completeness claim to check.
    captured.length = 0
    const bounded = await cli(["insight", "performance-calendar", "list", "--start-date", "2026-07-01", "--end-date", "2026-07-25", "--format", "json"])
    expect(captured).toHaveLength(61)
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
