import { createHash, randomBytes } from "node:crypto"
import { rmSync, statSync } from "node:fs"
import fs from "node:fs/promises"

import type { OutputFormat } from "./config.js"
import { ConfigError } from "./errors.js"

const OUTPUT_FORMATS = ["table", "json", "jsonl", "csv", "markdown"] as const

/**
 * A staging sibling of `target`, named for THIS write and no other. Every write that
 * publishes by rename must take its name from here.
 *
 * 🔴 Deriving it from the target alone (`<target>.part`) makes the temp file a property of
 * the destination instead of the operation, and two writers aimed at the same explicit
 * --output then share one file: both open it, both write at their own offsets, and the
 * first rename publishes a mix of the two runs — as a complete file, with exit 0. A name
 * unique to the write keeps each writer's bytes its own; the rename that lands last wins,
 * which is the overwrite semantics an explicit --output already has.
 *
 * Stays well inside the 255-byte filename limit: download names are truncated to 200.
 */
export function stagingPath(target: string, suffix = "part"): string {
  const staging = `${target}.${randomBytes(4).toString("hex")}.${suffix}`
  handedOut.add(staging)
  return staging
}

/** Every staging name this process has handed out. */
const handedOut = new Set<string>()

/** Final names this process claimed with an empty placeholder (download.ts `uniquePath`). */
const claimed = new Set<string>()

export function trackClaim(name: string): void {
  claimed.add(name)
}

/** Remove whichever of this process's staging files still exist, and any claimed name that
 * is still an empty placeholder, for an exit that skips the normal cleanup (SIGINT / SIGTERM
 * / SIGHUP, see cli.ts). Each name belongs to one write of this process, so nothing another
 * process is writing is touched; one already published by rename or removed is simply gone.
 * A placeholder is only removed while empty: it carries the final name, and left behind it
 * looks like a finished download. (A rename landing between the size check and the unlink
 * would lose that download — acceptable for a command being interrupted, whose exit already
 * says it did not finish.) Synchronous, because the process leaves right after. */
export function removeStagingFiles(): void {
  for (const staging of handedOut) {
    try {
      rmSync(staging, { force: true })
    } catch { /* best effort: the process is leaving either way */ }
  }
  for (const name of claimed) {
    try {
      if (statSync(name).size === 0) rmSync(name, { force: true })
    } catch { /* gone already, or not ours to judge */ }
  }
}

/** What a finished export actually wrote: byte count and content hash. */
export interface ExportDigest {
  bytes: number
  sha256: string
}

/**
 * Byte count + sha256 of a file, streamed so memory stays flat.
 *
 * 🔴 The digest a sidecar PUBLISHES must be taken from the export's own staging file, before
 * the rename — never by reading back the published path. By then another process writing the
 * same --output may already have replaced it, and hashing that would certify someone else's
 * bytes as ours. Reading the published path is only for the opposite question: "is what is
 * there still mine?" (see warnIfSuperseded).
 *
 * Byte count alone is not a check: `{"price":10}` and `{"price":20}` are the same length, so
 * a size match proves nothing and only a size MISMATCH detects. The hash is what makes a
 * match mean something.
 *
 * What neither can do: prove the data and the sidecar came from the same RUN. Two exports
 * with identical rows hash identically even when their queries, columns or `complete`
 * verdicts differ. See `bug/cli-backlog.md` K34.
 *
 * `digestBuffer` is the same digest over bytes the caller still holds — same rule, no read
 * back. Prefer it whenever the content is already in memory: the streamed paths use the file
 * form because they never held the whole export, but a writer that has the buffer would be
 * re-reading what it just wrote, and the download path pays that on every saved file.
 */
export function digestBuffer(content: string | Uint8Array): ExportDigest {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content
  return { bytes: buf.byteLength, sha256: createHash("sha256").update(buf).digest("hex") }
}

export async function digestFile(filePath: string): Promise<ExportDigest> {
  const { createReadStream } = await import("node:fs")
  const hash = createHash("sha256")
  let bytes = 0
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    bytes += buf.byteLength
    hash.update(buf)
  }
  return { bytes, sha256: hash.digest("hex") }
}

