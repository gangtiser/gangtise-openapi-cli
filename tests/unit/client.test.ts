import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, ValidationError } from "../../src/core/errors.js"
import { GangtiseClient } from "../../src/core/client.js"

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici")
  return {
    ...actual,
    request: requestMock,
  }
})

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

function rawJsonResponse(payload: unknown, statusCode = 200) {
  return {
    statusCode,
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

interface PageDef {
  total: number
  fieldList?: string[]
  itemFor: (id: number) => unknown
}

/**
 * Mock that responds based on the `from` and `size` in the request body, so
 * tests don't depend on call ordering (parallel pagination fans out requests).
 */
function paginatedMock(def: PageDef) {
  requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
    const body = JSON.parse(opts?.body ?? "{}") as { from?: number; size?: number }
    const from = body.from ?? 0
    const size = body.size ?? 20
    const start = from + 1
    const available = Math.max(def.total - from, 0)
    const count = Math.max(0, Math.min(size, available))
    const list = Array.from({ length: count }, (_, i) => def.itemFor(start + i))
    const data: Record<string, unknown> = { total: def.total, list }
    if (def.fieldList) data.fieldList = def.fieldList
    return Promise.resolve(jsonResponse(data))
  })
}

describe("GangtiseClient pagination", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("returns exactly the requested size across multiple pages", async () => {
    paginatedMock({ total: 300, itemFor: (id) => ({ id }) })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0, size: 120 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(300)
    expect(result.list).toHaveLength(120)
    expect(result.list[0]).toEqual({ id: 1 })
    expect(result.list.at(-1)).toEqual({ id: 120 })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("fetches all remaining rows when size is omitted", async () => {
    paginatedMock({ total: 118, itemFor: (id) => ({ id }) })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(118)
    expect(result.list).toHaveLength(118)
    expect(result.list[0]).toEqual({ id: 1 })
    expect(result.list.at(-1)).toEqual({ id: 118 })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("starts from a non-zero offset and stops at requested size", async () => {
    paginatedMock({ total: 300, itemFor: (id) => ({ id }) })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 50, size: 80 }) as { total: number; list: Array<{ id: number }> }

    expect(result.list).toHaveLength(80)
    expect(result.list[0]).toEqual({ id: 51 })
    expect(result.list.at(-1)).toEqual({ id: 130 })
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("returns all remaining rows when requested size exceeds available rows", async () => {
    paginatedMock({ total: 70, itemFor: (id) => ({ id }) })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0, size: 120 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(70)
    expect(result.list).toHaveLength(70)
    expect(result.list.at(-1)).toEqual({ id: 70 })
  })

  it("preserves first-page metadata like fieldList while merging pages", async () => {
    paginatedMock({
      total: 52,
      fieldList: ["securityCode", "title"],
      itemFor: (id) => [`s${id}`, `T${id}`],
    })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; fieldList: string[]; list: string[][] }

    expect(result.fieldList).toEqual(["securityCode", "title"])
    expect(result.total).toBe(52)
    expect(result.list).toHaveLength(52)
    expect(result.list[0]).toEqual(["s1", "T1"])
    expect(result.list.at(-1)).toEqual(["s52", "T52"])
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
    let call = 0
    requestMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }))
      return Promise.resolve(jsonResponse({ unexpected: true }))
    })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0, size: 100 }) as { total: number; list: Array<{ id: number }> }

    expect(result.total).toBe(200)
    expect(result.list.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })))
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

  it("passes through a response with only 'code' (business field, not an envelope)", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ code: "000001.SH", name: "平安银行" }))

    const client = createClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ code: "000001.SH", name: "平安银行" })
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

  it("throws ApiError for HTTP 4xx JSON responses without an envelope", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ error: "unauthorized" }, 401))

    const client = createClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toMatchObject({
      statusCode: 401,
      message: "API request failed (HTTP 401)",
    })
  })

  it("throws ApiError for HTTP 4xx JSON download responses without an envelope", async () => {
    requestMock.mockResolvedValueOnce(rawJsonResponse({ error: "missing file" }, 404))

    const client = createClient()
    await expect(client.call("insight.research.download", undefined, { reportId: "missing" })).rejects.toMatchObject({
      statusCode: 404,
      message: "API request failed (HTTP 404)",
    })
  })
})
