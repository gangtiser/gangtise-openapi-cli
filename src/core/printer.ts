import path from "node:path"

import type { OutputFormat } from "./config.js"
import { normalizeRows } from "./normalize.js"
import { pickList, renderOutput, saveOutputIfNeeded, streamOutputToFile } from "./output.js"
import { getRowSink } from "./rowSink.js"
import { extractTitles, type TitleCacheConfig, writeTitleCache } from "./titleCache.js"
import { CLI_VERSION } from "../version.js"

/** Rows above which renderOutput's single in-memory string risks high memory / the V8
 * max-string-length cap. Well above normal result sizes, so it only fires on huge exports. */
const LARGE_RESULT_ROWS = 50_000

/** Warn when we're about to renderOutput a huge result. Called only on the paths that
 * actually render — never after streamOutputToFile streamed — so it can't misfire on a
 * genuinely streamed export, and it DOES fire on the all-scalar-csv list that streaming
 * declines (which then falls back to a full in-memory string). */
function warnIfLargeInMemory(items: unknown[] | null, format: OutputFormat): void {
  if (items && items.length >= LARGE_RESULT_ROWS) {
    process.stderr.write(`[gangtise] note: ${items.length} rows in '${format}' is built entirely in memory; stream large exports to a file with --format jsonl --output <path> (or csv).\n`)
  }
}

/** Local time with the machine's UTC offset, so a reader elsewhere can place the fetch. */
function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * `<output>.meta.json` beside a csv / jsonl export: what was asked, when, how many rows
 * came back, the columns, and every completeness marker the result carried (`result`
 * holds all of the result's top-level keys except the rows). Those two formats hold rows
 * only, so once the file leaves this machine nothing else says whether it was partial;
 * a json export carries the markers inline and gets no sidecar.
 */
async function writeExportMeta(output: string, format: OutputFormat, rows: number, columns: unknown[] | undefined, normalized: unknown): Promise<void> {
  const result = normalized && typeof normalized === "object" && !Array.isArray(normalized) ? { ...(normalized as Record<string, unknown>) } : {}
  delete result.list
  const partial = result.partial === true
  const doc = {
    file: path.basename(output),
    format,
    rows,
    complete: !partial,
    exitCode: partial ? 3 : 0,
    command: process.argv.slice(2),
    cliVersion: CLI_VERSION,
    fetchedAt: localIso(new Date()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    columns,
    result,
  }
  await saveOutputIfNeeded(`${JSON.stringify(doc, null, 2)}\n`, `${output}.meta.json`)
}

export async function printData(data: unknown, format: OutputFormat, output?: string, cache?: TitleCacheConfig): Promise<void> {
  const sink = getRowSink(data)
  // A result that never grew past the sink's threshold comes back here whole and takes the
  // ordinary path below, so its file is byte-identical to a non-streamed run.
  if (sink && !sink.opened) (data as Record<string, unknown>).list = sink.takeBuffer()
  const streamed = sink?.opened ? sink : undefined
  const columns = data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).fieldList)
    ? (data as Record<string, unknown>).fieldList as unknown[]
    : undefined

  const normalized = normalizeRows(data)

  const items = pickList(normalized)
  const rows = streamed ? streamed.rows : (items?.length ?? 0)

  if (cache) {
    const titles = { ...(streamed?.titles ?? {}), ...(items ? extractTitles(items, cache) : {}) }
    if (Object.keys(titles).length > 0) {
      writeTitleCache(cache.endpointKey, titles).catch(() => {})
    }
  }

  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const meta = normalized as Record<string, unknown>
    if (typeof meta.total === "number" && format !== "json") {
      process.stderr.write(`Total: ${meta.total}, showing: ${rows}\n`)
    }
    // Incomplete results exit with code 3: the table/csv/jsonl renderers only
    // emit the rows, so without a distinct exit code a script or AI consumer
    // cannot tell such an export from a clean one. `partial` means rows are
    // missing — failed pages/shards, a row cap, or an EDE response that dropped
    // whole securities/indicators because it did not recognise those codes.
    if (meta.partial === true) {
      process.exitCode = 3
    }
  }

  if (output) {
    if (streamed) {
      // Rows are already on disk in order; close and move the file into place.
      await streamed.finish()
    } else if (!(await streamOutputToFile(normalized, format, output))) {
      // streamOutputToFile declined (non-stream format, or an all-scalar csv list) → we
      // fall back to renderOutput, which builds the whole result as one string.
      warnIfLargeInMemory(items, format)
      const content = renderOutput(normalized, format)
      // CSV files get a BOM so Excel double-click decodes Chinese as UTF-8 (stdout
      // stays BOM-free for pipes).
      await saveOutputIfNeeded(format === "csv" ? `\ufeff${content}` : content, output)
    }
    if (format === "csv" || format === "jsonl") await writeExportMeta(output, format, rows, columns, normalized)
    process.stdout.write(`${output}\n`)
    return
  }
  warnIfLargeInMemory(items, format)
  const rendered = renderOutput(normalized, format)
  // An empty render means "no rows at all". Appending the newline anyway would put
  // one blank line on stdout — `wc -l` reports 1 and `while read` yields one empty
  // record, which is exactly the phantom row the null-payload guard in toRows()
  // removes. Table/markdown render "(empty)" so they are unaffected.
  if (rendered) process.stdout.write(`${rendered}\n`)
}
