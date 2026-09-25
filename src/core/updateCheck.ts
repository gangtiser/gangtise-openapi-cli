/**
 * `gangtise --version` at a terminal: tell the user when a newer version is published.
 * The registry's answer is kept for a day, so the command only waits on the network
 * (1–2.5 s) once a day rather than every time.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { isVersionNewer } from "./args.js"
import { stagingPath } from "./output.js"

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000
export const DEFAULT_UPDATE_CHECK_PATH = path.join(os.homedir(), ".config", "gangtise", "update-check.json")

function saveLatest(cachePath: string, latest: string, now: number): void {
  const staging = stagingPath(cachePath, "tmp")
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true })
    writeFileSync(staging, JSON.stringify({ checkedAt: now, latest }))
    renameSync(staging, cachePath)
  } catch {
    // A read-only home only costs the next run another registry call.
    try { rmSync(staging, { force: true }) } catch { /* nothing to remove */ }
  }
}

/** The latest published version: the cached answer while it is under a day old, else the
 * registry's (then cached). Undefined when neither answers — a failed lookup is not cached,
 * so the next run asks again. Without a home directory the path is relative (an empty
 * HOME makes os.homedir() return ""), and the cache is skipped rather than written into
 * whatever directory the command runs in. */
export async function latestVersion(cachePath = DEFAULT_UPDATE_CHECK_PATH, timeoutMs = 2000, now = Date.now()): Promise<string | undefined> {
  const cacheable = path.isAbsolute(cachePath)
  if (cacheable) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as { checkedAt?: unknown; latest?: unknown }
      const age = typeof cached.checkedAt === "number" ? now - cached.checkedAt : -1
      if (typeof cached.latest === "string" && age >= 0 && age < UPDATE_CHECK_TTL_MS) return cached.latest
    } catch { /* no cache yet, or unreadable: ask the registry */ }
  }
  try {
    const response = await fetch("https://registry.npmjs.org/gangtise-openapi-cli/latest", { signal: AbortSignal.timeout(timeoutMs) })
    const latest = (await response.json() as { version?: unknown }).version
    if (typeof latest !== "string") return undefined
    if (cacheable) saveLatest(cachePath, latest, now)
    return latest
  } catch {
    return undefined
  }
}

export async function checkForUpdate(current: string): Promise<void> {
  const latest = await latestVersion()
  // Ordered compare, not inequality: during the just-published window the
  // registry still serves the PREVIOUS version — don't suggest a "downgrade".
  if (latest && isVersionNewer(latest, current)) {
    process.stderr.write(`Update available: ${current} → ${latest}\nRun: npm update -g gangtise-openapi-cli\n`)
  }
}
