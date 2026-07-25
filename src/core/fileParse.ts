import fs from "node:fs/promises"
import path from "node:path"

import { isAsyncPending, nextPollDelayMs, POLL_MAX_ATTEMPTS } from "./asyncContent.js"
import { saveDownloadResult } from "./download.js"
import { ApiError, ValidationError } from "./errors.js"
import { isTransientError } from "./transport.js"

/** Server-side upload cap (spec: ≤100MB, ≤500 pages). Checked locally so a
 * doomed 100MB+ upload fails instantly instead of after a long transfer. */
export const FILE_PARSE_MAX_BYTES = 100 * 1024 * 1024

interface FileParseClient {
  uploadFile<T>(endpointKey: string, file: { filename: string; data: Uint8Array; contentType?: string }): Promise<T>
  call(endpointKey: string, body?: unknown, query?: Record<string, string | number>, options?: { streamTo?: string }): Promise<unknown>
}

/** Upload a PDF and return its taskId. Billed at submit time (0.8 credits/page),
 * so every reason to reject a file is checked before the request goes out. */
export async function submitFileParse(client: FileParseClient, filePath: string): Promise<string> {
  const resolved = path.resolve(filePath)
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new ValidationError(`File not found: ${filePath}`)
  }
  if (!stat.isFile()) throw new ValidationError(`Not a file: ${filePath}`)
  if (stat.size === 0) throw new ValidationError(`File is empty: ${filePath}`)
  if (stat.size > FILE_PARSE_MAX_BYTES) {
    throw new ValidationError(`File is ${(stat.size / 1024 / 1024).toFixed(1)}MB — the parse API accepts at most 100MB`)
  }
  if (path.extname(resolved).toLowerCase() !== ".pdf") {
    throw new ValidationError(`Only PDF files are supported: ${filePath}`)
  }

  // Buffered, not streamed: undici's FormData needs a Blob, so a 100MB file peaks
  // at ~2× its size in memory. Acceptable against the API's own 100MB ceiling —
  // switch to a hand-rolled streaming multipart body if that ceiling ever rises.
  const data = await fs.readFile(resolved)
  const result = await client.uploadFile<{ taskId?: string | number }>("tool.file-parse.submit", {
    filename: path.basename(resolved),
    data,
    contentType: "application/pdf",
  })
  const taskId = result?.taskId
  if (taskId === undefined || taskId === null || taskId === "") {
    throw new ApiError("File parse task was accepted but the response carried no taskId", undefined, undefined, result)
  }
  return String(taskId)
}

/**
 * One result fetch. "pending" = the server answered with the generating code
 * (140001 / legacy 410110); "ok" = the ZIP was written and its path printed.
 * Free to call — only the submit step is billed.
 */
export async function fetchFileParseResult(client: FileParseClient, taskId: string, output?: string): Promise<"ok" | "pending"> {
  let result: unknown
  try {
    result = await client.call("tool.file-parse.result", { taskId }, undefined, output ? { streamTo: output } : undefined)
  } catch (error) {
    if (isAsyncPending(error)) return "pending"
    throw error
  }
  await saveDownloadResult(result, `file-parse-${taskId}`, output)
  return "ok"
}

/** Poll until the ZIP is ready. Same backoff budget as the AI async endpoints
 * (≈316s), which covers the documented ~3 min parse time. */
export async function pollFileParseResult(client: FileParseClient, taskId: string, output?: string): Promise<"ok" | "timeout"> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    try {
      if (await fetchFileParseResult(client, taskId, output) === "ok") return "ok"
    } catch (error) {
      // The task is already paid for: a blip must not void the wait. Transient
      // errors consume the attempt, anything else (bad taskId, no permission) aborts.
      if (!isTransientError(error)) throw error
      const msg = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Attempt ${attempt}/${POLL_MAX_ATTEMPTS}: transient error (${msg.slice(0, 80)}), continuing to wait...\n`)
    }
    if (attempt < POLL_MAX_ATTEMPTS) {
      const delay = nextPollDelayMs(attempt)
      process.stderr.write(`Attempt ${attempt}/${POLL_MAX_ATTEMPTS}: parse result not ready, retrying in ${Math.round(delay / 1000)}s...\n`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return "timeout"
}
