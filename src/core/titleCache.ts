import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEFAULT_TITLE_CACHE_PATH = path.join(os.homedir(), ".config", "gangtise", "title-cache.json")
export const TITLE_LOOKUP_SIZE = 200
const TITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface TitleCacheEntry {
  titles: Record<string, string>
  ts: number
}

export type TitleCacheData = Record<string, TitleCacheEntry>

export interface TitleCacheConfig {
  endpointKey: string
  idField: string
  titleField?: string
}

// Per-process in-memory snapshot of the cache. We read the file at most once,
// merge subsequent writes in memory, and flush atomically. This avoids the
// "read whole file → modify → write whole file" pattern firing on every list
// command (which got expensive once dozens of endpoints accumulated).
let memoryCache: TitleCacheData | null = null
let memoryCachePath: string | null = null
let pendingWrite: Promise<void> | null = null
let dirty = false

async function loadInto(filePath: string): Promise<TitleCacheData> {
  if (memoryCache && memoryCachePath === filePath) return memoryCache
  try {
    const content = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(content)
    memoryCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TitleCacheData) : {}
  } catch {
    memoryCache = {}
  }
  memoryCachePath = filePath
  return memoryCache
}

export async function readTitleCache(filePath = DEFAULT_TITLE_CACHE_PATH): Promise<TitleCacheData> {
  return loadInto(filePath)
}

async function flush(filePath: string): Promise<void> {
  if (!dirty || !memoryCache) return
  dirty = false
  const snapshot = JSON.stringify(memoryCache)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  // Atomic-ish: write to temp file then rename (rename is atomic within a fs).
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 })
  try {
    await fs.rename(tmp, filePath)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    throw error
  }
}

export async function writeTitleCache(endpoint: string, titles: Record<string, string>, filePath = DEFAULT_TITLE_CACHE_PATH): Promise<void> {
  const data = await loadInto(filePath)
  const existing = data[endpoint]?.titles ?? {}
  data[endpoint] = { titles: { ...existing, ...titles }, ts: Date.now() }
  dirty = true

  // Coalesce concurrent writes: the in-flight flush picks up everything dirty.
  if (pendingWrite) return pendingWrite
  pendingWrite = (async () => {
    try { await flush(filePath) } finally { pendingWrite = null }
  })()
  return pendingWrite
}

export function lookupTitleCache(data: TitleCacheData, endpoint: string, id: string): string | undefined {
  const entry = data[endpoint]
  if (!entry || Date.now() - entry.ts > TITLE_CACHE_TTL_MS) return undefined
  return entry.titles[id]
}

export function extractTitles(items: unknown[], cache: TitleCacheConfig): Record<string, string> {
  const titleField = cache.titleField ?? "title"
  const titles: Record<string, string> = {}

  for (const row of items) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const id = record[cache.idField]
    const title = record[titleField]
    if (id != null && typeof title === "string" && title) {
      titles[String(id)] = title
    }
  }

  return titles
}

/** Test-only hook to reset the in-memory snapshot between cases. */
export function __resetTitleCacheForTests(): void {
  memoryCache = null
  memoryCachePath = null
  pendingWrite = null
  dirty = false
}
