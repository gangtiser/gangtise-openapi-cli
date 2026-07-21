import { describe, expect, it } from "vitest"

import { collectKeyValue, collectList, collectNumberList, dateArg, datetimeArg, isVersionNewer, localDateString, maybeArray, parseChoiceList, parseDateOption, parseDatetimeOption, parseFrom, parseIndicatorParams, parseNumberOption, parseSize, parseTimestamp13, splitCsv, toTimestamp13 } from "../../src/core/args.js"
import { ValidationError } from "../../src/core/errors.js"

describe("splitCsv", () => {
  it("splits comma-separated values and trims whitespace", () => {
    expect(splitCsv("a, b, c")).toEqual(["a", "b", "c"])
  })

  it("filters empty segments", () => {
    expect(splitCsv("a,,b")).toEqual(["a", "b"])
  })

  it("splits on full-width commas from voice-input IMEs", () => {
    expect(splitCsv("600519.SH，000858.SZ")).toEqual(["600519.SH", "000858.SZ"])
    expect(splitCsv("a，b, c")).toEqual(["a", "b", "c"])
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
    expect(() => collectKeyValue("noequals")).toThrow(ValidationError)
  })

  it("throws on empty key", () => {
    expect(() => collectKeyValue("=value")).toThrow(ValidationError)
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

describe("parseDateOption", () => {
  it("accepts a well-formed YYYY-MM-DD date", () => {
    expect(parseDateOption("2026-07-01", "--start-date")).toBe("2026-07-01")
    expect(parseDateOption("2020-02-29", "--start-date")).toBe("2020-02-29") // real leap day
  })

  it("rejects the slash format the API silently misreads", () => {
    // Probed 2026-07-20: "07/01/2026" came back parsed as 2026-01-07 — an 8-row
    // window became 122 rows, HTTP 200, nothing in the response flagging it.
    expect(() => parseDateOption("07/01/2026", "--start-date")).toThrow(ValidationError)
    expect(() => parseDateOption("07/01/2026", "--start-date")).toThrow(/YYYY-MM-DD/)
  })

  it("rejects other shapes that would reach the server unvalidated", () => {
    for (const bad of ["2026/07/01", "20260701", "2026-7-1", "July 1 2026", "2026-07-01 00:00:00", ""]) {
      expect(() => parseDateOption(bad, "--end-date"), `should reject ${JSON.stringify(bad)}`).toThrow(ValidationError)
    }
  })

  it("rejects well-shaped but non-existent calendar dates", () => {
    expect(() => parseDateOption("2026-02-30", "--date")).toThrow(/not a real calendar date/)
    expect(() => parseDateOption("2026-13-01", "--date")).toThrow(/not a real calendar date/)
    expect(() => parseDateOption("2026-00-10", "--date")).toThrow(/not a real calendar date/)
  })

  it("rejects the hyphen year-last form, the one the server reads as MM-DD-YYYY", () => {
    // Headlined in the doc comment as the counterpart to the slash form but never
    // asserted; live probe 2026-07-20: "07-01-2026" came back as 2026-07-01.
    expect(() => parseDateOption("07-01-2026", "--start-date")).toThrow(ValidationError)
  })

  it("applies the century leap rule, not just divisible-by-four", () => {
    expect(() => parseDateOption("2100-02-29", "--date")).toThrow(/not a real calendar date/)
    expect(parseDateOption("2000-02-29", "--date")).toBe("2000-02-29")
  })

  it("does not mistake an early year for a non-existent date", () => {
    // Date.UTC(50, ...) maps to 1950, which reported a real date as fake.
    expect(parseDateOption("0050-06-15", "--date")).toBe("0050-06-15")
  })

  it("names the offending option so the user knows which flag to fix", () => {
    expect(() => parseDateOption("bad", "--end-date")).toThrow(/--end-date/)
  })
})

describe("dateArg", () => {
  it("returns a Commander-compatible parser bound to the option name", () => {
    expect(dateArg("--start-date")("2026-07-01")).toBe("2026-07-01")
    expect(() => dateArg("--start-date")("07/01/2026")).toThrow(/--start-date/)
  })
})

describe("parseDatetimeOption", () => {
  it("accepts date / datetime / timestamp shapes and returns them unchanged", () => {
    // Returned verbatim, not converted — the pass-through endpoints echo the string.
    expect(parseDatetimeOption("2026-01-07", "--start-time")).toBe("2026-01-07")
    expect(parseDatetimeOption("2026-01-07 10:30:00", "--start-time")).toBe("2026-01-07 10:30:00")
    expect(parseDatetimeOption("2026-01-07T10:30", "--start-time")).toBe("2026-01-07T10:30")
    expect(parseDatetimeOption("1751337000000", "--start-time")).toBe("1751337000000")
  })

  it("rejects the year-last forms the pass-through endpoints silently misread", () => {
    // Probed 2026-07-21 on insight research list: 07/01/2026 came back as 2026-01-07
    // (total 1562) but 07-01-2026 as 2026-07-01 (total 210) — a half-year apart,
    // both HTTP 200 with nothing flagging which the server used.
    for (const bad of ["07/01/2026", "07-01-2026", "25/12/2026", "12/25/2026", "2026/01/07", "July 1 2026", "Infinity", "1e309", "2026-13-01", "2026-02-30", "1.7512992e12", "0x174876e800", "17512992000", " 1751299200000 "]) {
      expect(() => parseDatetimeOption(bad, "--start-time"), bad).toThrow(ValidationError)
    }
  })

  it("validates fields without a local Date, so a DST-gap string is not client-timezone-dependent", () => {
    // The string is forwarded verbatim and resolved in the server's zone; a wall-clock
    // instant the client's zone happens to skip (a DST gap) must still be accepted.
    // Judged by fields only — no Date construction — so this holds in any TZ.
    expect(parseDatetimeOption("2026-03-08 02:30:00", "--start-time")).toBe("2026-03-08 02:30:00")
    expect(parseDatetimeOption("2026-10-04 02:15:00", "--start-time")).toBe("2026-10-04 02:15:00")
  })

  it("names the offending option", () => {
    expect(() => parseDatetimeOption("nope", "--end-time")).toThrow(/--end-time/)
  })
})

describe("datetimeArg", () => {
  it("returns a Commander parser bound to the option name", () => {
    expect(datetimeArg("--start-time")("2026-01-07 09:00:00")).toBe("2026-01-07 09:00:00")
    expect(() => datetimeArg("--start-time")("07/01/2026")).toThrow(/--start-time/)
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

  it("parses date-only input as local midnight, same as the datetime form", () => {
    // "2025-04-01" used to parse as UTC midnight while "2025-04-01 00:00:00" parsed
    // as local time — an 8h window shift for CST users. Both forms must agree.
    expect(toTimestamp13("2025-04-01")).toBe(toTimestamp13("2025-04-01 00:00:00"))
    expect(toTimestamp13("2025-04-01")).toBe(new Date(2025, 3, 1).getTime())
  })

  it("rejects out-of-range date-only input instead of rolling it over", () => {
    expect(toTimestamp13("2025-13-01")).toBeUndefined()
    expect(toTimestamp13("2025-02-30")).toBeUndefined()
  })

  it("rejects the year-last forms V8 reads backwards from the server", () => {
    // Probed 2026-07-20: the server reads "07/01/2026" as 2026-01-07 and accepts
    // "25/12/2026"; V8 reads the first as July 1 and rejects the second. Because
    // `announcement list` converts locally while announcement-hk passes the string
    // through, an open `new Date()` fallback made one flag mean two dates six months
    // apart across sibling commands, both exiting 0.
    for (const bad of ["07/01/2026", "07-01-2026", "25/12/2026", "12/25/2026", "20260701", "July 1 2026"]) {
      expect(toTimestamp13(bad), `should reject ${bad}`).toBeUndefined()
    }
  })

  it("still accepts the documented datetime forms", () => {
    expect(toTimestamp13("2026-07-01 10:30:00")).toBe(new Date(2026, 6, 1, 10, 30, 0).getTime())
    expect(toTimestamp13("2026-07-01T10:30:00")).toBe(new Date(2026, 6, 1, 10, 30, 0).getTime())
    expect(toTimestamp13("2026-07-01 10:30")).toBe(new Date(2026, 6, 1, 10, 30, 0).getTime())
  })

  it("rejects an out-of-range time instead of rolling it into the next hour/day", () => {
    expect(toTimestamp13("2026-07-01 10:99:00")).toBeUndefined()
    expect(toTimestamp13("2026-07-01 25:00:00")).toBeUndefined()
    expect(toTimestamp13("2026-07-01 10:30:99")).toBeUndefined()
  })

  it("rejects an early year the Date constructor would remap (new Date(50,…) → 1950)", () => {
    // getFullYear round-trip: without it, 0050-06-15 becomes 1950-06-15 and passes.
    expect(toTimestamp13("0050-06-15")).toBeUndefined()
    expect(toTimestamp13("0050-06-15 10:30:00")).toBeUndefined()
  })

  it("rejects non-finite and fractional numeric input", () => {
    // Number() leaks Infinity through the old >1e12 check; it serializes to null in
    // the body and silently drops the filter. A fractional epoch is not a timestamp.
    expect(toTimestamp13("Infinity")).toBeUndefined()
    expect(toTimestamp13("1e309")).toBeUndefined() // overflows to Infinity
    expect(toTimestamp13("1500000000000.7")).toBeUndefined()
  })

  it("normalizes a 10-digit seconds epoch to 13-digit millis", () => {
    // knowledge-batch relies on this: a seconds value must not be sent as millis
    // (1784476800 as millis is 1970, a silently wrong window).
    expect(toTimestamp13("1784476800")).toBe(1784476800000)
  })

  it("judges timestamps by digit count, not magnitude", () => {
    // 1e12 is a real 13-digit millis value — a `> 1e12` test wrongly sent it down the
    // seconds branch (×1000). And Number()-coercible shapes must NOT pass as epochs.
    expect(toTimestamp13("1000000000000")).toBe(1000000000000) // 13 digits, not ×1000
    expect(toTimestamp13("1.7512992e12")).toBeUndefined() // scientific notation
    expect(toTimestamp13("0x174876e800")).toBeUndefined() // hex
    expect(toTimestamp13(" 1751299200000 ")).toBeUndefined() // whitespace-padded
    expect(toTimestamp13("17512992000")).toBeUndefined() // 11 digits
    expect(toTimestamp13("175129920000")).toBeUndefined() // 12 digits
    expect(toTimestamp13("17512992000000")).toBeUndefined() // 14 digits
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

describe("parseIndicatorParams", () => {
  it("returns undefined when there are no specs", () => {
    expect(parseIndicatorParams([])).toBeUndefined()
  })

  it("parses a single code:key=value spec", () => {
    expect(parseIndicatorParams(["qte_close:adjustmentType=1"])).toEqual([
      { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustmentType", paramValue: "1" }] },
    ])
  })

  it("merges multiple params for the same indicator code", () => {
    expect(parseIndicatorParams(["qte_vol:currency=DFT", "qte_vol:scale=4"])).toEqual([
      {
        indicatorCode: "qte_vol",
        parameters: [
          { paramKey: "currency", paramValue: "DFT" },
          { paramKey: "scale", paramValue: "4" },
        ],
      },
    ])
  })

  it("keeps distinct codes as separate groups in first-seen order", () => {
    expect(parseIndicatorParams(["qte_close:adjustmentType=1", "qte_vol:scale=4"])).toEqual([
      { indicatorCode: "qte_close", parameters: [{ paramKey: "adjustmentType", paramValue: "1" }] },
      { indicatorCode: "qte_vol", parameters: [{ paramKey: "scale", paramValue: "4" }] },
    ])
  })

  it("throws when a spec is missing the ':' or '=' separator", () => {
    expect(() => parseIndicatorParams(["qte_close"])).toThrow(ValidationError)
    expect(() => parseIndicatorParams(["qte_close:adjustmentType"])).toThrow(ValidationError)
  })

  it("throws when the code or key is empty", () => {
    expect(() => parseIndicatorParams([":adjustmentType=1"])).toThrow(ValidationError)
    expect(() => parseIndicatorParams(["qte_close:=1"])).toThrow(ValidationError)
  })
})

describe("isVersionNewer", () => {
  it("compares numerically per segment, not as strings", () => {
    expect(isVersionNewer("0.10.0", "0.9.0")).toBe(true)
    expect(isVersionNewer("0.9.0", "0.10.0")).toBe(false)
  })

  it("is false when equal or when the registry lags behind a just-published local version", () => {
    expect(isVersionNewer("0.27.0", "0.27.0")).toBe(false)
    expect(isVersionNewer("0.26.0", "0.27.0")).toBe(false)
  })

  it("handles different segment counts and junk defensively", () => {
    expect(isVersionNewer("1.0.0.1", "1.0.0")).toBe(true)
    expect(isVersionNewer("not-a-version", "0.27.0")).toBe(false)
  })
})

describe("parseChoiceList", () => {
  it("returns undefined for an empty list (omit-for-all semantics)", () => {
    expect(parseChoiceList([], "--category", ["a", "b"])).toBeUndefined()
  })

  it("passes valid values through unchanged", () => {
    expect(parseChoiceList(["broker", "media"], "--category", ["listedCompany", "broker", "government", "media"])).toEqual(["broker", "media"])
  })

  it("throws ValidationError naming the bad value and the allowed set", () => {
    expect(() => parseChoiceList(["brokers"], "--category", ["broker", "media"])).toThrow(ValidationError)
    expect(() => parseChoiceList(["brokers"], "--category", ["broker", "media"])).toThrow(/--category.*brokers.*broker\/media/)
  })
})

describe("localDateString", () => {
  it("formats a Date as its LOCAL yyyy-MM-dd, not UTC", () => {
    // Built from local components and read back as local → deterministic regardless
    // of the machine timezone. `toISOString().slice(0,10)` renders the UTC day, which
    // for CST users flips a pre-08:00 "today" back to yesterday.
    expect(localDateString(new Date(2026, 6, 6, 3, 30))).toBe("2026-07-06")
  })

  it("zero-pads single-digit months and days", () => {
    expect(localDateString(new Date(2026, 0, 3))).toBe("2026-01-03")
  })
})
