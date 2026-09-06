import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, markStructural } from "../../src/core/errors.js"
import { flagMissingFields } from "../../src/core/normalize.js"
import { callKlineWithSharding } from "../../src/core/quoteSharding.js"
import { getRowSink, ExportSink } from "../../src/core/rowSink.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("callKlineWithSharding", () => {
  it("passes through a single-security request without sharding", async () => {
    const call = vi.fn().mockResolvedValue({ list: [{ id: 1 }] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["600519.SH"],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    }, { shardDays: 2 })

    expect(call).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ list: [{ id: 1 }] })
  })

  it("passes through when --security all but date range fits in one shard", async () => {
    const call = vi.fn().mockResolvedValue({ list: [{ id: 1 }] })
    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-02",
    }, { shardDays: 2 })

    expect(call).toHaveBeenCalledTimes(1)
  })

  it("splits --security all into N shards when range exceeds shardDays", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string; endDate: string }) => ({
      fieldList: ["securityCode", "tradeDate"],
      list: [[`SH-${body.startDate}`, body.startDate], [`SH-${body.endDate}`, body.endDate]],
    }))

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 }) as { fieldList: unknown[]; list: unknown[] }

    expect(call).toHaveBeenCalledTimes(3)
    expect(result.fieldList).toEqual(["securityCode", "tradeDate"])
    expect(result.list).toHaveLength(6) // 3 shards × 2 rows
  })

  it("date-shards a full-market fund-flow query (aShares) and lifts the limit", async () => {
    // fund-flow's whole-market keyword is `aShares`, and its rows are objects (not the
    // columnar arrays kline returns) — the merge must handle both.
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => ({
      total: 2,
      list: [{ securityCode: `A-${body.startDate}` }, { securityCode: `B-${body.startDate}` }],
    }))

    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-06-29",
      endDate: "2026-07-01",
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { list: unknown[] }

    expect(call).toHaveBeenCalledTimes(3) // 3 calendar days, 1 day/shard
    expect(result.list).toHaveLength(6) // 3 shards × 2 rows
    expect((call.mock.calls[0][1] as { limit?: number }).limit).toBe(10_000) // full-market lift
  })

  it("does not shard fund-flow for an explicit security (only the aShares keyword triggers it)", async () => {
    const call = vi.fn().mockResolvedValue({ total: 1, list: [{ securityCode: "600519.SH" }] })
    await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["600519.SH"],
      startDate: "2026-06-01",
      endDate: "2026-12-31",
    }, { shardDays: 1, fullMarketValue: "aShares" })

    expect(call).toHaveBeenCalledTimes(1) // explicit security → passthrough, no sharding
  })

  it("falls back to a single call when dates are unparseable", async () => {
    const call = vi.fn().mockResolvedValue({ list: [] })
    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "not-a-date",
      endDate: "2026-12-31",
    }, { shardDays: 2 })

    expect(call).toHaveBeenCalledTimes(1)
  })

  it("still lifts the limit to API max for --security all when dates are missing", async () => {
    // No dates → no sharding possible, but the single full-market request must
    // not stay on the 6000-row default (it would silently truncate the result).
    const call = vi.fn().mockResolvedValue({ list: [] })
    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
    }, { shardDays: 1 })

    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0][1]).toMatchObject({ securityList: ["all"], limit: 10_000 })
  })

  it("injects API-max limit (10000) for --security all when user didn't set --limit", async () => {
    const seenBodies: Array<Record<string, unknown>> = []
    const call = vi.fn().mockImplementation(async (_key: string, body: Record<string, unknown>) => {
      seenBodies.push(body)
      return { list: [] }
    })

    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-05",
    }, { shardDays: 1 })

    expect(seenBodies.length).toBeGreaterThan(0)
    for (const b of seenBodies) {
      expect(b.limit, "all-market sharded body should default limit to 10000").toBe(10_000)
    }
  })

  it("preserves a user-supplied --limit instead of overriding it", async () => {
    const seenBodies: Array<Record<string, unknown>> = []
    const call = vi.fn().mockImplementation(async (_key: string, body: Record<string, unknown>) => {
      seenBodies.push(body)
      return { list: [] }
    })

    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-05",
      limit: 500,
    }, { shardDays: 1 })

    for (const b of seenBodies) {
      expect(b.limit).toBe(500)
    }
  })

  it("reports WHICH shards were truncated so consumers can re-pull narrower windows", async () => {
    // The stderr count alone doesn't tell a script/agent which date windows to
    // re-fetch; truncatedShards mirrors failedShards with concrete ranges.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: Record<string, unknown>) => {
      // 06-29 shard maxes out the limit (truncated); 06-30 stays under.
      return body.startDate === "2026-06-29"
        ? { total: 2, list: [{ x: 1 }, { x: 2 }] }
        : { total: 1, list: [{ x: 3 }] }
    })
    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-06-29",
      endDate: "2026-06-30",
      limit: 2,
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { partial?: boolean; truncatedShards?: unknown }

    expect(result.partial).toBe(true)
    expect(result.truncatedShards).toEqual([{ startDate: "2026-06-29", endDate: "2026-06-29" }])
    errSpy.mockRestore()
  })

  it("flags partial when a shard comes back exactly full (low --limit silently truncates each shard)", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    // --limit 2 caps every daily shard at 2 rows though each day has far more → truncation.
    const call = vi.fn().mockResolvedValue({ total: 2, list: [{ x: 1 }, { x: 2 }] })
    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-06-29",
      endDate: "2026-07-01",
      limit: 2,
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { partial?: boolean }

    expect(result.partial).toBe(true)
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("truncated")
    errSpy.mockRestore()
  })

  it("reports the merged row count as total, not the first shard's per-day total", async () => {
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => ({
      total: 2, // each shard reports only its own day's count
      list: [{ d: body.startDate, n: 1 }, { d: body.startDate, n: 2 }],
    }))
    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-06-29",
      endDate: "2026-07-01",
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { total: number; list: unknown[] }

    expect(result.list).toHaveLength(6) // 3 shards × 2 rows
    expect(result.total).toBe(6) // merged count, NOT the first shard's 2
  })

  it("flags partial when a SINGLE-request full-market response is truncated (range fits one shard)", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    // 1-day range with shardDays 1 → totalDays <= shardDays → single passthrough request,
    // NOT the merge loop. --limit 2 caps it though the day has more → must still be partial.
    const call = vi.fn().mockResolvedValue({ total: 2, list: [{ x: 1 }, { x: 2 }] })
    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      limit: 2,
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { partial?: boolean }

    expect(call).toHaveBeenCalledTimes(1) // single request, not sharded
    expect(result.partial).toBe(true)
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("truncated")
    errSpy.mockRestore()
  })

  it("emits non-overlapping shards covering the whole range", async () => {
    const seenRanges: Array<{ startDate: string; endDate: string }> = []
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string; endDate: string }) => {
      seenRanges.push({ startDate: body.startDate, endDate: body.endDate })
      return { list: [] }
    })

    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-10",
    }, { shardDays: 3 })

    seenRanges.sort((a, b) => a.startDate.localeCompare(b.startDate))
    expect(seenRanges[0].startDate).toBe("2026-04-01")
    expect(seenRanges.at(-1)!.endDate).toBe("2026-04-10")
    // Every adjacent pair should be exactly 1 day apart with no gaps or overlap
    for (let i = 1; i < seenRanges.length; i++) {
      const prevEnd = new Date(`${seenRanges[i - 1].endDate}T00:00:00Z`).getTime()
      const currStart = new Date(`${seenRanges[i].startDate}T00:00:00Z`).getTime()
      expect(currStart - prevEnd).toBe(86_400_000)
    }
  })

  it("tolerates a failed shard: returns surviving data with partial/failedShards markers", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    // shards (shardDays 2): [04-01..04-02], [04-03..04-04], [04-05..04-06]; fail the middle one
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string; endDate: string }) => {
      if (body.startDate === "2026-04-03") throw new Error("shard boom")
      return { fieldList: ["securityCode", "tradeDate"], list: [[`SH-${body.startDate}`, body.startDate]] }
    })

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 }) as { list: unknown[]; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }

    expect(call).toHaveBeenCalledTimes(3)
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([{ startDate: "2026-04-03", endDate: "2026-04-04" }])
    expect(result.list).toHaveLength(2) // 2 surviving shards × 1 row each
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("partial")
    errSpy.mockRestore()
  })

  it("throws when every shard fails instead of returning a silent empty success", async () => {
    const call = vi.fn().mockRejectedValue(new Error("all down"))
    await expect(callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 })).rejects.toThrow("all down")
  })

  it("treats a shard that resolves without a list as failed, not a silent empty shard", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    // Middle shard returns a shape-broken response (an error object, no `list`) instead
    // of throwing. Its rows are missing, so it must be flagged failed/partial — not
    // merged as if it were a valid shard that happened to have no rows.
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-03") return { oops: true }
      return { fieldList: ["securityCode", "tradeDate"], list: [[`SH-${body.startDate}`, body.startDate]] }
    })

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 }) as { list: unknown[]; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }

    expect(call).toHaveBeenCalledTimes(3) // a shape-broken shard does NOT abort the rest
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([{ startDate: "2026-04-03", endDate: "2026-04-04" }])
    expect(result.list).toHaveLength(2) // 2 surviving shards × 1 row each
    errSpy.mockRestore()
  })

  it("stops dispatching remaining shards after a hard error, keeping earlier survivors", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    // Serial (concurrency 1): shard 1 succeeds, shard 2 hits a rate limit and throws,
    // shard 3 must be skipped — not dispatched into the same rate limit — while shard 1's
    // rows survive.
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-03") throw new Error("903301 rate limited")
      return { fieldList: ["securityCode"], list: [[`SH-${body.startDate}`]] }
    })

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2, concurrency: 1 }) as { list: unknown[]; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }

    expect(call).toHaveBeenCalledTimes(2) // the 04-05 shard is never dispatched
    expect(result.partial).toBe(true)
    expect(result.failedShards).toHaveLength(2) // the thrown shard + the skipped one
    expect(result.list).toHaveLength(1) // only the first shard survived
    errSpy.mockRestore()
  })

  it("skips weekend shards for per-day (fund-flow) sharding", async () => {
    // 2026-07-03 Fri, 07-04 Sat, 07-05 Sun, 07-06 Mon → only Fri + Mon are fetched
    // (weekends are always empty: A/HK/US markets are closed).
    const seen: string[] = []
    const call = vi.fn().mockImplementation(async (_k: string, body: { startDate: string }) => {
      seen.push(body.startDate)
      return { total: 1, list: [{ x: 1 }] }
    })
    await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-07-03",
      endDate: "2026-07-06",
    }, { shardDays: 1, fullMarketValue: "aShares" })

    expect(seen.sort()).toEqual(["2026-07-03", "2026-07-06"])
  })

  it("does not skip weekends for multi-day shards (e.g. day-kline-hk, shardDays 2)", async () => {
    const seen: string[] = []
    const call = vi.fn().mockImplementation(async (_k: string, body: { startDate: string }) => {
      seen.push(body.startDate)
      return { list: [] }
    })
    // shards [07-03..07-04],[07-05..07-06],[07-07..07-08]: the middle one starts on a
    // Sunday but contains Monday 07-06 — dropping it would lose a trading day.
    await callKlineWithSharding({ call }, "quote.day-kline-hk", {
      securityList: ["all"],
      startDate: "2026-07-03",
      endDate: "2026-07-08",
    }, { shardDays: 2 })

    expect(seen).toHaveLength(3)
  })

  it("skips weekends for ANY per-day sharding, not just fund-flow — day-kline/day-kline-us are shardDays 1", async () => {
    const seen: string[] = []
    const call = vi.fn().mockImplementation(async (_k: string, body: { startDate: string }) => {
      seen.push(body.startDate)
      return { list: [] }
    })
    // day-kline --security all shards one day at a time (cli.ts), so weekend-skip
    // applies to it too. A-shares are closed weekends, so this is correct, not a bug.
    await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-07-03",
      endDate: "2026-07-06",
    }, { shardDays: 1 })

    expect(seen.sort()).toEqual(["2026-07-03", "2026-07-06"]) // Sat 07-04 / Sun 07-05 skipped
  })

  it("returns an empty result without throwing when a per-day range is entirely weekend", async () => {
    // 2026-07-04 Sat, 07-05 Sun → both shards filtered out → nothing to fetch. Must
    // NOT fall into the "all shards failed" path (0 === 0) and throw.
    const call = vi.fn().mockResolvedValue({ total: 1, list: [{ x: 1 }] })
    const result = await callKlineWithSharding({ call }, "quote.fund-flow", {
      securityList: ["aShares"],
      startDate: "2026-07-04",
      endDate: "2026-07-05",
    }, { shardDays: 1, fullMarketValue: "aShares" }) as { list: unknown[] }

    expect(call).not.toHaveBeenCalled()
    expect(result.list).toEqual([])
  })
})

