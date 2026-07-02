import { randomUUID } from "node:crypto"
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

/**
 * Return a display-safe copy of a token cache for `auth status`: any field whose
 * name matches a credential pattern (token / key / secret / password / credential)
 * is replaced with "<redacted>" so the raw bearer token — or any unknown credential
 * field the cache file might carry (apiKey, privateKey, …) — is never printed; all
 * other metadata (expiresAt, userName, productCode, …) is preserved.
 */
export function redactTokenCache(cache: TokenCache | null): Record<string, unknown> | null {
  if (!cache) return null
  const SENSITIVE = /token|secret|password|credential|key/i
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(cache)) {
    out[key] = SENSITIVE.test(key) ? "<redacted>" : value
  }
  return out
}

export async function writeTokenCache(filePath: string, cache: TokenCache): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  // Write to a fresh 0600 temp file then rename over the target. Writing the bearer
  // token straight to token.json would (a) keep an existing file's lax perms — the
  // `mode` option only applies on creation, so a follow-up chmod still leaves a brief
  // world-readable window — and (b) risk a truncated file on crash. A temp file is
  // 0600 from the first byte and rename is atomic, carrying the 0600 perms over.
  const tmp = `${filePath}.tmp-${randomUUID()}`
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { encoding: "utf8", mode: 0o600 })
  try {
    await fs.rename(tmp, filePath)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    throw error
  }
}

export function isTokenCacheValid(cache: TokenCache | null, bufferSeconds = 300): boolean {
  if (!cache?.accessToken || !cache.expiresAt) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  return cache.expiresAt - bufferSeconds > now
}

export function normalizeToken(token: string): string {
  // Case-insensitive prefix check: GANGTISE_TOKEN="bearer xxx" must become
  // "Bearer xxx", not the silently-invalid "Bearer bearer xxx".
  const prefix = /^bearer\s+/i.exec(token)
  return `Bearer ${prefix ? token.slice(prefix[0].length) : token}`
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
