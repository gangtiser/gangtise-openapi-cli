import { gunzipSync } from "node:zlib"

import { Agent, type Dispatcher } from "undici"

import { ApiError } from "./errors.js"

/** Decode an HTTP response body honoring Content-Encoding. undici does not
 * auto-decompress, so requestJson advertises `accept-encoding: gzip` and gunzips
 * here; an unencoded body is read as-is. */
export function decodeResponseBody(buf: Uint8Array, contentEncoding: string | string[] | undefined): string {
  const enc = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding)?.toLowerCase().trim()
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  return enc === "gzip" ? gunzipSync(b).toString("utf8") : b.toString("utf8")
}

/**
 * Re-quote the *unquoted numeric* values of the named JSON fields so ids past
 * 2^53 survive JSON.parse: `{"taskId":1782345678901234567}` would otherwise come
 * back as 1782345678901234700 and address a task that does not exist.
 *
 * Probed 2026-07-25: file-parse's submit returns `taskId` as a STRING (matching
 * the spec), so this is a forward guard, not a live fix — but the failure mode it
 * covers is silent and expensive (the parse job is already billed, and a rounded
 * id can never fetch its result). Values already in quotes are left alone: the
 * pattern only matches a bare number right after the key.
 */
export function quoteBigIntFields(text: string, fields?: readonly string[]): string {
  if (!fields?.length) return text
  let out = text
  for (const field of fields) {
    out = out.replace(new RegExp(`("${field}"\\s*:\\s*)(-?\\d+)`, "g"), '$1"$2"')
  }
  return out
}

/** A Retry-After delay we'll honor even if it exceeds maxDelay — but never past this
 * ceiling, so a hostile/misconfigured header can't hang the CLI for minutes. */
const RETRY_AFTER_CEILING_MS = 60_000

/** Parse a Retry-After header (delta-seconds or an HTTP-date) into a delay in ms.
 * Returns undefined when absent or unparseable. `nowMs` is injected for testing. */
export function parseRetryAfterMs(value: string | string[] | undefined, nowMs: number): number | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  const dateMs = Date.parse(raw)
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs)
}

/** A retryable error may carry a server-specified Retry-After (attached by the
 * client on a 429); prefer it over the computed backoff. */
function retryAfterFromError(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const v = (error as { retryAfterMs?: unknown }).retryAfterMs
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v
  }
  return undefined
}

let cachedDispatcher: Dispatcher | null = null

export function getDispatcher(): Dispatcher {
  if (!cachedDispatcher) {
    cachedDispatcher = new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
      connections: 16,
      pipelining: 1,
    })
  }
  return cachedDispatcher
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

/** Parse GANGTISE_PAGE_CONCURRENCY defensively. runWithConcurrency clamps to
 * ≥1 worker, so a negative/zero/NaN value silently degrades to SERIAL fetching
 * (slow, confusing); an absurd value fans out up to items.length workers at
 * once and can 429-storm the server. Fall back to the default and cap at 32. */
export function resolvePageConcurrency(raw: string | undefined, fallback = 5, max = 32): number {
  const parsed = Math.floor(Number(raw))
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

/** Fan-out width for pagination and kline shards — one env knob tunes both. */
export const PAGE_CONCURRENCY = resolvePageConcurrency(process.env.GANGTISE_PAGE_CONCURRENCY)

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504])
const RETRYABLE_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])
const RETRYABLE_API_CODES = new Set(["999999"])
// Never replayed on any HTTP status:
// - 999011 CREDENTIAL_INVALID: bad AK/SK, only from auth.login (useAuth=false, so it
//   never consults AUTH_RETRY_CODES, and it declares no retry policy) — a 5xx would
//   otherwise be retried twice by the status rule.
// - 140002 PROCESSING_FAILED: the async *-check endpoints (get-content) declare no
//   retry policy, so a 140002@500 would be retried 2× by the default policy BEFORE
//   asyncContent's FAILED_CODES gets to call it terminal — that guard sits above
//   client.call's withRetry and cannot see the retries. 140002 is terminal in both
//   of its meanings — async "generation failed", and (probed 2026-08-02) the EDE
//   indicator endpoints' parameter/expression errors, e.g. an out-of-range enum or
//   a malformed screener expression — so the blanket rule stays correct and skips
//   the wasted retries. Server still emits the legacy 410111 today (410111@400
//   isn't retryable anyway); this is a forward guard for the documented 140002@500.
const TERMINAL_API_CODES = new Set(["999011", "140002"])
// Connect-phase / DNS failures: the request provably never reached the server, so a
// replay cannot double-execute (or double-bill) anything even under "no-replay".
const NO_REPLAY_NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])