describe("callKlineWithSharding column alignment", () => {
  it("re-maps a shard whose fieldList is ordered differently onto the first shard's columns", async () => {
    // Merged rows are zipped against ONE fieldList (the first shard's). A shard that
    // orders its columns differently used to be concatenated raw, so close landed
    // under volume and volume under close — silently, with no partial marker.
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-03") return { fieldList: ["volume", "close"], list: [[200, 20]] }
      return { fieldList: ["close", "volume"], list: [[10, 100]] }
    })

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 }) as { fieldList: unknown[]; list: unknown[][]; partial?: boolean }

    expect(result.fieldList).toEqual(["close", "volume"])
    expect(result.list).toEqual([[10, 100], [20, 200], [10, 100]])
    expect(result.partial).toBeUndefined()
  })

  it("drops a shard missing a header column as failed rather than merging it under the wrong names", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-03") return { fieldList: ["close"], list: [[20]] }
      return { fieldList: ["close", "volume"], list: [[10, 100]] }
    })

    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"],
      startDate: "2026-04-01",
      endDate: "2026-04-06",
    }, { shardDays: 2 }) as { list: unknown[][]; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }

    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([{ startDate: "2026-04-03", endDate: "2026-04-04" }])
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("cannot be aligned")
    errSpy.mockRestore()
  })
})

