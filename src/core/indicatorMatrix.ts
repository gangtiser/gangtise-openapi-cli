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
  return buildHeaders(bases, fields, reserved)
}

const CROSS_SECTION_COLUMNS = ["security", "name"]

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
export function flattenTimeSeries(data: unknown, keyBy: "name" | "code" = "name"): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const dates = asStringArray(d.dates)
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asIndicatorMetaList(d.indicatorList)
  if (!Array.isArray(d.values) || !dates || !securityCode || !indicators) return data

  const securityName = asStringArray(d.securityNameList)
  const seriesAreIndicators = securityCode.length <= 1
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
