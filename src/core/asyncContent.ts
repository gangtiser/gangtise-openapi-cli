import type { OutputFormat } from "./config.js"
import { ApiError } from "./errors.js"
import { printData } from "./printer.js"
import { isTransientError } from "./transport.js"
import { markFailed } from "./exitStatus.js"

// 14 attempts with exponential backoff (5s→30s cap) ≈ 316s total wait budget.
export const POLL_MAX_ATTEMPTS = 14
const POLL_INITIAL_DELAY_MS = 5_000
const POLL_MAX_DELAY_MS = 30_000

export function nextPollDelayMs(attempt: number): number {
  // 5s, 8s, 13s, 20s, 30s, 30s, ...
  const grown = POLL_INITIAL_DELAY_MS * 1.6 ** (attempt - 1)
  return Math.min(POLL_MAX_DELAY_MS, Math.round(grown))
}

interface AsyncContentClient {
  call(endpointKey: string, body?: unknown, query?: Record<string, string | number>): Promise<unknown>
}

// The async endpoints are still entirely on the legacy codes. 410110 "正在生成中"
// re-probed 2026-09-12 against a real viewpoint-debate job: string-typed, HTTP 400,
// no `errorType` field, traceId present. 410111 "生成失败" last probed 2026-07-20,
// same shape — forcing a terminal failure needs input the generator refuses, so it is
// not re-probed every round.
// The 2026-07-17 spec renumbers them to 140001 RESULT_GENERATING (409) and
// 140002 PROCESSING_FAILED (500); those are listed ahead of the switchover
// because the failure mode is expensive and silent — a `--wait` that does not
// recognize the pending code aborts the poll on a job already billed 50 credits.
const PENDING_CODES = new Set(["410110", "140001"])
const FAILED_CODES = new Set(["410111", "140002"])

/** Shared by the AI content endpoints and `tool file-parse` — both report
 * "still generating" with the same codes. */
export function isAsyncPending(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && PENDING_CODES.has(error.code)
}

function isAsyncFailed(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && FAILED_CODES.has(error.code)
}

/** Terminal failures are swallowed here rather than rethrown, so this line is the
 * user's only record of them — it has to carry what the global handler in cli.ts
 * would have printed (code, msg, traceId). Without the traceId the failure is
 * unreportable to Gangtise support, and README promises every error line has one. */
function terminalFailureLine(error: unknown): string {
  const api = error instanceof ApiError ? error : undefined
  const code = api?.code ? ` ${api.code}` : ""
  const trace = api?.traceId ? ` [trace ${api.traceId}]` : ""
  const detail = api?.message ? `: ${api.message}` : ""
  // Name the *submit* endpoint explicitly: re-running a `*-check` is a free
  // lookup, it is resubmitting the generation job that re-bills 50 credits for a
  // verdict that will not change (probed 2026-07-20 on sensitive content).
  return `Content generation failed (terminal${code})${trace}${detail}\n`
    + "This dataId is final — re-checking it will not change. Resubmitting the generation task bills again for the same result; change the parameters first.\n"
}

/** "ok" = content printed; "failed" = terminal 410111 (retrying is pointless, a
 * message was already written to stderr); "timeout" = poll budget exhausted while
 * still pending (retrying later makes sense). Callers used to get a bare boolean
 * and printed a "try again later" hint even for terminal failures — contradicting
 * the "Do not retry" line right above it. */
export type PollOutcome = "ok" | "failed" | "timeout"

/** The wait loop shared by the AI content endpoints and `tool file-parse`: up to
 * POLL_MAX_ATTEMPTS attempts, the delay growing between them. `attempt` says whether the
 * result is ready ("ok"), not yet ("pending") or never will be ("failed"). An error it
 * throws that is transient (a 5xx that outlived the client's own retries) consumes the
 * attempt and the wait goes on — the task is already paid for, and generation windows are
 * exactly when the server is busiest — while any other error (no credits, a bad id)
 * aborts. `notReady` names what is being waited for in the progress lines. */
export async function pollUntilDone(attempt: () => Promise<"ok" | "pending" | "failed">, notReady: string): Promise<PollOutcome> {
  for (let n = 1; n <= POLL_MAX_ATTEMPTS; n++) {
    try {
      const state = await attempt()
      if (state !== "pending") return state
    } catch (error) {
      if (!isTransientError(error)) throw error
      const msg = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Attempt ${n}/${POLL_MAX_ATTEMPTS}: transient error (${msg.slice(0, 80)}), continuing to wait...\n`)
    }
    if (n < POLL_MAX_ATTEMPTS) {
      const delay = nextPollDelayMs(n)
      process.stderr.write(`Attempt ${n}/${POLL_MAX_ATTEMPTS}: ${notReady}, retrying in ${Math.round(delay / 1000)}s...\n`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return "timeout"
}

export async function pollAsyncContent(
  client: AsyncContentClient,
  getContentEndpoint: string,
  dataId: string,
  format: OutputFormat,
  output?: string,
): Promise<PollOutcome> {
  return pollUntilDone(async () => {
    try {
      const result = await client.call(getContentEndpoint, { dataId }) as { content?: string }
      if (result?.content == null) return "pending"
      await printData(result, format, output)
      return "ok"
    } catch (error) {
      if (isAsyncFailed(error)) {
        process.stderr.write(terminalFailureLine(error))
        return "failed"
      }
      if (isAsyncPending(error)) return "pending"
      throw error
    }
  }, "content not ready")
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
    if (isAsyncFailed(error)) {
      process.stderr.write(terminalFailureLine(error))
      markFailed()
      return
    }
    if (!isAsyncPending(error)) throw error
  }
  // Through printData, like the ready branch three lines up and like the submit path:
  // a caller who passed --output/--format gets them honoured whatever the task's
  // state. Writing straight to stdout meant "still pending" was the one outcome that
  // produced exit 0 and no file, which is exactly the outcome a polling script has to
  // read to decide whether to poll again.
  await printData({ dataId, status: "pending", hint: "Content not ready yet, retry in ~2 minutes" }, format, output)
}
