import fs from "node:fs/promises"

import type { OutputFormat } from "./config.js"
import { ConfigError } from "./errors.js"

const OUTPUT_FORMATS = ["table", "json", "jsonl", "csv", "markdown"] as const

export function parseOutputFormat(value?: string): OutputFormat {
  const format = value ?? "table"
  if ((OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as OutputFormat
  }
  throw new ConfigError(`Unsupported format: ${format}`)
}

/** Cell text for terminal-facing formats (table/markdown): newlines collapsed for
 * alignment, remaining C0/DEL control chars stripped so server data can't inject
 * terminal escape sequences (ESC[31m etc.) into the user's terminal. */
function sanitizeCell(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "")
}

/** Terminal display width: CJK/fullwidth chars occupy 2 columns — padEnd counts
 * UTF-16 code units and misaligns every table containing Chinese text. */
function displayWidth(value: string): number {
  let width = 0
  for (const ch of value) {
    const cp = ch.codePointAt(0)!
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd)
    width += wide ? 2 : 1
  }
  return width
}

function formatScalar(value: unknown): string {
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
  const headerCells = columns.map(sanitizeCell)
  const matrix = rows.map((row) => columns.map((column) => sanitizeCell(formatScalar(row[column]))))
  const widths = columns.map((_, c) => matrix.reduce((max, cells) => Math.max(max, displayWidth(cells[c])), displayWidth(headerCells[c])))

  const renderLine = (values: string[]) => values.map((value, index) => value + " ".repeat(Math.max(0, widths[index] - displayWidth(value)))).join("  ")

  const header = renderLine(headerCells)
  const divider = renderLine(widths.map((width) => "-".repeat(width)))
  const body = matrix.map((cells) => renderLine(cells))

  return [header, divider, ...body].join("\n")
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(empty)"
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  // Column names come from server data (e.g. EDE indicator display names) — escape
  // them like cell values or a name containing | / , breaks the whole table.
  const header = `| ${columns.map((column) => sanitizeCell(column).replaceAll("|", "\\|")).join(" | ")} |`
  const divider = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${columns.map((column) => sanitizeCell(formatScalar(row[column])).replaceAll("|", "\\|")).join(" | ")} |`)
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

export function renderOutput(value: unknown, format: OutputFormat): string {
  // toRows is computed lazily per branch: json never needs it, and jsonl only
  // falls back to it when the value isn't already a {list}/array.
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2)
    case "jsonl": {
      const items = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).list)
        ? (value as Record<string, unknown>).list as unknown[]
        : null
      return (items ?? toRows(value)).map((item) => JSON.stringify(item)).join("\n")
    }
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
export async function streamOutputToFile(value: unknown, format: OutputFormat, outputPath: string): Promise<boolean> {
  if (format !== "jsonl" && format !== "csv") return false

  const list = pickList(value)
  if (!list) return false
  // Below this row count the join() approach is cheaper than per-row writes.
  if (list.length < 1000) return false

  // csv can only stream object rows; an all-scalar list has no columns — fall back
  // to renderOutput's index/value shaping instead of writing a BOM-only file.
  let csvRows: Array<Record<string, unknown>> = []
  let csvColumns: string[] = []
  if (format === "csv") {
    csvRows = list.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    if (csvRows.length === 0) return false
    csvColumns = Array.from(new Set(csvRows.flatMap((row) => Object.keys(row))))
  }

  const { dirname } = await import("node:path")
  const { createWriteStream } = await import("node:fs")
  await fs.mkdir(dirname(outputPath), { recursive: true })

  const stream = createWriteStream(outputPath, { encoding: "utf8" })
  // A stream 'error' with no listener (EACCES on open, ENOSPC mid-write) crashes the
  // process before any write callback fires. Swallow the event here — the failure
  // still surfaces through the write/end callbacks below.
  stream.on("error", () => {})
  try {
    if (format === "jsonl") {
      for (const item of list) {
        await writeLine(stream, JSON.stringify(item))
      }
    } else {
      // BOM so Excel double-click decodes Chinese as UTF-8 instead of ANSI/GBK.
      await writeLine(stream, "\ufeff" + csvColumns.map(csvEscape).join(","))
      for (const row of csvRows) {
        const cells = csvColumns.map((column) => csvEscape(formatScalar(row[column])))
        await writeLine(stream, cells.join(","))
      }
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => err ? reject(err) : resolve())
    })
  } catch (error) {
    // Mirror the download path: never leave a truncated file that looks complete.
    stream.destroy()
    await fs.unlink(outputPath).catch(() => {})
    throw error
  }
  return true
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

function csvEscape(value: string): string {
  let out = value
  // Formula-injection guard, but don't mangle legitimate numbers: a leading
  // -/+ only needs escaping when the cell isn't a finite number (e.g. "-1+cmd"),
  // so values like "-3.5" stay numeric for Excel/pandas.
  if (/^[=@\t\r]/.test(out) || (/^[+\-]/.test(out) && !Number.isFinite(Number(out)))) out = "'" + out
  if (/[",\n\r]/.test(out)) return `"${out.replaceAll("\"", "\"\"")}"`
  return out
}

interface LineSink {
  write(chunk: string, cb?: (err?: Error | null) => void): boolean
  once(event: "drain" | "error", cb: (err?: unknown) => void): unknown
  off(event: "drain" | "error", cb: (err?: unknown) => void): unknown
}

function writeLine(stream: LineSink, line: string): Promise<void> {
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

export async function saveOutputIfNeeded(content: string | Uint8Array, outputPath?: string): Promise<void> {
  if (!outputPath) {
    return
  }

  const { dirname } = await import("node:path")
  await fs.mkdir(dirname(outputPath), { recursive: true })

  if (typeof content === "string") {
    await fs.writeFile(outputPath, content, "utf8")
    return
  }

  await fs.writeFile(outputPath, content)
}
