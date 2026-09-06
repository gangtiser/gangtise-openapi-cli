import fs from "node:fs/promises"
import path from "node:path"

import type { OutputFormat } from "./config.js"
import { normalizeRows } from "./normalize.js"
import { countOutputRows, pickList, renderOutput, saveOutputIfNeeded, streamOutputToFile } from "./output.js"
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

/** Keys whose values never belong in a sidecar: the credentials on a `raw call auth.login`
 * body, the token such a call returns. Matched on the key name, not the option name — the
 * secret can sit inside a JSON argument. */
const SECRET_KEY = /^(access|secret|api|private)?key$|secret|token|password|credential/i

/** Replace secret-looking values anywhere in a JSON-shaped value. A string that parses as
 * JSON (a `--body` argument) is redacted inside and re-serialised — in both argv spellings
 * the CLI accepts, `--body <json>` and `--body=<json>`, and with the leading whitespace
 * JSON allows; the secret must not depend on how the argument was typed. */
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactSecrets(inner)
    return out
  }
  if (typeof value === "string") {
    // `--name=value`: keep the flag, redact the value.
    const eq = value.startsWith("--") ? value.indexOf("=") : -1
    const head = eq > 0 ? value.slice(0, eq + 1) : ""
    const raw = eq > 0 ? value.slice(eq + 1) : value
    const trimmed = raw.trimStart()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (parsed && typeof parsed === "object") return head + JSON.stringify(redactSecrets(parsed))
      } catch {
        // not JSON — leave as is
      }
    }
  }
  return value
}

interface StagedMeta {
  commit(): Promise<void>
  discard(): Promise<void>
}

/**
 * `<output>.meta.json` beside a csv / jsonl export: what was asked, when, how many data rows
 * the file holds, the columns, whether the export is complete (the exit code's verdict) and
 * every marker the result carried (`result` holds all of the result's top-level keys except
 * the rows). Those two formats hold rows only, so once the file leaves this machine nothing
 * else says whether it was partial; a json export carries the markers inline and gets none.
 *
 * Staged, not written: the sidecar goes to `.meta.json.part` BEFORE the data file is
 * published and is renamed into place only after — so a failure on either side never leaves
 * new data beside an earlier export's sidecar vouching for it. If even that final rename
 * fails, the stale sidecar is removed rather than left to describe the wrong file.
 */
async function stageExportMeta(output: string, format: OutputFormat, rows: number, columns: unknown[] | undefined, normalized: unknown, complete: boolean): Promise<StagedMeta> {
  const result = normalized && typeof normalized === "object" && !Array.isArray(normalized) ? { ...(normalized as Record<string, unknown>) } : {}
  delete result.list
  const doc = {
    file: path.basename(output),
    format,
    rows,
    complete,
    exitCode: complete ? 0 : 3,
    command: redactSecrets(process.argv.slice(2)),
    cliVersion: CLI_VERSION,
    fetchedAt: localIso(new Date()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    columns,
    result: redactSecrets(result),
  }
  const metaPath = `${output}.meta.json`
  const partPath = `${metaPath}.part`
  await fs.mkdir(path.dirname(output), { recursive: true })
  try {
    await fs.writeFile(partPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8")
  } catch (error) {
    // A write that failed part-way (disk full) leaves a fragment; the caller never gets a
    // handle to discard it, so clean up here.
    await fs.unlink(partPath).catch(() => {})
    throw error
  }
  return {
    async commit() {
      try {
        await fs.rename(partPath, metaPath)
      } catch (error) {
        await fs.unlink(partPath).catch(() => {})
        await fs.unlink(metaPath).catch(() => {})
        throw error
      }
    },
    async discard() {
      await fs.unlink(partPath).catch(() => {})
    },
  }
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
  const showing = streamed ? streamed.rows : (items?.length ?? 0)

  if (cache) {
    const titles = { ...(streamed?.titles ?? {}), ...(items ? extractTitles(items, cache) : {}) }
    if (Object.keys(titles).length > 0) {
      writeTitleCache(cache.endpointKey, titles).catch(() => {})
    }
  }

  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const meta = normalized as Record<string, unknown>
    if (typeof meta.total === "number" && format !== "json") {
      process.stderr.write(`Total: ${meta.total}, showing: ${showing}\n`)
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
  // The sidecar's verdict must be the one the exit code gives: some incompleteness is
  // signalled by exit 3 alone (a first page of unexpected shape), with no `partial` marker.
  const complete = process.exitCode !== 3

  if (output) {
    // Data rows the file will hold, under the renderer's own shaping rules.
    const staged = format === "csv" || format === "jsonl"
      ? await stageExportMeta(output, format, streamed ? streamed.dataRows : countOutputRows(normalized, format), columns, normalized, complete)
      : null
    try {
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
    } catch (error) {
      await staged?.discard()
      throw error
    }
    await staged?.commit()
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
