import { ApiError, attachEnvelopeTraceId, ENVELOPE_TRACE_ID } from "./errors.js"

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
      // Carry the envelope's traceId onto the inner payload. `unwrapEnvelope`
      // attached it to THIS object, but everything downstream (the flatteners'
      // shape guards) only ever sees `record.data` — without this hand-off those
      // failures, exactly the ones support needs to trace, arrive trace-less.
      if (ok && "data" in record) return attachEnvelopeTraceId(record.data, (record as Record<PropertyKey, unknown>)[ENVELOPE_TRACE_ID] ?? record.traceId)
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

/** A response carrying neither securities nor indicators: the query as a whole
 * resolved to nothing. This is NOT a dropped axis — nothing was left out, there
 * simply is no data (a non-trading range, a date outside coverage), so it must
 * not be reported as partial. Calling every requested code "omitted" here would
 * be false metadata: the diff against the request is total by construction.
 *
 * The check covers every STRUCTURAL array, not just the two axis lists, because
 * accepting anything looser would let a malformed payload — `values: null`, a
 * missing `values`, or dates with no matrix — pass as "legitimately empty" and
 * exit 0, which is precisely the protocol regression this release's shape guards
 * exist to catch. Required empty: `securityCodeList`, `indicatorList`, `values`;
 * plus `dates` when present. Probed 2026-08-02: a time-series no-data answer is
 * five empty arrays, a cross-section one is four (it carries no `dates` key at
 * all), hence "absent or empty" rather than a flat count.
 *
 * `securityNameList` is deliberately NOT checked: it holds display labels, not
 * structure, so a `null` there cannot misalign anything — and rejecting it would
 * re-introduce the false-partial this function exists to prevent. */
export function isEmptyMatrix(data: unknown): boolean {
  if (!data || typeof data !== "object") return false
  const d = data as MatrixData
  if (asStringArray(d.securityCodeList)?.length !== 0) return false
  if (asIndicatorMetaList(d.indicatorList)?.length !== 0) return false
  if (!Array.isArray(d.values) || d.values.length !== 0) return false
  // `dates` is time-series only; when present it must be empty too.
  return d.dates === undefined || (Array.isArray(d.dates) && d.dates.length === 0)
}

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
/** True only when the payload carries NONE of the EDE matrix keys — a foreign
 * shape. Nothing legitimately reaches the flatteners in that state — `indicator
 * search` prints its unwrapped list directly and `raw call` bypasses them — so
 * this is a protocol failure, not a payload to hand back: returning it would
 * print the raw envelope and exit 0, indistinguishable from success. */
function assertMatrixPayload(data: unknown, d: MatrixData): void {
  const bare = d.securityCodeList === undefined && d.securityNameList === undefined
    && d.indicatorList === undefined && d.dates === undefined && d.values === undefined
  if (bare) {
    throw new ApiError("Indicator matrix shape mismatch: the response carries none of the matrix fields — the response layout may have changed", undefined, undefined, data)
  }
}

function assertAxis<T>(data: unknown, axis: T | undefined, key: string): asserts axis is T {
  if (axis === undefined) {
    throw new ApiError(`Indicator matrix shape mismatch: the response is missing \`${key}\` or it is not an array — the response layout may have changed`, undefined, undefined, data)
  }
}

/** Resolve the display names for a security axis, degrading instead of failing.
 *
 * Names are consumed POSITIONALLY, so a list that does not line up cannot be
 * trusted at all: `["泡泡玛特"]` against `["600519.SH","09992.HK"]` labels 茅台's
 * series 泡泡玛特, and a `[null]` element used to render a column literally
 * headed `"null"` (both probed 2026-08-02). Neither may reach the output.
 *
 * But a name is a LABEL, not structure — `securityCodeList` already carries
 * identity, and every header falls back to the code. So an anomaly here drops
 * the names and keeps the values, rather than killing an EDE command whose
 * numbers are all correct. That is a deliberate asymmetry with the other guards
 * in this module: they protect against MISATTRIBUTED VALUES and must be fatal;
 * this one protects a caption. */
function resolveSecurityNames(names: unknown, codes: string[]): string[] | undefined {
  if (names === undefined || names === null) return undefined
  if (!Array.isArray(names) || names.length !== codes.length) {
    process.stderr.write(`[gangtise] warning: securityNameList carries ${Array.isArray(names) ? `${names.length} entries` : "no array"} for ${codes.length} securities — names are positional, so all of them were dropped; columns fall back to the security code.\n`)
    return undefined
  }
  let warned = false
  return names.map((name, i) => {
    if (typeof name === "string" && name.trim() !== "") return name
    // A blank or null name is a plausible gap for one security — fall back
    // quietly. A non-string (an object, a number) means the field changed type,
    // which is worth saying once.
    if (typeof name !== "string" && name !== null && name !== undefined && !warned) {
      warned = true
      process.stderr.write(`[gangtise] warning: securityNameList holds non-string entries; those columns fall back to the security code.\n`)
    }
    return codes[i]
  })
}

