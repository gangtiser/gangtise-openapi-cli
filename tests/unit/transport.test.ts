import { gzipSync } from "node:zlib"

import { describe, expect, it, vi } from "vitest"

import { ApiError } from "../../src/core/errors.js"
import { decodeResponseBody, markRetryable, parseRetryAfterMs, resolvePageConcurrency, runWithConcurrency, withRetry } from "../../src/core/transport.js"

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

  it("honors an error's retryAfterMs instead of the computed backoff", async () => {
    vi.useFakeTimers()
    try {
      // 1500ms > the 5ms maxDelay cap: proves Retry-After overrides normal backoff.
      const err = Object.assign(new ApiError("rate limited", "429000", 429), { retryAfterMs: 1500 })
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok")
      let seenDelay = -1
      const p = withRetry(fn, { retries: 1, baseDelayMs: 1, maxDelayMs: 5, onRetry: (_a, _e, d) => { seenDelay = d } })
      await vi.runAllTimersAsync()
      expect(await p).toBe("ok")
      expect(seenDelay).toBe(1500)
    } finally {
      vi.useRealTimers()
    }
  })

  it("caps a hostile retryAfterMs at a 60s ceiling so the CLI can't be hung", async () => {
    vi.useFakeTimers()
    try {
      const err = Object.assign(new ApiError("rate limited", "429000", 429), { retryAfterMs: 10 * 60_000 })
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok")
      let seenDelay = -1
      const p = withRetry(fn, { retries: 1, baseDelayMs: 1, onRetry: (_a, _e, d) => { seenDelay = d } })
      await vi.runAllTimersAsync()
      await p
      expect(seenDelay).toBe(60_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries connect-phase ECONNREFUSED under the default policy", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), { code: "ECONNREFUSED" }))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 2, baseDelayMs: 1 })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

// Billing probed 2026-07-11: per-call charging with NO cache-hit exemption, so a
// replay of a request the server may already have executed double-bills. Under
// "no-replay" only errors proving the request never reached the server (connect
// phase), 429 (rejected before processing), and the explicit token-self-heal
// mark may retry.
describe("withRetry no-replay policy (per-call billed endpoints)", () => {
  it("does not retry a 5xx (server may have executed and billed)", async () => {
    const err = new ApiError("server error", undefined, 503)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("does not retry a response timeout (request already sent)", async () => {
    const err = Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("does not retry the generic 999999 system code", async () => {
    const err = new ApiError("系统内部错误", "999999", 500)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("still retries connect-phase and DNS failures (request never left the machine)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
      .mockRejectedValueOnce(Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" }))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1, policy: "no-replay" })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("still retries a 429 (rate-limited before processing, not billed)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError("rate limited", undefined, 429))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("still honors the explicit retryable mark (token self-heal replay is safe)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(markRetryable(new ApiError("token invalid", "8000014", 200)))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe("resolvePageConcurrency", () => {
  it("returns the default for unset/invalid/non-positive values", () => {
    expect(resolvePageConcurrency(undefined)).toBe(5)
    expect(resolvePageConcurrency("abc")).toBe(5)
    expect(resolvePageConcurrency("0")).toBe(5)
    expect(resolvePageConcurrency("-3")).toBe(5) // negative used to degrade to a single serial worker
  })

  it("accepts sane values and caps runaway ones", () => {
    expect(resolvePageConcurrency("10")).toBe(10)
    expect(resolvePageConcurrency("2.9")).toBe(2) // integers only
    expect(resolvePageConcurrency("1000000")).toBe(32) // don't spawn a million workers / 429-storm the server
  })
})

// EDE uses 999999 + HTTP 500 for "no data for this query" (probed 2026-07-11) —
// retrying it is pure waste. "no-999999" keeps everything else from the default
// policy (5xx, network, 429, self-heal) and only drops the 999999 API code.
describe("withRetry no-999999 policy (EDE indicator endpoints)", () => {
  it("does not retry the 999999 API code", async () => {
    const err = new ApiError("系统内部错误", "999999", 500)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-999999" })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("still retries a plain 5xx without the 999999 code", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError("bad gateway", undefined, 502))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 2, baseDelayMs: 1, policy: "no-999999" })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

// 140002 PROCESSING_FAILED (2026-07-17 renumbering) is a terminal verdict shipped
// on HTTP 500 — the status rule alone would retry it under every policy.
describe("withRetry terminal API codes", () => {
  it("does not retry 140002 even on a retryable HTTP 500", async () => {
    // The async *-check endpoints have no retry policy, and asyncContent's FAILED_CODES
    // sits above client.call's withRetry — so without this guard a terminal 140002@500
    // would be white-retried 2× before being recognized as failed.
    const err = new ApiError("业务处理失败", "140002", 500)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("does not retry 999011 CREDENTIAL_INVALID, whatever status it rides in on", async () => {
    // Bad AK/SK only ever comes back from auth.login, which runs useAuth=false and so
    // never reaches AUTH_RETRY_CODES — leaving 999011 out of that set guarantees
    // nothing. auth.login also declares no retry policy, so on a 5xx the status rule
    // alone would replay a credential error that cannot fix itself.
    const err = new ApiError("开发账号凭证无效（ak/sk 匹配失败）", "999011", 500)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("still retries a plain 500 that carries no terminal code", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError("系统内部错误", "999999", 500))
      .mockResolvedValue("ok")
    expect(await withRetry(fn, { retries: 2, baseDelayMs: 1 })).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("retries 999006@500 under the default policy but not under no-replay (matches the hint)", async () => {
    // 999006 is a rate limit; on a 5xx it follows the HTTP-status rule, so default
    // policy retries and no-replay (billed endpoints) opts out. The hint promises
    // exactly this — lock both so the two can't drift apart again.
    const ok = vi.fn().mockRejectedValueOnce(new ApiError("限流", "999006", 500)).mockResolvedValue("ok")
    expect(await withRetry(ok, { retries: 2, baseDelayMs: 1 })).toBe("ok")
    expect(ok).toHaveBeenCalledTimes(2)

    const err = new ApiError("限流", "999006", 500)
    const billed = vi.fn().mockRejectedValue(err)
    await expect(withRetry(billed, { retries: 2, baseDelayMs: 1, policy: "no-replay" })).rejects.toBe(err)
    expect(billed).toHaveBeenCalledTimes(1)
  })
})

describe("decodeResponseBody", () => {
  it("gunzips a gzip-encoded body back to utf-8", () => {
    const json = JSON.stringify({ hello: "世界", n: 1 })
    expect(decodeResponseBody(gzipSync(Buffer.from(json)), "gzip")).toBe(json)
  })

  it("returns an unencoded body unchanged", () => {
    const json = JSON.stringify({ a: "中文" })
    expect(decodeResponseBody(Buffer.from(json), undefined)).toBe(json)
  })

  it("reads the first value when content-encoding arrives as an array", () => {
    expect(decodeResponseBody(gzipSync(Buffer.from("{}")), ["gzip"])).toBe("{}")
  })
})

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds into ms", () => {
    expect(parseRetryAfterMs("3", 0)).toBe(3000)
  })

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-07-06T00:00:00Z")
    expect(parseRetryAfterMs("Mon, 06 Jul 2026 00:00:05 GMT", now)).toBe(5000)
  })

  it("returns undefined for a missing or unparseable value", () => {
    expect(parseRetryAfterMs(undefined, 0)).toBeUndefined()
    expect(parseRetryAfterMs("soon", 0)).toBeUndefined()
  })
})
