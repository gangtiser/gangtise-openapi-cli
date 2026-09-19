import { createHash, randomUUID } from "node:crypto"
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
  /** Which credentials + host this token was minted for. Without it the cache is
   * just "some valid token": swap GANGTISE_ACCESS_KEY to a second account and the
   * unexpired token of the FIRST one keeps being sent, so writes land on the wrong
   * account — and `stock-pool-delete` is not reversible. Never the key itself; a
   * fingerprint is enough to tell two accounts apart and leaks nothing if the
   * 0600 file is read. Absent on caches written before this field existed. */
  issuedFor?: string
}

/** Stable, non-reversible id for "which credentials + which host". Only the
 * accessKey participates — the secret never needs to, and keeping it out means a
 * leaked cache file cannot help an offline guess against the secret. */
export function credentialFingerprint(accessKey: string, baseUrl: string): string {
  return createHash("sha256").update(`${accessKey}\u0000${baseUrl}`).digest("hex").slice(0, 16)
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

/** @param expectedFingerprint identity the caller requires, or `undefined` when it
 *   cannot check one (no accessKey in the environment — then there is no "other
 *   account" to confuse this with, and refusing the cache would only break the
 *   token-cache-only workflow with no safety gained). */
export function isTokenCacheValid(cache: TokenCache | null, bufferSeconds = 300, expectedFingerprint?: string): boolean {
  if (!cache?.accessToken || !cache.expiresAt) {
    return false
  }

  // A cache that belongs to other credentials (or a cache from before this field
  // existed, whose owner is simply unknown) is not valid for this caller — treat it
  // as a miss so the caller logs in fresh. One extra login is the whole cost; the
  // alternative is silently acting as the previous account.
  if (expectedFingerprint !== undefined && cache.issuedFor !== expectedFingerprint) {
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
