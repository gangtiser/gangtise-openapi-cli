import fs from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { gzipSync } from "node:zlib"

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

  it("follows a same-origin 302 redirect and keeps the Authorization header", async () => {
    // undici doesn't follow redirects on its own — without explicit handling the
    // redirect placeholder body would be saved as the "downloaded file".
    const bytes = new Uint8Array([1, 2, 3])
    requestMock
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: "/real/file.pdf" }, body: { text: vi.fn().mockResolvedValue("") } })
      .mockResolvedValueOnce(binaryResponse(bytes))

    const client = createClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "1" }) as { data?: Uint8Array }

    expect(result.data).toEqual(bytes)
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(String(requestMock.mock.calls[1][0])).toContain("/real/file.pdf")
    const secondHeaders = (requestMock.mock.calls[1][1] as { headers: Record<string, string> }).headers
    expect(secondHeaders.Authorization).toBeDefined()
  })

  it("drops Authorization when a download redirect leaves the API origin", async () => {
    requestMock
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: "https://oss.example.com/signed.pdf" }, body: { text: vi.fn().mockResolvedValue("") } })
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([9])))

    const client = createClient()
    await client.call("insight.research.download", undefined, { reportId: "1" })

    const secondHeaders = (requestMock.mock.calls[1][1] as { headers: Record<string, string> }).headers
    expect(secondHeaders.Authorization).toBeUndefined() // bearer must not leak to storage hosts
  })

  it("keeps the raw filename when content-disposition has a bare % (invalid URI encoding)", async () => {
    // decodeURIComponent throws URIError on "增长100%.pdf"; the download must not
    // fail over a cosmetic filename hint — fall back to the undecoded value.
    const response = binaryResponse(new Uint8Array([1]))
    response.headers["content-disposition"] = 'attachment; filename="增长100%.pdf"'
    requestMock.mockResolvedValueOnce(response)

    const client = createClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "9" }) as { filename?: string }

    expect(result.filename).toBe("增长100%.pdf")
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
    const result = await client.call("insight.research.list", { from: 0, size: 100 }) as { total: number; list: Array<{ id: number }>; partial?: boolean; failedPages?: Array<{ from: number; size: number }> }

    expect(result.total).toBe(200)
    expect(result.list.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })))
    // A shape-broken page means missing rows — the result must be marked partial,
    // not returned as a complete-looking success.
    expect(result.partial).toBe(true)
    expect(result.failedPages?.length).toBeGreaterThan(0)
  })

  it("returns an empty result with a single request when total is 0", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ total: 0, list: [] }))
    const client = createClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[] }
    expect(result.total).toBe(0)
    expect(result.list).toEqual([])
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("warns when a short first page contradicts the reported total", async () => {
    // Server says total=200 but returns only 30 rows on a 50-row first page: the
    // client treats the short page as end-of-data but must say so on stderr.
    requestMock.mockResolvedValueOnce(jsonResponse({ total: 200, list: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })) }))
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean }
      expect(result.total).toBe(200)
      expect(result.list).toHaveLength(30)
      expect(requestMock).toHaveBeenCalledTimes(1)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("short page"))
      // Not just a warning: scripts key off partial / exit code 3.
      expect(result.partial).toBe(true)
    } finally {
      errSpy.mockRestore()
    }
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

  it("flags partial when a later page comes back short (server page cap below maxPageSize)", async () => {
    // maxPageSize is 50. The first page fills (50 rows, total=100), so one more page
    // fans out — but it returns only 30 rows with no error. Collected 80 < 100: a short
    // later page is a silent shortfall today; it must be flagged partial, not complete.
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
        const from = (JSON.parse(opts?.body ?? "{}") as { from?: number }).from ?? 0
        const count = from === 0 ? 50 : 30
        const list = Array.from({ length: count }, (_, i) => ({ id: from + 1 + i }))
        return Promise.resolve(jsonResponse({ total: 100, list }))
      })

      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean }

      expect(requestMock).toHaveBeenCalledTimes(2)
      expect(result.list).toHaveLength(80)
      expect(result.partial).toBe(true)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("incomplete"))
    } finally {
      errSpy.mockRestore()
    }
  })

  it("flags partial when the MAX_PAGES safety cap truncates a huge fetch", async () => {
    // maxPageSize 50 × the 1000-page cap = 50000 rows max. total=50001 forces the cap:
    // the fetch stops one row short, so the result must be partial, not a silent subset.
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      paginatedMock({ total: 50001, itemFor: (id) => ({ id }) })
      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean }

      expect(requestMock).toHaveBeenCalledTimes(1000)
      expect(result.list).toHaveLength(50000)
      expect(result.partial).toBe(true)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("safety cap"))
    } finally {
      errSpy.mockRestore()
    }
  })

  it("flags partial when total drifts across pages even if the row count meets target", async () => {
    // First page reports total=100 (target 100); a later page reports total=90 — data
    // shifted mid-fetch, so rows may be duplicated/missing. Even though 100 rows come
    // back, the drift alone makes completeness unverifiable → partial.
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
        const from = (JSON.parse(opts?.body ?? "{}") as { from?: number }).from ?? 0
        const total = from === 0 ? 100 : 90
        const list = Array.from({ length: 50 }, (_, i) => ({ id: from + 1 + i }))
        return Promise.resolve(jsonResponse({ total, list }))
      })

      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean }

      expect(result.list).toHaveLength(100)
      expect(result.partial).toBe(true)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("changed across pages"))
    } finally {
      errSpy.mockRestore()
    }
  })

  it("flags partial when failedPages is non-empty even if the row count still meets target", async () => {
    // The case row-count and drift both miss: one page fails (shape-broken here, so the
    // fan-out is NOT aborted) while another page ignores `size` and over-returns, so
    // collected reaches target and `total` never drifts. short and totalDrift both look
    // clean — only failedPages betrays the hole. The code writes "results are partial" to
    // stderr, so the machine-readable partial flag (→ exit 3) MUST agree, or a script reads
    // a holed export as complete.
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
        const from = (JSON.parse(opts?.body ?? "{}") as { from?: number }).from ?? 0
        // maxPageSize 50, total 150 → first page (from=0) + fan-out at from=50 and from=100.
        if (from === 0) return Promise.resolve(jsonResponse({ total: 150, list: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }))
        // from=50: shape-broken → recorded in failedPages, but no abort of the fan-out.
        if (from === 50) return Promise.resolve(jsonResponse({ unexpected: true }))
        // from=100: over-returns 100 rows (ignores size=50); total unchanged → no drift.
        return Promise.resolve(jsonResponse({ total: 150, list: Array.from({ length: 100 }, (_, i) => ({ id: 101 + i })) }))
      })

      const client = createClient()
      const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean; failedPages?: Array<{ from: number; size: number }> }

      // Over-return pushes the row count up to target and total never drifts...
      expect(result.list).toHaveLength(150)
      // ...so only failedPages exposes the gap — and it must force both the flag and the warning.
      expect(result.failedPages?.length).toBeGreaterThan(0)
      expect(result.partial).toBe(true)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("results are partial"))
    } finally {
      errSpy.mockRestore()
    }
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

  it("gives up after one refresh when the server keeps rejecting the token (no login loop)", async () => {
    // Regression guard for the authState.retried latch: if the replay after a
    // forced refresh is rejected again, the client must fail — not login forever.
    // Pre-seed a valid cache so the only login on the wire is the forced refresh.
    await fs.writeFile(tokenCachePath, JSON.stringify({ accessToken: "Bearer stale", expiresIn: 7200, time: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }))
    let loginCalls = 0
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        loginCalls += 1
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      return Promise.resolve(rawJsonResponse({ code: "8000014", msg: "access key error" }))
    })

    const client = loginClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toMatchObject({ code: "8000014" })
    expect(loginCalls).toBe(1)
    expect(listCalls).toBe(2) // initial failure + exactly one replay
  })

  it("logs in only once when several concurrent pages hit an auth error together", async () => {
    // The refreshPromise single-flight must merge concurrent refresh attempts from
    // the pagination fan-out instead of firing one login per failed page.
    // Pre-seed a valid cache so the only login on the wire is the forced refresh.
    await fs.writeFile(tokenCachePath, JSON.stringify({ accessToken: "Bearer stale", expiresIn: 7200, time: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }))
    let loginCalls = 0
    const failedOnce = new Set<number>()
    requestMock.mockImplementation((url: unknown, init?: { body?: string }) => {
      if (String(url).includes("/loginV2")) {
        loginCalls += 1
        // Keep the refresh in flight briefly so every concurrent page failure
        // lands while refreshPromise is still pending (deterministic single-flight).
        return new Promise((resolve) => setTimeout(() => resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } })), 50))
      }
      const body = JSON.parse(init?.body ?? "{}") as { from: number; size: number }
      if (body.from === 0) return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }))
      if (!failedOnce.has(body.from)) {
        failedOnce.add(body.from)
        return Promise.resolve(rawJsonResponse({ code: "8000014", msg: "access key error" }))
      }
      return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: body.size }, (_, i) => ({ id: body.from + i + 1 })) }))
    })

    const client = loginClient()
    const result = await client.call("insight.research.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean }

    expect(result.list).toHaveLength(200)
    expect(result.partial).toBeUndefined()
    expect(loginCalls).toBe(1)
  })

  it("self-heals when the auth error arrives as HTTP 4xx instead of a 200 envelope", async () => {
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      if (listCalls === 1) return Promise.resolve(rawJsonResponse({ code: "8000014", msg: "access key error" }, 401))
      return Promise.resolve(jsonResponse({ answer: 42 }))
    })

    const client = loginClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 })
    expect(listCalls).toBe(2) // HTTP 401 + auth code → refresh → replay succeeds
  })

  it("reuses a token refreshed by a concurrent request instead of logging in again", async () => {
    // A and B both go out with the stale token. A fails fast and refreshes; B's
    // failure lands AFTER that refresh completed (the staggered case). B must
    // detect "the token I used is older than memoCache" and replay with the fresh
    // one — a second login could kick the fresh session server-side.
    await fs.writeFile(tokenCachePath, JSON.stringify({ accessToken: "Bearer stale", expiresIn: 7200, time: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }))
    let loginCalls = 0
    let staleFailures = 0
    requestMock.mockImplementation((url: unknown, init?: { headers?: Record<string, string> }) => {
      if (String(url).includes("/loginV2")) {
        loginCalls += 1
        return new Promise((resolve) => setTimeout(() => resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } })), 40))
      }
      if (init?.headers?.Authorization === "Bearer stale") {
        staleFailures += 1
        // First stale request fails immediately; the second one resolves only
        // after the refresh (40ms) has finished — genuinely staggered.
        const delay = staleFailures === 1 ? 0 : 120
        return new Promise((resolve) => setTimeout(() => resolve(rawJsonResponse({ code: "8000014", msg: "access key error" })), delay))
      }
      return Promise.resolve(jsonResponse({ answer: 1 }))
    })

    const client = loginClient()
    const [a, b] = await Promise.all([
      client.call("ai.one-pager", { securityCode: "600519.SH" }),
      client.call("ai.one-pager", { securityCode: "000858.SZ" }),
    ])

    expect(a).toEqual({ answer: 1 })
    expect(b).toEqual({ answer: 1 })
    expect(staleFailures).toBe(2)
    expect(loginCalls).toBe(1) // B reused A's fresh token, no second login
  })

  it("re-logins when the freshly acquired token itself gets invalidated (kicked session)", async () => {
    // Regression for the removed time-window guard: right after the initial login
    // the window was always "recent", so a 0000001008 on the brand-new token was
    // replayed with the SAME dead token and failed. Token comparison must instead
    // conclude "the current token died" and force a second login.
    let loginCalls = 0
    requestMock.mockImplementation((url: unknown, init?: { headers?: Record<string, string> }) => {
      if (String(url).includes("/loginV2")) {
        loginCalls += 1
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: `t${loginCalls}`, expiresIn: 7200, time: 1 } }))
      }
      // Only the second-generation token works; the first is "kicked".
      if (init?.headers?.Authorization === "Bearer t2") return Promise.resolve(jsonResponse({ answer: 42 }))
      return Promise.resolve(rawJsonResponse({ code: "0000001008", msg: "token is invalid" }))
    })

    const client = loginClient()
    const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

    expect(result).toEqual({ answer: 42 })
    expect(loginCalls).toBe(2) // initial login + forced re-login after the kick
  })

  it("reports a clean ApiError when the login response has no accessToken", async () => {
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { expiresIn: 7200, time: 1 } }))
      }
      return Promise.resolve(jsonResponse({ answer: 1 }))
    })

    const client = loginClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toMatchObject({
      name: "ApiError",
      message: expect.stringContaining("accessToken"),
    })
  })

  it("degrades to a warning when the token cache cannot be persisted", async () => {
    // Point the cache path INSIDE an existing file: mkdir fails with ENOTDIR.
    const blocker = `${tokenCachePath}.blocker`
    await fs.writeFile(blocker, "not a directory")
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      requestMock.mockImplementation((url: unknown) => {
        if (String(url).includes("/loginV2")) {
          return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
        }
        return Promise.resolve(jsonResponse({ answer: 7 }))
      })

      const client = new GangtiseClient({
        baseUrl: "https://open.gangtise.com",
        timeoutMs: 30_000,
        accessKey: "ak",
        secretKey: "sk",
        tokenCachePath: path.join(blocker, "token.json"),
      })
      const result = await client.call("ai.one-pager", { securityCode: "600519.SH" })

      expect(result).toEqual({ answer: 7 }) // request succeeds despite the failed persist
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("could not persist token cache"))
    } finally {
      errSpy.mockRestore()
      await fs.unlink(blocker).catch(() => {})
    }
  })

  it("keeps a path prefix in GANGTISE_BASE_URL when building request URLs", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ answer: 1 }))
    const client = new GangtiseClient({
      baseUrl: "https://proxy.corp.com/gangtise",
      timeoutMs: 30_000,
      token: "Bearer t",
      tokenCachePath,
    })
    await client.call("ai.one-pager", { securityCode: "600519.SH" })

    const requestedUrl = String(requestMock.mock.calls[0][0])
    expect(requestedUrl).toContain("https://proxy.corp.com/gangtise/application/")
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

