import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, loadConfig } from "../../src/core/config.js"

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

  it("ignores a non-positive or non-numeric timeout", () => {
    process.env.GANGTISE_TIMEOUT_MS = "0"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)

    process.env.GANGTISE_TIMEOUT_MS = "not-a-number"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)

    process.env.GANGTISE_TIMEOUT_MS = "-100"
    expect(loadConfig().timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })
})
