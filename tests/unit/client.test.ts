import { beforeEach, describe, expect, it, vi } from "vitest"

import { GangtiseClient } from "../../src/core/client.js"

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock("undici", () => ({
  request: requestMock,
}))

function createClient() {
  return new GangtiseClient({
    baseUrl: "https://open.gangtise.com",
    timeoutMs: 30_000,
    token: "test-token",
    tokenCachePath: "/tmp/gangtise-token.json",
  })
}

function jsonResponse(data: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: {
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: "000000",
          msg: "ok",
          data,
        }),
      ),
    },
  }
}

describe("GangtiseClient pagination", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("returns exactly the requested size across multiple pages", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 300, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 300, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 51 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 300, list: Array.from({ length: 20 }, (_, index) => ({ id: index + 101 })) }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0, size: 120 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(300)
    expect(result.list).toHaveLength(120)
    expect(result.list[0]).toEqual({ id: 1 })
    expect(result.list.at(-1)).toEqual({ id: 120 })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("fetches all remaining rows when size is omitted", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 118, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 118, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 51 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 118, list: Array.from({ length: 18 }, (_, index) => ({ id: index + 101 })) }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(118)
    expect(result.list).toHaveLength(118)
    expect(result.list[0]).toEqual({ id: 1 })
    expect(result.list.at(-1)).toEqual({ id: 118 })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("starts from a non-zero offset and stops at requested size", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 300, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 51 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 300, list: Array.from({ length: 30 }, (_, index) => ({ id: index + 101 })) }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 50, size: 80 }) as { total: number; list: Array<{ id: number }> }

    expect(result.list).toHaveLength(80)
    expect(result.list[0]).toEqual({ id: 51 })
    expect(result.list.at(-1)).toEqual({ id: 130 })
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("returns all remaining rows when requested size exceeds available rows", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 70, list: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })) }))
      .mockResolvedValueOnce(jsonResponse({ total: 70, list: Array.from({ length: 20 }, (_, index) => ({ id: index + 51 })) }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0, size: 120 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(70)
    expect(result.list).toHaveLength(70)
    expect(result.list.at(-1)).toEqual({ id: 70 })
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("preserves first-page metadata like fieldList while merging pages", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 52, fieldList: ["securityCode", "title"], list: Array.from({ length: 50 }, (_, index) => [`0000${index + 1}.SZ`, `T${index + 1}`]) }))
      .mockResolvedValueOnce(jsonResponse({ total: 52, fieldList: ["securityCode", "title"], list: [["000051.SZ", "T51"], ["000052.SZ", "T52"]] }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; fieldList: string[]; list: string[][] }

    expect(result.fieldList).toEqual(["securityCode", "title"])
    expect(result.total).toBe(52)
    expect(result.list).toHaveLength(52)
    expect(result.list[0]).toEqual(["00001.SZ", "T1"])
    expect(result.list.at(-1)).toEqual(["000052.SZ", "T52"])
  })

  it("does one request for endpoints without pagination metadata", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ answer: 1 }))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 1 })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to the data already fetched when later pages lose total/list shape", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ total: 4, list: [{ id: 1 }, { id: 2 }] }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }))

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(4)
    expect(result.list).toEqual([{ id: 1 }, { id: 2 }])
  })
})
