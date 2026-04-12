import { describe, expect, it } from "vitest"

import { collectKeyValue, collectList, collectNumberList, maybeArray, splitCsv, toTimestamp13 } from "../../src/core/args.js"

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

  it("filters NaN values", () => {
    expect(collectNumberList("1,abc,3")).toEqual([1, 3])
  })

  it("accumulates with previous", () => {
    expect(collectNumberList("5", [1, 2])).toEqual([1, 2, 5])
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