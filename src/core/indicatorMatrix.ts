import { ApiError } from "./errors.js"

// The EDE cross-section / time-series endpoints return a `values` matrix plus
// parallel code/name/date lists rather than ready-made rows. These helpers
// flatten that matrix into the wide tabular shape the rest of the pipeline
// (printData → renderOutput) expects: { list, total }.

// Field names match the live EDE response (not the published doc): the real
// keys are securityCode / securityName / indicators / indicatorName.
interface MatrixData {
  date?: unknown
  securityCode?: unknown
  securityName?: unknown
  indicators?: unknown
  indicatorName?: unknown
  dates?: unknown
  values?: unknown
}

// The EDE endpoints double-wrap on success: the shared client strips the outer
// envelope but leaves an inner { code, status, data } around the real payload.
// Peel that inner envelope so the list (search) / matrix (cross-section,
// time-series) is reachable. Observed errors arrive single-enveloped (the
// client throws on those), but a failure code carried only by the inner
// envelope must still surface instead of rendering its null payload as success.
export function unwrapIndicatorData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if ("data" in record && ("code" in record || "status" in record)) {
      const code = record.code === undefined ? undefined : String(record.code)
      const ok = record.status === true || code === "000000" || code === "0"
      if (!ok) {
        throw new ApiError(typeof record.msg === "string" && record.msg ? record.msg : "Indicator API request failed", code)
      }
      return record.data
    }
  }
  return raw
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined
}

function rowOf(values: unknown, index: number): unknown[] | undefined {
  const row = (values as unknown[])[index]
  return Array.isArray(row) ? row : undefined
}

// Build one column header per series. Prefer the human-readable name; on a
// duplicate name append the code so a column is never silently overwritten.
function buildHeaders(names: string[] | undefined, codes: string[] | undefined, count: number): string[] {
  const used = new Set<string>()
  const headers: string[] = []
  for (let i = 0; i < count; i++) {
    const base = String(names?.[i] ?? codes?.[i] ?? `col${i}`)
    let header = base
    let attempt = 1
    while (used.has(header)) {
      const suffix = codes?.[i] ?? i
      header = attempt === 1 ? `${base} (${suffix})` : `${base} (${suffix})_${attempt}`
      attempt++
    }
    used.add(header)
    headers.push(header)
  }
  return headers
}

// Cross-section: one row per security, one column per indicator. The live
// `values` is a flat [numIndicators * numSecurities][1] array in
// indicator-major order, so indicator i on security j is values[i*numSec+j][0].
export function flattenCrossSection(data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const securityCode = asStringArray(d.securityCode)
  const indicators = asStringArray(d.indicators)
  if (!Array.isArray(d.values) || !securityCode || !indicators) return data

  const securityName = asStringArray(d.securityName)
  const headers = buildHeaders(asStringArray(d.indicatorName), indicators, indicators.length)
  const numSec = securityCode.length

  const list = securityCode.map((code, j) => {
    const row: Record<string, unknown> = { date: d.date, security: code, name: securityName?.[j] }
    for (let i = 0; i < indicators.length; i++) {
      row[headers[i]] = rowOf(d.values, i * numSec + j)?.[0]
    }
    return row
  })
  return { list, total: list.length }
}

// Time-series: one row per date. Columns are the indicators (single-security
// case) or the securities (single-indicator case) — exactly one dimension
// varies, per the API contract. `values` is a 2D [series][date] matrix.
export function flattenTimeSeries(data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const dates = asStringArray(d.dates)
  const securityCode = asStringArray(d.securityCode)
  const indicators = asStringArray(d.indicators)
  if (!Array.isArray(d.values) || !dates || !securityCode || !indicators) return data

  const seriesAreIndicators = securityCode.length <= 1
  const headers = seriesAreIndicators
    ? buildHeaders(asStringArray(d.indicatorName), indicators, indicators.length)
    : buildHeaders(asStringArray(d.securityName), securityCode, securityCode.length)

  const list = dates.map((date, k) => {
    const row: Record<string, unknown> = { date }
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = rowOf(d.values, i)?.[k]
    }
    return row
  })
  return { list, total: list.length }
}
