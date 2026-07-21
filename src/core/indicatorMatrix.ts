import { ApiError } from "./errors.js"

// The EDE cross-section / time-series endpoints return a `values` matrix plus
// parallel code/name/date lists rather than ready-made rows. These helpers
// flatten that matrix into the wide tabular shape the rest of the pipeline
// (printData → renderOutput) expects: { list, total }.

// Field names match the live EDE response (not the published doc): the real
// keys are securityCodeList / securityNameList / indicatorCodeList /
// indicatorNameList; `values` is a 2D matrix ([indicator][security] for
// cross-section, [series][date] for time-series).
interface MatrixData {
  date?: unknown
  dates?: unknown
  securityCodeList?: unknown
  securityNameList?: unknown
  indicatorCodeList?: unknown
  indicatorNameList?: unknown
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

function rowOf(values: unknown, index: number): unknown[] | undefined {
  const row = (values as unknown[])[index]
  return Array.isArray(row) ? row : undefined
}

// Build one column header per series. Prefer the human-readable name; on a
// duplicate name append the code so a column is never silently overwritten.
function buildHeaders(names: string[] | undefined, codes: string[] | undefined, count: number): string[] {
  // Pre-seed the metadata column names: an indicator literally named "date" /
  // "security" / "name" must get a suffixed header, not overwrite the metadata.
  const used = new Set<string>(["date", "security", "name"])
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
// `values` is a 2D [numIndicators][numSecurities] matrix in indicator-major
// order, so indicator i on security j is values[i][j].
export function flattenCrossSection(data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as MatrixData
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asStringArray(d.indicatorCodeList)
  if (!Array.isArray(d.values) || !securityCode || !indicators) return data

  const securityName = asStringArray(d.securityNameList)
  const headers = buildHeaders(asStringArray(d.indicatorNameList), indicators, indicators.length)

  const list = securityCode.map((code, j) => {
    const row: Record<string, unknown> = { date: d.date, security: code, name: securityName?.[j] }
    for (let i = 0; i < indicators.length; i++) {
      row[headers[i]] = rowOf(d.values, i)?.[j]
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
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asStringArray(d.indicatorCodeList)
  if (!Array.isArray(d.values) || !dates || !securityCode || !indicators) return data

  const seriesAreIndicators = securityCode.length <= 1
  const headers = seriesAreIndicators
    ? buildHeaders(asStringArray(d.indicatorNameList), indicators, indicators.length)
    : buildHeaders(asStringArray(d.securityNameList), securityCode, securityCode.length)

  const list = dates.map((date, k) => {
    const row: Record<string, unknown> = { date }
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = rowOf(d.values, i)?.[k]
    }
    return row
  })
  return { list, total: list.length }
}
