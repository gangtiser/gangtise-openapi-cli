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

  return {
    baseUrl: process.env.GANGTISE_BASE_URL ?? DEFAULT_BASE_URL,
    timeoutMs,
    accessKey: process.env.GANGTISE_ACCESS_KEY,
    secretKey: process.env.GANGTISE_SECRET_KEY,
    token: process.env.GANGTISE_TOKEN,
    tokenCachePath: process.env.GANGTISE_TOKEN_CACHE_PATH ?? DEFAULT_TOKEN_CACHE_PATH,
  }
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
