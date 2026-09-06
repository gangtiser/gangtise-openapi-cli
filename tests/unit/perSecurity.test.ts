import { describe, expect, it, vi } from "vitest"

import { ApiError, isStructuralError } from "../../src/core/errors.js"
import { callPerSecurity, estimateTradingDays } from "../../src/core/perSecurity.js"

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
})

describe("estimateTradingDays", () => {
  it("scales calendar days to trading days and falls back to a year without a range", () => {
    expect(estimateTradingDays("2026-01-01", "2026-12-31")).toBe(261)
    expect(estimateTradingDays("2026-08-10", "2026-08-14")).toBe(4)
    expect(estimateTradingDays(undefined, "2026-08-14")).toBe(250)
    expect(estimateTradingDays("2026-08-14", "2026-08-10")).toBe(250)
  })
})
