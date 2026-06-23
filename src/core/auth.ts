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
    const missing = [!accessKey && "GANGTISE_ACCESS_KEY", !secretKey && "GANGTISE_SECRET_KEY"].filter(Boolean).join(", ")
    throw new ConfigError(
      `缺少环境变量: ${missing}（未导出到当前进程环境）\n`
      + `注意：在 shell 里赋值还不够，必须"导出"，子进程才读得到：\n`
      + `  bash/zsh:  export GANGTISE_ACCESS_KEY=... GANGTISE_SECRET_KEY=...\n`
      + `  fish:      set -gx GANGTISE_ACCESS_KEY ...; set -gx GANGTISE_SECRET_KEY ...\n`
      + `验证：env | grep GANGTISE（能列出对应行才算导出成功）`,
    )
  }

  return { accessKey, secretKey }
}