export function parseOutputFormat(value?: string): OutputFormat {
  const format = value ?? "table"
  if ((OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as OutputFormat
  }
  throw new ConfigError(`Unsupported format: ${format}`)
}

/** Cell text for terminal-facing formats (table/markdown): newlines collapsed for
 * alignment, remaining C0/DEL/C1 control chars stripped so server data can't inject
 * terminal escape sequences into the user's terminal (U+009B is a one-byte CSI
 * that 8-bit-control terminals treat exactly like ESC[). */
function sanitizeCell(value: string): string {
  // Most cells hold no control character at all: skip both passes for them.
  if (!/[\u0000-\u001f\u007f-\u009f]/.test(value)) return value
  return value.replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f\u0080-\u009f]/g, "")
}

/** Terminal display width: CJK/fullwidth chars and emoji occupy 2 columns — padEnd
 * counts UTF-16 code units and misaligns every table containing Chinese text or emoji
 * (e.g. WeChat group names). */
function displayWidth(value: string): number {
  // Printable ASCII is one column per char — the common case (codes, dates, numbers).
  if (/^[\x20-\x7e]*$/.test(value)) return value.length
  let width = 0
  for (const ch of value) {
    const cp = ch.codePointAt(0)!
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f000 && cp <= 0x1faff)
      || (cp >= 0x20000 && cp <= 0x3fffd)
    width += wide ? 2 : 1
  }
  return width
}

export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

/** Rows for a list: object rows as-is with stray null/scalar rows dropped (one bad
 * row must not degrade the whole table to index/value pairs — and the streaming CSV
 * path already skips them, so both paths agree). A list with NO object rows at all
 * (e.g. plain string codes) still renders as index/value pairs. */
function rowsFromList(list: unknown[]): Array<Record<string, unknown>> {
  const objectRows = list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
  if (objectRows.length > 0) return objectRows
  return list.map((item, index) => ({ index, value: item }))
}

function toRows(value: unknown): Array<Record<string, unknown>> {
  // A null/undefined payload means "no data", not "one row whose only column is
  // null". Without this guard it fell through to [{ value }] and jsonl emitted
  // {"value":null} — a phantom record that makes `wc -l` report 1. Real case:
  // insight foreign-opinion --industry answers 200 + data:null.
  // Scalars (0, "", false) are left alone; only the two empty values short-circuit.
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return rowsFromList(value)
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.list)) {
      return rowsFromList(record.list)
    }
    return [record]
  }

  return [{ value }]
}

// One huge cell (a 50KB brief/chat message) would otherwise force every row of
// that column to be padded to the same width — rows × width of pure spaces.
const MAX_CELL_DISPLAY_WIDTH = 120

/** Truncate a cell to the display-width cap, ellipsis included in the budget. */
function clampCell(value: string): string {
  if (displayWidth(value) <= MAX_CELL_DISPLAY_WIDTH) return value
  let out = ""
  let width = 0
  for (const ch of value) {
    const w = displayWidth(ch)
    if (width + w > MAX_CELL_DISPLAY_WIDTH - 1) break
    out += ch
    width += w
  }
  return out + "…"
}

function renderTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(empty)"
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  // Format every cell once (formatScalar may JSON.stringify objects), sanitizing
  // control chars so multi-line fields don't break alignment. Reuse the matrix for
  // both width and rendering — and compute widths with reduce, NOT Math.max(...arr):
  // spreading a per-row array overflows the call stack on large results (table is
  // the default format, e.g. `quote day-kline --security all`). Widths and padding
  // use displayWidth so CJK cells stay aligned.
  const headerCells = columns.map((column) => clampCell(sanitizeCell(column)))
  const matrix = rows.map((row) => columns.map((column) => clampCell(sanitizeCell(formatScalar(row[column])))))
  // Each cell's width once, reused for the column widths and for the padding.
  const cellWidths = matrix.map((cells) => cells.map(displayWidth))
  const headerWidths = headerCells.map(displayWidth)
  const widths = columns.map((_, c) => cellWidths.reduce((max, cells) => Math.max(max, cells[c]), headerWidths[c]))

  const renderLine = (values: string[], valueWidths: number[]) => values.map((value, index) => value + " ".repeat(Math.max(0, widths[index] - valueWidths[index]))).join("  ")

  const header = renderLine(headerCells, headerWidths)
  const divider = renderLine(widths.map((width) => "-".repeat(width)), widths)
  const body = matrix.map((cells, r) => renderLine(cells, cellWidths[r]))

  return [header, divider, ...body].join("\n")
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(empty)"
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  // Column names come from server data (e.g. EDE indicator display names) — escape
  // them like cell values or a name containing | / , breaks the whole table.
  // Backslash must go first: escaping only "|" turns a literal `\|` into `\\|`,
  // which GFM reads as an escaped backslash + BARE pipe → an extra column.
  const mdEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("|", "\\|")
  const header = `| ${columns.map((column) => mdEscape(sanitizeCell(column))).join(" | ")} |`
  const divider = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${columns.map((column) => mdEscape(sanitizeCell(formatScalar(row[column])))).join(" | ")} |`)
  return [header, divider, ...body].join("\n")
}

function renderCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return ""
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const header = columns.map(csvEscape).join(",")
  const body = rows.map((row) => columns.map((column) => csvEscape(formatScalar(row[column]))).join(","))
  return [header, ...body].join("\n")
}

/** The records a jsonl render of `value` emits — ONE rule for the in-memory renderer, the
 * streamed writer and the sidecar's row count: a `{list}` result writes every list item
 * as it is (null rows included, as the API returned them); anything else goes through
 * toRows (a bare array keeps its object rows only, a lone object is one record, null is
 * none). Two paths reading this differently is how a file and its sidecar disagree. */
export function jsonlItems(value: unknown): unknown[] {
  const list = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).list : undefined
  return Array.isArray(list) ? list : toRows(value)
}

/** Data rows a jsonl / csv render of `value` contains, under the renderers' own shaping
 * rules (see jsonlItems / toRows). */
export function countOutputRows(value: unknown, format: "jsonl" | "csv"): number {
  return format === "jsonl" ? jsonlItems(value).length : toRows(value).length
}

export function renderOutput(value: unknown, format: OutputFormat): string {
  // toRows is computed lazily per branch: json never needs it, and jsonl only
  // falls back to it when the value isn't already a {list}.
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2)
    case "jsonl":
      return jsonlItems(value).map((item) => JSON.stringify(item)).join("\n")
    case "csv":
      return renderCsv(toRows(value))
    case "markdown":
      return renderMarkdown(toRows(value))
    case "table":
    default:
      return renderTable(toRows(value))
  }
}

/** Stream large jsonl/csv output row-by-row to avoid building a full string in memory. */
export async function streamOutputToFile(value: unknown, format: OutputFormat, outputPath: string): Promise<ExportDigest | null> {
  if (format !== "jsonl" && format !== "csv") return null

  const list = pickList(value)
  if (!list) return null
  // Below this row count the join() approach is cheaper than per-row writes.
  if (list.length < 1000) return null

  // csv can only stream object rows; an all-scalar list has no columns — fall back
  // to renderOutput's index/value shaping instead of writing a BOM-only file.
  let csvRows: Array<Record<string, unknown>> = []
  let csvColumns: string[] = []
  if (format === "csv") {
    csvRows = list.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    if (csvRows.length === 0) return null
    csvColumns = Array.from(new Set(csvRows.flatMap((row) => Object.keys(row))))
  }

  const { dirname } = await import("node:path")
  const { createWriteStream } = await import("node:fs")
  await fs.mkdir(dirname(outputPath), { recursive: true })

  // Stream into a staging sibling and rename over the target only on success, so a
  // failed re-export never destroys the previous good file.
  const partPath = stagingPath(outputPath)
  const stream = createWriteStream(partPath, { encoding: "utf8" })
  // A stream 'error' with no listener (EACCES on open, ENOSPC mid-write) crashes the
  // process before any write callback fires. Swallow the event here — the failure
  // still surfaces through the write/end callbacks below.
  stream.on("error", () => {})
  try {
    if (format === "jsonl") {
      // Same record selection as renderOutput, so crossing the 1000-row threshold never
      // changes which rows a bare array yields.
      let chunk: string[] = []
      for (const item of jsonlItems(value)) {
        chunk.push(JSON.stringify(item))
        if (chunk.length >= LINES_PER_WRITE) { await writeLines(stream, chunk); chunk = [] }
      }
      await writeLines(stream, chunk)
    } else {
      // BOM so Excel double-click decodes Chinese as UTF-8 instead of ANSI/GBK.
      let chunk = ["\ufeff" + csvColumns.map(csvEscape).join(",")]
      for (const row of csvRows) {
        chunk.push(csvColumns.map((column) => csvEscape(formatScalar(row[column]))).join(","))
        if (chunk.length >= LINES_PER_WRITE) { await writeLines(stream, chunk); chunk = [] }
      }
      await writeLines(stream, chunk)
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => err ? reject(err) : resolve())
    })
    const digest = await digestFile(partPath)
    await fs.rename(partPath, outputPath)
    return digest
  } catch (error) {
    // Mirror the download path: never leave a truncated file that looks complete.
    // createWriteStream opens lazily — an early abort can reach unlink BEFORE the
    // open() creates the file, so wait for 'close' (fd released or open aborted)
    // or the .part would reappear right after being "removed".
    stream.destroy()
    // Already-closed happens when the failure was the rename (stream ended fine);
    // then 'close' has fired and waiting for it again would hang forever.
    if (!stream.closed) {
      await new Promise<void>((resolve) => stream.once("close", resolve))
    }
    await fs.unlink(partPath).catch(() => {})
    throw error
  }
}

/** Extract a row array from a value: the array itself, or its `.list` property,
 * else null. Shared by streaming, printer's title-cache, and list detection. */
export function pickList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") {
    const list = (value as Record<string, unknown>).list
    if (Array.isArray(list)) return list
  }
  return null
}

export function csvEscape(value: string): string {
  let out = value
  // Formula-injection guard, but don't mangle legitimate numbers: a leading
  // -/+ only needs escaping when the cell isn't a finite number (e.g. "-1+cmd"),
  // so values like "-3.5" stay numeric for Excel/pandas.
  if (/^[=@\t\r]/.test(out) || (/^[+\-]/.test(out) && !Number.isFinite(Number(out)))) out = "'" + out
  if (/[",\n\r]/.test(out)) return `"${out.replaceAll("\"", "\"\"")}"`
  return out
}

