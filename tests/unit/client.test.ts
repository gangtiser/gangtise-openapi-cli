import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, ValidationError } from "../../src/core/errors.js"
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

function rawJsonResponse(payload: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: {
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    },
  }
}

function binaryResponse(data: Uint8Array) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="report.pdf"',
    },
    body: {
      arrayBuffer: vi.fn().mockResolvedValue(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
      text: vi.fn(),
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

  it("rejects non-finite size instead of treating it as fetch-all", async () => {
    const client = createClient()

    await expect(client.call("insight.research.list", { from: 0, size: Number.NaN })).rejects.toBeInstanceOf(ValidationError)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it("dispatches download endpoints through the download flow", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    requestMock.mockResolvedValueOnce(binaryResponse(bytes))

    const client = createClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "123" }) as { data?: Uint8Array; filename?: string }

    expect(result.data).toEqual(bytes)
    expect(result.filename).toBe("report.pdf")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("returns built-in lookup data without making HTTP requests", async () => {
    const client = createClient()

    const researchAreas = await client.call("lookup.research-areas.list") as Array<{ id: string; name: string }>
    const brokerOrgs = await client.call("lookup.broker-orgs.list") as Array<{ id: string; name: string }>
    const meetingOrgs = await client.call("lookup.meeting-orgs.list") as Array<{ id: string; name: string }>
    const industries = await client.call("lookup.industries.list") as Array<{ id: string; name: string; taxonomy: string }>

    expect(researchAreas[0]).toEqual({ id: "122000001", name: "宏观" })
    expect(brokerOrgs[0]).toEqual({ id: "C800150015", name: "野村证券" })
    expect(meetingOrgs[0]).toEqual({ id: "C000000000", name: "公司自发" })
    expect(industries[0]).toEqual({ id: "104410000", name: "公用事业", taxonomy: "sw" })
    expect(requestMock).not.toHaveBeenCalled()
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

describe("GangtiseClient envelope unwrapping", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("passes through a direct array response without envelope", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse([{ id: 1 }, { id: 2 }]))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("passes through a response with 'data' field but no 'code' (not an envelope)", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ data: [1, 2, 3], total: 3 }))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ data: [1, 2, 3], total: 3 })
  })

  it("passes through a response with 'status' field but no 'code' (not an envelope)", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ status: true, items: ["a", "b"] }))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ status: true, items: ["a", "b"] })
  })

  it("unwraps a standard {code, data} envelope", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ code: "000000", msg: "ok", data: { answer: 42 } }))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 })
  })

  it("throws ApiError for envelope with error code", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ code: "410110", msg: "生成中" }))

    const client = createClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toBeInstanceOf(ApiError)
  })
})
