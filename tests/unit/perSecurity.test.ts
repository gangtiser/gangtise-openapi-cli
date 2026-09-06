import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, isStructuralError } from "../../src/core/errors.js"
import { callPerSecurity, estimateTradingDays } from "../../src/core/perSecurity.js"
import { getRowSink, ExportSink } from "../../src/core/rowSink.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const body = (code: string) => ({ securityCode: code })

describe("callPerSecurity", () => {
  it("issues one request per security and merges rows in input order under one fieldList", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => ({
      total: 2, fieldList: ["securityCode", "close"], list: [[b.securityCode, 1], [b.securityCode, 2]],
    }))
    const result = await callPerSecurity({ call }, "quote.minute-kline", ["600519.SH", "000858.SZ", "300750.SZ"], body, 6000, "quote minute-kline")
    expect(call).toHaveBeenCalledTimes(3)
    expect(call.mock.calls.map((c) => (c[1] as { securityCode: string }).securityCode)).toEqual(["600519.SH", "000858.SZ", "300750.SZ"])
    expect(result.fieldList).toEqual(["securityCode", "close"])
    expect(result.total).toBe(6)
    expect((result.list as unknown[][]).map((r) => r[0])).toEqual(["600519.SH", "600519.SH", "000858.SZ", "000858.SZ", "300750.SZ", "300750.SZ"])
    expect(result.partial).toBeUndefined()
  })

  it("marks the merge partial and names the securities that filled their row cap", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => ({
      fieldList: ["close"], list: b.securityCode === "000858.SZ" ? [[1], [2], [3]] : [[1]],
    }))
    const result = await callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 3, "quote day-kline")
    expect(result.partial).toBe(true)
    expect(result.truncatedSecurities).toEqual(["000858.SZ"])
    expect(result.total).toBe(4)
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("000858.SZ")
    errSpy.mockRestore()
  })

  it("refuses to merge parts whose column layout differs, as a structural error", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => (
      b.securityCode === "000858.SZ" ? { fieldList: ["volume", "close"], list: [[200, 20]] } : { fieldList: ["close", "volume"], list: [[10, 100]] }
    ))
    let caught: unknown
    try {
      await callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 6000, "quote day-kline")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).message).toContain("cannot be merged")
    expect(isStructuralError(caught)).toBe(true)
  })

  it("propagates a failed part instead of returning a merge with that security silently missing", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => {
      if (b.securityCode === "BAD.XX") throw new ApiError("非有效A股", "120001")
      return { fieldList: ["close"], list: [[1]] }
    })
    await expect(callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "BAD.XX"], body, 6000, "quote day-kline")).rejects.toThrow("非有效A股")
  })

  it("rejects a part without a list payload", async () => {
    const call = vi.fn().mockResolvedValue(null)
    await expect(callPerSecurity({ call }, "quote.day-kline", ["600519.SH"], body, 6000, "quote day-kline")).rejects.toThrow("no list payload")
  })

  it("skips an empty part in either position without comparing its (empty) fieldList", async () => {
    const empty = { total: 0, fieldList: [], list: [] }
    const data = { total: 1, fieldList: ["securityCode", "close"], list: [["000858.SZ", 1]] }
    for (const order of [["EMPTY.SH", "000858.SZ"], ["000858.SZ", "EMPTY.SH"]]) {
      const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => (b.securityCode === "EMPTY.SH" ? empty : data))
      const result = await callPerSecurity({ call }, "quote.day-kline", order, body, 6000, "quote day-kline")
      expect(result.fieldList).toEqual(["securityCode", "close"])
      expect(result.total).toBe(1)
      expect(result.partial).toBeUndefined()
    }
  })

  it("rejects an empty part that claims rows (total > 0 or partial) in either position, as a structural error", async () => {
    const data = { total: 1, fieldList: ["securityCode", "close"], list: [["000858.SZ", 1]] }
    for (const claim of [{ total: 1, fieldList: [], list: [] }, { total: 0, partial: true, fieldList: ["close"], list: [] }]) {
      for (const order of [["600519.SH", "000858.SZ"], ["000858.SZ", "600519.SH"]]) {
        const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => (b.securityCode === "600519.SH" ? claim : data))
        let caught: unknown
        try {
          await callPerSecurity({ call }, "quote.day-kline", order, body, 6000, "quote day-kline")
        } catch (error) {
          caught = error
        }
        expect((caught as ApiError).message).toContain("600519.SH")
        expect((caught as ApiError).message).toContain("delivered no rows")
        expect(isStructuralError(caught)).toBe(true)
      }
    }
    // Every part contradictory → still an error, never an empty success.
    const call = vi.fn().mockResolvedValue({ total: 3, fieldList: [], list: [] })
    await expect(callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 6000, "quote day-kline")).rejects.toThrow("delivered no rows")
  })

  it("keeps an empty part's fieldList as the header only when no part had rows", async () => {
    const call = vi.fn().mockResolvedValue({ total: 0, fieldList: ["close"], list: [] })
    const result = await callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 6000, "quote day-kline")
    expect(result).toEqual({ total: 0, list: [], fieldList: ["close"] })
  })

  it("rejects a columnar part that lacks its own fieldList, whichever position it is in", async () => {
    const named = { fieldList: ["close", "volume"], list: [[10, 100]] }
    const unnamed = { list: [[100, 10]] }
    for (const order of [["NAMED.SH", "UNNAMED.SZ"], ["UNNAMED.SZ", "NAMED.SH"]]) {
      const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => (b.securityCode === "NAMED.SH" ? named : unnamed))
      let caught: unknown
      try {
        await callPerSecurity({ call }, "quote.day-kline", order, body, 6000, "quote day-kline")
      } catch (error) {
        caught = error
      }
      expect((caught as ApiError).message).toContain("UNNAMED.SZ returned columnar rows without a usable fieldList")
      expect(isStructuralError(caught)).toBe(true)
    }
  })

  it("keeps a part's own partial marker on the merged result", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => (
      b.securityCode === "600519.SH" ? { fieldList: ["close"], list: [[1]], partial: true } : { fieldList: ["close"], list: [[2]] }
    ))
    const result = await callPerSecurity({ call }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 6000, "quote day-kline")
    expect(result.partial).toBe(true)
    expect(result.truncatedSecurities).toBeUndefined()
  })
})

