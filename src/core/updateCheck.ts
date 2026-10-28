/**
 * Telling a person at a terminal that a newer version is published. `gangtise --version`
 * asks the registry, and its answer is kept for a day, so it waits on the network (1–2.5 s)
 * once a day rather than every time. Every other command only reads that kept answer and,
 * once it is a day old, refreshes it in a detached process — no command waits on the network.
 * While the registry does not answer (offline, a network that blocks it), a refresh is started
 * once an hour, not by every command.
 */
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { isVersionNewer } from "./args.js"
import { writeFileAtomicSync } from "./output.js"

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000
export const REFRESH_RETRY_MS = 60 * 60 * 1000
export const DEFAULT_UPDATE_CHECK_PATH = path.join(os.homedir(), ".config", "gangtise", "update-check.json")
/** Where the package is published (publishConfig). Asked directly: a mirror can lag behind it. */
export const REGISTRY = "https://registry.npmjs.org"
export const PACKAGE_NAME = "gangtise-openapi-cli"

/** `notifiedAt`: when a command last mentioned `latest`, so it is mentioned once per answer. */
interface KeptAnswer { checkedAt: number; latest: string; notifiedAt?: number }
/** The file: the kept answer once the registry has given one, and when a command last started
 * a background refresh. */
type KeptFile = Partial<KeptAnswer> & { refreshStartedAt?: number }

function readFile(cachePath: string): KeptFile {
  try {
    const kept = JSON.parse(readFileSync(cachePath, "utf8")) as unknown
    if (kept && typeof kept === "object") return kept as KeptFile
  } catch { /* nothing kept yet, or unreadable */ }
  return {}
}

const answerIn = (kept: KeptFile) => typeof kept.checkedAt === "number" && typeof kept.latest === "string" ? kept as KeptAnswer : undefined

const isFresh = (kept: KeptAnswer, now: number) => now - kept.checkedAt >= 0 && now - kept.checkedAt < UPDATE_CHECK_TTL_MS

function keep(cachePath: string, kept: KeptFile): void {
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true })
    writeFileAtomicSync(cachePath, JSON.stringify(kept), { suffix: "tmp" })
  } catch {
    // A read-only home only costs the next run another registry call.
  }
}

/** The latest published version: the kept answer while it is under a day old (unless
 * `fresh`), else the registry's (then kept). Undefined when neither answers — a failed lookup
 * is not kept, so the next run asks again. Without a home directory the path is relative (an
 * empty HOME makes os.homedir() return ""), and nothing is kept rather than written into
 * whatever directory the command runs in. */
export async function latestVersion(cachePath = DEFAULT_UPDATE_CHECK_PATH, timeoutMs = 2000, now = Date.now(), fresh = false): Promise<string | undefined> {
  const cacheable = path.isAbsolute(cachePath)
  if (cacheable && !fresh) {
    const kept = answerIn(readFile(cachePath))
    if (kept && isFresh(kept, now)) return kept.latest
  }
  try {
    const response = await fetch(`${REGISTRY}/${PACKAGE_NAME}/latest`, { signal: AbortSignal.timeout(timeoutMs) })
    const latest = (await response.json() as { version?: unknown }).version
    if (typeof latest !== "string") return undefined
    if (cacheable) keep(cachePath, { checkedAt: now, latest })
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
    process.stderr.write(`Update available: ${current} → ${latest}\nRun: gangtise update\n`)
  }
}

/** Asks the registry in a process of its own that outlives this one, so the command that
 * started it never waits. Errors are dropped: the next command tries again. */
function refreshInBackground(cachePath: string): void {
  try {
    const script = `import(${JSON.stringify(import.meta.url)}).then((m) => m.latestVersion(${JSON.stringify(cachePath)}, 10000, Date.now(), true))`
    const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", windowsHide: true })
    // Without a listener, a failed spawn would surface as an uncaught 'error' event.
    child.on("error", () => {})
    child.unref()
  } catch { /* see above */ }
}

/** After a command at a terminal: one line on stderr when the kept answer names a newer
 * version — once per answer, so about once a day — and a background refresh once that answer
 * is a day old (at most one an hour). Reads and writes a file and nothing else on the
 * command's own time. */
export function noticeUpdate(current: string, cachePath = DEFAULT_UPDATE_CHECK_PATH, now = Date.now(), refresh: (cachePath: string) => void = refreshInBackground): void {
  if (!path.isAbsolute(cachePath)) return
  const file = readFile(cachePath)
  const kept = answerIn(file)
  const started = file.refreshStartedAt
  if ((!kept || !isFresh(kept, now)) && !(typeof started === "number" && now - started >= 0 && now - started < REFRESH_RETRY_MS)) {
    file.refreshStartedAt = now
    keep(cachePath, file)
    refresh(cachePath)
  }
  if (!kept || kept.notifiedAt !== undefined || !isVersionNewer(kept.latest, current)) return
  process.stderr.write(`Update available: ${current} → ${kept.latest}. Run: gangtise update\n`)
  keep(cachePath, { ...file, notifiedAt: now })
}
