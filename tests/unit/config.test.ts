import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, loadConfig, MAX_TIMEOUT_MS } from "../../src/core/config.js"

const ENV_KEYS = [
  "GANGTISE_BASE_URL",
  "GANGTISE_TIMEOUT_MS",
  "GANGTISE_ACCESS_KEY",
  "GANGTISE_SECRET_KEY",
  "GANGTISE_TOKEN",
  "GANGTISE_TOKEN_CACHE_PATH",
] as const

describe("loadConfig", () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = {}
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it("falls back to defaults when nothing is set", () => {
    const config = loadConfig()
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(config.accessKey).toBeUndefined()
    expect(config.secretKey).toBeUndefined()
    expect(config.token).toBeUndefined()
    expect(config.tokenCachePath).toContain("token.json")
  })

  it("defaults to the openapi.gangtise.com base URL", () => {
    expect(DEFAULT_BASE_URL).toBe("https://openapi.gangtise.com")
  })

  it("reads overrides from the environment", () => {
    process.env.GANGTISE_BASE_URL = "https://example.test"
    process.env.GANGTISE_TIMEOUT_MS = "5000"
    process.env.GANGTISE_ACCESS_KEY = "ak"
    process.env.GANGTISE_SECRET_KEY = "sk"
    process.env.GANGTISE_TOKEN = "tok"
    process.env.GANGTISE_TOKEN_CACHE_PATH = "/custom/token.json"

    const config = loadConfig()
    expect(config.baseUrl).toBe("https://example.test")
    expect(config.timeoutMs).toBe(5000)
    expect(config.accessKey).toBe("ak")
    expect(config.secretKey).toBe("sk")
    expect(config.token).toBe("tok")
    expect(config.tokenCachePath).toBe("/custom/token.json")
  })

  it("takes whole milliseconds only, falls back below a second, and caps at the upper bound", () => {
    for (const raw of ["0.5", "1e12", "30s", "-5000", "30"]) {
      process.env.GANGTISE_TIMEOUT_MS = raw
      expect(loadConfig().timeoutMs, raw).toBe(DEFAULT_TIMEOUT_MS)
    }
    process.env.GANGTISE_TIMEOUT_MS = "1000"
    expect(loadConfig().timeoutMs).toBe(1000)
    process.env.GANGTISE_TIMEOUT_MS = "99999999"
    expect(loadConfig().timeoutMs).toBe(MAX_TIMEOUT_MS)
  })

  it("says once on stderr when the timeout that was set is not the one in effect", async () => {
    // A fresh module per case: the warning is once per process, kept in module state.
    const warningsFor = async (raw: string): Promise<string[]> => {
      vi.resetModules()
      const fresh = await import("../../src/core/config.js")
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      try {
        process.env.GANGTISE_TIMEOUT_MS = raw
        fresh.loadConfig()
        fresh.loadConfig()
        return errSpy.mock.calls.map((c) => String(c[0]))
      } finally {
        errSpy.mockRestore()
      }
    }
    for (const raw of ["1.2e5", "120000.0", "120s", "30", "99999999"]) {
      const lines = await warningsFor(raw)
      expect(lines, raw).toHaveLength(1)
      expect(lines[0], raw).toContain(`GANGTISE_TIMEOUT_MS=${raw} is not in effect`)
    }
    for (const raw of ["120000", "0120000", " 5000 "]) {
      expect(await warningsFor(raw), raw).toEqual([])
    }
  })

  it("ignores a non-positive or non-numeric timeout", () => {
    process.env.GANGTISE_TIMEOUT_MS = "0"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)

    process.env.GANGTISE_TIMEOUT_MS = "not-a-number"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)

    process.env.GANGTISE_TIMEOUT_MS = "-100"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })
})