export interface LineSink {
  write(chunk: string, cb?: (err?: Error | null) => void): boolean
  once(event: "drain" | "error", cb: (err?: unknown) => void): unknown
  off(event: "drain" | "error", cb: (err?: unknown) => void): unknown
}

/** How many lines a loop hands to one write. One write means one callback, one promise
 * and at most one drain wait per chunk instead of per row — per-row awaits were most of
 * the time a large export spent writing. */
export const LINES_PER_WRITE = 1000

/** writeLine for several lines at once (each still newline-terminated). */
export function writeLines(stream: LineSink, lines: string[]): Promise<void> {
  return lines.length === 0 ? Promise.resolve() : writeLine(stream, lines.join("\n"))
}

export function writeLine(stream: LineSink, line: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ok = stream.write(line + "\n", (err?: Error | null) => err ? reject(err) : undefined)
    if (ok) {
      resolve()
      return
    }
    // Waiting only for 'drain' would hang forever if the stream errors instead;
    // race the two and detach the loser so listeners don't pile up per write.
    const onDrain = () => { stream.off("error", onError); resolve() }
    const onError = (err?: unknown) => { stream.off("drain", onDrain); reject(err) }
    stream.once("drain", onDrain)
    stream.once("error", onError)
  })
}

export async function saveOutputIfNeeded(content: string | Uint8Array, outputPath?: string, withDigest = true): Promise<ExportDigest | undefined> {
  if (!outputPath) {
    return
  }

  const { dirname } = await import("node:path")
  await fs.mkdir(dirname(outputPath), { recursive: true })

  // Write to a staging sibling and rename over the target only on success, so a
  // failed re-export/download never destroys the previous good file.
  const partPath = stagingPath(outputPath)
  try {
    if (typeof content === "string") {
      await fs.writeFile(partPath, content, "utf8")
    } else {
      await fs.writeFile(partPath, content)
    }
    // Digested from `content`, not from the file: these are the bytes just written. Only an
    // export's sidecar uses it, so downloads pass `withDigest = false` and skip the hash.
    const digest = withDigest ? digestBuffer(content) : undefined
    await fs.rename(partPath, outputPath)
    return digest
  } catch (error) {
    await fs.unlink(partPath).catch(() => {})
    throw error
  }
}
