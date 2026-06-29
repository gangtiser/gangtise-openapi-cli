import fs from "node:fs/promises"
import { Readable } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

    const brokerOrgs = await client.call("lookup.broker-orgs.list") as Array<{ id: string; name: string }>
    const meetingOrgs = await client.call("lookup.meeting-orgs.list") as Array<{ id: string; name: string }>

    expect(brokerOrgs[0]).toEqual({ id: "C800150015", name: "野村证券" })
    expect(meetingOrgs[0]).toEqual({ id: "C000000000", name: "公司自发" })
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

  it("returns partial data (first + fetched pages) when a later page hard-fails", async () => {
    // total 200 → first page (serial) + remaining pages fanned out. A non-retryable
    // error (rate limit 903301) on a later page must not discard the rows already
    // fetched — the result is marked partial with the unfetched pages listed.
    let call = 0
    requestMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }))
      if (call === 2) return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: 50 }, (_, i) => ({ id: i + 51 })) }))
      // rawJsonResponse: a real error envelope (outer code != 000000) → non-retryable ApiError
      return Promise.resolve(rawJsonResponse({ code: "903301", msg: "rate limited", status: false }))
    })

    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: Array<{ id: number }>; partial?: boolean; failedPages?: Array<{ from: number; size: number }> }

    expect(result.total).toBe(200)
    expect(result.partial).toBe(true)
    expect(result.failedPages?.length).toBeGreaterThan(0)
    // first page (and any page that succeeded before the failure) survives, not discarded
    expect(result.list.length).toBeGreaterThanOrEqual(50)
    expect(result.list[0]).toEqual({ id: 1 })
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

  it("throws ApiError with the HTTP status when an error body isn't JSON (gateway HTML)", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 404,
      headers: { "content-type": "text/html" },
      body: { text: vi.fn().mockResolvedValue("<html>Not Found</html>") },
    })

    const client = createClient()
    await expect(client.call("ai.one-pager", { securityCode: "x" })).rejects.toMatchObject({
      statusCode: 404,
      message: "API request failed (HTTP 404)",
    })
  })

  it("throws a parse error for a 200 response whose body isn't JSON", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: { text: vi.fn().mockResolvedValue("not json at all") },
    })

    const client = createClient()
    await expect(client.call("ai.one-pager", { securityCode: "x" })).rejects.toMatchObject({
      message: "Failed to parse API response",
    })
  })
})

describe("GangtiseClient auth recovery", () => {
  const tokenCachePath = `/tmp/gangtise-auth-recovery-${process.pid}.json`

  beforeEach(() => {
    requestMock.mockReset()
  })

  afterEach(async () => {
    await fs.unlink(tokenCachePath).catch(() => {})
  })

  function loginClient() {
    return new GangtiseClient({
      baseUrl: "https://open.gangtise.com",
      timeoutMs: 30_000,
      accessKey: "ak",
      secretKey: "sk",
      tokenCachePath,
    })
  }

  it("auto-recovers a JSON request from an auth error by refreshing the token once", async () => {
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      if (listCalls === 1) return Promise.resolve(rawJsonResponse({ code: "8000014", msg: "access key error" }))
      return Promise.resolve(jsonResponse({ answer: 42 }))
    })

    const client = loginClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 })
    expect(listCalls).toBe(2) // initial 8000014 + retry after refresh
  })

  it("auto-recovers when the server invalidates the token (code 0000001008)", async () => {
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      if (listCalls === 1) return Promise.resolve(rawJsonResponse({ code: "0000001008", msg: "token is invalid" }))
      return Promise.resolve(jsonResponse({ answer: 42 }))
    })

    const client = loginClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 })
    expect(listCalls).toBe(2) // initial 0000001008 + retry after forced re-login
  })

  it("does not loop back to a stale injected env token after self-heal (TOKEN + AK/SK)", async () => {
    // config has BOTH an injected env token (now stale) AND AK/SK. The stale token is
    // rejected; self-heal logs in for a fresh token and the retry must use THAT, not
    // short-circuit back to config.token (the #7 bug — a request still carrying the
    // stale token is rejected here, so a regressed retry would fail the call).
    let listCalls = 0
    requestMock.mockImplementation((url: unknown, opts: { headers?: Record<string, string> } | undefined) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      const auth = opts?.headers?.Authorization ?? ""
      if (auth.includes("stale")) return Promise.resolve(rawJsonResponse({ code: "0000001008", msg: "token is invalid" }))
      return Promise.resolve(jsonResponse({ answer: 42 }))
    })

    const client = new GangtiseClient({
      baseUrl: "https://open.gangtise.com",
      timeoutMs: 30_000,
      token: "stale-injected",
      accessKey: "ak",
      secretKey: "sk",
      tokenCachePath,
    })
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 }) // retry used the fresh token, not the stale one
    expect(listCalls).toBe(2) // initial stale-token reject + one successful retry
  })

  it("auto-recovers a download from an auth error by refreshing the token once", async () => {
    const bytes = new Uint8Array([7, 8, 9])
    let downloadCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      downloadCalls += 1
      if (downloadCalls === 1) return Promise.resolve(rawJsonResponse({ code: "8000015", msg: "secret key error" }))
      return Promise.resolve(binaryResponse(bytes))
    })

    const client = loginClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "123" }) as { data?: Uint8Array }

    expect(result.data).toEqual(bytes)
    expect(downloadCalls).toBe(2) // initial 8000015 + retry after refresh
  })

  it("does not retry a download auth error when credentials are absent", async () => {
    let downloadCalls = 0
    requestMock.mockImplementation(() => {
      downloadCalls += 1
      return Promise.resolve(rawJsonResponse({ code: "8000015", msg: "secret key error" }))
    })

    // token-only client (no AK/SK) cannot refresh, so the error must surface
    const client = new GangtiseClient({
      baseUrl: "https://open.gangtise.com",
      timeoutMs: 30_000,
      token: "test-token",
      tokenCachePath,
    })
    await expect(client.call("insight.research.download", undefined, { reportId: "123" })).rejects.toMatchObject({ code: "8000015" })
    expect(downloadCalls).toBe(1)
  })
})

