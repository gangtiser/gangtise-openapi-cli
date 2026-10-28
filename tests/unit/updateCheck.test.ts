import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { latestVersion, noticeUpdate, REFRESH_RETRY_MS, UPDATE_CHECK_TTL_MS } from "../../src/core/updateCheck.js"

describe("latestVersion", () => {
  let dir: string
  let cachePath: string
  const fetchMock = vi.fn()

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-update-"))
    cachePath = path.join(dir, "nested", "update-check.json")
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const registryAnswers = (version: string) => fetchMock.mockResolvedValue({ json: () => Promise.resolve({ version }) })

  it("asks the registry once, then reuses the answer for a day", async () => {
    registryAnswers("9.9.9")
    expect(await latestVersion(cachePath, 2000, 1_000)).toBe("9.9.9")
    expect(JSON.parse(await fs.readFile(cachePath, "utf8"))).toEqual({ checkedAt: 1_000, latest: "9.9.9" })
    expect(await latestVersion(cachePath, 2000, 1_000 + UPDATE_CHECK_TTL_MS - 1)).toBe("9.9.9")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await fs.readdir(path.dirname(cachePath))).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  it("asks again once the answer is a day old, or dated in the future", async () => {
    registryAnswers("9.9.9")
    await latestVersion(cachePath, 2000, 1_000)
    registryAnswers("10.0.0")
    expect(await latestVersion(cachePath, 2000, 1_000 + UPDATE_CHECK_TTL_MS)).toBe("10.0.0")
    expect(await latestVersion(cachePath, 2000, 500)).toBe("10.0.0")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("writes no cache relative to the working directory when there is no home", async () => {
    // An empty HOME makes os.homedir() return "", so the default path comes out relative.
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      registryAnswers("9.9.9")
      expect(await latestVersion(path.join(".config", "gangtise", "update-check.json"), 2000, 1_000)).toBe("9.9.9")
      await expect(fs.access(path.join(dir, ".config"))).rejects.toThrow()
    } finally {
      process.chdir(cwd)
    }
  })

  it("caches no failed lookup", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    expect(await latestVersion(cachePath, 2000, 1_000)).toBeUndefined()
    await expect(fs.access(cachePath)).rejects.toThrow()
    registryAnswers("9.9.9")
    expect(await latestVersion(cachePath, 2000, 2_000)).toBe("9.9.9")
  })

  it("asks the registry even under a fresh kept answer when told to", async () => {
    registryAnswers("9.9.9")
    await latestVersion(cachePath, 2000, 1_000)
    registryAnswers("10.0.0")
    expect(await latestVersion(cachePath, 2000, 1_001, true)).toBe("10.0.0")
    expect(JSON.parse(await fs.readFile(cachePath, "utf8"))).toEqual({ checkedAt: 1_001, latest: "10.0.0" })
  })
})

describe("noticeUpdate", () => {
  let dir: string
  let cachePath: string
  let errSpy: MockInstance<typeof process.stderr.write>
  const refresh = vi.fn()

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-notice-"))
    cachePath = path.join(dir, "update-check.json")
    refresh.mockReset()
    errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true)
  })

  afterEach(async () => {
    errSpy.mockRestore()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const keep = (answer: Record<string, unknown>) => fs.writeFile(cachePath, JSON.stringify(answer))
  const printed = () => errSpy.mock.calls.map((call) => String(call[0])).join("")

  it("mentions a newer kept version once, then stays quiet until a new answer is kept", async () => {
    await keep({ checkedAt: 1_000, latest: "0.50.0" })
    noticeUpdate("0.48.0", cachePath, 2_000, refresh)
    expect(printed()).toBe("Update available: 0.48.0 → 0.50.0. Run: gangtise update\n")
    noticeUpdate("0.48.0", cachePath, 3_000, refresh)
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    await keep({ checkedAt: 4_000, latest: "0.51.0" })
    noticeUpdate("0.48.0", cachePath, 5_000, refresh)
    expect(errSpy).toHaveBeenCalledTimes(2)
  })

  it("says nothing when the kept version is not newer", async () => {
    await keep({ checkedAt: 1_000, latest: "0.48.0" })
    noticeUpdate("0.48.0", cachePath, 2_000, refresh)
    await keep({ checkedAt: 1_000, latest: "0.47.0" })
    noticeUpdate("0.48.0", cachePath, 2_000, refresh)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it("refreshes in the background when nothing is kept or the answer is a day old, and never asks the registry itself", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      noticeUpdate("0.48.0", cachePath, 1_000, refresh)
      expect(refresh).toHaveBeenCalledWith(cachePath)
      await keep({ checkedAt: 1_000, latest: "0.50.0" })
      noticeUpdate("0.48.0", cachePath, 1_000 + UPDATE_CHECK_TTL_MS, refresh)
      expect(refresh).toHaveBeenCalledTimes(2)
      // A day-old answer is still worth mentioning while the refresh runs.
      expect(printed()).toContain("0.50.0")
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("starts one background refresh an hour while the registry gives no answer", async () => {
    noticeUpdate("0.48.0", cachePath, 1_000, refresh)
    noticeUpdate("0.48.0", cachePath, 2_000, refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    noticeUpdate("0.48.0", cachePath, 1_000 + REFRESH_RETRY_MS, refresh)
    expect(refresh).toHaveBeenCalledTimes(2)
    // A day-old answer: refreshed once an hour too, and still mentioned once.
    await keep({ checkedAt: 1_000, latest: "0.50.0" })
    const dayOld = 1_000 + UPDATE_CHECK_TTL_MS
    noticeUpdate("0.48.0", cachePath, dayOld, refresh)
    noticeUpdate("0.48.0", cachePath, dayOld + 1_000, refresh)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(errSpy).toHaveBeenCalledTimes(1)
    noticeUpdate("0.48.0", cachePath, dayOld + REFRESH_RETRY_MS, refresh)
    expect(refresh).toHaveBeenCalledTimes(4)
  })

  it("keeps nothing and starts nothing without a home directory", () => {
    noticeUpdate("0.48.0", path.join(".config", "gangtise", "update-check.json"), 1_000, refresh)
    expect(refresh).not.toHaveBeenCalled()
  })
})