describe("estimateTradingDays", () => {
  it("counts weekdays exactly (an upper bound on trading days) and falls back to a year without a range", () => {
    expect(estimateTradingDays("2026-01-01", "2026-12-31")).toBe(261)
    expect(estimateTradingDays("2026-08-10", "2026-08-14")).toBe(5) // Mon–Fri
    expect(estimateTradingDays("2026-08-08", "2026-08-09")).toBe(0) // Sat–Sun
    expect(estimateTradingDays(undefined, "2026-08-14")).toBe(262)
    expect(estimateTradingDays("2026-08-14", "2026-08-10")).toBe(262)
  })

  it("counts a start-only range up to today, since the server fills the end with the latest day", () => {
    const start = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
    const days = estimateTradingDays(start, undefined)
    expect(days).toBeGreaterThanOrEqual(285) // ≈ 400 × 5/7, never the one-year fallback
    expect(days).toBeLessThanOrEqual(288)
  })

  it("batches two securities over a Mon–Fri week when the limit only fits 9 rows", () => {
    // 2 × 5 = 10 > 9: the calendar-scaled estimate (4 days) said one request would do,
    // and that request came back capped at 9 rows.
    expect(2 * estimateTradingDays("2026-08-10", "2026-08-14") > 9).toBe(true)
  })
})

describe("callPerSecurity with a row sink (large jsonl export)", () => {
  const dir = path.join(os.tmpdir(), `gangtise-persec-sink-${process.pid}`)
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it("streams parts in input order under the shared header and leaves the result's list empty", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, b: { securityCode: string }) => {
      if (b.securityCode === "600519.SH") await new Promise((r) => setTimeout(r, 20))
      return { total: 600, fieldList: ["securityCode", "close"], list: Array.from({ length: 600 }, (_, i) => [b.securityCode, i]) }
    })
    const sink = new ExportSink(path.join(dir, "parts.jsonl"))
    const result = await callPerSecurity({ call, claimRowSink: () => sink }, "quote.day-kline", ["600519.SH", "000858.SZ"], body, 6000, "quote day-kline")
    expect(result.total).toBe(1200)
    expect(result.list).toEqual([])
    expect(result.fieldList).toEqual(["securityCode", "close"])
    expect(getRowSink(result)).toBe(sink)
    await sink.finish()
    const lines = (await fs.readFile(path.join(dir, "parts.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { securityCode: string; close: number })
    expect(lines).toHaveLength(1200)
    expect(lines[0]).toEqual({ securityCode: "600519.SH", close: 0 })
    expect(lines[600]).toEqual({ securityCode: "000858.SZ", close: 0 })
  })
})
