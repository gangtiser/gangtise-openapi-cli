import { createHash, randomBytes } from "node:crypto"
import { renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

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

/** Write `content` to `target` in one go through a staging sibling renamed into place, so a
 * failed write (disk full, a crash) leaves neither a truncated target nor the staging file
 * behind. `mode` holds from the first byte: the staging file is created with it and the
 * rename carries it over — a follow-up chmod would leave a window. The one implementation
 * for whole-content writes; streaming writers (rowSink, exports, downloads) stage the same
 * way but publish on their own schedule. */
export async function writeFileAtomic(target: string, content: string | Uint8Array, options: { mode?: number; suffix?: string } = {}): Promise<void> {
  const staging = stagingPath(target, options.suffix)
  try {
    await fs.writeFile(staging, content, options.mode === undefined ? undefined : { mode: options.mode })
    await publishFile(staging, target)
  } catch (error) {
    await fs.unlink(staging).catch(() => {})
    throw error
  }
}

/** The dev / inode each file this process published has, by absolute path. rename keeps
 * the inode, so a path that still holds the same one is still ours, and nothing needs to be
 * read back to know it (see stillPublished; a DIFFERENT inode is only a hint, see
 * warnIfSuperseded). */
const publishedIdentity = new Map<string, { dev: number; ino: number }>()

/** Move a finished staging file over `target`, remembering which file it was. Every write
 * that publishes by rename goes through here. */
export async function publishFile(staging: string, target: string): Promise<void> {
  const { dev, ino } = await fs.stat(staging)
  await fs.rename(staging, target)
  publishedIdentity.set(path.resolve(target), { dev, ino })
}

/** Is the file at `target` still the one this process published there? `undefined` when that
 * cannot be told: nothing recorded, a filesystem without inode numbers (0), or a failed stat
 * (a transient failure is not evidence of a replacement). */
export async function stillPublished(target: string): Promise<boolean | undefined> {
  const mine = publishedIdentity.get(path.resolve(target))
  if (!mine || !mine.ino) return undefined
  const now = await fs.stat(target).catch(() => undefined)
  if (!now) return undefined
  return now.dev === mine.dev && now.ino === mine.ino
}

/** `writeFileAtomic` for the few callers that cannot await (the update check). */
export function writeFileAtomicSync(target: string, content: string, options: { suffix?: string } = {}): void {
  const staging = stagingPath(target, options.suffix)
  try {
    writeFileSync(staging, content)
    renameSync(staging, target)
  } catch (error) {
    try { rmSync(staging, { force: true }) } catch { /* nothing to remove */ }
    throw error
  }
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

function renderTable(rows: Array<Record<string, unknown>>, clamp: boolean): string {
  if (rows.length === 0) {
    return "(empty)"
  }
  const cell = clamp ? clampCell : (value: string) => value

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  // Format every cell once (formatScalar may JSON.stringify objects), sanitizing
  // control chars so multi-line fields don't break alignment. Reuse the matrix for
  // both width and rendering — and compute widths with reduce, NOT Math.max(...arr):
  // spreading a per-row array overflows the call stack on large results (table is
  // the default format, e.g. `quote day-kline --security all`). Widths and padding
  // use displayWidth so CJK cells stay aligned.
  const headerCells = columns.map((column) => cell(sanitizeCell(column)))
  const matrix = rows.map((row) => columns.map((column) => cell(sanitizeCell(formatScalar(row[column])))))
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

export function csvHeader(columns: readonly string[]): string {
  return columns.map(csvEscape).join(",")
}

export function csvRow(columns: readonly string[], row: Record<string, unknown>): string {
  return columns.map((column) => csvEscape(formatScalar(row[column]))).join(",")
}

/** The lines of a jsonl or csv render of `value`, in order — ONE generator for the in-memory
 * render, the file writer and stdout, so no two of them shape rows differently. jsonl: one
 * line per jsonlItems record. csv: the header, then one line per toRows row under the union
 * of the rows' keys; with no rows at all, the header alone when the columns are known
 * (`columns`: a columnar result's fieldList), else nothing — an object-row result with no
 * rows has no columns to name. */
export function* outputLines(value: unknown, format: "jsonl" | "csv", columns?: readonly unknown[]): Generator<string> {
  if (format === "jsonl") {
    for (const item of jsonlItems(value)) yield JSON.stringify(item)
    return
  }
  const rows = toRows(value)
  const header = rows.length > 0 ? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))) : (columns ?? []).map(String)
  if (header.length === 0) return
  yield csvHeader(header)
  for (const row of rows) yield csvRow(header, row)
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

export interface RenderOptions {
  /** A columnar result's fieldList: names the csv header when there are no rows. */
  columns?: readonly unknown[]
  /** Cap table cells at MAX_CELL_DISPLAY_WIDTH. For the terminal only: a file written with
   * --format table keeps every cell whole — a cut cell there is lost data, not layout. */
  clampCells?: boolean
}

export function renderOutput(value: unknown, format: OutputFormat, options: RenderOptions = {}): string {
  // toRows is computed lazily per branch: json never needs it, and jsonl only
  // falls back to it when the value isn't already a {list}.
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2)
    case "jsonl":
    case "csv":
      return [...outputLines(value, format, options.columns)].join("\n")
    case "markdown":
      return renderMarkdown(toRows(value))
    case "table":
    default:
      return renderTable(toRows(value), options.clampCells ?? true)
  }
}

