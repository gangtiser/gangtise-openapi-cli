import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

// End-to-end smoke test: runs the real CLI via tsx so command wiring,
// option parsing, and the top-level error handler are exercised exactly as
// shipped. No network is touched — only --help, commander-level validation,
// and argument-validation paths (which throw before any client.call).
const run = promisify(execFile)
const TSX = path.resolve(process.cwd(), "node_modules/.bin/tsx")
const CLI = path.resolve(process.cwd(), "src/cli.ts")

async function cli(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run(TSX, [CLI, ...args], {
      timeout: 25_000,
      // strip credentials so nothing attempts a real login
      env: { ...process.env, GANGTISE_ACCESS_KEY: "", GANGTISE_SECRET_KEY: "", GANGTISE_TOKEN: "" },
    })
    return { code: 0, out: stdout + stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: typeof e.code === "number" ? e.code : 1, out: (e.stdout ?? "") + (e.stderr ?? "") }
  }
}

describe("cli smoke", () => {
  it("prints top-level help listing every command group", async () => {
    const { code, out } = await cli(["--help"])
    expect(code).toBe(0)
    for (const group of ["auth", "lookup", "insight", "quote", "fundamental", "ai", "reference", "vault", "alternative", "indicator", "raw"]) {
      expect(out).toContain(group)
    }
  }, 30_000)

  it("lists quote subcommands", async () => {
    const { code, out } = await cli(["quote", "--help"])
    expect(code).toBe(0)
    for (const sub of ["day-kline", "day-kline-hk", "day-kline-us", "index-day-kline", "minute-kline", "realtime"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("lists fundamental subcommands", async () => {
    const { code, out } = await cli(["fundamental", "--help"])
    expect(code).toBe(0)
    for (const sub of ["income-statement", "balance-sheet", "cash-flow", "valuation-analysis", "top-holders", "earning-forecast", "main-business"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("lists alternative subcommands", async () => {
    const { code, out } = await cli(["alternative", "--help"])
    expect(code).toBe(0)
    for (const sub of ["edb-search", "edb-data", "concept-info", "concept-securities"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("lists reference subcommands", async () => {
    const { code, out } = await cli(["reference", "--help"])
    expect(code).toBe(0)
    for (const sub of ["securities-search", "chiefs-search", "constant-category", "constant-list", "concept-search", "sector-search", "sector-constituents"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("lookup keeps only local-data subcommands", async () => {
    const { code, out } = await cli(["lookup", "--help"])
    expect(code).toBe(0)
    for (const sub of ["broker-org", "meeting-org"]) {
      expect(out).toContain(sub)
    }
    for (const removed of ["research-area", "theme-id", "announcement-category", "industry-code"]) {
      expect(out).not.toContain(removed)
    }
  }, 30_000)

  it("rejects an invalid enum choice at the commander layer", async () => {
    const { code, out } = await cli(["fundamental", "top-holders", "--security-code", "600519.SH", "--holder-type", "WRONG"])
    expect(code).not.toBe(0)
    expect(out).toContain("top10")
  }, 30_000)

  it("reports an argument-validation error with a non-zero exit", async () => {
    const { code, out } = await cli(["quote", "day-kline", "--security", "600519.SH", "--limit", "abc"])
    expect(code).toBe(1)
    expect(out).toContain("--limit")
  }, 30_000)

  it("reports an unknown raw endpoint key", async () => {
    const { code, out } = await cli(["raw", "call", "does.not.exist"])
    expect(code).toBe(1)
    expect(out).toContain("Unknown endpoint key")
  }, 30_000)

  // Each schedule endpoint accepts a different filter subset (per API spec); the
  // CLI must advertise only the supported flags so an unsupported one is rejected
  // up front instead of being sent and silently returning 0.
  it("schedule commands expose only spec-supported filters", async () => {
    const strategy = await cli(["insight", "strategy", "list", "--help"])
    expect(strategy.out).toContain("--institution")
    expect(strategy.out).toContain("--location")
    for (const absent of ["--research-area", "--security", "--category", "--market", "--participant-role", "--broker-type", "--object", "--permission"]) {
      expect(strategy.out).not.toContain(absent)
    }

    const forum = await cli(["insight", "forum", "list", "--help"])
    expect(forum.out).toContain("--research-area")
    expect(forum.out).toContain("--location")
    expect(forum.out).not.toContain("--institution")

    const siteVisit = await cli(["insight", "site-visit", "list", "--help"])
    expect(siteVisit.out).toContain("--object")
    expect(siteVisit.out).not.toContain("--participant-role")
    expect(siteVisit.out).not.toContain("--broker-type")

    const roadshow = await cli(["insight", "roadshow", "list", "--help"])
    expect(roadshow.out).toContain("--participant-role")
    expect(roadshow.out).toContain("--broker-type")
    expect(roadshow.out).not.toContain("--object")
  }, 30_000)

  it("rejects an unsupported schedule filter at the commander layer", async () => {
    const { code, out } = await cli(["insight", "strategy", "list", "--research-area", "122000001"])
    expect(code).not.toBe(0)
    expect(out).toContain("unknown option")
  }, 30_000)

  // A-share announcement only supports --category + --security (per spec); the
  // dropped --announcement-type was silently ignored server-side, so a user who
  // relied on it got the full unfiltered list.
  it("announcement list drops the unsupported --announcement-type", async () => {
    const help = await cli(["insight", "announcement", "list", "--help"])
    expect(help.out).toContain("--category")
    expect(help.out).not.toContain("--announcement-type")
    const { code, out } = await cli(["insight", "announcement", "list", "--announcement-type", "103910200"])
    expect(code).not.toBe(0)
    expect(out).toContain("unknown option")
  }, 30_000)

  it("official-account list exposes the documented filters", async () => {
    const { code, out } = await cli(["insight", "official-account", "list", "--help"])
    expect(code).toBe(0)
    for (const flag of ["--account-id", "--security", "--category", "--industry", "--search-type", "--rank-type", "--keyword", "--start-time", "--end-time", "--from", "--size"]) {
      expect(out).toContain(flag)
    }
  }, 30_000)

  it("official-account download requires --article-id", async () => {
    const { code, out } = await cli(["insight", "official-account", "download"])
    expect(code).not.toBe(0)
    expect(out).toContain("--article-id")
  }, 30_000)

  it("lists indicator subcommands", async () => {
    const { code, out } = await cli(["indicator", "--help"])
    expect(code).toBe(0)
    for (const sub of ["search", "cross-section", "time-series"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("indicator search requires --keyword", async () => {
    const { code, out } = await cli(["indicator", "search"])
    expect(code).not.toBe(0)
    expect(out).toContain("--keyword")
  }, 30_000)

  it("indicator cross-section exposes the documented flags", async () => {
    const { code, out } = await cli(["indicator", "cross-section", "--help"])
    expect(code).toBe(0)
    for (const flag of ["--indicator", "--security", "--date", "--currency", "--scale", "--indicator-param"]) {
      expect(out).toContain(flag)
    }
  }, 30_000)

  it("indicator time-series exposes the documented flags", async () => {
    const { code, out } = await cli(["indicator", "time-series", "--help"])
    expect(code).toBe(0)
    for (const flag of ["--indicator", "--security", "--start-date", "--end-date", "--calendar-type", "--currency", "--scale", "--indicator-param"]) {
      expect(out).toContain(flag)
    }
  }, 30_000)

  it("lists insight announcement subcommands including announcement-us", async () => {
    const { code, out } = await cli(["insight", "--help"])
    expect(code).toBe(0)
    for (const sub of ["announcement", "announcement-hk", "announcement-us", "official-account"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("lists US financial report subcommands", async () => {
    const { code, out } = await cli(["fundamental", "--help"])
    expect(code).toBe(0)
    for (const sub of ["income-statement-us", "balance-sheet-us", "cash-flow-us"]) {
      expect(out).toContain(sub)
    }
  }, 30_000)

  it("exposes ai stock-summary subcommand", async () => {
    const { code, out } = await cli(["ai", "--help"])
    expect(code).toBe(0)
    expect(out).toContain("stock-summary")
  }, 30_000)

  it("ai stock-summary requires --security (guards against accidental all-market spend)", async () => {
    const { code, out } = await cli(["ai", "stock-summary"])
    expect(code).not.toBe(0)
    expect(out).toContain("--security")
  }, 30_000)

  it("ai knowledge-batch requires --query", async () => {
    const { code, out } = await cli(["ai", "knowledge-batch"])
    expect(code).not.toBe(0)
    expect(out).toContain("--query")
  }, 30_000)

  it("auth login exposes --show-token (token redacted by default)", async () => {
    const { code, out } = await cli(["auth", "login", "--help"])
    expect(code).toBe(0)
    expect(out).toContain("--show-token")
  }, 30_000)

  it("HK and US announcement downloads expose --file-type", async () => {
    for (const market of ["announcement-hk", "announcement-us"]) {
      const { code, out } = await cli(["insight", market, "download", "--help"])
      expect(code).toBe(0)
      expect(out, market).toContain("--file-type")
    }
  }, 30_000)
})
