import { ValidationError } from "./errors.js"

interface NumberOptionConfig {
  integer?: boolean
  min?: number
  max?: number
}

export function splitCsv(value: string): string[] {
  // Also split on full-width "，": voice-input IMEs produce it, and an unsplit
  // "600519，000858" goes to the API as one bogus code with no local hint.
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, ...splitCsv(value)]
}

export function parseNumberOption(value: string | number | undefined, optionName: string, config: NumberOptionConfig = {}): number {
  if (value === undefined || String(value).trim() === "") {
    throw new ValidationError(`Invalid ${optionName}: expected a number`)
  }

  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Invalid ${optionName}: expected a finite number`)
  }
  if (config.integer && !Number.isInteger(parsed)) {
    throw new ValidationError(`Invalid ${optionName}: expected an integer`)
  }
  if (config.min !== undefined && parsed < config.min) {
    throw new ValidationError(`Invalid ${optionName}: expected a number >= ${config.min}`)
  }
  if (config.max !== undefined && parsed > config.max) {
    throw new ValidationError(`Invalid ${optionName}: expected a number <= ${config.max}`)
  }

  return parsed
}

export function parseOptionalNumberOption(value: string | number | undefined, optionName: string, config: NumberOptionConfig = {}): number | undefined {
  return value === undefined ? undefined : parseNumberOption(value, optionName, config)
}

export function parseFrom(value: string | number | undefined): number {
  return parseNumberOption(value ?? "0", "--from", { integer: true, min: 0 })
}

export function parseSize(value: string | number | undefined): number | undefined {
  return parseOptionalNumberOption(value, "--size", { integer: true, min: 1 })
}

export function collectNumberList(value: string, previous: number[] = []): number[] {
  return [
    ...previous,
    ...splitCsv(value).map((item) => parseNumberOption(item, "number list item")),
  ]
}

export function collectKeyValue(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const index = value.indexOf("=")
  if (index === -1) {
    throw new ValidationError(`Invalid key=value pair: ${value}`)
  }

  const key = value.slice(0, index).trim()
  const rawValue = value.slice(index + 1).trim()

  if (!key) {
    throw new ValidationError(`Invalid key=value pair: ${value}`)
  }

  return {
    ...previous,
    [key]: rawValue,
  }
}

export function maybeArray<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined
}

/** True when `latest` is strictly newer than `current` (numeric per-segment
 * compare). Plain inequality would nag "update available" during the
 * just-published window while the registry still serves the previous version. */
export function isVersionNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number)
  const a = parse(latest)
  const b = parse(current)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

// Whitelist for enum-valued repeatable options. Only used where the server was
// probed NOT to reject bad values (it silently ignores the filter or returns
// empty instead) — endpoints that answer 100003 keep server-side validation.
export function parseChoiceList(values: string[], optionName: string, allowed: readonly string[]): string[] | undefined {
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new ValidationError(`Invalid ${optionName}: "${value}" is not one of ${allowed.join("/")}`)
    }
  }
  return maybeArray(values)
}

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Strict `YYYY-MM-DD` guard for Quote/Fundamental date options.
 *
 * Beyond the documented shape the server accepts two extra year-last formats
 * whose day/month order is *opposite* to each other (probed 2026-07-20 on
 * quote/kline/daily and fundamental/balance-sheet; other groups sharing these
 * flags were not probed, so the guard is applied uniformly as the safe default):
 *
 *   "07/01/2026" -> 2026-01-07   slash  reads DD/MM/YYYY
 *   "07-01-2026" -> 2026-07-01   hyphen reads MM-DD-YYYY
 *
 * Same three digits, six months apart, both HTTP 200, and nothing in the
 * response echoes which date the server actually used. Confirmed by the
 * complement: "25/12/2026" parses while "12/25/2026" errors, and the hyphen
 * forms behave exactly the other way round. Since the CLI cannot know which
 * reading was meant, it forwards only the unambiguous form.
 *
 * Other unambiguous shapes (`20260701`, `2026/07/01`) are rejected too, even
 * though the server handles them — one accepted form beats a per-shape allowlist
 * that has to be re-probed per endpoint group. The message says which form is
 * wanted rather than claiming the input itself was ambiguous.
 *
 * Datetime options (`--start-time`) are guarded separately: pass-through ones by
 * `parseDatetimeOption` (a timezone-free field check that returns the string as-is),
 * and the two conversion endpoints (A-share announcement / knowledge-batch) by
 * `parseTimestamp13`.
 */
export function parseDateOption(value: string, optionName: string): string {
  if (!YYYY_MM_DD.test(value)) {
    throw new ValidationError(`Invalid ${optionName}: expected YYYY-MM-DD, got "${value}" — only that form is forwarded; some endpoints silently misread other layouts (e.g. "07/01/2026") as a different day`)
  }
  // Shape alone lets 2026-02-30 / 2026-13-01 through; round-trip to reject those.
  // Built from the ISO string, not Date.UTC(y,...), whose two-digit-year mapping
  // would turn a valid year 0050 into 1950 and report it as a non-existent date.
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ValidationError(`Invalid ${optionName}: "${value}" is not a real calendar date`)
  }
  return value
}

/** Commander argParser factory — `.option("--start-date <date>", desc, dateArg("--start-date"))`. */
export function dateArg(optionName: string): (value: string) => string {
  return (value: string) => parseDateOption(value, optionName)
}

/** `yyyy-MM-dd` with an optional ` HH:mm[:ss]` / `THH:mm[:ss]` tail. Anything else
 * is rejected rather than handed to `new Date()`: V8's fallback parser accepts the
 * same year-last shapes the server does but reads them the OTHER way round —
 * `07/01/2026` is July 1 to V8 and January 7 to the server, `25/12/2026` is invalid
 * to V8 and valid to the server (both probed 2026-07-20). Since `announcement list`
 * converts locally while its HK/US siblings pass the string through, an open
 * fallback made the same flag mean two dates six months apart across sibling
 * commands, silently and with exit 0. */
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Field-level datetime validation, timezone-free — a real calendar day plus a
 * valid clock time, judged by arithmetic alone (no Date construction, so no
 * dependence on the client's timezone or DST). This is what the pass-through guard
 * needs: a string the CLI forwards verbatim must be judged on its fields, not on
 * whether the local zone happens to contain that wall-clock instant. */
function datetimeFieldsValid(value: string): boolean {
  const parts = LOCAL_DATETIME.exec(value)
  if (!parts) return false
  const [, y, mo, d, hh = "0", mi = "0", ss = "0"] = parts
  const year = Number(y), month = Number(mo), day = Number(d)
  if (month < 1 || month > 12) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (day < 1 || day > dim) return false
  return Number(hh) <= 23 && Number(mi) <= 59 && Number(ss) <= 59
}

/** A 10-digit seconds or 13-digit millis epoch, normalized to millis. Judged by
 * digit count, NOT magnitude: a `> 1e12` test sends a real 13-digit `1000000000000`
 * (which equals 1e12) down the seconds branch, and lets Number() coerce scientific
 * / hex / whitespace-padded / 11–12–14-digit inputs through as a "timestamp" — all
 * of which then convert wrong or get rejected by the server. Exactly 10 or 13
 * digits, nothing else. */
function epochMillis(value: string): number | undefined {
  if (/^\d{13}$/.test(value)) return Number(value)
  if (/^\d{10}$/.test(value)) return Number(value) * 1000
  return undefined
}

export function toTimestamp13(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const ts = epochMillis(value)
  if (ts !== undefined) return ts
  if (!datetimeFieldsValid(value)) return undefined
  // `new Date("yyyy-MM-dd")` parses as UTC midnight while `new Date("yyyy-MM-dd
  // HH:mm:ss")` parses as local time — for CST users the two forms would differ by 8
  // hours. Build from local components so both mean the same wall-clock day.
  const parts = LOCAL_DATETIME.exec(value)!
  const [, y, mo, d, hh = "0", mi = "0", ss = "0"] = parts
  const year = Number(y)
  const dt = new Date(year, Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss))
  // Full round-trip on every field: rejects the two inputs that cannot convert
  // faithfully — the two-digit-year remap (new Date(50,…) → 1950) and a DST gap (a
  // wall-clock time the local zone skips: 02:30 on a US spring-forward morning, or
  // 02:15 in Lord Howe's 30-minute gap, which only a minute-level check catches).
  const faithful = dt.getFullYear() === year && dt.getMonth() === Number(mo) - 1
    && dt.getDate() === Number(d) && dt.getHours() === Number(hh)
    && dt.getMinutes() === Number(mi) && dt.getSeconds() === Number(ss)
  return faithful ? dt.getTime() : undefined
}

