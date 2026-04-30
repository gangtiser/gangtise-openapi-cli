import { describe, expect, it } from "vitest"

import { collectKeyValue, collectList, collectNumberList, maybeArray, parseFrom, parseNumberOption, parseSize, parseTimestamp13, splitCsv, toTimestamp13 } from "../../src/core/args.js"
import { ValidationError } from "../../src/core/errors.js"

describe("splitCsv", () => {
  it("splits comma-separated values and trims whitespace", () => {
    expect(splitCsv("a, b, c")).toEqual(["a", "b", "c"])
  })

  it("filters empty segments", () => {
    expect(splitCsv("a,,b")).toEqual(["a", "b"])
  })

  it("returns empty array for empty string", () => {
    expect(splitCsv("")).toEqual([])
  })
})

describe("collectList", () => {
  it("accumulates values across repeated calls", () => {
    expect(collectList("x", ["a"])).toEqual(["a", "x"])
  })

  it("starts fresh when no previous", () => {
    expect(collectList("hello")).toEqual(["hello"])
  })

  it("handles comma-separated input", () => {
    expect(collectList("a,b", ["c"])).toEqual(["c", "a", "b"])
  })
})

describe("collectNumberList", () => {
  it("parses numbers from comma-separated input", () => {
    expect(collectNumberList("1,2,3")).toEqual([1, 2, 3])
  })

  it("throws on invalid numeric values", () => {
    expect(() => collectNumberList("1,abc,3")).toThrow(ValidationError)
  })

  it("accumulates with previous", () => {
    expect(collectNumberList("5", [1, 2])).toEqual([1, 2, 5])
  })
})

describe("parseNumberOption", () => {
  it("parses finite numbers", () => {
    expect(parseNumberOption("12", "--limit")).toBe(12)
  })

  it("rejects non-finite values", () => {
    expect(() => parseNumberOption("abc", "--limit")).toThrow(ValidationError)
  })

  it("enforces integer and minimum constraints", () => {
    expect(() => parseNumberOption("1.5", "--size", { integer: true })).toThrow(ValidationError)
    expect(() => parseNumberOption("0", "--size", { min: 1 })).toThrow(ValidationError)
  })
})

describe("parseFrom/parseSize", () => {
  it("parses pagination options", () => {
    expect(parseFrom(undefined)).toBe(0)
    expect(parseFrom("10")).toBe(10)
    expect(parseSize(undefined)).toBeUndefined()
    expect(parseSize("50")).toBe(50)
  })

  it("rejects invalid pagination options", () => {
    expect(() => parseFrom("-1")).toThrow(ValidationError)
    expect(() => parseSize("0")).toThrow(ValidationError)
  })
})

describe("collectKeyValue", () => {
  it("parses key=value pair", () => {
    expect(collectKeyValue("foo=bar")).toEqual({ foo: "bar" })
  })

  it("merges with previous object", () => {
    expect(collectKeyValue("b=2", { a: "1" })).toEqual({ a: "1", b: "2" })
  })

  it("handles values with equals sign", () => {
    expect(collectKeyValue("url=https://x.com/path?a=1")).toEqual({ url: "https://x.com/path?a=1" })
  })

  it("throws on missing equals sign", () => {
    expect(() => collectKeyValue("noequals")).toThrow()
  })

  it("throws on empty key", () => {
    expect(() => collectKeyValue("=value")).toThrow()
  })
})

describe("maybeArray", () => {
  it("returns undefined for empty array", () => {
    expect(maybeArray([])).toBeUndefined()
  })

  it("returns the array when non-empty", () => {
    expect(maybeArray(["a"])).toEqual(["a"])
  })
})

describe("toTimestamp13", () => {
  it("returns undefined for undefined input", () => {
    expect(toTimestamp13(undefined)).toBeUndefined()
  })

  it("passes through 13-digit timestamps", () => {
    expect(toTimestamp13("1711929600000")).toBe(1711929600000)
  })

  it("converts 10-digit timestamps to 13-digit", () => {
    expect(toTimestamp13("1711929600")).toBe(1711929600000)
  })

  it("parses date strings to 13-digit timestamps", () => {
    const result = toTimestamp13("2025-04-01 00:00:00")
    expect(result).toBeDefined()
    expect(result!).toBeGreaterThan(1e12)
  })

  it("returns undefined for unparseable strings", () => {
    expect(toTimestamp13("not-a-date")).toBeUndefined()
  })
})

describe("parseTimestamp13", () => {
  it("parses valid date values", () => {
    expect(parseTimestamp13("2025-04-01", "--start-time")).toBeGreaterThan(1e12)
  })

  it("throws on invalid date values", () => {
    expect(() => parseTimestamp13("not-a-date", "--start-time")).toThrow(ValidationError)
  })
})
