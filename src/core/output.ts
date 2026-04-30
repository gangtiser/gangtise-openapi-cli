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
  const widths = columns.map((column) => {
    const cellWidths = rows.map((row) => formatScalar(row[column]).length)
    return Math.max(column.length, ...cellWidths)
  })

  const renderLine = (values: string[]) => values.map((value, index) => value.padEnd(widths[index], " ")).join("  ")

  const header = renderLine(columns)
  const divider = renderLine(widths.map((width) => "-".repeat(width)))
  const body = rows.map((row) => renderLine(columns.map((column) => formatScalar(row[column]))))

  return [header, divider, ...body].join("\n")
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(empty)"
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const header = `| ${columns.join(" | ")} |`
  const divider = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${columns.map((column) => formatScalar(row[column]).replaceAll("|", "\\|")).join(" | ")} |`)
  return [header, divider, ...body].join("\n")
}

function renderCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return ""
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const escape = (value: string) => {
    if (/^[=+\-@\t\r]/.test(value)) {
      value = "'" + value
    }
    if (/[",\n]/.test(value)) {
      return `"${value.replaceAll("\"", "\"\"")}"`
    }
    return value
  }

  const header = columns.join(",")
  const body = rows.map((row) => columns.map((column) => escape(formatScalar(row[column]))).join(","))
  return [header, ...body].join("\n")
}

export function renderOutput(value: unknown, format: OutputFormat): string {
  const rows = toRows(value)

  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2)
    case "jsonl": {
      const items = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).list)
        ? (value as Record<string, unknown>).list as unknown[]
        : null
      return (items ?? rows).map((item) => JSON.stringify(item)).join("\n")
    }
    case "csv":
      return renderCsv(rows)
    case "markdown":
      return renderMarkdown(rows)
    case "table":
    default:
      return renderTable(rows)
  }
}

export async function saveOutputIfNeeded(content: string | Uint8Array, outputPath?: string): Promise<void> {
  if (!outputPath) {
    return
  }

  const { dirname } = await import("node:path")
  await (await import("node:fs/promises")).mkdir(dirname(outputPath), { recursive: true })

  if (typeof content === "string") {
    await fs.writeFile(outputPath, content, "utf8")
    return
  }

  await fs.writeFile(outputPath, content)
}
