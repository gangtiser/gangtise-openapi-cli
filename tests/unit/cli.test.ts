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
    for (const group of ["auth", "lookup", "insight", "quote", "fundamental", "ai", "reference", "vault", "alternative", "raw"]) {
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
})
