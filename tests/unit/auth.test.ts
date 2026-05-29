import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { isTokenCacheValid, normalizeToken, readTokenCache, requireAccessCredentials, writeTokenCache, type TokenCache } from "../../src/core/auth.js"
import { ConfigError } from "../../src/core/errors.js"

const nowSec = () => Math.floor(Date.now() / 1000)

function cache(overrides: Partial<TokenCache> = {}): TokenCache {
  return { accessToken: "abc", expiresIn: 7200, time: 1, expiresAt: nowSec() + 7200, ...overrides }
}

describe("normalizeToken", () => {
  it("prefixes a bare token with Bearer", () => {
    expect(normalizeToken("abc")).toBe("Bearer abc")
  })

  it("is idempotent for an already-prefixed token", () => {
    expect(normalizeToken("Bearer abc")).toBe("Bearer abc")
  })
})

describe("isTokenCacheValid", () => {
  it("rejects null", () => {
    expect(isTokenCacheValid(null)).toBe(false)
  })

  it("rejects a cache missing accessToken or expiresAt", () => {
    expect(isTokenCacheValid({ ...cache(), accessToken: "" })).toBe(false)
    expect(isTokenCacheValid({ ...cache(), expiresAt: 0 })).toBe(false)
  })

  it("accepts a token comfortably in the future", () => {
    expect(isTokenCacheValid(cache({ expiresAt: nowSec() + 7200 }))).toBe(true)
  })

  it("rejects a token inside the expiry buffer", () => {
    // expires in 100s but the default 300s buffer makes it stale
    expect(isTokenCacheValid(cache({ expiresAt: nowSec() + 100 }))).toBe(false)
  })

  it("honours a custom buffer", () => {
    expect(isTokenCacheValid(cache({ expiresAt: nowSec() + 100 }), 30)).toBe(true)
  })
})

describe("requireAccessCredentials", () => {
  it("returns the pair when both are present", () => {
    expect(requireAccessCredentials("ak", "sk")).toEqual({ accessKey: "ak", secretKey: "sk" })
  })

  it("throws ConfigError when either is missing", () => {
    expect(() => requireAccessCredentials(undefined, "sk")).toThrow(ConfigError)
    expect(() => requireAccessCredentials("ak", undefined)).toThrow(ConfigError)
  })
})

describe("readTokenCache / writeTokenCache", () => {
  const dir = path.join(os.tmpdir(), `gangtise-auth-test-${process.pid}`)
  const file = path.join(dir, "token.json")

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("round-trips a cache and writes it with 0600 permissions", async () => {
    const value = cache({ accessToken: "round-trip" })
    await writeTokenCache(file, value)

    const read = await readTokenCache(file)
    expect(read).toEqual(value)

    const stat = await fs.stat(file)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it("returns null for a missing file", async () => {
    expect(await readTokenCache(path.join(dir, "nope.json"))).toBeNull()
  })

  it("returns null for corrupt or shape-invalid content", async () => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, "{ not json")
    expect(await readTokenCache(file)).toBeNull()

    await fs.writeFile(file, JSON.stringify({ accessToken: 123 }))
    expect(await readTokenCache(file)).toBeNull()
  })
})
