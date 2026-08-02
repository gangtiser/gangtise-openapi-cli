import { ApiError } from "./errors.js"

// The EDE cross-section / time-series endpoints return a `values` matrix plus
// parallel code/name/date lists rather than ready-made rows. These helpers
// flatten that matrix into the wide tabular shape the rest of the pipeline
// (printData → renderOutput) expects: { list, total }.

// Shapes below match the EDE response as of the 2026-08-01 API revision, which
// replaced the parallel indicatorCodeList / indicatorNameList arrays with a
// single structured `indicatorList`, and TRANSPOSED the cross-section matrix.
// `values` is now [security][indicator] for cross-section and the screener, and
// stays [series][date] for time-series.
interface IndicatorMeta {
  /** Screener only: the F1/F2… variable this column was requested under. */
  field?: unknown
  code?: unknown
  name?: unknown
  dataType?: unknown
}

interface MatrixData {
  dates?: unknown
  securityCodeList?: unknown
  securityNameList?: unknown
  indicatorList?: unknown
  values?: unknown
}

// The EDE endpoints double-wrap on success: the shared client strips the outer
// envelope but leaves an inner { code, status, data } around the real payload.
// Peel that inner envelope so the list (search) / matrix (cross-section,
// time-series) is reachable. A failure code carried only by the inner envelope
// must still surface instead of rendering its null payload as success.
export function unwrapIndicatorData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if ("code" in record || "status" in record) {
      const code = record.code === undefined ? undefined : String(record.code)
      const ok = record.status === true || code === "000000" || code === "0"
      // A failure envelope may omit `data` entirely ({ code, status: false, msg })
      // — gating on the data key would let a permission/quota error flow through
      // as "successful" payload. Still require some envelope evidence
      // (status/msg/data) so a non-envelope object that merely carries a `code`
      // field can't be misread as a failure.
      if (!ok && ("status" in record || "msg" in record || "data" in record)) {
        // Pass `record` as details: the inner envelope carries no traceId of its
        // own, but unwrapEnvelope attached the outer one to this object and
        // ApiError.traceId falls back to it. Without it these failures — the EDE
        // 999999 / 130001 that most need reporting — reach the user trace-less.
        throw new ApiError(typeof record.msg === "string" && record.msg ? record.msg : "Indicator API request failed", code, undefined, record)
      }
      if (ok && "data" in record) return record.data
    }
  }
  return raw
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined
}

function asIndicatorMetaList(value: unknown): IndicatorMeta[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as IndicatorMeta) : {}))
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value)
}

function rowOf(values: unknown, index: number): unknown[] | undefined {
  const row = (values as unknown[])[index]
  return Array.isArray(row) ? row : undefined
}

// Build one column header per series. Prefer the human-readable name; on a
// duplicate name append a disambiguator so a column is never silently
// overwritten. `reserved` pre-seeds the metadata column names, so a series
// literally named "date" / "security" / "name" gets suffixed rather than
// clobbering the metadata.
function buildHeaders(bases: (string | undefined)[], suffixes: (string | undefined)[], reserved: string[]): string[] {
  const used = new Set<string>(reserved)
  const headers: string[] = []
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i] ?? suffixes[i] ?? `col${i}`
    let header = base
    let attempt = 1
    while (used.has(header)) {
      const suffix = suffixes[i] ?? i
      header = attempt === 1 ? `${base} (${suffix})` : `${base} (${suffix})_${attempt}`
      attempt++
    }
    used.add(header)
    headers.push(header)
  }
  return headers
}

