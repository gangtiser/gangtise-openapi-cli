import { execFile } from "node:child_process"
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
const TSX = path.resolve(process.cwd(), "node_modules/.bin/tsx")
const CLI = path.resolve(process.cwd(), "src/cli.ts")

interface CapturedRequest {
  path: string
  body: unknown
}

const captured: CapturedRequest[] = []
let server: http.Server
let baseUrl: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      captured.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : undefined })
      res.setHeader("content-type", "application/json")
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
    const { stdout, stderr } = await run(TSX, [CLI, ...args], {
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
    })
  }, 30_000)

  it("ai stock-summary maps --security to securityList", async () => {
    const { code } = await cli(["ai", "stock-summary", "--security", "600519.SH", "--format", "json"])
    expect(code).toBe(0)
    expect(captured[0].path).toBe("/application/open-ai/stock-summary/getList")
    expect(captured[0].body).toEqual({ securityList: ["600519.SH"] })
  }, 30_000)
})
