import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn().mockResolvedValue(undefined) }))

// Stub the on-disk title-cache write so tests never touch ~/.config; keep the
// real extractTitles so we still exercise the title-extraction wiring.
vi.mock("../../src/core/titleCache.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/titleCache.js")>("../../src/core/titleCache.js")
  return { ...actual, writeTitleCache: writeMock }
})

const { printData } = await import("../../src/core/printer.js")

describe("printData", () => {
  let outSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>
  const dir = path.join(os.tmpdir(), `gangtise-printer-test-${process.pid}`)

  beforeEach(() => {
    writeMock.mockClear()
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(async () => {
    outSpy.mockRestore()
    errSpy.mockRestore()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const stdout = () => outSpy.mock.calls.map((c) => String(c[0])).join("")
  const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("")

  it("renders a plain array to stdout", async () => {
    await printData([{ a: 1, b: 2 }], "table")
    expect(stdout()).toContain("a")
    expect(stdout()).toContain("b")
  })

  it("sets exit code 3 for partial results so scripts can tell them from complete ones", async () => {
    const prevExitCode = process.exitCode
    try {
      await printData({ total: 100, list: [{ id: 1 }], partial: true, failedPages: [{ from: 50, size: 50 }] }, "table")
      expect(process.exitCode).toBe(3)
    } finally {
      process.exitCode = prevExitCode
    }
  })

  it("writes csv files with a BOM so Excel decodes Chinese as UTF-8", async () => {
    const out = path.join(dir, "bom.csv")
    await printData({ total: 1, list: [{ 名称: "贵州茅台" }] }, "csv", out)
    const content = await fs.readFile(out, "utf8")
    expect(content.startsWith("\ufeff")).toBe(true)
    expect(content).toContain("贵州茅台")
  })

  it("keeps stdout csv BOM-free for pipes", async () => {
    await printData({ total: 1, list: [{ a: 1 }] }, "csv")
    expect(stdout().startsWith("\ufeff")).toBe(false)
  })

  it("leaves the exit code alone for complete results", async () => {
    const prevExitCode = process.exitCode
    try {
      await printData({ total: 2, list: [{ id: 1 }, { id: 2 }] }, "table")
      expect(process.exitCode).toBe(prevExitCode)
    } finally {
      process.exitCode = prevExitCode
    }
  })

  it("prints a Total/showing summary to stderr for paginated wrappers", async () => {
    await printData({ total: 100, list: [{ id: 1 }, { id: 2 }] }, "table")
    expect(stderr()).toContain("Total: 100, showing: 2")
  })

  it("suppresses the Total summary for json output", async () => {
    await printData({ total: 100, list: [{ id: 1 }] }, "json")
    expect(stderr()).toBe("")
  })

  it("writes to a file and echoes the path when output is set", async () => {
    const out = path.join(dir, "out.json")
    await printData({ total: 1, list: [{ id: 7 }] }, "json", out)
    expect(stdout().trim()).toBe(out)
    const parsed = JSON.parse(await fs.readFile(out, "utf8"))
    expect(parsed.list[0]).toEqual({ id: 7 })
  })

  it("writes titles to the cache when a cache config and matching items are present", async () => {
    await printData({ total: 1, list: [{ reportId: "55", title: "T" }] }, "table", undefined, {
      endpointKey: "insight.research.list",
      idField: "reportId",
    })
    expect(writeMock).toHaveBeenCalledWith("insight.research.list", { "55": "T" })
  })

  it("does not write to the cache when items carry no titles", async () => {
    await printData({ total: 1, list: [{ reportId: "55" }] }, "table", undefined, {
      endpointKey: "insight.research.list",
      idField: "reportId",
    })
    expect(writeMock).not.toHaveBeenCalled()
  })
})
