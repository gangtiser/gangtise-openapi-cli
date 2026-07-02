import fs from "node:fs/promises"
import { extname } from "node:path"

import { DownloadError } from "./errors.js"
import { saveOutputIfNeeded } from "./output.js"
import { lookupTitleCache, readTitleCache, TITLE_LOOKUP_SIZE } from "./titleCache.js"

/** Replace filesystem-unsafe characters (path separators, wildcards, and control
 * characters / NUL) with `_` so a title or a server-supplied filename can't create
 * stray subdirectories, escape the intended output path, or break fs.writeFile.
 * Shared by title-based naming and the download fallback. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_")
}

/** Keep auto-derived filenames under 200 UTF-8 bytes, preserving the extension.
 * ext4 caps directory entries at 255 bytes — long Chinese titles hit that at
 * ~85 chars (3 bytes each) and fs.writeFile throws ENAMETOOLONG after the body
 * has already been downloaded. */
function truncateFilename(name: string, maxBytes = 200): string {
  if (Buffer.byteLength(name, "utf8") <= maxBytes) return name
  const ext = extname(name)
  let stem = name.slice(0, name.length - ext.length)
  while (stem.length > 1 && Buffer.byteLength(stem + ext, "utf8") > maxBytes) stem = stem.slice(0, -1)
  return stem + ext
}

/** Pick a non-existing path by suffixing -1, -2, … before the extension, so batch
 * downloads whose titles collide ("2025年第一季度报告" from several companies) don't
 * silently overwrite each other. Only auto-derived names go through this — an
 * explicit --output path keeps plain overwrite semantics. */
export async function uniquePath(p: string): Promise<string> {
  const exists = (f: string) => fs.access(f).then(() => true, () => false)
  if (!(await exists(p))) return p
  const ext = extname(p)
  const stem = p.slice(0, p.length - ext.length)
  for (let i = 1; i <= 99; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!(await exists(candidate))) return candidate
  }
  return p
}

export interface DownloadResult {
  data?: Uint8Array
  text?: string
  url?: string
  filename?: string
  contentType?: string
  /** Set by the client when the body was streamed straight to disk. */
  savedPath?: string
}

interface TitleLookupClient {
  call(endpointKey: string, body?: unknown, query?: Record<string, string | number>): Promise<unknown>
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/gzip": ".gz",
  "application/x-7z-compressed": ".7z",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "application/octet-stream": ".bin",
}

export function extFromContentType(contentType?: string): string {
  if (!contentType) return ""
  const mime = contentType.split(";")[0].trim().toLowerCase()
  return MIME_EXT[mime] ?? ""
}

export async function resolveTitle(
  client: TitleLookupClient,
  result: unknown,
  listEndpoint: string,
  idField: string,
  idValue: string,
  titleField = "title",
): Promise<string | undefined> {
  const file = result as { filename?: string; contentType?: string }
  const serverExt = file.filename ? extname(file.filename) : extFromContentType(file.contentType)

  function buildFilename(rawTitle: string): string {
    let title = sanitizeFilename(rawTitle).trim()
    if (serverExt && !title.toLowerCase().endsWith(serverExt.toLowerCase())) {
      title += serverExt
    }
    return truncateFilename(title)
  }

  try {
    const cacheData = await readTitleCache()
    const cached = lookupTitleCache(cacheData, listEndpoint, idValue)
    if (cached) return buildFilename(cached)
  } catch {
    // Ignore corrupt cache data and fall back to the list endpoint.
  }

  try {
    const resp = await client.call(listEndpoint, { from: 0, size: TITLE_LOOKUP_SIZE }) as { list?: Array<Record<string, unknown>> }
    const items = Array.isArray(resp) ? resp : (resp.list ?? [])
    const match = items.find(item => String(item[idField]) === String(idValue))
    const rawTitle = match?.[titleField]
    if (typeof rawTitle === "string" && rawTitle) return buildFilename(rawTitle)
  } catch {
    return undefined
  }

  return undefined
}

async function downloadUrlTo(url: string, outputPath: string): Promise<void> {
  const { createWriteStream } = await import("node:fs")
  const { Readable } = await import("node:stream")
  const { pipeline } = await import("node:stream/promises")
  const { dirname } = await import("node:path")

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new DownloadError(`Failed to fetch download URL (HTTP ${response.status})`)
  }
  await fs.mkdir(dirname(outputPath), { recursive: true })
  try {
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(outputPath))
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {})
    throw error
  }
}

export async function saveDownloadResult(result: unknown, fallbackName: string, output?: string): Promise<void> {
  if (!(result && typeof result === "object")) {
    throw new DownloadError("Unexpected download response")
  }

  const file = result as DownloadResult
  // The fallback prefix embeds a user-supplied id (e.g. --report-id): sanitize it
  // like server-provided names so an auto filename never interprets input as a path.
  const safeFallback = sanitizeFilename(fallbackName)

  if (typeof file.savedPath === "string") {
    process.stdout.write(`${file.savedPath}\n`)
    return
  }

  if (file.data instanceof Uint8Array) {
    // Sanitize the server-provided filename so a Content-Disposition value with
    // / or : can't write outside the intended path (same rule as buildFilename).
    const autoName = (file.filename ? sanitizeFilename(file.filename) : undefined) ?? (safeFallback + extFromContentType(file.contentType))
    const outputPath = output ?? await uniquePath(truncateFilename(autoName))
    await saveOutputIfNeeded(file.data, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.text === "string") {
    const outputPath = output ?? await uniquePath(truncateFilename(`${safeFallback}.txt`))
    await saveOutputIfNeeded(file.text, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.url === "string") {
    if (output) {
      // The server handed us a (typically signed, short-lived) URL instead of the
      // bytes. The user asked for a file — follow the URL and stream the content
      // to disk instead of writing the URL string into a fake .pdf.
      await downloadUrlTo(file.url, output)
      process.stdout.write(`${output}\n`)
      return
    }
    process.stdout.write(`${file.url}\n`)
    return
  }

  throw new DownloadError("Unexpected download response")
}