describe("GangtiseClient streaming download", () => {
  const streamTo = `/tmp/gangtise-stream-${process.pid}.bin`

  beforeEach(() => {
    requestMock.mockReset()
  })

  afterEach(async () => {
    await fs.unlink(streamTo).catch(() => {})
  })

  it("streams the body to disk and returns savedPath + parsed filename on success", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="report.pdf"' },
      body: Readable.from([Buffer.from("hello "), Buffer.from("world")]),
    })

    const client = createClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "1" }, { streamTo }) as { savedPath?: string; filename?: string }

    expect(result.savedPath).toBe(streamTo)
    expect(result.filename).toBe("report.pdf")
    expect(await fs.readFile(streamTo, "utf8")).toBe("hello world")
  })

  it("removes the partial file when the stream fails mid-download", async () => {
    function* boom() {
      yield Buffer.from("partial bytes")
      throw new Error("stream boom")
    }
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "application/octet-stream" },
      body: Readable.from(boom()),
    })

    const client = createClient()
    await expect(
      client.call("insight.research.download", undefined, { reportId: "1" }, { streamTo }),
    ).rejects.toThrow("stream boom")

    // a failed download must not leave a truncated file behind
    await expect(fs.access(streamTo)).rejects.toThrow()
  })
})

describe("GangtiseClient sequential pagination (no total)", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  // Mimics wechat chatroom: responds with { chatRoomList } and NO total; the
  // server caps page size at 50. The client must page until a short page.
  function chatroomMock(total: number, cap = 50) {
    requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
      const body = JSON.parse(opts?.body ?? "{}") as { from?: number; size?: number }
      const from = body.from ?? 0
      const size = Math.min(body.size ?? 50, cap)
      const available = Math.max(total - from, 0)
      const count = Math.max(0, Math.min(size, available))
      const chatRoomList = Array.from({ length: count }, (_, i) => ({ chatroomId: `id-${from + i + 1}` }))
      return Promise.resolve(jsonResponse({ chatRoomList }))
    })
  }

  it("pages until a short page when size is omitted (no total to drive fan-out)", async () => {
    chatroomMock(101)
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0 }) as { chatRoomList: Array<{ chatroomId: string }> }
    expect(result.chatRoomList).toHaveLength(101)
    expect(result.chatRoomList[0]).toEqual({ chatroomId: "id-1" })
    expect(result.chatRoomList.at(-1)).toEqual({ chatroomId: "id-101" })
    expect(requestMock).toHaveBeenCalledTimes(3) // 50 + 50 + 1
  })

  it("stops at the requested size without over-fetching", async () => {
    chatroomMock(101)
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0, size: 60 }) as { chatRoomList: unknown[] }
    expect(result.chatRoomList).toHaveLength(60)
    expect(requestMock).toHaveBeenCalledTimes(2) // 50 + 10
  })

  it("returns a single page when fewer rows than one page exist", async () => {
    chatroomMock(8)
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0 }) as { chatRoomList: unknown[] }
    expect(result.chatRoomList).toHaveLength(8)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("does one extra (empty) page when total is an exact multiple of page size", async () => {
    chatroomMock(50)
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0 }) as { chatRoomList: unknown[] }
    expect(result.chatRoomList).toHaveLength(50)
    expect(requestMock).toHaveBeenCalledTimes(2) // 50 (full) then 0 (short → stop)
  })

  it("keeps already-collected pages and warns when a LATER page loses shape", async () => {
    let call = 0
    requestMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(jsonResponse({ chatRoomList: Array.from({ length: 50 }, (_, i) => ({ chatroomId: `id-${i + 1}` })) }))
      return Promise.resolve(jsonResponse({ unexpected: true })) // 2nd page loses shape
    })
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      const client = createClient()
      const result = await client.call("vault.wechat-chatroom.list", { from: 0 }) as { chatRoomList: unknown[] }
      expect(result.chatRoomList).toHaveLength(50) // first page survives, not discarded
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unexpected shape"))
    } finally {
      errSpy.mockRestore()
    }
  })

  it("returns the first response untouched when the FIRST page isn't a list shape", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ someObject: true }))
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0 })
    expect(result).toEqual({ someObject: true })
  })
})

describe("GangtiseClient pagination cap", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("caps at 1000 pages and warns when more rows exist", async () => {
    // maxPageSize is 50, so 50_001 rows would need 1001 pages — one past the cap.
    paginatedMock({ total: 50_001, itemFor: (id) => ({ id }) })
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)

    try {
      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[] }

      expect(result.total).toBe(50_001)
      expect(result.list).toHaveLength(50_000) // 1000 pages × 50 rows
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("safety cap"))
    } finally {
      errSpy.mockRestore()
    }
  })
})