export function parseTimestamp13(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = toTimestamp13(value)
  if (parsed === undefined) {
    throw new ValidationError(`Invalid ${optionName}: expected a Unix timestamp or "YYYY-MM-DD" optionally with " HH:mm[:ss]" (space or T separator), got "${value}" — year-last forms are refused because Node and the API read their day/month order the opposite way round`)
  }
  return parsed
}

/**
 * Guard for datetime options forwarded to the server AS A STRING (never converted
 * to a timestamp): the pass-through Insight/Vault list endpoints echo the string
 * verbatim, and probing 2026-07-21 showed they misread year-last separators exactly
 * like the date endpoints — `insight research list` read `07/01/2026` as 2026-01-07
 * but `07-01-2026` as 2026-07-01, a half-year apart, both HTTP 200 with nothing in
 * the response flagging it. Accept a finite epoch or a well-formed `YYYY-MM-DD
 * [ HH:mm[:ss]]` and return the ORIGINAL string unchanged.
 *
 * Validated with `datetimeFieldsValid`, NOT `toTimestamp13`: the latter's local Date
 * round-trip would reject a DST-gap string (e.g. `2026-03-08 02:30:00` under
 * America/New_York) that the server accepts — the CLI forwards this string as-is and
 * the server resolves it in its own zone, so the client's timezone must not decide
 * validity. Distinct from `parseTimestamp13`, which DOES convert (A-share
 * announcement / knowledge-batch want epoch millis, where an unrepresentable local
 * instant genuinely cannot convert).
 */
