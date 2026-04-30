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

export async function readTitleCache(filePath = DEFAULT_TITLE_CACHE_PATH): Promise<TitleCacheData> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TitleCacheData
    }
  } catch {
    return {}
  }
  return {}
}

export async function writeTitleCache(endpoint: string, titles: Record<string, string>, filePath = DEFAULT_TITLE_CACHE_PATH): Promise<void> {
  const data = await readTitleCache(filePath)
  data[endpoint] = { titles, ts: Date.now() }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 })
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
