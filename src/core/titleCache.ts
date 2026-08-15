import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEFAULT_TITLE_CACHE_PATH = path.join(os.homedir(), ".config", "gangtise", "title-cache.json")
export const TITLE_LOOKUP_SIZE = 200
const TITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/**
 * Hard cap on titles kept per endpoint. The cache only needs the recent working
 * set so downloads can resolve friendly filenames; without a cap, `writeTitleCache`
 * merges forever and the endpoint's `ts` refreshes on every write, so the TTL
 * never expires it — the file grew to tens of MB in practice, and `resolveTitle`
 * re-parses the whole thing on every download. Bounds the file to roughly
 * (#cached endpoints × this × avg entry size).
 */
export const MAX_TITLES_PER_ENDPOINT = 5_000

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
let pendingLoad: Promise<TitleCacheData> | null = null
/** Which file `pendingLoad` is loading. Keyed alongside the promise because the
 * cache is a single-slot module global: coalescing on the promise ALONE would hand
 * a caller asking for file B the contents of file A. */
let pendingLoadPath: string | null = null
let dirty = false

async function loadInto(filePath: string): Promise<TitleCacheData> {
  if (memoryCache && memoryCachePath === filePath) return memoryCache
  // Coalesce concurrent first-loads. Without this, two callers that both miss the
  // cache each run their own readFile and each assign their OWN object to
  // `memoryCache`; the last assignment wins, and entries written against the
  // loser's reference are silently dropped. Sharing one promise means every
  // caller gets the same object, so merges land in one place.
  //
  // The path check is what keeps that from becoming a worse bug than the one it
  // fixes: same promise for the same file is deduplication, same promise for a
  // different file is handing back the wrong file's data.
  if (pendingLoad && pendingLoadPath === filePath) return pendingLoad
  const load = (async () => {
    try {
      const content = await fs.readFile(filePath, "utf8")
      const parsed = JSON.parse(content)
      memoryCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TitleCacheData) : {}
    } catch {
      memoryCache = {}
    }
    memoryCachePath = filePath
    return memoryCache
  })()
  pendingLoad = load
  pendingLoadPath = filePath
  try {
    return await load
  } finally {
    // Only clear if still ours — a load for another path may have replaced it.
    if (pendingLoad === load) {
      pendingLoad = null
      pendingLoadPath = null
    }
  }
}

export async function readTitleCache(filePath = DEFAULT_TITLE_CACHE_PATH): Promise<TitleCacheData> {
  return loadInto(filePath)
}

async function flush(filePath: string): Promise<void> {
  // Loop rather than snapshot once. `dirty` is cleared before the snapshot, so an
  // entry added while we await the rename sets it again — and `writeTitleCache`
  // hands that caller THIS in-flight promise instead of starting a second flush.
  // Returning after one pass would leave that entry in memory only, never on disk.
  for (;;) {
    // Deciding to stop and releasing the in-flight handle must happen in ONE
    // synchronous block. If they were split by an await, a write landing between
    // them would attach to an already-resolving flush and never be written.
    if (!dirty || !memoryCache) {
      pendingWrite = null
      return
    }
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
}

/**
 * Trim `merged` down to `cap` entries. The freshly-written ids (`freshKeys`) are
 * kept first since those are what the user just listed and is most likely to
 * download; remaining capacity is filled from the rest. Returns `merged` as-is
 * when already within the cap.
 */
function capTitles(merged: Record<string, string>, freshKeys: string[], cap: number): Record<string, string> {
  if (Object.keys(merged).length <= cap) return merged
  const out: Record<string, string> = {}
  let n = 0
  for (const k of freshKeys) {
    if (n >= cap) break
    if (k in merged && !(k in out)) { out[k] = merged[k]; n++ }
  }
  if (n < cap) {
    // Newest-inserted keys sit at the END of the merged object — fill in reverse so
    // eviction drops the oldest entries, not the batch the user just listed yesterday.
    const rest = Object.keys(merged)
    for (let i = rest.length - 1; i >= 0 && n < cap; i--) {
      const k = rest[i]
      if (k in out) continue
      out[k] = merged[k]; n++
    }
  }
  return out
}

/**
 * Keep the cache bounded on every write: drop endpoint entries past their TTL
 * (lookups already ignore them) and cap each endpoint's titles. The just-written
 * endpoint keeps its newest ids first; others over the cap are trimmed too, so a
 * pre-existing oversized file shrinks on the next write.
 */
function pruneCache(data: TitleCacheData, freshEndpoint: string, freshKeys: string[]): void {
  const now = Date.now()
  for (const key of Object.keys(data)) {
    const entry = data[key]
    if (!entry || typeof entry.ts !== "number" || now - entry.ts > TITLE_CACHE_TTL_MS) {
      delete data[key]
      continue
    }
    if (!entry.titles || typeof entry.titles !== "object") {
      delete data[key]
      continue
    }
    if (Object.keys(entry.titles).length > MAX_TITLES_PER_ENDPOINT) {
      entry.titles = capTitles(entry.titles, key === freshEndpoint ? freshKeys : [], MAX_TITLES_PER_ENDPOINT)
    }
  }
}

export async function writeTitleCache(endpoint: string, titles: Record<string, string>, filePath = DEFAULT_TITLE_CACHE_PATH): Promise<void> {
  const data = await loadInto(filePath)
  const existing = data[endpoint]?.titles ?? {}
  data[endpoint] = { titles: { ...existing, ...titles }, ts: Date.now() }
  pruneCache(data, endpoint, Object.keys(titles))
  dirty = true

  // Coalesce concurrent writes: the in-flight flush picks up everything dirty.
  //
  // `flush` clears `pendingWrite` itself, in the same synchronous block as the
  // `if (!dirty || !memoryCache)` test that decides to stop looping. Clearing it out
  // here — in a `finally` after `await flush(...)` — would leave a gap of microtasks
  // between "flush decided nothing is left" and "flush is no longer in flight": a
  // write landing in that gap sets `dirty`, sees a non-null `pendingWrite`, and
  // attaches to a promise that is already resolving, so its entry never reaches
  // disk while its `await` still resolves normally. Same silent loss the loop was
  // added to fix, just a narrower window.
  if (pendingWrite) return pendingWrite
  pendingWrite = (async () => {
    try {
      await flush(filePath)
    } catch (error) {
      // flush throws before reaching its own clear, so release the handle here.
      // Safe to null unconditionally: nothing else can have replaced it, since a
      // non-null pendingWrite is exactly what stops another flush from starting.
      //
      // ⚠️ Only the SUCCESS path is atomic. A write landing between the throw and
      // this line still attaches to the rejecting promise and never reaches disk;
      // it recovers on the next successful write (which re-serialises the whole
      // in-memory cache), and is lost only if no write ever follows. Left as-is
      // deliberately — retrying against a filesystem that is already failing is
      // worse than deferring to the next write.
      pendingWrite = null
      throw error
    }
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
  // Must include the load handles: a reset that leaves `pendingLoad` set would hand
  // the next readTitleCache the pre-reset promise, breaking the "force a fresh read
  // from disk" contract this helper exists to provide.
  pendingLoad = null
  pendingLoadPath = null
  dirty = false
}