/** The matrix endpoints cannot legitimately answer with a non-object payload:
 * `indicator search` never reaches the flatteners (it prints the unwrapped list
 * directly) and `raw call` bypasses them entirely, so there is no caller for
 * which `null`, an array, or a foreign object is a valid cross-section /
 * time-series / screener body. Checked here, BEFORE the envelope is discarded,
 * because a `data: null` cannot carry the non-enumerable traceId — passing the
 * envelope as details is the only way such a failure stays traceable. */
export function requireIndicatorMatrix(raw: unknown): Record<string, unknown> {
  const data = unwrapIndicatorData(raw)
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(`Indicator API returned no matrix object (got ${data === null ? "null" : Array.isArray(data) ? "an array" : typeof data}) — the response layout may have changed`, undefined, undefined, raw)
  }
  return data as Record<string, unknown>
}

function assertValuesPresent(data: unknown, values: unknown): asserts values is unknown[] {
  if (!Array.isArray(values)) {
    throw new ApiError(`Indicator matrix shape mismatch: the response carries axis lists but no \`values\` array — the response layout may have changed`, undefined, undefined, data)
  }
}

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
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(`Indicator API returned no matrix object (got ${data === null ? "null" : Array.isArray(data) ? "an array" : typeof data}) — the response layout may have changed`, undefined, undefined, data)
  }
  const d = data as MatrixData
  assertMatrixPayload(data, d)
  // Past this point the payload claims to be a matrix, so every axis it needs
  // must actually be there. A `null` or absent axis is a broken response.
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asIndicatorMetaList(d.indicatorList)
  assertAxis(data, securityCode, "securityCodeList")
  assertAxis(data, indicators, "indicatorList")
  assertValuesPresent(data, d.values)
  assertMatrixShape(data, d.values, securityCode.length, "securities", indicators.length, "indicators")

  const securityName = resolveSecurityNames(d.securityNameList, securityCode)
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
//  3. Both are 1 → genuinely ambiguous, so fall back to what was REQUESTED:
//     - a universe holding a sector ID always takes the security axis. The
//       sector may expand to one constituent, or the rest may have been dropped
//       for lack of data; either way the caller asked "which securities", and an
//       indicator-named column would erase whose series this is.
//     - otherwise the entry count decides. The server drops securities with no
//       data at all, so a two-security request that comes back with one must
//       still be labelled by security (probed 2026-08-02: `finc_pe_ttm` over
//       600519.SH + 09992.HK).
export function flattenTimeSeries(data: unknown, keyBy: "name" | "code" = "name", requestedUniverse?: string[]): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(`Indicator API returned no matrix object (got ${data === null ? "null" : Array.isArray(data) ? "an array" : typeof data}) — the response layout may have changed`, undefined, undefined, data)
  }
  const d = data as MatrixData
  assertMatrixPayload(data, d)
  const dates = asStringArray(d.dates)
  const securityCode = asStringArray(d.securityCodeList)
  const indicators = asIndicatorMetaList(d.indicatorList)
  assertAxis(data, dates, "dates")
  assertAxis(data, securityCode, "securityCodeList")
  assertAxis(data, indicators, "indicatorList")
  assertValuesPresent(data, d.values)

  const securityName = resolveSecurityNames(d.securityNameList, securityCode)
  // The API permits multi-indicator × single-security OR single-indicator ×
  // multi-security, never both — the server rejects such a REQUEST with 100003.
  // A RESPONSE carrying both axes plural is therefore unattributable: whichever
  // axis becomes the columns, the other one's identity is silently discarded
  // (probed 2026-08-02: 2×2 rendered as 收盘价/成交量 with both securities gone,
  // and droppedFromMatrix sees nothing missing so it would not even flag).
  if (securityCode.length > 1 && indicators.length > 1) {
    throw new ApiError(`Indicator matrix shape mismatch: the time-series response carries ${securityCode.length} securities AND ${indicators.length} indicators, which the endpoint does not support — one of the two identities would be lost`, undefined, undefined, data)
  }
  // A universe entry without a `.` is a sector ID — the server expands it, so
  // neither its presence nor the entry count says anything about the axis.
  const requested = requestedUniverse === undefined ? undefined : [...new Set(requestedUniverse)]
  const hasSector = requested?.some((entry) => !entry.includes(".")) ?? false
  const seriesAreIndicators = indicators.length > 1 ? true
    : securityCode.length > 1 ? false
      : hasSector ? false
        : (requested?.length ?? securityCode.length) <= 1
  const seriesCount = seriesAreIndicators ? indicators.length : securityCode.length
  assertMatrixShape(data, d.values, seriesCount, seriesAreIndicators ? "indicators" : "securities", dates.length, "dates")
  // Dates with no series passes the shape check (0 rows for 0 series) but would
  // emit one row per date carrying nothing but the date — no security, no
  // indicator, no way to attribute the row. A genuine no-data answer empties
  // `dates` too (probed 2026-08-02), so this combination is a broken response.
  if (dates.length > 0 && seriesCount === 0) {
    throw new ApiError(`Indicator matrix shape mismatch: ${dates.length} dates with no series to attribute them to — the response layout may have changed`, undefined, undefined, data)
  }
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