describe("GangtiseClient wechat-chatroom pagination (total + list)", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  // The server switched chatroom from `{ chatRoomList }` (no total) to
  // `{ total, list }`; the endpoint now auto-paginates by total like any other
  // list endpoint (server still caps page size at 50).
  it("fetches all chatrooms across pages when size is omitted", async () => {
    paginatedMock({ total: 101, itemFor: (id) => ({ chatroomId: `id-${id}`, chatroomName: `room-${id}` }) })
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0 }) as { total: number; list: Array<{ chatroomId: string }> }
    expect(result.total).toBe(101)
    expect(result.list).toHaveLength(101)
    expect(result.list[0]).toEqual({ chatroomId: "id-1", chatroomName: "room-1" })
    expect(result.list.at(-1)).toEqual({ chatroomId: "id-101", chatroomName: "room-101" })
  })

  it("stops at the requested size without over-fetching", async () => {
    paginatedMock({ total: 101, itemFor: (id) => ({ chatroomId: `id-${id}` }) })
    const client = createClient()
    const result = await client.call("vault.wechat-chatroom.list", { from: 0, size: 60 }) as { list: unknown[] }
    expect(result.list).toHaveLength(60)
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

// A gzip-encoded JSON envelope: content-encoding: gzip + a body that only exposes
// arrayBuffer() (undici gives bytes; we gunzip). Mirrors what the server actually
// returns once we advertise accept-encoding.
function gzipJsonResponse(data: unknown) {
  const gz = gzipSync(Buffer.from(JSON.stringify({ code: "000000", msg: "ok", data })))
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: {
      arrayBuffer: vi.fn().mockResolvedValue(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)),
      text: vi.fn(),
    },
  }
}