export function parseDatetimeOption(value: string, optionName: string): string {
  if (epochMillis(value) === undefined && !datetimeFieldsValid(value)) {
    throw new ValidationError(`Invalid ${optionName}: expected a Unix timestamp or "YYYY-MM-DD" optionally with " HH:mm[:ss]" (space or T separator), got "${value}" — year-last forms are refused because the API reads their day/month order differently per separator`)
  }
  return value
}

/** Commander argParser factory for pass-through datetime options — same role as
 * `dateArg`, but allows an optional time part and keeps the string as-is. */
export function datetimeArg(optionName: string): (value: string) => string {
  return (value: string) => parseDatetimeOption(value, optionName)
}

/** Machine-local calendar date as `yyyy-MM-dd`, for CLI "default: today" options.
 * `new Date().toISOString().slice(0,10)` renders the UTC day — for CST users a
 * pre-08:00 "today" resolves to yesterday. Anchoring to local components matches
 * toTimestamp13's local-midnight convention. */
export function localDateString(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
}

export interface IndicatorParam {
  paramKey: string
  paramValue: string
}

export interface IndicatorParamGroup {
  indicatorCode: string
  parameters: IndicatorParam[]
}

export interface ScreenerIndicator {
  field: string
  indicatorCode: string
  parameters: IndicatorParam[]
}

// Parse repeatable `"<lhs>:key=value"` specs into per-lhs parameter lists.
// The left-hand side is an indicator code for cross-section / time-series and a
// screener variable (F1, F2…) for the screener, so it stays an opaque string
// here. Multiple specs for the same lhs accumulate, first-seen order.
function parseParamSpecs(specs: string[], option: string, syntax: string): Map<string, IndicatorParam[]> {
  const groups = new Map<string, IndicatorParam[]>()
  for (const spec of specs) {
    const colon = spec.indexOf(":")
    const rest = colon === -1 ? "" : spec.slice(colon + 1)
    const eq = rest.indexOf("=")
    const lhs = colon === -1 ? "" : spec.slice(0, colon).trim()
    const paramKey = eq === -1 ? "" : rest.slice(0, eq).trim()
    const paramValue = eq === -1 ? "" : rest.slice(eq + 1).trim()
    if (!lhs || !paramKey) {
      throw new ValidationError(`Invalid ${option}: expected "${syntax}", got "${spec}"`)
    }
    let params = groups.get(lhs)
    if (!params) {
      params = []
      groups.set(lhs, params)
    }
    params.push({ paramKey, paramValue })
  }
  return groups
}

// Parse repeatable `--indicator-param "code:key=value"` specs into the nested
// indicatorParamList the EDE cross-section / time-series endpoints expect.
export function parseIndicatorParams(specs: string[]): IndicatorParamGroup[] | undefined {
  if (specs.length === 0) return undefined
  return [...parseParamSpecs(specs, "--indicator-param", "code:key=value")].map(([indicatorCode, parameters]) => ({ indicatorCode, parameters }))
}

/** Screener variables are `F` + a positive integer; the server rejects anything
 * else, and a typo'd variable would otherwise surface as an opaque expression
 * error rather than pointing at the binding that is wrong. */
