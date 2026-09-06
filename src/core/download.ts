import fs from "node:fs/promises"
import { dirname, extname } from "node:path"

import { DownloadError } from "./errors.js"
import { saveOutputIfNeeded } from "./output.js"
import { extractTitles, lookupTitleCache, readTitleCache, TITLE_LOOKUP_SIZE, writeTitleCache } from "./titleCache.js"

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
  // Trim by code point, not UTF-16 unit: a cut inside a surrogate pair would put
  // a lone surrogate in the name, which reaches the filesystem as U+FFFD (�).
  const stem = [...name.slice(0, name.length - ext.length)]
  while (stem.length > 1 && Buffer.byteLength(stem.join("") + ext, "utf8") > maxBytes) stem.pop()
  return stem.join("") + ext
}

/** Pick a non-existing path by suffixing -1, -2, … before the extension, so batch
 * downloads whose titles collide ("2025年第一季度报告" from several companies) don't
 * silently overwrite each other. Only auto-derived names go through this — an
 * explicit --output path keeps plain overwrite semantics. Throws instead of
 * falling back to the original path once the suffixes run out: returning `p`
 * there would silently overwrite the very first file. */
/**
 * A not-yet-taken sibling of `p` (`p`, `p-1`, `p-2`, …), CLAIMED: its `.part` file is
 * created exclusively (O_EXCL) on the way out. Checking existence alone is a race — two
 * processes resolving the same auto name together both got `p`, shared one `.part`, and
 * one then failed with ENOENT on rename while the other published the wrong bytes. The
 * claimed `.part` is what the writer truncates and renames over the target, so nothing
 * changes downstream; a stale `.part` from a crashed run merely skips that candidate.
 * Release with `releaseClaim` if the write never happens.
 */
export async function uniquePath(p: string): Promise<string> {
  const exists = (f: string) => fs.access(f).then(() => true, () => false)
  const claim = async (f: string): Promise<boolean> => {
    if (await exists(f)) return false
    try {
      const handle = await fs.open(`${f}.part`, "wx")
      await handle.close()
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
      throw error
    }
  }
  await fs.mkdir(dirname(p) || ".", { recursive: true })
  if (await claim(p)) return p
  const ext = extname(p)
  const stem = p.slice(0, p.length - ext.length)
  for (let i = 1; i <= 99; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (await claim(candidate)) return candidate
  }
  throw new DownloadError(`Refusing to overwrite: 100 files already share the name "${p}" — pass --output or clean up the directory`)
}

