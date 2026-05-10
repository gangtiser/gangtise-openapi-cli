import { describe, expect, it, vi } from "vitest"

import { ApiError } from "../../src/core/errors.js"
import { markRetryable, runWithConcurrency, withRetry } from "../../src/core/transport.js"

describe("runWithConcurrency", () => {
  it("preserves item order in the results", async () => {
    const items = [1, 2, 3, 4, 5]
    const result = await runWithConcurrency(items, 2, async (n) => n * 10)
    expect(result).toEqual([10, 20, 30, 40, 50])
  })

  it("respects the concurrency limit", async () => {
    let inFlight = 0
    let peak = 0
    const work = Array.from({ length: 10 }, (_, i) => i)

    await runWithConcurrency(work, 3, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
    })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it("returns empty array for empty input without invoking the worker", async () => {
    const fn = vi.fn()
    const result = await runWithConcurrency([], 5, fn)
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it("propagates the first error encountered", async () => {
    const fn = vi.fn().mockImplementation(async (item: number) => {
      if (item === 2) throw new Error("boom")
      return item
    })
    await expect(runWithConcurrency([1, 2, 3], 2, fn)).rejects.toThrow("boom")
  })
})

describe("withRetry", () => {
  it("returns the result on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok")
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on retryable HTTP 5xx ApiError up to the limit", async () => {
    const err = new ApiError("server error", undefined, 503)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it("does not retry on a 4xx ApiError that is not marked retryable", async () => {
    const err = new ApiError("bad request", "400000", 400)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries when the error is explicitly marked retryable", async () => {
    let attempt = 0
    const fn = vi.fn().mockImplementation(async () => {
      attempt++
      if (attempt < 2) throw markRetryable(new ApiError("auth recovered", "8000014", 200))
      return "second-time-lucky"
    })
    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 })
    expect(result).toBe("second-time-lucky")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("retries on retryable network errors", async () => {
    let attempt = 0
    const fn = vi.fn().mockImplementation(async () => {
      attempt++
      if (attempt < 2) throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" })
      return "ok"
    })
    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 })
    expect(result).toBe("ok")
  })
})
