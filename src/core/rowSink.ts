import { createReadStream, createWriteStream, type WriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

import { zipFieldRow } from "./normalize.js"
import { csvEscape, formatScalar, writeLine } from "./output.js"
import { extractTitles, MAX_TITLES_PER_ENDPOINT, type TitleCacheConfig } from "./titleCache.js"

/** Non-enumerable key under which a producer hangs the sink it streamed into on the result
 * it returns, so printData can finish the file without a new parameter on every call site.
 * Like ENVELOPE_TRACE_ID it is invisible to spreads and JSON. */
export const ROW_SINK = Symbol("gangtise.rowSink")

/** Rows below which a result is handed back whole to the ordinary in-memory render path
 * (whose file output then stays byte-identical to a non-streamed run). Matches
 * streamOutputToFile's threshold. */
const STREAM_THRESHOLD = 1000

export type SinkFormat = "jsonl" | "csv"

/**
 * Ordered, bounded-memory export of a large result. A fetch-all / sharded / per-security
 * producer pushes rows as its parts arrive — in part order, see runInOrder — instead of
 * collecting them. The sink buffers the first rows and only opens a file once the result
 * proves large; finish() moves the finished file over the target (abort() removes the
 * partial files). Metadata — total, partial, failedPages … — still travels on the result
 * object, whose `list` is empty when a sink took the rows.
 *
 * jsonl is written directly: every line is self-describing. csv needs the union of the
 * columns in its header before any row, so rows first go to `<file>.rows.part` as jsonl
 * while the column set accumulates; finish() then streams that file back line by line
 * into the csv (two passes over disk, still O(1) memory). Row shaping matches
 * rowsFromList: object rows under the union of their keys, scalar rows dropped when any
 * object row exists and shown as index/value pairs otherwise.
 */
export class ExportSink {
  /** Rows written out. */
  rows = 0
  /** Titles seen in the rows written out, for the download-name cache (the rows are gone).
   * Capped at the cache's own per-endpoint limit so a huge export cannot grow it. */
  readonly titles: Record<string, string> = {}
  private titleCount = 0
  private buffer: unknown[] = []
  private stream: WriteStream | null = null
  private fields: unknown[] | undefined
  private finished = false
  /** csv: column union in first-appearance order, and how many object rows contributed. */
  private readonly columns: string[] = []
  private readonly columnSet = new Set<string>()
  private objectRows = 0

  constructor(readonly outputPath: string, readonly format: SinkFormat = "jsonl", private readonly cache?: TitleCacheConfig) {}

  get opened(): boolean {
    return this.stream !== null
  }

  /** Rows delivered so far, written or still buffered. */
  get count(): number {
    return this.rows + this.buffer.length
  }

  /** Data rows the finished file holds: every jsonl line, or for csv the object rows
   * (scalar rows are dropped when any object row exists, else each scalar is one row). */
  get dataRows(): number {
    if (this.format === "jsonl") return this.rows
    return this.objectRows > 0 ? this.objectRows : this.rows
  }

  private get partPath(): string {
    return `${this.outputPath}.part`
  }

  private get rowsPath(): string {
    return `${this.outputPath}.rows.part`
  }

  /** Columns to zip array rows against; a columnar producer sets this once its header is
   * fixed, before pushing rows. Object rows are written as they are. */
  setFieldList(fields: unknown[] | undefined): void {
    this.fields = fields
  }

  async push(rows: unknown[]): Promise<void> {
    if (this.stream) {
      await this.write(rows)
      return
    }
    for (const row of rows) this.buffer.push(row)
    if (this.buffer.length < STREAM_THRESHOLD) return
    await this.open()
    const buffered = this.buffer
    this.buffer = []
    await this.write(buffered)
  }

  /** The buffered rows of a result that never crossed the threshold — raw, so the caller's
   * normalizeRows zips them like any other result. */
  takeBuffer(): unknown[] {
    const rows = this.buffer
    this.buffer = []
    return rows
  }

  /** Close the file(s) and move the finished export over the target. A failure removes the
   * partial files. */
  async finish(): Promise<void> {
    const stream = this.stream
    if (!stream || this.finished) return
    try {
      await endStream(stream)
      if (this.format === "csv") await this.assembleCsv()
      await fs.rename(this.partPath, this.outputPath)
      this.finished = true
    } catch (error) {
      await this.abort()
      throw error
    }
  }

  /** Drop the partial files. A no-op when nothing was opened or the file is finished, so
   * callers can run it unconditionally on the way out. */
  async abort(): Promise<void> {
    const stream = this.stream
    if (!stream || this.finished) return
    this.finished = true
    // Same dance as streamOutputToFile: the stream opens lazily, so wait for 'close'
    // before unlinking or the .part can reappear after being "removed".
    stream.destroy()
    if (!stream.closed) await new Promise<void>((resolve) => stream.once("close", resolve))
    await fs.unlink(this.partPath).catch(() => {})
    await fs.unlink(this.rowsPath).catch(() => {})
  }

  private async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.outputPath), { recursive: true })
    const stream = createWriteStream(this.format === "csv" ? this.rowsPath : this.partPath, { encoding: "utf8" })
    // Surfaced through the write/end callbacks; an unhandled 'error' would crash the process.
    stream.on("error", () => {})
    this.stream = stream
  }

  private async write(rows: unknown[]): Promise<void> {
    const stream = this.stream as WriteStream
    for (const row of rows) {
      const item = Array.isArray(row) && this.fields ? zipFieldRow(this.fields, row) : row
      if (this.format === "csv" && isObjectRow(item)) {
        this.objectRows++
        for (const key of Object.keys(item)) {
          if (!this.columnSet.has(key)) {
            this.columnSet.add(key)
            this.columns.push(key)
          }
        }
      }
      await writeLine(stream, JSON.stringify(item))
      this.rows++
      if (this.cache && this.titleCount < MAX_TITLES_PER_ENDPOINT) {
        for (const [id, title] of Object.entries(extractTitles([item], this.cache))) {
          if (!(id in this.titles)) this.titleCount++
          this.titles[id] = title
        }
      }
    }
  }

  /** Second pass for csv: the buffered jsonl rows become the csv, header first. */
  private async assembleCsv(): Promise<void> {
    const out = createWriteStream(this.partPath, { encoding: "utf8" })
    out.on("error", () => {})
    const objectMode = this.objectRows > 0
    const columns = objectMode ? this.columns : ["index", "value"]
    // BOM so Excel double-click decodes Chinese as UTF-8 instead of ANSI/GBK.
    await writeLine(out, "\ufeff" + columns.map(csvEscape).join(","))
    const lines = readline.createInterface({ input: createReadStream(this.rowsPath, { encoding: "utf8" }), crlfDelay: Infinity })
    let index = 0
    for await (const line of lines) {
      if (!line) continue
      const item = JSON.parse(line) as unknown
      if (objectMode) {
        if (!isObjectRow(item)) continue
        await writeLine(out, columns.map((column) => csvEscape(formatScalar(item[column]))).join(","))
      } else {
        await writeLine(out, `${csvEscape(String(index++))},${csvEscape(formatScalar(item))}`)
      }
    }
    await endStream(out)
    await fs.unlink(this.rowsPath).catch(() => {})
  }
}

function isObjectRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => err ? reject(err) : resolve())
  })
}

export function attachRowSink<T extends object>(result: T, sink: ExportSink): T {
  Object.defineProperty(result, ROW_SINK, { value: sink, enumerable: false, configurable: true })
  return result
}

export function getRowSink(value: unknown): ExportSink | undefined {
  if (!value || typeof value !== "object") return undefined
  const sink = (value as Record<symbol, unknown>)[ROW_SINK]
  return sink instanceof ExportSink ? sink : undefined
}

/** Rows a result holds — in its list, or already handed to a sink. Completeness checks
 * that size a result must use this, not `list.length`, or a streamed result reads as empty. */
export function rowCount(value: unknown): number {
  const sink = getRowSink(value)
  if (sink) return sink.count
  const list = value && typeof value === "object" ? (value as Record<string, unknown>).list : undefined
  return Array.isArray(list) ? list.length : 0
}
