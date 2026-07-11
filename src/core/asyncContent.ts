import type { OutputFormat } from "./config.js"
import { ApiError } from "./errors.js"
import { printData } from "./printer.js"
import { isTransientError } from "./transport.js"

// 14 attempts with exponential backoff (5s→30s cap) ≈ 316s total wait budget.
export const POLL_MAX_ATTEMPTS = 14
const POLL_INITIAL_DELAY_MS = 5_000
const POLL_MAX_DELAY_MS = 30_000

function nextDelayMs(attempt: number): number {
  // 5s, 8s, 13s, 20s, 30s, 30s, ...
  const grown = POLL_INITIAL_DELAY_MS * 1.6 ** (attempt - 1)
  return Math.min(POLL_MAX_DELAY_MS, Math.round(grown))
}

interface AsyncContentClient {
  call(endpointKey: string, body?: unknown, query?: Record<string, string | number>): Promise<unknown>
}

function isAsyncPending(error: unknown): boolean {
  return error instanceof ApiError && error.code === "410110"
}

/** "ok" = content printed; "failed" = terminal 410111 (retrying is pointless, a
 * message was already written to stderr); "timeout" = poll budget exhausted while
 * still pending (retrying later makes sense). Callers used to get a bare boolean
 * and printed a "try again later" hint even for terminal failures — contradicting
 * the "Do not retry" line right above it. */
export type PollOutcome = "ok" | "failed" | "timeout"

export async function pollAsyncContent(
  client: AsyncContentClient,
  getContentEndpoint: string,
  dataId: string,
  format: OutputFormat,
  output?: string,
): Promise<PollOutcome> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await client.call(getContentEndpoint, { dataId }) as { content?: string }
      if (result?.content != null) {
        await printData(result, format, output)
        return "ok"
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "410111") {
        process.stderr.write("Content generation failed (terminal). Do not retry.\n")
        return "failed"
      }
      if (!isAsyncPending(error)) {
        // AI generation windows are exactly when the server is busiest: one 5xx
        // (after the client's own retries) must not void minutes of waiting —
        // the dataId is still valid. Transient errors consume this attempt and
        // polling continues; anything else (no credits, bad params) aborts.
        if (!isTransientError(error)) throw error
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`Attempt ${attempt}/${POLL_MAX_ATTEMPTS}: transient error (${msg.slice(0, 80)}), continuing to wait...\n`)
      }
    }
    if (attempt < POLL_MAX_ATTEMPTS) {
      const delay = nextDelayMs(attempt)
      process.stderr.write(`Attempt ${attempt}/${POLL_MAX_ATTEMPTS}: content not ready, retrying in ${Math.round(delay / 1000)}s...\n`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return "timeout"
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