const SCREENER_FIELD = /^F[1-9][0-9]*$/

/** Variable references inside a screener expression, e.g. the F1/F2 in
 * `F1 >= 800 && F2 <= 30`. String literals are stripped first, so a
 * `contains 'F2 系列'` operand is not mistaken for a reference. */
const SCREENER_FIELD_REF = /\bF[1-9][0-9]*\b/g
const SCREENER_STRING_LITERAL = /'[^']*'|"[^"]*"/g

/** True when the expression is a pure conjunction — no `||` outside string
 * literals. It decides how hard a missing column is treated: under `&&` every
 * referenced variable must have contributed to every matched row, so a vanished
 * column means that condition cannot be shown to have been applied. Under `||` a
 * row can legitimately satisfy the expression while another operand is not
 * evaluable at all (`F1 > 0 || F2 > 0` over a HK security where `finc_pe_ttm`
 * has no coverage), so the same absence proves nothing wrong. */
export function screenerExpressionIsConjunctive(expression: string | undefined): boolean {
  return !(expression ?? "").replace(SCREENER_STRING_LITERAL, "").includes("||")
}

/** Variables the expression actually filters on, string literals stripped. These
 * are the bindings whose VALUES the result depends on — a column missing for one
 * of them means the filter cannot be shown to have been applied. */
export function screenerExpressionFields(expression: string | undefined): string[] {
  return (expression ?? "").replace(SCREENER_STRING_LITERAL, "").match(SCREENER_FIELD_REF) ?? []
}

// Parse the screener's `--indicator "F1:code"` bindings and merge each one's
// `--indicator-param "F1:key=value"` specs. Params key off the variable, not the
// code, because the same indicator may legitimately appear under two variables
// with different parameters (e.g. the same price on two dates).
export function parseScreenerIndicators(bindings: string[], paramSpecs: string[], expression?: string): ScreenerIndicator[] {
  const params = parseParamSpecs(paramSpecs, "--indicator-param", "F1:key=value")
  const indicators = new Map<string, ScreenerIndicator>()
  for (const spec of bindings) {
    const colon = spec.indexOf(":")
    const field = colon === -1 ? "" : spec.slice(0, colon).trim()
    const indicatorCode = colon === -1 ? "" : spec.slice(colon + 1).trim()
    if (!field || !indicatorCode) {
      throw new ValidationError(`Invalid --indicator: expected "F1:code", got "${spec}"`)
    }
    if (!SCREENER_FIELD.test(field)) {
      throw new ValidationError(`Invalid --indicator variable "${field}": expected F followed by a positive integer, e.g. F1`)
    }
    if (indicators.has(field)) {
      throw new ValidationError(`Duplicate --indicator variable "${field}": each variable must bind exactly one indicator`)
    }
    indicators.set(field, { field, indicatorCode, parameters: params.get(field) ?? [] })
  }
  // A param for an unbound variable is silently dropped by the server, so the
  // query would run with a filter the caller believes is applied but is not.
  for (const field of params.keys()) {
    if (!indicators.has(field)) {
      throw new ValidationError(`--indicator-param references "${field}", which no --indicator binds`)
    }
  }
  // The server does reject this (100003), but only after a round trip — and the
  // symmetric mistake (binding a variable the expression never uses) it accepts
  // silently while still billing the extra column.
  for (const ref of screenerExpressionFields(expression)) {
    if (!indicators.has(ref)) {
      throw new ValidationError(`--expression references "${ref}", which no --indicator binds`)
    }
  }
  return [...indicators.values()]
}

/** Indicator codes bound to more than one screener variable, in first-seen
 * order. The API is specified to allow this (one code under two variables with
 * different parameters), but the server currently mis-resolves it — probed
 * 2026-08-03: ALL such bindings are answered from the EARLIEST date among them,
 * that one value lands in the first of their columns, and the rest come back
 * null. The surviving number therefore need not belong to the variable it is
 * labelled with, so it is not merely "one column is missing": the values shown
 * and the set of matched securities are both untrustworthy. (The same request
 * also returns an empty set roughly a third of the time.)
 *
 * Callers warn rather than reject: the capability is intended and a server-side
 * fix is in flight, so a hard block here would have to be reverted. */
export function duplicateScreenerCodes(indicators: ScreenerIndicator[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const { indicatorCode } of indicators) {
    if (seen.has(indicatorCode)) duplicated.add(indicatorCode)
    seen.add(indicatorCode)
  }
  return [...duplicated]
}