/** "no-replay" (replay-safety marker — NOT a billing-model flag; see endpoints.ts):
 * never resend a request the server may already have executed, because a replay can
 * double-bill.
 * Only connect-phase errors, 429 (rejected before processing) and the explicit
 * token-self-heal mark retry; 5xx / response timeouts / 999999 fail fast.
 * "no-999999" (EDE indicator endpoints): 999999 is a server-side fault here (it
 * also meant "no data" until 2026-08-01; a no-data answer is now a null cell
 * that keeps its row and column) and
 * replaying an already-billed query buys nothing; everything
 * else follows the default policy. */
export type RetryPolicy = "default" | "no-replay" | "no-999999"

function isRetryableError(error: unknown, policy: RetryPolicy): boolean {
  if (error && typeof error === "object" && (error as { __retryable?: boolean }).__retryable === true) {
    return true
  }
  if (error instanceof ApiError) {
    if (error.code && TERMINAL_API_CODES.has(error.code)) return false
    if (error.statusCode === 429) return true
    if (policy === "no-replay") return false
    if (error.code && RETRYABLE_API_CODES.has(error.code)) return policy !== "no-999999"
    if (error.statusCode != null && RETRYABLE_HTTP_STATUS.has(error.statusCode)) return true
    return false
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code)
    if ((policy === "no-replay" ? NO_REPLAY_NETWORK_CODES : RETRYABLE_NETWORK_CODES).has(code)) return true
  }
  if (policy === "no-replay") return false
  if (error instanceof Error && /timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(error.message)) {
    return true
  }
  return false
}

export function markRetryable<E extends object>(error: E): E {
  return Object.assign(error, { __retryable: true })
}

/** Errors worth waiting out (anything the default policy would retry): transient
 * 5xx / network / timeout / 429 / 999999. Used by async polling to survive a
 * blip without abandoning a multi-minute wait. */
export function isTransientError(error: unknown): boolean {
  return isRetryableError(error, "default")
}

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  policy?: RetryPolicy
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2
  const baseDelay = options.baseDelayMs ?? 400
  const maxDelay = options.maxDelayMs ?? 4_000
  let attempt = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error, options.policy ?? "default")) throw error
      // A server-sent Retry-After (429) wins over exponential backoff, but is capped
      // so it can't stall the CLI; otherwise fall back to jittered exponential backoff.
      const retryAfter = retryAfterFromError(error)
      const delay = retryAfter !== undefined
        ? Math.min(retryAfter, RETRY_AFTER_CEILING_MS)
        : Math.min(maxDelay, baseDelay * 2 ** attempt + Math.random() * baseDelay)
      options.onRetry?.(attempt + 1, error, delay)
      await new Promise(resolve => setTimeout(resolve, delay))
      attempt++
    }
  }
}

let verboseEnabled = process.env.GANGTISE_VERBOSE === "1" || process.env.GANGTISE_VERBOSE === "true"

export function setVerbose(value: boolean): void {
  verboseEnabled = value
}

export function isVerbose(): boolean {
  return verboseEnabled
}

export function logTiming(label: string, durationMs: number, extra?: string): void {
  if (!verboseEnabled) return
  const ms = durationMs.toFixed(0).padStart(5, " ")
  process.stderr.write(`[gangtise] ${ms}ms ${label}${extra ? ` (${extra})` : ""}\n`)
}
