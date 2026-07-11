import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extFromContentType, resolveTitle, saveDownloadResult, uniquePath } from "../../src/core/download.js"
import { DownloadError } from "../../src/core/errors.js"
import { readTitleCache } from "../../src/core/titleCache.js"

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

// downloadUrlTo goes through the transport layer (shared undici request); mock it
// so signed-URL tests control status/body/timeout without a real server.
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici")
  return { ...actual, request: requestMock }
})

// resolveTitle reads the on-disk title cache via readTitleCache(); stub it to an
// empty cache so these tests stay hermetic and fast (the real cache can be large).
vi.mock("../../src/core/titleCache.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/titleCache.js")>("../../src/core/titleCache.js")
  return { ...actual, readTitleCache: vi.fn().mockResolvedValue({}) }
})

describe("extFromContentType", () => {
  it("maps known mime types to extensions", () => {
    expect(extFromContentType("application/pdf")).toBe(".pdf")
    expect(extFromContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(".xlsx")
  })

  it("ignores parameters and casing", () => {
    expect(extFromContentType("application/PDF; charset=utf-8")).toBe(".pdf")
  })

  it("returns empty string for unknown or absent types", () => {
    expect(extFromContentType("application/x-unknown")).toBe("")
    expect(extFromContentType(undefined)).toBe("")
  })
})

describe("resolveTitle", () => {
  // readTitleCache is stubbed to {}, so the lookup misses and we fall through
  // to the (mocked) list endpoint.
  const ENDPOINT = "test.resolve-title.list"

  it("returns a filename from the title cache without calling the list endpoint", async () => {
    // The common path: a prior `list` cached the title, so download resolves the
    // name from cache and never re-hits the list endpoint. (Default mock is {}.)
    vi.mocked(readTitleCache).mockResolvedValueOnce({
      [ENDPOINT]: { titles: { "123": "Cached Q3 Report" }, ts: Date.now() },
    })
    const listSpy = vi.fn()
    const name = await resolveTitle({ call: listSpy }, { contentType: "application/pdf" }, ENDPOINT, "reportId", "123")
    expect(name).toBe("Cached Q3 Report.pdf")
    expect(listSpy).not.toHaveBeenCalled()
  })

  it("builds a sanitized filename from the matched list item and content type", async () => {
    const client = { call: vi.fn().mockResolvedValue({ list: [{ reportId: "123", title: "Q3 业绩/点评" }] }) }
    const name = await resolveTitle(client, { contentType: "application/pdf" }, ENDPOINT, "reportId", "123")
    expect(name).toBe("Q3 业绩_点评.pdf")
  })

  it("does not double-append an extension the title already has", async () => {
    const client = { call: vi.fn().mockResolvedValue({ list: [{ reportId: "1", title: "report.pdf" }] }) }
    const name = await resolveTitle(client, { filename: "x.pdf" }, ENDPOINT, "reportId", "1")
    expect(name).toBe("report.pdf")
  })

  it("returns undefined when no item matches", async () => {
    const client = { call: vi.fn().mockResolvedValue({ list: [{ reportId: "999", title: "T" }] }) }
    expect(await resolveTitle(client, {}, ENDPOINT, "reportId", "123")).toBeUndefined()
  })

  it("returns undefined when the list endpoint throws", async () => {
    const client = { call: vi.fn().mockRejectedValue(new Error("network")) }
    expect(await resolveTitle(client, {}, ENDPOINT, "reportId", "123")).toBeUndefined()
  })
})

describe("saveDownloadResult", () => {
  const dir = path.join(os.tmpdir(), `gangtise-download-test-${process.pid}`)
  let outSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    requestMock.mockReset()
  })

  afterEach(async () => {
    outSpy.mockRestore()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const stdout = () => outSpy.mock.calls.map((c) => String(c[0])).join("")

  it("reports the streamed path without writing again", async () => {
    await saveDownloadResult({ savedPath: "/already/written.pdf" }, "fallback")
    expect(stdout().trim()).toBe("/already/written.pdf")
  })

  it("writes binary data to the given output path", async () => {
    const out = path.join(dir, "bin.dat")
    await saveDownloadResult({ data: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" }, "fallback", out)
    expect(new Uint8Array(await fs.readFile(out))).toEqual(new Uint8Array([1, 2, 3]))
    expect(stdout().trim()).toBe(out)
  })

  it("derives a filename from content type when no output path is given", async () => {
    await fs.mkdir(dir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      await saveDownloadResult({ data: new Uint8Array([9]), contentType: "application/pdf" }, "myfile")
      expect(stdout().trim()).toBe("myfile.pdf")
      expect(new Uint8Array(await fs.readFile(path.join(dir, "myfile.pdf")))).toEqual(new Uint8Array([9]))
    } finally {
      process.chdir(cwd)
    }
  })

  it("suffixes auto-derived filenames instead of overwriting an existing file", async () => {
    await fs.mkdir(dir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      await saveDownloadResult({ data: new Uint8Array([1]), contentType: "application/pdf", filename: "2025年第一季度报告.pdf" }, "fallback")
      await saveDownloadResult({ data: new Uint8Array([2]), contentType: "application/pdf", filename: "2025年第一季度报告.pdf" }, "fallback")
      // Batch downloads with colliding titles keep both files (-1 suffix), so the
      // first download never silently vanishes.
      expect(new Uint8Array(await fs.readFile(path.join(dir, "2025年第一季度报告.pdf")))).toEqual(new Uint8Array([1]))
      expect(new Uint8Array(await fs.readFile(path.join(dir, "2025年第一季度报告-1.pdf")))).toEqual(new Uint8Array([2]))
    } finally {
      process.chdir(cwd)
    }
  })

  it("sanitizes a user-supplied fallback name so it can't act as a path", async () => {
    await fs.mkdir(dir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      // fallbackName embeds a user-supplied id (--report-id "../evil"): the auto
      // filename must treat it as a plain name, not a parent-directory reference.
      await saveDownloadResult({ text: "hello" }, "../evil")
      const files = await fs.readdir(dir)
      expect(files).toEqual([".._evil.txt"])
    } finally {
      process.chdir(cwd)
    }
  })

  it("truncates over-long auto-derived filenames but keeps the extension", async () => {
    await fs.mkdir(dir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      const longName = "会".repeat(300) + ".pdf" // 900+ bytes — over ext4's 255-byte entry cap
      await saveDownloadResult({ data: new Uint8Array([1]), contentType: "application/pdf", filename: longName }, "fallback")
      const written = (await fs.readdir(dir))[0]
      expect(Buffer.byteLength(written, "utf8")).toBeLessThanOrEqual(210)
      expect(written.endsWith(".pdf")).toBe(true)
    } finally {
      process.chdir(cwd)
    }
  })

  it("follows a server-returned URL and writes the fetched bytes when --output is set", async () => {
    // The old behavior wrote the URL STRING into x.pdf — a "corrupt file" from the
    // user's point of view. With an output path we must fetch the actual content.
    const bytes = new Uint8Array([80, 75, 3, 4])
    requestMock.mockResolvedValue({ statusCode: 200, headers: {}, body: Readable.from(Buffer.from(bytes)) })
    const out = path.join(dir, "followed.pdf")
    await saveDownloadResult({ url: "https://signed.example.com/f.pdf" }, "fallback", out)
    expect(String(requestMock.mock.calls[0][0])).toBe("https://signed.example.com/f.pdf")
    expect(new Uint8Array(await fs.readFile(out))).toEqual(bytes)
    expect(stdout().trim()).toBe(out)
  })

  it("applies the configured timeout to signed-URL downloads (no unbounded fetch)", async () => {
    // The bare global fetch had no timeout: a slow-drip CDN could hang the CLI
    // indefinitely. The transport path must carry GANGTISE_TIMEOUT_MS.
    vi.stubEnv("GANGTISE_TIMEOUT_MS", "1234")
    try {
      requestMock.mockResolvedValue({ statusCode: 200, headers: {}, body: Readable.from(Buffer.from([1])) })
      const out = path.join(dir, "timed.pdf")
      await saveDownloadResult({ url: "https://signed.example.com/f.pdf" }, "fallback", out)
      const opts = requestMock.mock.calls[0][1] as { headersTimeout?: number; bodyTimeout?: number }
      expect(opts.headersTimeout).toBe(1234)
      expect(opts.bodyTimeout).toBe(1234)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("throws DownloadError when the followed URL responds with an error status", async () => {
    requestMock.mockResolvedValue({ statusCode: 403, headers: {}, body: { text: vi.fn().mockResolvedValue("expired") } })
    const out = path.join(dir, "expired.pdf")
    await expect(saveDownloadResult({ url: "https://signed.example.com/f.pdf" }, "fallback", out)).rejects.toBeInstanceOf(DownloadError)
    await expect(fs.access(out)).rejects.toThrow() // no half-written file
  })

  it("follows a signed-URL redirect chain to the final content", async () => {
    // undici does not follow redirects (the old global fetch did) — without
    // explicit handling the 302 placeholder body gets saved as the "file".
    const finalBytes = new Uint8Array([37, 80, 68, 70])
    requestMock
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: "https://cdn.example.com/real.pdf" }, body: { text: vi.fn().mockResolvedValue("") } })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: Readable.from(Buffer.from(finalBytes)) })
    const out = path.join(dir, "redirected.pdf")
    await saveDownloadResult({ url: "https://signed.example.com/start.pdf" }, "fallback", out)
    expect(String(requestMock.mock.calls[1][0])).toBe("https://cdn.example.com/real.pdf")
    expect(new Uint8Array(await fs.readFile(out))).toEqual(finalBytes)
  })

  it("resolves a relative redirect Location against the current URL", async () => {
    requestMock
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: "/real.pdf" }, body: { text: vi.fn().mockResolvedValue("") } })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: Readable.from(Buffer.from([1])) })
    const out = path.join(dir, "relative.pdf")
    await saveDownloadResult({ url: "https://signed.example.com/a/start.pdf" }, "fallback", out)
    expect(String(requestMock.mock.calls[1][0])).toBe("https://signed.example.com/real.pdf")
  })

  it("throws instead of saving the redirect page when hops exceed the limit or Location is missing", async () => {
    requestMock.mockImplementation(() => Promise.resolve({
      statusCode: 302,
      headers: { location: "https://signed.example.com/loop.pdf" },
      body: { text: vi.fn().mockResolvedValue("REDIRECT BODY") },
    }))
    const looped = path.join(dir, "loop.pdf")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(looped, "OLD")
    await expect(saveDownloadResult({ url: "https://signed.example.com/start.pdf" }, "fallback", looped)).rejects.toBeInstanceOf(DownloadError)
    expect(await fs.readFile(looped, "utf8")).toBe("OLD") // old file untouched

    requestMock.mockReset()
    requestMock.mockResolvedValue({ statusCode: 302, headers: {}, body: { text: vi.fn().mockResolvedValue("REDIRECT BODY") } })
    const noLocation = path.join(dir, "no-location.pdf")
    await expect(saveDownloadResult({ url: "https://signed.example.com/start.pdf" }, "fallback", noLocation)).rejects.toBeInstanceOf(DownloadError)
    await expect(fs.access(noLocation)).rejects.toThrow()
  })

  it("redacts the signed-URL query string from verbose logs", async () => {
    const { setVerbose } = await import("../../src/core/transport.js")
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    setVerbose(true)
    try {
      requestMock.mockResolvedValue({ statusCode: 200, headers: {}, body: Readable.from(Buffer.from([1])) })
      const out = path.join(dir, "redacted.pdf")
      await saveDownloadResult({ url: "https://oss.example.com/f.pdf?X-Signature=TOPSECRET&Expires=1" }, "fallback", out)
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(logged).toContain("oss.example.com/f.pdf")
      expect(logged).not.toContain("TOPSECRET")
    } finally {
      setVerbose(false)
      errSpy.mockRestore()
    }
  })

  it("preserves an existing file when the followed download dies mid-stream", async () => {
    const out = path.join(dir, "keep.pdf")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(out, "OLD")
    const broken = new Readable({
      read() {
        this.push(Buffer.from("partial"))
        this.destroy(new Error("connection cut"))
      },
    })
    requestMock.mockResolvedValue({ statusCode: 200, headers: {}, body: broken })
    await expect(saveDownloadResult({ url: "https://signed.example.com/f.pdf" }, "fallback", out)).rejects.toThrow()
    expect(await fs.readFile(out, "utf8")).toBe("OLD") // re-download failure must not destroy the old file
    await expect(fs.access(out + ".part")).rejects.toThrow() // no .part litter
  })

  it("uniquePath throws instead of overwriting the original after 99 suffix collisions", async () => {
    await fs.mkdir(dir, { recursive: true })
    const base = path.join(dir, "dup.pdf")
    await fs.writeFile(base, "x")
    await Promise.all(Array.from({ length: 99 }, (_, i) => fs.writeFile(path.join(dir, `dup-${i + 1}.pdf`), "x")))
    await expect(uniquePath(base)).rejects.toBeInstanceOf(DownloadError)
  })

  it("still prints the URL to stdout when no output path is given", async () => {
    await saveDownloadResult({ url: "https://signed.example.com/f.pdf" }, "fallback")
    expect(stdout().trim()).toBe("https://signed.example.com/f.pdf")
  })

  it("keeps plain overwrite semantics for an explicit output path", async () => {
    const out = path.join(dir, "explicit.pdf")
    await saveDownloadResult({ data: new Uint8Array([1]), contentType: "application/pdf" }, "fallback", out)
    await saveDownloadResult({ data: new Uint8Array([2]), contentType: "application/pdf" }, "fallback", out)
    expect(new Uint8Array(await fs.readFile(out))).toEqual(new Uint8Array([2]))
  })

  it("sanitizes a server-provided filename containing path separators", async () => {
    await fs.mkdir(dir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      await saveDownloadResult({ data: new Uint8Array([7]), contentType: "application/pdf", filename: "a/b:c.pdf" }, "fallback")
      // `/` and `:` replaced with `_` → one flat file, can't escape the intended dir
      expect(stdout().trim()).toBe("a_b_c.pdf")
      expect(new Uint8Array(await fs.readFile(path.join(dir, "a_b_c.pdf")))).toEqual(new Uint8Array([7]))
    } finally {
      process.chdir(cwd)
    }
  })

  it("writes text content to a .txt fallback", async () => {
    const out = path.join(dir, "note.txt")
    await saveDownloadResult({ text: "hello" }, "fallback", out)
    expect(await fs.readFile(out, "utf8")).toBe("hello")
  })

  it("prints a redirect url when there is no output path", async () => {
    await saveDownloadResult({ url: "https://cdn.example/file.pdf" }, "fallback")
    expect(stdout().trim()).toBe("https://cdn.example/file.pdf")
  })

  it("throws DownloadError on an unrecognized response", async () => {
    await expect(saveDownloadResult({}, "fallback")).rejects.toBeInstanceOf(DownloadError)
  })
})
