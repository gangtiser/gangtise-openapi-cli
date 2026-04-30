import type { OutputFormat } from "./config.js"
import { ApiError } from "./errors.js"
import { printData } from "./printer.js"

export const POLL_MAX_ATTEMPTS = 12
export const POLL_DELAY_MS = 15_000

interface AsyncContentClient {
  call(endpointKey: string, body?: unknown, query?: Record<string, string | number>): Promise<unknown>
}

function isAsyncPending(error: unknown): boolean {
  return error instanceof ApiError && error.code === "410110"
}

export async function pollAsyncContent(
  client: AsyncContentClient,
  getContentEndpoint: string,
  dataId: string,
  format: OutputFormat,
  output?: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await client.call(getContentEndpoint, { dataId }) as { content?: string }
      if (result?.content != null) {
        await printData(result, format, output)
        return true
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "410111") {
        process.stderr.write("Content generation failed (terminal). Do not retry.\n")
        return false
      }
      if (!isAsyncPending(error)) throw error
    }
    if (attempt < POLL_MAX_ATTEMPTS) {
      process.stderr.write(`Attempt ${attempt}/${POLL_MAX_ATTEMPTS}: content not ready, retrying in 15s...\n`)
      await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS))
    }
  }
  return false
}

export async function checkAsyncContent(
  client: AsyncContentClient,
  getContentEndpoint: string,
  dataId: string,
  format: OutputFormat,
  output?: string,
): Promise<void> {
  try {
    const result = await client.call(getContentEndpoint, { dataId }) as { content?: string }
    if (result?.content != null) {
      await printData(result, format, output)
      return
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "410111") {
      process.stderr.write("Content generation failed (terminal). Do not retry.\n")
      process.exitCode = 1
      return
    }
    if (!isAsyncPending(error)) throw error
  }
  process.stdout.write(`${JSON.stringify({ dataId, status: "pending", hint: "Content not ready yet, retry in ~2 minutes" })}\n`)
}
