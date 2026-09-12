import fs from "node:fs/promises"
import path from "node:path"

/**
 * Staging siblings of `target` on disk — `<target>.<token>.part` and, for csv exports,
 * `<target>.<token>.rows.part`.
 *
 * The token is per-write (see `stagingPath`), so a test cannot spell the name: asserting
 * `fs.access("<target>.part")` rejects would pass for a path that is never created, and
 * the cleanup it is meant to guard would go uncovered. Look for what is actually there.
 */
export async function stagingSiblings(target: string): Promise<string[]> {
  const prefix = `${path.basename(target)}.`
  const names = await fs.readdir(path.dirname(target)).catch(() => [] as string[])
  return names.filter((name) => name.startsWith(prefix) && name.endsWith(".part")).map((name) => path.join(path.dirname(target), name))
}

/** The staging file a lazily-opened writer is about to create, once it exists. */
export async function waitForStaging(target: string, suffix = ".part"): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const hit = (await stagingSiblings(target)).find((p) => p.endsWith(suffix))
    if (hit) return hit
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`no ${suffix} staging file appeared beside ${target}`)
}
