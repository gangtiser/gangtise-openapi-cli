import type { OutputFormat } from "./config.js"
import { normalizeRows } from "./normalize.js"
import { renderOutput, saveOutputIfNeeded, streamOutputToFile } from "./output.js"
import { extractTitles, type TitleCacheConfig, writeTitleCache } from "./titleCache.js"

export async function printData(data: unknown, format: OutputFormat, output?: string, cache?: TitleCacheConfig): Promise<void> {
  const normalized = normalizeRows(data)

  const items = Array.isArray(normalized)
    ? normalized
    : (normalized && typeof normalized === "object" && Array.isArray((normalized as Record<string, unknown>).list))
      ? (normalized as Record<string, unknown>).list as unknown[]
      : null

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
  }

  if (output) {
    if (await streamOutputToFile(normalized, format, output)) {
      process.stdout.write(`${output}\n`)
      return
    }
    const content = renderOutput(normalized, format)
    await saveOutputIfNeeded(content, output)
    process.stdout.write(`${output}\n`)
    return
  }
  process.stdout.write(`${renderOutput(normalized, format)}\n`)
}
