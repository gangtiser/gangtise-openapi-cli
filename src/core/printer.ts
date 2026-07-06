import type { OutputFormat } from "./config.js"
import { normalizeRows } from "./normalize.js"
import { pickList, renderOutput, saveOutputIfNeeded, streamOutputToFile } from "./output.js"
import { extractTitles, type TitleCacheConfig, writeTitleCache } from "./titleCache.js"

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

export async function printData(data: unknown, format: OutputFormat, output?: string, cache?: TitleCacheConfig): Promise<void> {
  const normalized = normalizeRows(data)

  const items = pickList(normalized)

  if (cache && items) {
    const titles = extractTitles(items, cache)
    if (Object.keys(titles).length > 0) {
      writeTitleCache(cache.endpointKey, titles).catch(() => {})
    }
  }

  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const meta = normalized as Record<string, unknown>
    if (typeof meta.total === "number" && format !== "json") {
      const listLen = Array.isArray(meta.list) ? (meta.list as unknown[]).length : 0
      process.stderr.write(`Total: ${meta.total}, showing: ${listLen}\n`)
    }
    // Partial results (failed pages/shards) exit with code 3: the table/csv/jsonl
    // renderers only emit the rows, so without a distinct exit code a script or AI
    // consumer cannot tell a partial export from a complete one.
    if (meta.partial === true) {
      process.exitCode = 3
    }
  }

  if (output) {
    if (await streamOutputToFile(normalized, format, output)) {
      process.stdout.write(`${output}\n`)
      return
    }
    // streamOutputToFile declined (non-stream format, or an all-scalar csv list) \u2192 we
    // fall back to renderOutput, which builds the whole result as one string.
    warnIfLargeInMemory(items, format)
    const content = renderOutput(normalized, format)
    // CSV files get a BOM so Excel double-click decodes Chinese as UTF-8 (stdout
    // stays BOM-free for pipes).
    await saveOutputIfNeeded(format === "csv" ? `\ufeff${content}` : content, output)
    process.stdout.write(`${output}\n`)
    return
  }
  warnIfLargeInMemory(items, format)
  process.stdout.write(`${renderOutput(normalized, format)}\n`)
}