// Column headers for a list of indicator metadata. keyBy "code" makes each
// column its `code` (unique, and independent of the display name or the
// server's column order) instead of the human name — required for batch
// code→value mapping, where names collide (many indicators share a display
// name) and the server reorders columns relative to the request. The screener
// disambiguates by `field` instead, because there the SAME code may legitimately
// appear twice under two variables with different parameters.
function indicatorHeaders(indicators: IndicatorMeta[], keyBy: "name" | "code", reserved: string[]): string[] {
  const codes = indicators.map((meta) => optionalString(meta.code))
  const fields = indicators.map((meta, i) => optionalString(meta.field) ?? codes[i])
  const bases = keyBy === "code" ? codes : indicators.map((meta) => optionalString(meta.name))
  // On a screener payload every column carries its variable, so a repeated base
  // can suffix ALL of its occurrences instead of leaving the first one bare.
  // A bare `收盘价` next to `收盘价 (F2)` reads as "the" close price when it is
  // really just whichever variable the server happened to list first.
  const screener = indicators.some((meta) => meta.field !== undefined)
  if (!screener) return buildHeaders(bases, fields, reserved)
  const repeated = new Set(bases.filter((base, i) => base !== undefined && bases.indexOf(base) !== i))
  return buildHeaders(bases.map((base, i) => (base !== undefined && repeated.has(base) ? `${base} (${fields[i] ?? i})` : base)), fields, reserved)
}

const CROSS_SECTION_COLUMNS = ["security", "name"]

/** What the caller asked for that the response does not contain. The server
 * does NOT pad missing data with `null`: an indicator that is empty for every
 * security disappears from `indicatorList`, and a security that is empty for
 * every indicator disappears from `securityCodeList` (probed 2026-08-02 — three
 * indicators over 09992.HK came back with one, two securities over
 * `qte_mkt_cptl` came back with one). Only partial gaps become `null`.
 *
 * That is the dangerous shape: `--key-by code` batch mapping finds no key at
 * all rather than a null, and a cross-market pull quietly returns fewer rows
 * than requested with exit code 0.
 *
 * Universe entries with no `.` are skipped — those are sector IDs, which the
 * server expands into constituents, so their absence from the response is
 * expected rather than a dropped row. */
/** A response carrying neither securities nor indicators: the query as a whole
 * resolved to nothing. This is NOT a dropped axis — nothing was left out, there
 * simply is no data (a non-trading range, a date outside coverage), so it must
 * not be reported as partial. Calling every requested code "omitted" here would
 * be false metadata: the diff against the request is total by construction. */
export function isEmptyMatrix(data: unknown): boolean {
  if (!data || typeof data !== "object") return false
  const d = data as MatrixData
  return asStringArray(d.securityCodeList)?.length === 0 && asIndicatorMetaList(d.indicatorList)?.length === 0
}

export function droppedFromMatrix(data: unknown, requestedSecurities: string[], requestedIndicators: string[]): { securities: string[]; indicators: string[] } {
  const empty = { securities: [], indicators: [] }
  if (!data || typeof data !== "object") return empty
  const d = data as MatrixData
  const returnedSecurities = new Set(asStringArray(d.securityCodeList) ?? [])
  const returnedIndicators = new Set((asIndicatorMetaList(d.indicatorList) ?? []).map((meta) => optionalString(meta.code)))
  return {
    securities: requestedSecurities.filter((code) => code.includes(".") && !returnedSecurities.has(code)),
    indicators: requestedIndicators.filter((code) => !returnedIndicators.has(code)),
  }
}

/** The matrix and its axis labels must agree on BOTH dimensions, or cells are
 * dropped or misread. The 2026-08-01 revision transposed cross-section without a
 * version marker, so a re-transpose has to fail loudly rather than silently
 * relabel columns — with the caveat that this only catches a NON-SQUARE change.
 * A 2×2 or 1×1 matrix keeps its dimensions when transposed and would still be
 * read with the axes swapped; nothing in the payload distinguishes the two.
 *
 * Row length is checked exactly, not leniently: the server pads a row with
 * `null` rather than truncating it — probed 2026-08-02 across A/HK/US, where a
 * US security missing 3 of 4 indicators still came back with a full-length row,
 * and a cross-market time series padded every security to the union of trading
 * days (each market's own holidays land as `null`). A short or long row is
 * therefore a structural change, not missing data.
 *
 * `data` rides along as ApiError details so the failure keeps the response's
 * traceId — a shape mismatch is precisely the kind of thing support needs to
 * trace, and without it the error reaches the user trace-less. */
