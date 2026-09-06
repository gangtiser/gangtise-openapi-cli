import { createWriteStream, type WriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { zipFieldRow } from "./normalize.js"
import { writeLine } from "./output.js"
import { extractTitles, type TitleCacheConfig } from "./titleCache.js"

/** Non-enumerable key under which a producer hangs the sink it streamed into on the result
 * it returns, so printData can finish the file without a new parameter on every call site.
 * Like ENVELOPE_TRACE_ID it is invisible to spreads and JSON. */
export const ROW_SINK = Symbol("gangtise.rowSink")

/** Rows below which a result is handed back whole to the ordinary in-memory render path
 * (whose file output then stays byte-identical to a non-streamed run). Matches
 * streamOutputToFile's threshold. */
const STREAM_THRESHOLD = 1000

/**
 * Ordered, bounded-memory jsonl export. A fetch-all / sharded / per-security producer
 * pushes rows as its parts arrive — in part order, see runInOrder — instead of collecting
 * them. The sink buffers the first rows and only opens `<output>.part` once the result
 * proves large, writes each row as it comes, and on finish() renames over the target
 * (abort() removes the partial file). Metadata — total, partial, failedPages … — still
 * travels on the result object, whose `list` is empty when a sink took the rows.
 *
 * Only jsonl streams: every line is self-describing, so rows can go out before the column
 * set is known. csv needs the union of columns in its header first, so a csv export keeps
 * collecting in memory.
 */
export class JsonlRowSink {
  /** Rows written to the file. */
  rows = 0
  /** Titles seen in the rows written out, for the download-name cache (the rows are gone). */
  readonly titles: Record<string, string> = {}
  private buffer: unknown[] = []
  private stream: WriteStream | null = null
  private fields: unknown[] | undefined
  private finished = false

  constructor(readonly outputPath: string, private readonly cache?: TitleCacheConfig) {}

  get opened(): boolean {
    return this.stream !== null
  }

  /** Rows delivered so far, written or still buffered. */
  get count(): number {
    return this.rows + this.buffer.length
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

  /** Close the file and move it over the target. A failure removes the partial file. */
  async finish(): Promise<void> {
    const stream = this.stream
    if (!stream || this.finished) return
    try {
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => err ? reject(err) : resolve())
      })
      await fs.rename(`${this.outputPath}.part`, this.outputPath)
      this.finished = true
    } catch (error) {
      await this.abort()
      throw error
    }
  }

  /** Drop the partial file. A no-op when nothing was opened or the file is finished, so
   * callers can run it unconditionally on the way out. */
  async abort(): Promise<void> {
    const stream = this.stream
    if (!stream || this.finished) return
    this.finished = true
    // Same dance as streamOutputToFile: the stream opens lazily, so wait for 'close'
    // before unlinking or the .part can reappear after being "removed".
    stream.destroy()
    if (!stream.closed) await new Promise<void>((resolve) => stream.once("close", resolve))
    await fs.unlink(`${this.outputPath}.part`).catch(() => {})
  }

  private async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.outputPath), { recursive: true })
    const stream = createWriteStream(`${this.outputPath}.part`, { encoding: "utf8" })
    // Surfaced through the write/end callbacks; an unhandled 'error' would crash the process.
    stream.on("error", () => {})
    this.stream = stream
  }

  private async write(rows: unknown[]): Promise<void> {
    const stream = this.stream as WriteStream
    for (const row of rows) {
      const item = Array.isArray(row) && this.fields ? zipFieldRow(this.fields, row) : row
      await writeLine(stream, JSON.stringify(item))
      this.rows++
      if (this.cache) Object.assign(this.titles, extractTitles([item], this.cache))
    }
  }
}

export function attachRowSink<T extends object>(result: T, sink: JsonlRowSink): T {
  Object.defineProperty(result, ROW_SINK, { value: sink, enumerable: false, configurable: true })
  return result
}

export function getRowSink(value: unknown): JsonlRowSink | undefined {
  if (!value || typeof value !== "object") return undefined
  const sink = (value as Record<symbol, unknown>)[ROW_SINK]
  return sink instanceof JsonlRowSink ? sink : undefined
}

/** Rows a result holds — in its list, or already handed to a sink. Completeness checks
 * that size a result must use this, not `list.length`, or a streamed result reads as empty. */
export function rowCount(value: unknown): number {
  const sink = getRowSink(value)
  if (sink) return sink.count
  const list = value && typeof value === "object" ? (value as Record<string, unknown>).list : undefined
  return Array.isArray(list) ? list.length : 0
}
