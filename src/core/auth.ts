import fs from "node:fs/promises"
import path from "node:path"

import { ConfigError } from "./errors.js"

export interface TokenCache {
  accessToken: string
  expiresIn: number
  time: number
  expiresAt: number
  uid?: number
  userName?: string
  tenantId?: number
}

export async function readTokenCache(filePath: string): Promise<TokenCache | null> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "number") {
      return parsed as TokenCache
    }
    return null
  } catch {
    return null
  }
}

export async function writeTokenCache(filePath: string, cache: TokenCache): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(cache, null, 2), { encoding: "utf8", mode: 0o600 })
}

export function isTokenCacheValid(cache: TokenCache | null, bufferSeconds = 300): boolean {
  if (!cache?.accessToken || !cache.expiresAt) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  return cache.expiresAt - bufferSeconds > now
}

export function normalizeToken(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`
}

export function requireAccessCredentials(accessKey?: string, secretKey?: string): { accessKey: string; secretKey: string } {
  if (!accessKey || !secretKey) {
    throw new ConfigError("Missing GANGTISE_ACCESS_KEY or GANGTISE_SECRET_KEY")
  }

  return { accessKey, secretKey }
}
