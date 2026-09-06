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

/** The three year-first date layouts, all normalized to `YYYY-MM-DD` before the
 * request goes out. The backreference makes the separator consistent, so
 * `2026-07/01` is not a date. */
const YEAR_FIRST_DATE = /^(\d{4})([-/]?)(\d{2})\2(\d{2})$/

/** `YYYY-MM-DD` | `YYYY/MM/DD` | `YYYYMMDD` -> `YYYY-MM-DD`; anything else undefined.
 *
 * Year-FIRST only, on purpose. All three read as the same day to anyone, whichever
 * date convention they hold, so accepting them costs nothing. Year-LAST is a
 * different proposition and stays rejected — see parseDateOption.
 *
 * Normalizing rather than forwarding as typed keeps one shape on the wire: the
 * server's lenient parsing is not guaranteed uniform across endpoint groups, and
 * `YYYY-MM-DD` is the form every group is probed against. */
function normalizeYearFirstDate(value: string): string | undefined {
  const parts = YEAR_FIRST_DATE.exec(value)
  return parts ? `${parts[1]}-${parts[3]}-${parts[4]}` : undefined
}

/**
 * Year-first date guard for Quote/Fundamental date options. Accepts the three
 * year-first layouts and normalizes them to `YYYY-MM-DD`; rejects year-last.
 *
 * The server parses year-last layouts too, and reads them month-first — the US
 * convention (re-probed 2026-08-17):
 *
 *   "01-07-2026" / "01/07/2026" -> 2026-01-07
 *   "07-01-2026" / "07/01/2026" -> 2026-07-01
 *
 * That is a platform convention, not a defect: both separators agree (an earlier
 * build read slash as DD/MM and hyphen as MM-DD — fixed 2026-08-15, `bug/closed.md`
 * P0-3), and it is documented in README + SKILL.md.
 *
 * The CLI still refuses year-last, and the asymmetry with year-first is the whole
 * point: `2026/07/01` means one day to every reader, while `01-07-2026` means
 * 7 January to an American and 1 July to a European. Forwarding it would hand
 * half of them data six months off with HTTP 200 and a plausible row count —
 * the CLI cannot know which reading was meant. Failing here also beats a round
 * trip: no request, no billing, and the message names the form that works.
 *
 * Datetime options (`--start-time`) are guarded separately but follow the same
 * rule: pass-through ones by `parseDatetimeOption`, and the two conversion
 * endpoints (A-share announcement / knowledge-batch) by `parseTimestamp13`.
 */
export function parseDateOption(value: string, optionName: string): string {
  const normalized = normalizeYearFirstDate(value)
  if (normalized === undefined) {
    throw new ValidationError(`Invalid ${optionName}: expected YYYY-MM-DD (YYYY/MM/DD and YYYYMMDD also accepted), got "${value}" — year-last layouts are refused because the API reads them month-first (US convention): "01-07-2026" means 7 January, not 1 July`)
  }
  // Shape alone lets 2026-02-30 / 2026-13-01 through; round-trip to reject those.
  // Built from the ISO string, not Date.UTC(y,...), whose two-digit-year mapping
  // would turn a valid year 0050 into 1950 and report it as a non-existent date.
  const [year, month, day] = normalized.split("-").map(Number)
  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ValidationError(`Invalid ${optionName}: "${value}" is not a real calendar date`)
  }
  return normalized
}

/** Commander argParser factory — `.option("--start-date <date>", desc, dateArg("--start-date"))`. */
export function dateArg(optionName: string): (value: string) => string {
  return (value: string) => parseDateOption(value, optionName)
}

