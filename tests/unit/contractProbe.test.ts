import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

// scripts/contract-probe.mjs is driven against tests/fixtures/fake-gangtise.mjs (a
// stand-in CLI) through the GANGTISE_CONTRACT_CLI / GANGTISE_CONTRACT_SNAPSHOT
// overrides. What is pinned here is the probe's own contract: what counts as a
// change, what counts as a failure, and that neither depends on row order.
const run = promisify(execFile)
const SCRIPT = path.resolve(process.cwd(), "scripts/contract-probe.mjs")
const FAKE = path.resolve(process.cwd(), "tests/fixtures/fake-gangtise.mjs")

let dir: string
let snapshot: string

async function probe(mode: "ok" | "reorder" | "fail" | "drift", ...flags: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await run(process.execPath, [SCRIPT, ...flags], {
      env: { ...process.env, GANGTISE_CONTRACT_CLI: FAKE, GANGTISE_CONTRACT_SNAPSHOT: snapshot, FAKE_MODE: mode },
    })
    return { code: 0, stderr }
  } catch (error) {
    const e = error as { code?: number; stderr?: string }
    return { code: typeof e.code === "number" ? e.code : 1, stderr: e.stderr ?? "" }
  }
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "gangtise-contract-"))
  snapshot = path.join(dir, "api-contract.json")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("contract-probe", () => {
  it("--update writes a baseline and a rerun on the same contract passes", async () => {
    expect((await probe("ok", "--update")).code).toBe(0)
    const written = JSON.parse(await readFile(snapshot, "utf8")) as Record<string, unknown>
    expect(Object.keys(written).sort()).toEqual(["indicator.search", "quote.day-kline", "quote.fund-flow", "quote.minute-kline", "quote.realtime", "reference.constant-category"])
    const again = await probe("ok")
    expect(again.code).toBe(0)
    expect(again.stderr).not.toContain("≠")
  }, 30_000)

  it("row order is not part of the contract: reversed rows still pass", async () => {
    // Identical columns and null pattern, every list reversed — including the two-date
    // day-kline rows, where a naive "last row per security" would flip the null pattern.
    expect((await probe("ok", "--update")).code).toBe(0)
    const reordered = await probe("reorder")
    expect(reordered.stderr).not.toContain("≠")
    expect(reordered.code).toBe(0)
  }, 30_000)

  it("a genuine contract change fails the plain run, leaves the baseline alone, and is accepted only by --update", async () => {
    // One extra column on the realtime rows — everything else identical. This is the
    // one case the probe exists for; a comparison that silently passed it would make
    // every other test here vacuous.
    expect((await probe("ok", "--update")).code).toBe(0)
    const before = await readFile(snapshot, "utf8")
    const drifted = await probe("drift")
    expect(drifted.code).toBe(1)
    expect(drifted.stderr).toContain("≠ quote.realtime")
    expect(drifted.stderr).toContain("differ from the snapshot")
    expect(await readFile(snapshot, "utf8")).toBe(before)
    expect((await probe("drift", "--update")).code).toBe(0)
    expect(await readFile(snapshot, "utf8")).not.toBe(before)
    expect((await probe("drift")).code).toBe(0)
  }, 30_000)

  it("--update refuses to write when a probe failed to run, and keeps the old baseline", async () => {
    expect((await probe("ok", "--update")).code).toBe(0)
    const before = await readFile(snapshot, "utf8")
    const mtimeBefore = (await stat(snapshot)).mtimeMs
    const failed = await probe("fail", "--update")
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain("NOT updated")
    expect(failed.stderr).not.toContain("snapshot written")
    expect(await readFile(snapshot, "utf8")).toBe(before)
    expect((await stat(snapshot)).mtimeMs).toBe(mtimeBefore)
  }, 30_000)

  it("--update with no prior baseline and failing probes writes nothing at all", async () => {
    const failed = await probe("fail", "--update")
    expect(failed.code).toBe(1)
    await expect(stat(snapshot)).rejects.toThrow()
  }, 30_000)

  it("a plain run reports failed probes as a non-zero exit, not as a pass", async () => {
    expect((await probe("ok", "--update")).code).toBe(0)
    const failed = await probe("fail")
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain("failed to run")
  }, 30_000)
})
