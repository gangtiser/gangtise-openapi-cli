import os from "node:os"
import path from "node:path"

export const DEFAULT_BASE_URL = "https://open.gangtise.com"
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

export function loadConfig(): CliConfig {
  const timeoutValue = process.env.GANGTISE_TIMEOUT_MS
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_TIMEOUT_MS

  return {
    baseUrl: process.env.GANGTISE_BASE_URL ?? DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    accessKey: process.env.GANGTISE_ACCESS_KEY,
    secretKey: process.env.GANGTISE_SECRET_KEY,
    token: process.env.GANGTISE_TOKEN,
    tokenCachePath: process.env.GANGTISE_TOKEN_CACHE_PATH ?? DEFAULT_TOKEN_CACHE_PATH,
  }
}