function assertMatrixShape(data: unknown, values: unknown[], rows: number, rowAxis: string, cols: number, colAxis: string): void {
  if (values.length !== rows) {
    throw new ApiError(`Indicator matrix shape mismatch: got ${values.length} value rows for ${rows} ${rowAxis} — the response layout may have changed`, undefined, undefined, data)
  }
  for (const [i, row] of values.entries()) {
    const width = Array.isArray(row) ? row.length : -1
    if (width !== cols) {
      throw new ApiError(`Indicator matrix shape mismatch: value row ${i} has ${width < 0 ? "no array of" : String(width)} cells for ${cols} ${colAxis} — the response layout may have changed`, undefined, undefined, data)
    }
  }
}

// Cross-section (and the screener, whose payload is the same shape plus a
// per-indicator `field`): one row per security, one column per indicator.
// `values` is [security][indicator], so security i's value for indicator j is
// values[i][j]. There is no row-level date any more — the query date now lives
// in each indicator's own parameters and may legitimately differ per column.
export function flattenCrossSection(data: unknown, keyBy: "name" | "code" = "name"): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asIndicatorMetaList(d.indicatorList)
  if (!Array.isArray(d.values) || !securityCode || !indicators) return data
  assertMatrixShape(data, d.values, securityCode.length, "securities", indicators.length, "indicators")

  const securityName = asStringArray(d.securityNameList)
  const headers = indicatorHeaders(indicators, keyBy, CROSS_SECTION_COLUMNS)

  const list = securityCode.map((code, i) => {
    const row: Record<string, unknown> = { security: code, name: securityName?.[i] }
    const cells = rowOf(d.values, i)
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells?.[j]
    }
    return row
  })
  return { list, total: list.length }
}

// Time-series: one row per date. Columns are the indicators (single-security
// case) or the securities (single-indicator case) — exactly one dimension
// varies, per the API contract. `values` stays a 2D [series][date] matrix.
//
// Axis rule, in priority order:
//  1. More than one indicator came back → multi-indicator × single-security.
//  2. More than one security came back → single-indicator × multi-security.
//     This is what a sector ID produces: the request carries ONE universe entry
//     and the server expands it into N constituents, so the request count says
//     nothing about the axis.
//  3. Both are 1 → genuinely ambiguous, so fall back to what was REQUESTED. The
//     server drops securities that have no data at all, and a two-security
//     request that comes back with one must still be labelled by security or
//     the caller cannot tell whose series they are holding (probed 2026-08-02:
//     `finc_pe_ttm` over 600519.SH + 09992.HK).
// A single-entry sector that expands to exactly one constituent lands in (3) and
// gets the indicator axis — degenerate, and only cosmetic.
export function flattenTimeSeries(data: unknown, keyBy: "name" | "code" = "name", requestedSecurities?: number): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const dates = asStringArray(d.dates)
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asIndicatorMetaList(d.indicatorList)
  if (!Array.isArray(d.values) || !dates || !securityCode || !indicators) return data

  const securityName = asStringArray(d.securityNameList)
  const seriesAreIndicators = indicators.length > 1 ? true
    : securityCode.length > 1 ? false
      : (requestedSecurities ?? securityCode.length) <= 1
  assertMatrixShape(data, d.values, seriesAreIndicators ? indicators.length : securityCode.length, seriesAreIndicators ? "indicators" : "securities", dates.length, "dates")
  // Map over securityCode rather than securityNameList directly: a response that
  // omits the names must still yield one header per security (falling back to
  // the code), not zero columns.
  const headers = seriesAreIndicators
    ? indicatorHeaders(indicators, keyBy, ["date"])
    : buildHeaders(securityCode.map((code, i) => (keyBy === "code" ? code : securityName?.[i])), securityCode, ["date"])

  const list = dates.map((date, k) => {
    const row: Record<string, unknown> = { date }
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = rowOf(d.values, i)?.[k]
    }
    return row
  })
  return { list, total: list.length }
}