/** Drop the `.part` a uniquePath claim created, when the write it was reserved for never happened. */
export async function releaseClaim(p: string): Promise<void> {
  await fs.unlink(`${p}.part`).catch(() => {})
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

/**
 * Resolve a friendly filename for a downloaded file.
 *
 * The title cache (populated by any prior `list` on the same endpoint) is always
 * consulted and is free. The LIST FALLBACK is not: `TITLE_LOOKUP_SIZE` rows across
 * 4 requests, and 9 of the 12 endpoints wired up for title lookup are metered at
 * 0.1 credits/row — roughly 20 credits levied for nothing but a nicer filename, on
 * a download that itself costs 10–50. So the fallback is opt-in (`--resolve-title`)
 * and off by default; without it the caller keeps the server's own
 * Content-Disposition name, or `<prefix>-<id>.<ext>`.
 */
export async function resolveTitle(
  client: TitleLookupClient,
  result: unknown,
  listEndpoint: string,
  idField: string,
  idValue: string,
  options: { titleField?: string; allowLookup?: boolean } = {},
): Promise<string | undefined> {
  const titleField = options.titleField ?? "title"
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

  if (!options.allowLookup) return undefined

  // `process.exitCode` is saved and restored around the lookup. The call below goes
  // through `requestPaginated`, which sets exit 3 on a malformed first page — a verdict
  // about THIS LOOKUP, not about the file that was already downloaded intact. Leaving it
  // set makes a complete download report "data is incomplete", which is the one thing
  // exit 3 must never be able to say wrongly. Restoring the previous value (rather than
  // clearing) keeps an exit code set before the lookup.
  const previousExitCode = process.exitCode
  try {
    const resp = await client.call(listEndpoint, { from: 0, size: TITLE_LOOKUP_SIZE }) as { list?: Array<Record<string, unknown>> }
    const items = Array.isArray(resp) ? resp : (resp?.list ?? [])
    // Bank the WHOLE page set, not just the row we came for: those rows are already
    // paid for, and without the write-back a batch of N downloads re-buys them N times
    // (measured: 4 list requests per download, every time).
    const titles = extractTitles(items, { endpointKey: listEndpoint, idField, titleField })
    if (Object.keys(titles).length > 0) {
      await writeTitleCache(listEndpoint, titles).catch(() => {})
    }
    const rawTitle = titles[String(idValue)]
    if (rawTitle) return buildFilename(rawTitle)
  } catch {
    return undefined
  } finally {
    process.exitCode = previousExitCode
  }

  return undefined
}

async function downloadUrlTo(url: string, outputPath: string): Promise<void> {
  const { createWriteStream } = await import("node:fs")
  const { pipeline } = await import("node:stream/promises")
  const { dirname } = await import("node:path")
  const { request } = await import("undici")
  const { getDispatcher, logTiming, withRetry } = await import("./transport.js")
  const { loadConfig } = await import("./config.js")

  // Through the transport layer instead of a bare global fetch: the configured
  // timeout applies (a slow-drip CDN can no longer hang the CLI indefinitely),
  // network-level failures retry, and --verbose logs the request.
  const timeoutMs = loadConfig().timeoutMs
  await fs.mkdir(dirname(outputPath), { recursive: true })
  // Signed URLs carry credentials in the query string — verbose logs must strip
  // search/hash so signatures never land in terminal/CI logs.
  const redactUrl = (u: string): string => {
    try {
      const parsed = new URL(u)
      return parsed.origin + parsed.pathname
    } catch {
      return "signed-url"
    }
  }
  // .part + rename so a failed follow-download never destroys an existing file.
  const partPath = `${outputPath}.part`
  await withRetry(async () => {
    const startedAt = Date.now()
    const requestOptions = {
      method: "GET" as const,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      // headers/body timeouts are IDLE timeouts — a stream trickling one byte
      // per interval resets them forever. A generous total deadline (10× the
      // per-request timeout) bounds the whole transfer without killing large
      // legitimate downloads.
      signal: AbortSignal.timeout(timeoutMs * 10),
      dispatcher: getDispatcher(),
    }
    let currentUrl = url
    let response = await request(currentUrl, requestOptions)
    // undici does not follow redirects (the old global fetch did): a signed URL
    // may 302 to the real CDN object. Follow a bounded number of hops; no
    // Authorization header is involved on this path, so nothing leaks cross-origin.
    for (let hops = 0; hops < 3 && response.statusCode >= 300 && response.statusCode < 400; hops++) {
      const locationHeader = response.headers.location
      const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader
      if (!location) break
      await response.body.text().catch(() => {})
      currentUrl = new URL(location, currentUrl).toString()
      response = await request(currentUrl, requestOptions)
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      await response.body.text().catch(() => {})
      throw new DownloadError(`Failed to fetch download URL: unresolved redirect (HTTP ${response.statusCode})`)
    }
    if (response.statusCode >= 400) {
      await response.body.text().catch(() => {})
      // DownloadError (not retried): signed URLs expire — replaying a 403 is useless.
      throw new DownloadError(`Failed to fetch download URL (HTTP ${response.statusCode})`)
    }
    try {
      await pipeline(response.body, createWriteStream(partPath))
    } catch (error) {
      await fs.unlink(partPath).catch(() => {})
      throw error
    }
    logTiming(`GET ${redactUrl(currentUrl)}`, Date.now() - startedAt, String(response.statusCode))
  })
  try {
    await fs.rename(partPath, outputPath)
  } catch (error) {
    // e.g. outputPath turned out to be a directory — don't leave the .part behind.
    await fs.unlink(partPath).catch(() => {})
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
