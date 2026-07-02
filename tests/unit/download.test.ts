import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extFromContentType, resolveTitle, saveDownloadResult } from "../../src/core/download.js"
import { DownloadError } from "../../src/core/errors.js"
import { readTitleCache } from "../../src/core/titleCache.js"

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
