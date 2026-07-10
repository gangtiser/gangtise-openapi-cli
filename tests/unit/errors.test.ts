import { describe, expect, it } from "vitest"

import { ApiError, ConfigError, DownloadError, ValidationError } from "../../src/core/errors.js"

describe("ApiError", () => {
  it("stores code, statusCode, and details", () => {
    const err = new ApiError("fail", "123", 400, { extra: true })
    expect(err.message).toBe("fail")
    expect(err.code).toBe("123")
    expect(err.statusCode).toBe(400)
    expect(err.details).toEqual({ extra: true })
  })

  it("provides hint for known error codes", () => {
    const err = new ApiError("access key error", "8000014")
    expect(err.hint).toContain("ACCESS_KEY")
  })

  it("hints 100003 参数值非法 toward enum spelling (server does not name the bad param)", () => {
    expect(new ApiError("参数值非法", "100003").hint).toContain("枚举")
  })

  it("provides hints for codes documented in the skill error table", () => {
    expect(new ApiError("quote range", "430007").hint).toContain("日期范围")
    expect(new ApiError("download", "430004").hint).toContain("file-type")
  })

  it("has no hint for unknown error codes", () => {
    const err = new ApiError("unknown", "999999999")
    expect(err.hint).toBeUndefined()
  })

  it("has no hint when code is omitted", () => {
    const err = new ApiError("generic")
    expect(err.hint).toBeUndefined()
  })
})

describe("ConfigError", () => {
  it("is instanceof CliError and Error", () => {
    const err = new ConfigError("bad config")
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("bad config")
  })
})

describe("ValidationError", () => {
  it("is instanceof CliError", () => {
    const err = new ValidationError("invalid input")
    expect(err).toBeInstanceOf(ValidationError)
  })
})

describe("DownloadError", () => {
  it("is instanceof CliError", () => {
    const err = new DownloadError("download failed")
    expect(err).toBeInstanceOf(DownloadError)
  })
})

describe("error hierarchy", () => {
  it("all custom errors are distinct classes", () => {
    expect(ConfigError).not.toBe(ValidationError)
    expect(ValidationError).not.toBe(DownloadError)
    expect(DownloadError).not.toBe(ApiError)
  })
})