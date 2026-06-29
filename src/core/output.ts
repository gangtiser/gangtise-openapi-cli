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

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function toRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return value as Array<Record<string, unknown>>
    }
    return value.map((item, index) => ({ index, value: item }))
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.list)) {
      const list = record.list
      if (list.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        return list as Array<Record<string, unknown>>
      }
      return list.map((item, index) => ({ index, value: item }))
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
  // Format every cell once (formatScalar may JSON.stringify objects), collapsing
  // newlines so multi-line fields don't break alignment. Reuse the matrix for both
  // width and rendering — and compute widths with reduce, NOT Math.max(...arr):
  // spreading a per-row array overflows the call stack on large results (table is
  // the default format, e.g. `quote day-kline --security all`).
  const matrix = rows.map((row) => columns.map((column) => formatScalar(row[column]).replace(/[\r\n]+/g, " ")))
  const widths = columns.map((column, c) => matrix.reduce((max, cells) => Math.max(max, cells[c].length), column.length))

  const renderLine = (values: string[]) => values.map((value, index) => value.padEnd(widths[index], " ")).join("  ")

  const header = renderLine(columns)
  const divider = renderLine(widths.map((width) => "-".repeat(width)))
  const body = matrix.map((cells) => renderLine(cells))

  return [header, divider, ...body].join("\n")
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(empty)"
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const header = `| ${columns.join(" | ")} |`
  const divider = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${columns.map((column) => formatScalar(row[column]).replace(/[\r\n]+/g, " ").replaceAll("|", "\\|")).join(" | ")} |`)
  return [header, divider, ...body].join("\n")
}

function renderCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return ""
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const header = columns.join(",")
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

  const { dirname } = await import("node:path")
  const { createWriteStream } = await import("node:fs")
  await fs.mkdir(dirname(outputPath), { recursive: true })

  const stream = createWriteStream(outputPath, { encoding: "utf8" })
  try {
    if (format === "jsonl") {
      for (const item of list) {
        await writeLine(stream, JSON.stringify(item))
      }
    } else {
      const objectRows = list.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
      const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))))
      await writeLine(stream, columns.join(","))
      for (const row of objectRows) {
        const cells = columns.map((column) => csvEscape(formatScalar(row[column])))
        await writeLine(stream, cells.join(","))
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => err ? reject(err) : resolve())
    })
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

function writeLine(stream: { write(chunk: string, cb?: (err?: Error | null) => void): boolean; once(event: "drain", cb: () => void): unknown }, line: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ok = stream.write(line + "\n", (err?: Error | null) => err ? reject(err) : undefined)
    if (ok) resolve()
    else stream.once("drain", () => resolve())
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
