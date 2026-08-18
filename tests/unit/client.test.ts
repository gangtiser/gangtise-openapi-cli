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
    // 3 pages + 1 probe past the end. Every fetch-all pays that one extra request so a
    // server-capped `total` can't pass off a truncated export as complete; it returns
    // zero rows (and bills nothing) whenever the total is honest.
    expect(requestMock).toHaveBeenCalledTimes(4)
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

  it("warns on verbose when a paginated endpoint's first page loses the {total,list} shape", async () => {
    // Shape drift (e.g. total arriving as a string) silently degrades fetch-all
    // to a single page with no partial marker — at least make it visible.
    const { setVerbose } = await import("../../src/core/transport.js")
    const previousExit = process.exitCode
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    setVerbose(true)
    try {
      requestMock.mockResolvedValueOnce(jsonResponse({ total: "200", list: [{ id: 1 }] }))
      const client = createClient()
      const result = await client.call("insight.qa.list", { securityCode: "601012.SH" }) as Record<string, unknown>
      expect(result.total).toBe("200") // passthrough unchanged
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("shape")
      // A string `total` truncates fetch-all to page 1 while still LOOKING complete —
      // worse than an obviously empty payload, so it must carry the same exit code.
      expect(process.exitCode).toBe(3)
    } finally {
      process.exitCode = previousExit
      setVerbose(false)
      errSpy.mockRestore()
    }
  })

  // Three opinion endpoints report a fixed total=10000 while rows keep coming past that
  // offset (Elasticsearch track_total_hits shape). A fetch-all stops exactly at the cap
  // with collected === total, so every other completeness check passes and the truncated
  // export looks complete — while `opinion` bills 30 credits per row.
  it("flags a fetch-all as truncated when rows exist past the reported total", async () => {
    const CAP = 100
    requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
      const body = JSON.parse(opts?.body ?? "{}") as { from?: number; size?: number }
      const from = body.from ?? 0
      const size = body.size ?? 20
      // Server always claims CAP but keeps serving rows well past it.
      const list = Array.from({ length: size }, (_, i) => ({ id: from + i + 1 }))
      return Promise.resolve(jsonResponse({ total: CAP, list }))
    })
    const previousExit = process.exitCode
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      const client = createClient()
      const result = await client.call("insight.opinion.list", { from: 0 }) as { total: number; list: unknown[]; partial?: boolean; totalCapped?: boolean }
      expect(result.list).toHaveLength(CAP)
      expect(result.totalCapped).toBe(true)
      // partial must agree, because printData maps it to exit 3.
      expect(result.partial).toBe(true)
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("TRUNCATED")
    } finally {
      process.exitCode = previousExit
      errSpy.mockRestore()
    }
  })

  it("still probes past the end on a no-replay endpoint", async () => {
    // `ai.hot-topic` is the only endpoint that is both paginated and `no-replay`, and it
    // MUST still be probed. An earlier build skipped it, reading `no-replay` as a
    // per-call billing marker; it is not one — it means "never resend a request the
    // server may already have executed", and the probe is a new request, not a resend.
    // Billing-wise hot-topic is priced per returned item, and the platform does not
    // charge a per-item endpoint for a query that finds nothing — so the gate saved no
    // credits while costing this endpoint its only truncation check.
    paginatedMock({ total: 40, itemFor: (id) => ({ id }) })
    const client = createClient()
    const result = await client.call("ai.hot-topic", { from: 0 }) as { list: unknown[]; totalCapped?: boolean }
    expect(result.list).toHaveLength(40)
    expect(result.totalCapped).toBeUndefined()
    // 40 rows / 20 per page = 2 pages, plus the probe past the end.
    expect(requestMock.mock.calls).toHaveLength(3)
    const probed = requestMock.mock.calls.some((c) => {
      const body = JSON.parse((c[1] as { body?: string } | undefined)?.body ?? "{}") as { from?: number; size?: number }
      return body.from === 40 && body.size === 1
    })
    expect(probed).toBe(true)
  })

  it("flags a capped total on a no-replay endpoint too", async () => {
    // The positive half: skipping the probe here used to make a truncated hot-topic
    // export indistinguishable from a complete one. Rows past the claimed end must
    // surface as `totalCapped`, exactly as on the `insight.opinion*` endpoints.
    const CAP = 40
    requestMock.mockImplementation((_url: unknown, opts: { body?: string } | undefined) => {
      const body = JSON.parse(opts?.body ?? "{}") as { from?: number; size?: number }
      const from = body.from ?? 0
      const size = body.size ?? 20
      // Server always claims CAP but keeps serving rows well past it.
      const list = Array.from({ length: size }, (_, i) => ({ id: from + i + 1 }))
      return Promise.resolve(jsonResponse({ total: CAP, list }))
    })
    const previousExit = process.exitCode
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      const client = createClient()
      const result = await client.call("ai.hot-topic", { from: 0 }) as { list: unknown[]; partial?: boolean; totalCapped?: boolean }
      expect(result.list).toHaveLength(CAP)
      expect(result.totalCapped).toBe(true)
      // partial must agree, because printData maps it to exit 3.
      expect(result.partial).toBe(true)
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("TRUNCATED")
    } finally {
      process.exitCode = previousExit
      errSpy.mockRestore()
    }
  })

  it("does not flag a fetch-all when the reported total is honest", async () => {
    // The probe past the end comes back empty — no false positive, and on the
    // per-row-billed endpoints it costs nothing because it returns no rows.
    paginatedMock({ total: 70, itemFor: (id) => ({ id }) })
    const client = createClient()
    const result = await client.call("insight.opinion.list", { from: 0 }) as { list: unknown[]; partial?: boolean; totalCapped?: boolean }
    expect(result.list).toHaveLength(70)
    expect(result.totalCapped).toBeUndefined()
    expect(result.partial).toBeUndefined()
  })

  it("does not probe past the end when the caller bounded the request with size", async () => {
    // An explicit --size got exactly what it asked for; there is no truncation claim
    // to make, so we must not spend an extra request (or credits) on the probe.
    paginatedMock({ total: 300, itemFor: (id) => ({ id }) })
    const client = createClient()
    await client.call("insight.opinion.list", { from: 0, size: 120 })
    const probed = requestMock.mock.calls.some((c) => {
      const body = JSON.parse((c[1] as { body?: string } | undefined)?.body ?? "{}") as { from?: number }
      return body.from === 300
    })
    expect(probed).toBe(false)
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

  it("throws instead of saving the redirect page when redirects exceed the hop limit", async () => {
    // Endless 302 chain: the loop follows a bounded number of hops; when the
    // final response is still a 3xx it must become an ApiError instead of
    // flowing into the content branches and being saved as the "downloaded file".
    requestMock.mockImplementation(() => Promise.resolve({
      statusCode: 302,
      headers: { location: "/loop.pdf", "content-type": "text/html" },
      body: { text: vi.fn().mockResolvedValue("<html>moved</html>"), arrayBuffer: vi.fn() },
    }))
    const client = createClient()
    await expect(client.call("insight.research.download", undefined, { reportId: "1" })).rejects.toMatchObject({ statusCode: 302 })
  })

  it("throws when a redirect carries no Location header instead of saving its body", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 302,
      headers: { "content-type": "text/html" },
      body: { text: vi.fn().mockResolvedValue("<html>moved</html>"), arrayBuffer: vi.fn() },
    })
    const client = createClient()
    await expect(client.call("insight.research.download", undefined, { reportId: "1" })).rejects.toBeInstanceOf(ApiError)
  })

  it("wraps a corrupt gzip body in an ApiError instead of leaking a bare zlib error", async () => {
    // A proxy/middlebox can declare gzip and deliver garbage; the bare
    // Z_DATA_ERROR from zlib carries no request context and confuses users.
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
      body: { arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer), text: vi.fn() },
    })
    const client = createClient()
    await expect(client.call("insight.qa.list", { securityCode: "601012.SH", from: 0, size: 1 })).rejects.toBeInstanceOf(ApiError)
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

  it("warns on stderr without GANGTISE_VERBOSE when a paginated endpoint answers with a null payload", async () => {
    // insight foreign-opinion/independent-opinion answer `--industry` with 200 + data:null.
    // The warning used to be verbose-gated, so the default run printed nothing and exited 0 —
    // a caller could not tell "no data" from "this filter is broken".
    const previous = process.env.GANGTISE_VERBOSE
    const previousExit = process.exitCode
    delete process.env.GANGTISE_VERBOSE
    requestMock.mockResolvedValueOnce(jsonResponse(null))
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      const client = createClient()
      const result = await client.call("insight.foreign-opinion.list", { from: 0 })
      expect(result).toBeNull()
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unexpected shape"))
      // The warning alone only helps a human; a script reads the exit code. Without a
      // non-zero one it cannot tell "this filter matched nothing" from "this filter is
      // broken", which is the entire harm of the null payload.
      expect(process.exitCode).toBe(3)
    } finally {
      process.exitCode = previousExit
      errSpy.mockRestore()
      if (previous !== undefined) process.env.GANGTISE_VERBOSE = previous
    }
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

describe("GangtiseClient retry policy wiring", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("sends exactly one request when a no-replay endpoint hits a 5xx", async () => {
    requestMock.mockResolvedValue(rawJsonResponse({ code: "999999", msg: "系统内部错误" }, 503))
    const client = createClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toBeInstanceOf(ApiError)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("still replays a 5xx on a default-policy endpoint", async () => {
    requestMock
      .mockResolvedValueOnce(rawJsonResponse({ code: "999999", msg: "系统内部错误" }, 503))
      .mockResolvedValue(jsonResponse({ total: 0, list: [] }))
    const client = createClient()
    const result = await client.call("insight.qa.list", { securityCode: "601012.SH", from: 0, size: 1 }) as { total: number }
    expect(result.total).toBe(0)
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("does not replay a 5xx on a no-replay DOWNLOAD endpoint (billed per 篇, non-idempotent)", async () => {
    // summary/foreign-report/my-conference downloads cost 50/篇 — same tier as
    // the AI Agent calls; the download path must honor retry policy too.
    requestMock.mockResolvedValue({
      statusCode: 503,
      headers: { "content-type": "application/json" },
      body: { text: vi.fn().mockResolvedValue(JSON.stringify({ code: "999999", msg: "err" })), arrayBuffer: vi.fn() },
    })
    const client = createClient()
    await expect(client.call("insight.summary.download", undefined, { summaryId: "1" })).rejects.toBeInstanceOf(ApiError)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("still replays a 5xx on a default-policy download endpoint", async () => {
    requestMock
      .mockResolvedValueOnce({
        statusCode: 503,
        headers: { "content-type": "application/json" },
        body: { text: vi.fn().mockResolvedValue(JSON.stringify({ code: "999999", msg: "err" })), arrayBuffer: vi.fn() },
      })
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([9])))
    const client = createClient()
    const result = await client.call("insight.research.download", undefined, { reportId: "1" }) as { data?: Uint8Array }
    expect(result.data).toEqual(new Uint8Array([9]))
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry 999999 on indicator fetches and hints the parameter checklist, not '稍后重试'", async () => {
    // EDE used 999999 for "no data" until 2026-08-01 (no-data is now a null cell
    // that keeps its row and column), so retrying burned 3 requests and ~4s
    // before advising another retry.
    // Fail fast with a fetch-specific hint. The assertions deliberately avoid the
    // substring 无数据: the current hint mentions it only to say it is NOT this
    // code, so matching on it would pass on a negation.
    requestMock.mockResolvedValue(rawJsonResponse({ code: "999999", msg: "系统内部错误" }, 500))
    const client = createClient()
    let caught: unknown
    try {
      await client.call("indicator.cross-section", { indicatorCodeList: ["qte_close"], universe: ["600519.SH"], indicatorParamList: [] })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    const hint = (caught as ApiError).hint ?? ""
    expect(hint).toContain("parameterList") // param names come from indicator search — a wrong name fails silently
    expect(hint).toContain("指标周期") // date must match the indicator's period (财务报表类=报告期末; PE/PB 等日频估值=交易日 — finc_pb_mrq went daily on 2026-08-02)
    expect(hint).not.toContain("稍后重试")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("applies the fetch hint to the screener too, not just cross-section/time-series", async () => {
    requestMock.mockResolvedValue(rawJsonResponse({ code: "999999", msg: "系统内部错误" }, 500))
    const client = createClient()
    let caught: unknown
    try {
      await client.call("indicator.screener", { universe: ["600519.SH"], expression: "F1 > 0", indicatorList: [] })
    } catch (error) {
      caught = error
    }
    expect((caught as ApiError).hint ?? "").toContain("parameterList")
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("does not slap the data-fetch hint on a 999999 from indicator.search (no date/scope/param inputs)", async () => {
    // search shares the no-999999 policy but takes only a keyword — the cross-section
    // hint (date period / scopeList / required params) would be nonsensical guidance.
    requestMock.mockResolvedValue(rawJsonResponse({ code: "999999", msg: "系统内部错误" }, 500))
    const client = createClient()
    let caught: unknown
    try {
      await client.call("indicator.search", { keyword: "收盘价", limit: 5 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).hint ?? "").not.toContain("scopeList") // scopeList is unique to the data-fetch hint
    expect(requestMock).toHaveBeenCalledTimes(1)
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
      // Only inject the auth failure for offsets inside the fan-out. The cap probe runs
      // serially AFTER the fan-out, so failing it too would count a second (legitimate)
      // self-heal against the single-flight assertion this test is actually about.
      if (body.from < 200 && !failedOnce.has(body.from)) {
        failedOnce.add(body.from)
        return Promise.resolve(rawJsonResponse({ code: "8000014", msg: "access key error" }))
      }
      // Respect `total`: a server that keeps serving rows past its own total is what
      // the cap probe is designed to catch, and that is not what this test is about.
      const remaining = Math.max(200 - body.from, 0)
      const count = Math.min(body.size, remaining)
      return Promise.resolve(jsonResponse({ total: 200, list: Array.from({ length: count }, (_, i) => ({ id: body.from + i + 1 })) }))
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

  it("auto-recovers on the renumbered 999002 TOKEN_INVALID (401) the same as on 0000001008", async () => {
    // 2026-07-17 renumbering. The token filter still emits 0000001008 today, but
    // self-heal must not silently stop working the day it switches over.
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      if (listCalls === 1) return Promise.resolve(rawJsonResponse({ code: 999002, errorType: "TOKEN_INVALID", msg: "令牌无效或已过期" }, 401))
      return Promise.resolve(jsonResponse({ answer: 42 }))
    })

    const client = loginClient()
    expect(await client.call("ai.one-pager", { securityCode: "600519.SH" })).toEqual({ answer: 42 })
    expect(listCalls).toBe(2) // initial 999002 + retry after forced re-login
  })

  it("does not replay 999011 CREDENTIAL_INVALID — bad AK/SK will not fix itself", async () => {
    let listCalls = 0
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      listCalls += 1
      return Promise.resolve(rawJsonResponse({ code: 999011, errorType: "CREDENTIAL_INVALID", msg: "开发账号凭证无效（ak/sk 匹配失败）" }, 401))
    })

    const client = loginClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" })).rejects.toMatchObject({ code: "999011" })
    expect(listCalls).toBe(1)
  })

  it("surfaces the envelope traceId on the raised ApiError", async () => {
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      return Promise.resolve(rawJsonResponse({ code: 130002, errorType: "RESOURCE_NOT_FOUND", msg: "资源不存在", traceId: "830970758816235520" }, 404))
    })

    const client = loginClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" }))
      .rejects.toMatchObject({ code: "130002", traceId: "830970758816235520" })
  })

  it("carries the envelope traceId onto the payload so double-wrapped EDE failures keep it", async () => {
    // EDE nests a second envelope inside `data` and raises its own failures from it
    // (indicatorMatrix.unwrapIndicatorData), by which point the outer envelope — the
    // only layer carrying a traceId, probed 2026-07-20 — has already been stripped.
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      return Promise.resolve(rawJsonResponse({
        code: "000000", status: true, traceId: "830886133018902528",
        data: { code: 130001, status: false, msg: "指标无权限" },
      }))
    })

    const client = loginClient()
    const inner = await client.call("indicator.cross-section", { date: "2026-07-17" })
    expect(new ApiError("指标无权限", "130001", undefined, inner).traceId).toBe("830886133018902528")
  })

  it("keeps the server's Retry-After when the error arrives as a 200-wrapped envelope", async () => {
    // throwHttpError passes it on for 4xx/5xx, but Gangtise also returns errors
    // inside an HTTP 200 envelope — that route used to discard the server's own
    // backoff window.
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: { text: vi.fn().mockResolvedValue(JSON.stringify({ code: 999006, status: false, msg: "调用超出限制" })) },
      })
    })

    const client = loginClient()
    await expect(client.call("ai.one-pager", { securityCode: "600519.SH" }))
      .rejects.toMatchObject({ code: "999006", retryAfterMs: 5000 })
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

  it("keeps the server's Retry-After on a download error delivered as a JSON envelope", async () => {
    // The download JSON path unwraps its envelope too and used to drop the
    // retryAfterMs that the main JSON path preserves (client.ts throwHttpError passes
    // it, unwrapEnvelope did not).
    requestMock.mockImplementation((url: unknown) => {
      if (String(url).includes("/loginV2")) {
        return Promise.resolve(rawJsonResponse({ code: "000000", data: { accessToken: "fresh", expiresIn: 7200, time: 1 } }))
      }
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: { text: vi.fn().mockResolvedValue(JSON.stringify({ code: 999006, status: false, msg: "调用超出限制" })) },
      })
    })
    const client = loginClient()
    await expect(client.call("insight.research.download", undefined, { reportId: "123" }))
      .rejects.toMatchObject({ code: "999006", retryAfterMs: 5000 })
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
    await expect(fs.access(streamTo + ".part")).rejects.toThrow() // no .part litter
  })

  it("preserves an existing file at the destination when a re-download fails mid-stream", async () => {
    // The stream must write to a .part sibling and only rename on success —
    // otherwise a failed re-download (or each withRetry attempt) truncates and
    // then deletes the user's previous good file.
    await fs.writeFile(streamTo, "OLD")
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
    await expect(client.call("insight.research.download", undefined, { reportId: "1" }, { streamTo })).rejects.toThrow("stream boom")
    expect(await fs.readFile(streamTo, "utf8")).toBe("OLD")
    await expect(fs.access(streamTo + ".part")).rejects.toThrow()
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