function rateLimitedResponse(retryAfter: string) {
  return {
    statusCode: 429,
    headers: { "content-type": "application/json", "retry-after": retryAfter },
    body: { text: vi.fn().mockResolvedValue(JSON.stringify({ code: "429000", msg: "rate limited" })) },
  }
}

describe("GangtiseClient gzip", () => {
  beforeEach(() => requestMock.mockReset())

  it("gunzips a gzip-encoded JSON response", async () => {
    requestMock.mockResolvedValue(gzipJsonResponse({ hello: "世界" }))
    const result = await createClient().call("reference.constant-list", { category: "x" })
    expect(result).toEqual({ hello: "世界" })
  })

  it("advertises accept-encoding: gzip on JSON requests", async () => {
    requestMock.mockResolvedValue(jsonResponse({ ok: 1 }))
    await createClient().call("reference.constant-list", { category: "x" })
    const opts = requestMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(opts.headers["accept-encoding"]).toBe("gzip")
  })
})

describe("GangtiseClient endpoint timeout floor", () => {
  beforeEach(() => requestMock.mockReset())

  it("lifts the request timeout to 120s for a synchronous AI generation endpoint", async () => {
    requestMock.mockResolvedValue(jsonResponse({ text: "..." }))
    await createClient().call("ai.one-pager", { securityCode: "600519.SH" })
    const opts = requestMock.mock.calls[0][1] as { headersTimeout: number; bodyTimeout: number }
    expect(opts.headersTimeout).toBe(120_000)
    expect(opts.bodyTimeout).toBe(120_000)
  })

  it("keeps the default 30s timeout for a normal endpoint", async () => {
    requestMock.mockResolvedValue(jsonResponse({ list: [] }))
    await createClient().call("reference.constant-list", { category: "x" })
    const opts = requestMock.mock.calls[0][1] as { headersTimeout: number }
    expect(opts.headersTimeout).toBe(30_000)
  })
})

