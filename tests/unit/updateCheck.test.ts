import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { latestVersion, UPDATE_CHECK_TTL_MS } from "../../src/core/updateCheck.js"

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
})