/** Write `value` as jsonl / csv lines to `stream`, a batch of lines per write (a result of
 * any size never becomes one string: V8 caps a string near 512 MiB, and a redirected
 * full-market pull passes that). Every line ends with a newline. With `digest`, the bytes
 * are hashed as they are written, so the caller never reads the file back to describe it.
 * `bom`: csv files start with one so Excel decodes Chinese as UTF-8; stdout does not. */
export async function writeOutputLines(stream: LineSink, value: unknown, format: "jsonl" | "csv", options: { columns?: readonly unknown[]; bom?: boolean; digest?: boolean } = {}): Promise<ExportDigest | undefined> {
  const hash = options.digest ? createHash("sha256") : undefined
  let bytes = 0
  const flush = async (lines: string[]): Promise<void> => {
    if (lines.length === 0) return
    const text = lines.join("\n")
    if (hash) {
      const buf = Buffer.from(`${text}\n`, "utf8")
      hash.update(buf)
      bytes += buf.byteLength
    }
    await writeLine(stream, text)
  }
  let chunk: string[] = []
  let first = true
  for (const line of outputLines(value, format, options.columns)) {
    chunk.push(first && options.bom && format === "csv" ? `\ufeff${line}` : line)
    first = false
    if (chunk.length >= LINES_PER_WRITE) { await flush(chunk); chunk = [] }
  }
  await flush(chunk)
  return hash ? { bytes, sha256: hash.digest("hex") } : undefined
}

/** Write a jsonl / csv export to `outputPath`: line batches into a staging sibling, hashed as
 * they are written, then renamed over the target only on success — a failed re-export never
 * destroys the previous good file, and nothing is read back. Every size goes this way, so a
 * small file and a large one end the same way (with a newline). Returns null for the other
 * formats, which the caller renders whole. */
export async function streamOutputToFile(value: unknown, format: OutputFormat, outputPath: string, columns?: readonly unknown[]): Promise<ExportDigest | null> {
  if (format !== "jsonl" && format !== "csv") return null

  const { createWriteStream } = await import("node:fs")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const partPath = stagingPath(outputPath)
  const stream = createWriteStream(partPath, { encoding: "utf8" })
  // A stream 'error' with no listener (EACCES on open, ENOSPC mid-write) crashes the
  // process before any write callback fires. Swallow the event here — the failure
  // still surfaces through the write/end callbacks below.
  stream.on("error", () => {})
  try {
    const digest = await writeOutputLines(stream, value, format, { columns, bom: true, digest: true }) as ExportDigest
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => err ? reject(err) : resolve())
    })
    await publishFile(partPath, outputPath)
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

const NUMERIC_LOOKING = /^[+\-](?:(?=[^\d]*\d)[\d.,%eE]+)?$/

export function csvEscape(value: string): string {
  let out = value
  // Formula-injection guard, but don't mangle legitimate values: a leading -/+ only needs
  // escaping when what follows is more than a number — digits with separators, a percent
  // or an exponent ("-3.5%", "+5.2%", "-1,234.5", "-1e3"), or the sign alone ("-", a common
  // placeholder), stay as they are. A payload like "-1+cmd|..." carries operators or
  // letters and is still escaped.
  if (/^[=@\t\r]/.test(out) || (/^[+\-]/.test(out) && !NUMERIC_LOOKING.test(out))) out = "'" + out
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

  // Staged and renamed over the target only on success, so a failed re-export/download
  // never destroys the previous good file. Digested from `content`, not from the file: these
  // are the bytes being written. Only an export's sidecar uses it, so downloads pass
  // `withDigest = false` and skip the hash.
  const digest = withDigest ? digestBuffer(content) : undefined
  await writeFileAtomic(outputPath, content)
  return digest
}
