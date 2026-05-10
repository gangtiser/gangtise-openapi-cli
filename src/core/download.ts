import { extname } from "node:path"

import { DownloadError } from "./errors.js"
import { saveOutputIfNeeded } from "./output.js"
import { lookupTitleCache, readTitleCache, TITLE_LOOKUP_SIZE } from "./titleCache.js"

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
    let title = rawTitle.replace(/[/\\:*?"<>|]/g, "_").trim()
    if (serverExt && !title.toLowerCase().endsWith(serverExt.toLowerCase())) {
      title += serverExt
    }
    return title
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

export async function saveDownloadResult(result: unknown, fallbackName: string, output?: string): Promise<void> {
  if (!(result && typeof result === "object")) {
    throw new DownloadError("Unexpected download response")
  }

  const file = result as DownloadResult

  if (typeof file.savedPath === "string") {
    process.stdout.write(`${file.savedPath}\n`)
    return
  }

  if (file.data instanceof Uint8Array) {
    const outputPath = output ?? file.filename ?? (fallbackName + extFromContentType(file.contentType))
    await saveOutputIfNeeded(file.data, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.text === "string") {
    const outputPath = output ?? `${fallbackName}.txt`
    await saveOutputIfNeeded(file.text, outputPath)
    process.stdout.write(`${outputPath}\n`)
    return
  }

  if (typeof file.url === "string") {
    if (output) {
      await saveOutputIfNeeded(file.url, output)
      process.stdout.write(`${output}\n`)
      return
    }
    process.stdout.write(`${file.url}\n`)
    return
  }

  throw new DownloadError("Unexpected download response")
}