describe("callKlineWithSharding shard schema validation", () => {
  // Three 2-day shards over 04-01..04-06; the middle one (04-03) is the odd one out.
  const range = { securityList: ["all"], startDate: "2026-04-01", endDate: "2026-04-06" }
  const good = { fieldList: ["close", "volume"], list: [[10, 100]] }
  type Merged = { fieldList?: unknown[]; list: unknown[]; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }
  const middle = { startDate: "2026-04-03", endDate: "2026-04-04" }
  const withMiddle = (odd: unknown) => vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => (body.startDate === "2026-04-03" ? odd : good))

  it("drops a shard whose array rows are narrower than its own fieldList instead of padding them", async () => {
    // Re-mapping used to force every row to the header width, so a short row was padded
    // with undefined and sailed past zipFieldRow's width guard — the guard the
    // single-request path still has.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await callKlineWithSharding({ call: withMiddle({ fieldList: ["volume", "close"], list: [[200]] }) }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([middle])
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("do not match its own fieldList")
    errSpy.mockRestore()
  })

  it("drops a shard whose array rows are wider than its own fieldList instead of truncating them", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await callKlineWithSharding({ call: withMiddle({ fieldList: ["volume", "close"], list: [[200, 20, 999]] }) }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.failedShards).toEqual([middle])
    errSpy.mockRestore()
  })

  it("drops a shard whose fieldList repeats a column name rather than picking one of the two", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await callKlineWithSharding({ call: withMiddle({ fieldList: ["volume", "close", "close"], list: [[200, 20, 999]] }) }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.failedShards).toEqual([middle])
    errSpy.mockRestore()
  })

  it("drops a shard with array rows but no fieldList rather than reading them under the header", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await callKlineWithSharding({ call: withMiddle({ list: [[200, 20]] }) }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.failedShards).toEqual([middle])
    errSpy.mockRestore()
  })

  it("lets an empty first shard neither define the header nor blank the rows that follow", async () => {
    // A holiday window answers `{total: 0, fieldList: [], list: []}`; as the first shard
    // it used to become the merged header, and every later row was re-mapped onto [].
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => (body.startDate === "2026-04-01" ? { total: 0, fieldList: [], list: [] } : good))
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.fieldList).toEqual(["close", "volume"])
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBeUndefined()
    expect(result.failedShards).toBeUndefined()
  })

  it("does not count an empty later shard as failed for lacking columns", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await callKlineWithSharding({ call: withMiddle({ total: 0, fieldList: [], list: [] }) }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBeUndefined()
    expect(result.failedShards).toBeUndefined()
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe("callKlineWithSharding header provenance and empty-shard contradictions", () => {
  const range = { securityList: ["all"], startDate: "2026-04-01", endDate: "2026-04-06" }
  type Merged = { fieldList?: unknown[]; list: unknown[]; total?: number; partial?: boolean; failedShards?: Array<{ startDate: string; endDate: string }> }
  const middle = { startDate: "2026-04-03", endDate: "2026-04-04" }
  const byStart = (map: Record<string, unknown>, fallback: unknown) => vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => map[body.startDate] ?? fallback)

  it("never lets an object-row shard's unvalidated fieldList become the header for later array rows", async () => {
    // First shard: object rows plus a malformed fieldList that constrains nothing of its
    // own. Second shard: well-formed array rows. The header must come from the second.
    const call = byStart({ "2026-04-01": { fieldList: ["close", "close"], list: [{ close: 10, volume: 100 }] } }, { fieldList: ["close", "volume"], list: [[20, 200]] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.fieldList).toEqual(["close", "volume"])
    expect(result.list).toEqual([{ close: 10, volume: 100 }, [20, 200], [20, 200]])
    expect(result.partial).toBeUndefined()
  })

  it("treats an empty shard that claims total > 0 as failed instead of a holiday", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = byStart({ "2026-04-03": { total: 1, fieldList: [], list: [] } }, { fieldList: ["close", "volume"], list: [[10, 100]] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([middle])
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("reported total=1 but delivered no rows")
    errSpy.mockRestore()
  })

  it("keeps an empty shard with total 0 (or no total) as a plain holiday", async () => {
    const call = byStart({ "2026-04-03": { total: 0, fieldList: [], list: [] }, "2026-04-05": { list: [] } }, { fieldList: ["close", "volume"], list: [[10, 100]] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100]])
    expect(result.partial).toBeUndefined()
  })

  it("derives the object-row result's fieldList from the rows' keys, not from an empty first shard", async () => {
    // Object rows carry their own keys; a stray `fieldList: []` from the empty first shard
    // would make flagMissingFields report every requested column as missing — and no
    // fieldList at all would make it report nothing, even for a column that is missing.
    const call = byStart({ "2026-04-01": { total: 0, fieldList: [], list: [] } }, { list: [{ close: 20, volume: 200 }] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([{ close: 20, volume: 200 }, { close: 20, volume: 200 }])
    expect(result.fieldList).toEqual(["close", "volume"])
    expect(result.total).toBe(2)
  })

  it("keeps the missing-column signal on an object-row merge whose shards carried a valid fieldList", async () => {
    // Two ordinary object-row shards, each with `fieldList: ["close"]`; the caller asked
    // for close AND bogus. The merged result must still let flagMissingFields see that
    // only close came back.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = byStart({}, { total: 1, fieldList: ["close"], list: [{ close: 10 }] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged & { missingFields?: string[] }
    expect(result.fieldList).toEqual(["close"])
    flagMissingFields(result, ["close", "bogus"], "quote day-kline")
    expect(result.partial).toBe(true)
    expect(result.missingFields).toEqual(["bogus"])
    errSpy.mockRestore()
  })

  it("on an all-empty result keeps the server's explicit column set (even empty) and drops only absent metadata", async () => {
    const full = byStart({}, { total: 0, fieldList: ["close", "volume"], list: [] })
    const kept = await callKlineWithSharding({ call: full }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(kept.fieldList).toEqual(["close", "volume"])
    expect(kept.list).toEqual([])
    // An explicit empty column set is still an answer: a requested column did not come back.
    const bare = byStart({}, { total: 0, fieldList: [], list: [] })
    const explicitEmpty = await callKlineWithSharding({ call: bare }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(explicitEmpty.fieldList).toEqual([])
    const none = byStart({}, { total: 0, list: [] })
    const noMeta = await callKlineWithSharding({ call: none }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(noMeta.fieldList).toBeUndefined()
    expect(noMeta.list).toEqual([])
  })

  it("never takes an all-empty result's fieldList from a shard already judged failed", async () => {
    // Failed first shard (claims a row, delivers none, fieldList []) + a legitimate empty
    // second shard that names its columns. The columns the server returned are the
    // survivor's; the failure stays a failedShards entry, not a "close is missing" verdict.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    for (const bad of [
      { total: 1, fieldList: [], list: [] },
      { total: 0, fieldList: [], list: [], partial: true },
      { total: 1, fieldList: [], list: [[10]] },
    ]) {
      const call = byStart({ "2026-04-01": bad }, { total: 0, fieldList: ["close"], list: [] })
      const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged & { missingFields?: string[] }
      expect(result.fieldList, JSON.stringify(bad)).toEqual(["close"])
      expect(result.failedShards, JSON.stringify(bad)).toEqual([{ startDate: "2026-04-01", endDate: "2026-04-02" }])
      flagMissingFields(result, ["close"], "quote day-kline")
      expect(result.missingFields, JSON.stringify(bad)).toBeUndefined()
      expect(result.partial).toBe(true)
    }
    // Same with the failed shard LAST: order must not change the verdict.
    const call = byStart({ "2026-04-05": { total: 1, fieldList: [], list: [] } }, { total: 0, fieldList: ["close"], list: [] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.fieldList).toEqual(["close"])
    expect(result.failedShards).toEqual([{ startDate: "2026-04-05", endDate: "2026-04-06" }])
    errSpy.mockRestore()
  })

  it("carries no fieldList when the only survivors are failed shards plus one with no metadata", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = byStart({ "2026-04-01": { total: 1, fieldList: [], list: [] } }, { total: 0, list: [] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.fieldList).toBeUndefined()
    expect(result.partial).toBe(true)
    expect(result.list).toEqual([])
    errSpy.mockRestore()
  })

  it("unions object-row keys across ALL rows, whichever row a column first appears in", async () => {
    // volume only exists on the later shard's rows: the union must still contain it, in
    // either order, so flagMissingFields does not report a column that did come back.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    for (const [first, later] of [[{ close: 10 }, { close: 20, volume: 200 }], [{ close: 20, volume: 200 }, { close: 10 }]]) {
      const call = byStart({ "2026-04-01": { fieldList: Object.keys(first), list: [first] } }, { fieldList: Object.keys(later), list: [later] })
      const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged & { missingFields?: string[] }
      expect(result.fieldList?.slice().sort()).toEqual(["close", "volume"])
      flagMissingFields(result, ["close", "volume", "bogus"], "quote day-kline")
      expect(result.missingFields).toEqual(["bogus"])
    }
    errSpy.mockRestore()
  })

  it("treats an empty shard carrying an explicit partial marker as failed even with total 0", async () => {
    // total=0 on purpose: the positive-total branch must not be what catches this one.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = byStart({ "2026-04-03": { total: 0, fieldList: [], list: [], partial: true } }, { fieldList: ["close", "volume"], list: [[10, 100]] })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2 }) as Merged
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([middle])
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("carried a partial marker but delivered no rows")
    errSpy.mockRestore()
  })

  it("keeps dispatching the remaining shards when one shard fails structurally (data: null)", async () => {
    // The client rejects a null payload for `expects: "list"` endpoints with a structural
    // ApiError. That is one bad response, not a rate limit: the other shards must still go
    // out, and the result is partial with that shard in failedShards.
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-01") throw markStructural(new ApiError("quote.day-kline returned no list payload (got null)"))
      return { fieldList: ["close", "volume"], list: [[10, 100]] }
    })
    const result = await callKlineWithSharding({ call }, "quote.day-kline", range, { shardDays: 2, concurrency: 1 }) as Merged
    expect(call).toHaveBeenCalledTimes(3)
    expect(result.list).toEqual([[10, 100], [10, 100]])
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([{ startDate: "2026-04-01", endDate: "2026-04-02" }])
    errSpy.mockRestore()
  })
})

describe("callKlineWithSharding with a row sink (large jsonl export)", () => {
  const dir = path.join(os.tmpdir(), `gangtise-shard-sink-${process.pid}`)
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it("streams shards in date order under the first shard's header, re-mapping a reordered shard, with an empty list on the result", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      // The middle day is slow and answers its columns in the other order.
      const reversed = body.startDate === "2026-04-07"
      if (reversed) await new Promise((r) => setTimeout(r, 30))
      const rows = Array.from({ length: 400 }, (_, i) => reversed ? [i, body.startDate, `S${i}`] : [`S${i}`, body.startDate, i])
      return { total: 400, fieldList: reversed ? ["close", "tradeDate", "securityCode"] : ["securityCode", "tradeDate", "close"], list: rows }
    })
    const sink = new ExportSink(path.join(dir, "kline.jsonl"))
    const result = await callKlineWithSharding({ call, claimRowSink: () => sink }, "quote.day-kline", {
      securityList: ["all"], startDate: "2026-04-06", endDate: "2026-04-08",
    }, { shardDays: 1 }) as { total: number; list: unknown[]; fieldList: string[]; partial?: boolean }
    errSpy.mockRestore()
    expect(result.total).toBe(1200)
    expect(result.list).toEqual([])
    expect(result.fieldList).toEqual(["securityCode", "tradeDate", "close"])
    expect(result.partial).toBeUndefined()
    expect(getRowSink(result)).toBe(sink)
    await sink.finish()
    const lines = (await fs.readFile(path.join(dir, "kline.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines).toHaveLength(1200)
    expect(lines[0]).toEqual({ securityCode: "S0", tradeDate: "2026-04-06", close: 0 })
    expect(lines[400]).toEqual({ securityCode: "S0", tradeDate: "2026-04-07", close: 0 })
    expect(lines[1199]).toEqual({ securityCode: "S399", tradeDate: "2026-04-08", close: 399 })
  })

  it("keeps failedShards / partial while streaming and writes only the surviving shards", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => {
      if (body.startDate === "2026-04-07") throw markStructural(new ApiError("bad shape"))
      return { total: 600, fieldList: ["securityCode", "tradeDate"], list: Array.from({ length: 600 }, (_, i) => [`S${i}`, body.startDate]) }
    })
    const sink = new ExportSink(path.join(dir, "partial.jsonl"))
    const result = await callKlineWithSharding({ call, claimRowSink: () => sink }, "quote.day-kline", {
      securityList: ["all"], startDate: "2026-04-06", endDate: "2026-04-08",
    }, { shardDays: 1 }) as { total: number; partial?: boolean; failedShards?: unknown[] }
    errSpy.mockRestore()
    expect(result.partial).toBe(true)
    expect(result.failedShards).toEqual([{ startDate: "2026-04-07", endDate: "2026-04-07" }])
    expect(result.total).toBe(1200)
    expect(sink.rows).toBe(1200)
    await sink.abort()
  })
})

describe("callKlineWithSharding partial marker on a later shard", () => {
  it("keeps the merged result partial when a shard after the header shard reports itself partial", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const call = vi.fn().mockImplementation(async (_key: string, body: { startDate: string }) => ({
      total: 1, fieldList: ["securityCode", "tradeDate"], list: [["S1", body.startDate]], ...(body.startDate === "2026-04-07" ? { partial: true } : {}),
    }))
    const result = await callKlineWithSharding({ call }, "quote.day-kline", {
      securityList: ["all"], startDate: "2026-04-06", endDate: "2026-04-08",
    }, { shardDays: 1 }) as { partial?: boolean; total: number }
    errSpy.mockRestore()
    expect(result.total).toBe(3)
    expect(result.partial).toBe(true)
  })
})
