import { describe, expect, it, vi } from "vitest"

import { callKlineWithSharding } from "../../src/core/quoteSharding.js"

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

  it("does not skip weekends for multi-day shards (e.g. day-kline-hk, shardDays 2), which straddle weekdays", async () => {
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
