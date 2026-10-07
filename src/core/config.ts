import { isIPv4 } from "node:net"
import os from "node:os"
import path from "node:path"

export const DEFAULT_BASE_URL = "https://openapi.gangtise.com"
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_TOKEN_CACHE_PATH = path.join(os.homedir(), ".config", "gangtise", "token.json")

export type OutputFormat = "table" | "json" | "jsonl" | "csv" | "markdown"

export interface CliConfig {
  baseUrl: string
  timeoutMs: number
  accessKey?: string
  secretKey?: string
  token?: string
  tokenCachePath: string
}

let timeoutWarned = false
let plainHttpWarned = false

export function loadConfig(): CliConfig {
  const rawTimeout = process.env.GANGTISE_TIMEOUT_MS?.trim()
  const timeoutMs = resolveTimeoutEnv(rawTimeout)
  // Said once per process, on stderr: the AI generation commands are the ones this variable
  // is set for, they are not replayed on a timeout, and a rerun bills again — so a value
  // that quietly fell back to 30 s must not go unnoticed.
  if (rawTimeout && Number(rawTimeout) !== timeoutMs && !timeoutWarned) {
    timeoutWarned = true
    process.stderr.write(`[gangtise] warning: GANGTISE_TIMEOUT_MS=${rawTimeout} is not in effect, using ${timeoutMs} ms: expected whole milliseconds from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}\n`)
  }

  const baseUrl = envValue("GANGTISE_BASE_URL") ?? DEFAULT_BASE_URL
  warnIfPlainHttp(baseUrl)

  return {
    baseUrl,
    timeoutMs,
    accessKey: envValue("GANGTISE_ACCESS_KEY"),
    secretKey: envValue("GANGTISE_SECRET_KEY"),
    token: envValue("GANGTISE_TOKEN"),
    tokenCachePath: envValue("GANGTISE_TOKEN_CACHE_PATH") ?? DEFAULT_TOKEN_CACHE_PATH,
  }
}

/** Said once per process: over plain http the login body carries the access key and secret,
 * and every request the token, all unencrypted. Loopback is left alone — that is where a
 * local proxy or a test stub lives. */
function warnIfPlainHttp(baseUrl: string): void {
  if (plainHttpWarned) return
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return
  }
  if (url.protocol !== "http:") return
  const host = url.hostname.replace(/^\[|\]$/g, "")
  // The 127. prefix only means loopback on an address: 127.proxy.example.com is a remote name.
  if (host === "localhost" || host === "::1" || (isIPv4(host) && host.startsWith("127."))) return
  plainHttpWarned = true
  process.stderr.write(`[gangtise] warning: GANGTISE_BASE_URL uses plain http (${url.host}): the access key, secret and token are sent unencrypted. Use https unless this is a trusted local proxy.\n`)
}

/** An environment variable, with an empty or blank value treated as unset. `export
 * GANGTISE_BASE_URL=` (a common way to "clear" one) otherwise sends every request to an
 * empty base URL, and an empty GANGTISE_TOKEN shadows working AK/SK credentials. */
function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** Bounds for GANGTISE_TIMEOUT_MS. Below a second every request times out before the
 * server can answer; past an hour a hung request is indistinguishable from none. */
export const MIN_TIMEOUT_MS = 1_000
export const MAX_TIMEOUT_MS = 3_600_000

/** GANGTISE_TIMEOUT_MS as whole milliseconds. Anything that is not a plain decimal integer
 * (`0.5`, `1e12`, `30s`) falls back to the default, the same way an invalid
 * GANGTISE_PAGE_CONCURRENCY does; so does a value under a second, which is almost always
 * seconds written where milliseconds were meant (`30`) and would time every request out.
 * A value past the upper bound is capped to it. */
export function resolveTimeoutEnv(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return DEFAULT_TIMEOUT_MS
  const ms = Number(raw)
  return ms < MIN_TIMEOUT_MS ? DEFAULT_TIMEOUT_MS : Math.min(MAX_TIMEOUT_MS, ms)
}
