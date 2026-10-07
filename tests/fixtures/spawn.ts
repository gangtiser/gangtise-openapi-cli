import { execFile } from "node:child_process"
import os from "node:os"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Concurrent CLI processes per test file. The help walks used to start one per command
 * all at once — well over a hundred — and on a loaded machine some then ran past their
 * timeout, which execFile reports only as "Command failed", like a real regression. */
const MAX_SPAWNS = Math.max(2, os.availableParallelism())
let active = 0
const waiting: Array<() => void> = []

/** execFile with the spawn cap, and a timeout kill reported as a timeout. */
export async function runCapped(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  while (active >= MAX_SPAWNS) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await execFileAsync(file, args, { ...options, encoding: "utf8" })
  } catch (error) {
    const e = error as { killed?: boolean; signal?: string | null; message: string }
    if (e.killed) e.message = `timed out after ${options.timeout} ms and was killed (${e.signal}); a heavily loaded machine does this — rerun the file alone before treating it as a regression. ${e.message.split("\n")[0]}`
    throw error
  } finally {
    active--
    waiting.shift()?.()
  }
}