/** A year-first date (any of the three layouts, separator consistent via the
 * backreference) with an optional ` HH:mm[:ss]` / `THH:mm[:ss]` tail. Anything
 * else is rejected rather than handed to `new Date()`: V8's fallback parser
 * accepts the year-last shapes the server does but reads them the OTHER way round
 * — `07/01/2026` is July 1 to V8 and January 7 to the server, `25/12/2026` is
 * invalid to V8 and valid to the server (both probed 2026-07-20). Since
 * `announcement list` converts locally while its HK/US siblings pass the string
 * through, an open fallback made the same flag mean two dates six months apart
 * across sibling commands, silently and with exit 0.
 *
 * Groups: 1=year 2=separator 3=month 4=day 5=hour 6=minute 7=second. */
const LOCAL_DATETIME = /^(\d{4})([-/]?)(\d{2})\2(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Rewrite the date part of an already-validated datetime to `YYYY-MM-DD`, leaving
 * the time part and its separator untouched. Pass-through endpoints echo whatever
 * we send, so they should see the one canonical layout. */
function normalizeDatetime(value: string): string {
  const parts = LOCAL_DATETIME.exec(value)
  if (!parts) return value
  const [, y, sep, mo, d] = parts
  return sep === "" ? `${y}-${mo}-${d}${value.slice(8)}` : `${y}-${mo}-${d}${value.slice(10)}`
}

/** Field-level datetime validation, timezone-free — a real calendar day plus a
 * valid clock time, judged by arithmetic alone (no Date construction, so no
 * dependence on the client's timezone or DST). This is what the pass-through guard
 * needs: a string the CLI forwards verbatim must be judged on its fields, not on
 * whether the local zone happens to contain that wall-clock instant. */
function datetimeFieldsValid(value: string): boolean {
  const parts = LOCAL_DATETIME.exec(value)
  if (!parts) return false
  const [, y, , mo, d, hh = "0", mi = "0", ss = "0"] = parts
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

/** Beijing time (UTC+8) as an offset suffix. The two endpoints that take epoch millis
 * (A-share announcement, knowledge-batch) define their windows in Beijing time, like
 * every date the API reads; anchoring the wall-clock input there — not to the machine's
 * zone — makes "2026-08-01" the same instant on a UTC sandbox and a CST laptop. */
const BEIJING_OFFSET = "+08:00"

export function toTimestamp13(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const ts = epochMillis(value)
  if (ts !== undefined) return ts
  if (!datetimeFieldsValid(value)) return undefined
  const parts = LOCAL_DATETIME.exec(value)!
  const [, y, , mo, d, hh = "00", mi = "00", ss = "00"] = parts
  // Built from an ISO string with an explicit offset, not Date.UTC(y, …) − 8h: the
  // numeric constructor remaps years 0–99 (50 → 1950), the string form does not. The
  // fields were already validated (real calendar day, valid clock time) so nothing can
  // roll over here, and with a fixed offset there is no DST gap to reject.
  const instant = new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}${BEIJING_OFFSET}`).getTime()
  return Number.isNaN(instant) ? undefined : instant
}

export function parseTimestamp13(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = toTimestamp13(value)
  if (parsed === undefined) {
    throw new ValidationError(`Invalid ${optionName}: expected a Unix timestamp or "YYYY-MM-DD" optionally with " HH:mm[:ss]" (space or T separator; YYYY/MM/DD and YYYYMMDD also accepted), got "${value}" — year-last layouts are refused because the API reads them month-first (US convention): "01-07-2026" means 7 January, not 1 July`)
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
 * Validated with `datetimeFieldsValid`: field arithmetic only, no Date construction —
 * the CLI forwards this string and the server resolves it in its own zone, so nothing
 * about the client machine may decide validity. Distinct from `parseTimestamp13`,
 * which DOES convert (A-share announcement / knowledge-batch want epoch millis) and
 * anchors the wall-clock input to Beijing time.
 *
 * Epochs pass through untouched; a datetime has only its DATE part rewritten to
 * `YYYY-MM-DD` (so `2026/07/01 09:30` goes out as `2026-07-01 09:30`). The time
 * part is never reformatted — the endpoints echo it verbatim and accept both the
 * space and `T` separators.
 */
export function parseDatetimeOption(value: string, optionName: string): string {
  if (epochMillis(value) !== undefined) return value
  if (!datetimeFieldsValid(value)) {
    throw new ValidationError(`Invalid ${optionName}: expected a Unix timestamp or "YYYY-MM-DD" optionally with " HH:mm[:ss]" (space or T separator; YYYY/MM/DD and YYYYMMDD also accepted), got "${value}" — year-last layouts are refused because the API reads them month-first (US convention): "01-07-2026" means 7 January, not 1 July`)
  }
  return normalizeDatetime(value)
}

/** Commander argParser factory for pass-through datetime options — same role as
 * `dateArg`, but allows an optional time part and keeps the string as-is. */
export function datetimeArg(optionName: string): (value: string) => string {
  return (value: string) => parseDatetimeOption(value, optionName)
}

/** Machine-local calendar date as `yyyy-MM-dd`, for CLI "default: today" options.
 * `new Date().toISOString().slice(0,10)` renders the UTC day — for CST users a
 * pre-08:00 "today" resolves to yesterday, so the machine's own calendar day is used.
 * (toTimestamp13 is different: it converts an explicit input, and anchors it to
 * Beijing time regardless of the machine.) */
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
  /** Set by the bare `"code:"` spec — "this indicator takes no query date".
   * A parse-time marker, stripped before the body is built; never sent. */
  noQueryDate?: true
}

export interface ScreenerIndicator {
  field: string
  indicatorCode: string
  parameters: IndicatorParam[]
  /** Set by the bare `"F1:"` spec — "this indicator takes no query date".
   * A parse-time marker, stripped before the body is built; never sent. */
  noQueryDate?: true
}

// Parse repeatable `"<lhs>:key=value"` specs into per-lhs parameter lists.
// The left-hand side is an indicator code for cross-section / time-series and a
// screener variable (F1, F2…) for the screener, so it stays an opaque string
// here. Multiple specs for the same lhs accumulate, first-seen order.
function parseParamSpecs(specs: string[], option: string, syntax: string): { groups: Map<string, IndicatorParam[]>; noQueryDate: Set<string> } {
  const groups = new Map<string, IndicatorParam[]>()
  const noQueryDate = new Set<string>()
  for (const spec of specs) {
    const colon = spec.indexOf(":")
    const rest = colon === -1 ? "" : spec.slice(colon + 1)
    const eq = rest.indexOf("=")
    const lhs = colon === -1 ? "" : spec.slice(0, colon).trim()
    const paramKey = eq === -1 ? "" : rest.slice(0, eq).trim()
    const paramValue = eq === -1 ? "" : rest.slice(eq + 1).trim()
    // Bare `"<lhs>:"` — "this indicator takes no query date, do not inject one".
    // Needed by every indicator whose parameterList has neither tradeDate nor any
    // other date key: the `pty_*` / `scr_*` static-attribute families, plus
    // div_cash_paid_ratio / div_cash_yr (fiscalYear) and pty_shr_reg (currency/scale).
    // See the DATE_PARAM_KEYS comment in commandBodies.ts for the full rule and the
    // command that regenerates the list. The fetch endpoints reject the WHOLE request
    // over a stray tradeDate and `--date` is required, so these were unreachable from
    // cross-section and screener — with no fallback at all on the screener, since
    // `indicator time-series` cannot filter.
    //
    // A flag rather than "an empty parameters array" so it composes with real
    // params: the fiscalYear pair needs `"code:"` AND `"code:fiscalYear=2025"`.
    // Opt-in on purpose: this spelling used to be a ValidationError, so no existing
    // invocation changes behaviour. NOT a blanket `fiscalYear` entry in
    // DATE_PARAM_KEYS — that would regress the five `frcst_*` indicators, which
    // require tradeDate AND fiscalYear together (see commandBodies.ts).
    if (rest.trim() === "") {
      if (!lhs) throw new ValidationError(`Invalid ${option}: expected "${syntax}", got "${spec}"`)
      noQueryDate.add(lhs)
      if (!groups.has(lhs)) groups.set(lhs, [])
      continue
    }
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
  return { groups, noQueryDate }
}

// Parse repeatable `--indicator-param "code:key=value"` specs into the nested
// indicatorParamList the EDE cross-section / time-series endpoints expect.
export function parseIndicatorParams(specs: string[]): IndicatorParamGroup[] | undefined {
  if (specs.length === 0) return undefined
  const { groups, noQueryDate } = parseParamSpecs(specs, "--indicator-param", "code:key=value")
  return [...groups].map(([indicatorCode, parameters]) => (noQueryDate.has(indicatorCode)
    ? { indicatorCode, parameters, noQueryDate: true as const }
    : { indicatorCode, parameters }))
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

/** Split an expression into `(`, `)`, `&&`, `||` and the atoms between them.
 * String literals are copied verbatim so a `||` or an `F2` inside one is never
 * mistaken for syntax. */
function tokenizeScreenerExpression(src: string): string[] {
  const tokens: string[] = []
  let atom = ""
  const flush = () => {
    if (atom.trim()) tokens.push(atom)
    atom = ""
  }
  for (let i = 0; i < src.length;) {
    const ch = src[i]
    if (ch === "'" || ch === '"') {
      const close = src.indexOf(ch, i + 1)
      const stop = close === -1 ? src.length : close + 1
      atom += src.slice(i, stop)
      i = stop
    } else if (src.startsWith("&&", i) || src.startsWith("||", i)) {
      flush()
      tokens.push(src.slice(i, i + 2))
      i += 2
    } else if (ch === "(" || ch === ")") {
      flush()
      tokens.push(ch)
      i += 1
    } else {
      atom += ch
      i += 1
    }
  }
  flush()
  return tokens
}

/** Whether the expression still has a path that could have been evaluated, given
 * the variables the response actually returned a column for.
 *
 * The boolean structure decides, not the mere presence of a `||`:
 *   - a term is evaluable when every variable it names has a column;
 *   - `A && B` needs BOTH sides — a missing mandatory conjunct is an unprovable
 *     claim even if the other side is a disjunction;
 *   - `A || B` needs only one — a row can legitimately match through one operand
 *     while the other is not evaluable at all (probed 2026-08-03: `F1 > 0 || F2
 *     > 0` over 09992.HK, where `finc_pe_ttm` has no HK coverage, matches on F2).
 *
 * So `F1 && (F2 || F3)` missing F1, and `F1 || F2` missing both, are both
 * unevaluable and must fail — checking only for a `||` anywhere would let them
 * through. */
export function screenerExpressionIsEvaluable(expression: string | undefined, present: Set<string>): boolean {
  const tokens = tokenizeScreenerExpression(expression ?? "")
  let pos = 0
  const unit = (): boolean => {
    if (tokens[pos] === "(") {
      pos += 1
      const value = or()
      if (tokens[pos] === ")") pos += 1
      return value
    }
    const atom = tokens[pos++] ?? ""
    // A term naming no variable (a literal comparison) is always evaluable.
    return (atom.replace(SCREENER_STRING_LITERAL, "").match(SCREENER_FIELD_REF) ?? []).every((ref) => present.has(ref))
  }
  const and = (): boolean => {
    let value = unit()
    // Evaluate both sides before combining: short-circuiting would leave the
    // parser mid-expression.
    while (tokens[pos] === "&&") {
      pos += 1
      const right = unit()
      value = value && right
    }
    return value
  }
  const or = (): boolean => {
    let value = and()
    while (tokens[pos] === "||") {
      pos += 1
      const right = and()
      value = value || right
    }
    return value
  }
  return or()
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
  const { groups: params, noQueryDate } = parseParamSpecs(paramSpecs, "--indicator-param", "F1:key=value")
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
    indicators.set(field, noQueryDate.has(field)
      ? { field, indicatorCode, parameters: params.get(field) ?? [], noQueryDate: true }
      : { field, indicatorCode, parameters: params.get(field) ?? [] })
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
