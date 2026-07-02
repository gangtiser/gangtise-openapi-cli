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
})