describe("GangtiseClient 429 Retry-After", () => {
  beforeEach(() => requestMock.mockReset())

  it("attaches Retry-After from a 429 response so backoff can honor it", async () => {
    vi.useFakeTimers()
    try {
      requestMock.mockResolvedValue(rateLimitedResponse("2"))
      const p = createClient().call("reference.constant-list", { category: "x" }).catch((e: unknown) => e)
      await vi.runAllTimersAsync()
      const err = await p
      expect(err).toBeInstanceOf(ApiError)
      expect((err as { retryAfterMs?: number }).retryAfterMs).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("attaches Retry-After even when the 429 body is not JSON (parse-fail path)", async () => {
    vi.useFakeTimers()
    try {
      // A gateway may return a plain-text 429; JSON.parse fails, but Retry-After must
      // still reach the error so backoff honors it.
      requestMock.mockResolvedValue({
        statusCode: 429,
        headers: { "content-type": "text/plain", "retry-after": "2" },
        body: { text: vi.fn().mockResolvedValue("rate limited, try later") },
      })
      const p = createClient().call("reference.constant-list", { category: "x" }).catch((e: unknown) => e)
      await vi.runAllTimersAsync()
      const err = await p
      expect(err).toBeInstanceOf(ApiError)
      expect((err as { retryAfterMs?: number }).retryAfterMs).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("attaches Retry-After on a rate-limited (429) download", async () => {
    vi.useFakeTimers()
    try {
      requestMock.mockResolvedValue({
        statusCode: 429,
        headers: { "content-type": "text/plain", "retry-after": "3" },
        body: { text: vi.fn().mockResolvedValue("rate limited") },
      })
      const p = createClient().call("insight.summary.download", undefined, { reportId: "1" }).catch((e: unknown) => e)
      await vi.runAllTimersAsync()
      const err = await p
      expect(err).toBeInstanceOf(ApiError)
      expect((err as { retryAfterMs?: number }).retryAfterMs).toBe(3000)
    } finally {
      vi.useRealTimers()
    }
  })
})
