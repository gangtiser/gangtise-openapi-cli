import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __resetTitleCacheForTests,
  extractTitles,
  lookupTitleCache,
  MAX_TITLES_PER_ENDPOINT,
  readTitleCache,
  writeTitleCache,
  type TitleCacheData,
} from "../../src/core/titleCache.js"

describe("extractTitles", () => {
  it("maps id field to title field, stringifying ids", () => {
    const titles = extractTitles(
      [{ reportId: 1, title: "A" }, { reportId: 2, title: "B" }],
      { endpointKey: "x", idField: "reportId" },
    )
    expect(titles).toEqual({ "1": "A", "2": "B" })
  })

  it("supports a custom title field", () => {
    const titles = extractTitles([{ id: "9", name: "N" }], { endpointKey: "x", idField: "id", titleField: "name" })
    expect(titles).toEqual({ "9": "N" })
  })

  it("skips rows with missing id, missing title, or non-string title", () => {
    const titles = extractTitles(
      [
        { reportId: 1, title: "ok" },
        { reportId: 2 },
        { title: "no id" },
        { reportId: 3, title: 42 },
        null,
        "nope",
      ],
      { endpointKey: "x", idField: "reportId" },
    )
    expect(titles).toEqual({ "1": "ok" })
  })
})

describe("lookupTitleCache", () => {
  const fresh: TitleCacheData = { ep: { titles: { "1": "Fresh" }, ts: Date.now() } }

  it("returns a title within TTL", () => {
    expect(lookupTitleCache(fresh, "ep", "1")).toBe("Fresh")
  })

  it("returns undefined for unknown endpoint or id", () => {
    expect(lookupTitleCache(fresh, "other", "1")).toBeUndefined()
    expect(lookupTitleCache(fresh, "ep", "999")).toBeUndefined()
  })

  it("returns undefined once the entry is older than the 24h TTL", () => {
    const stale: TitleCacheData = { ep: { titles: { "1": "Old" }, ts: Date.now() - 25 * 60 * 60 * 1000 } }
    expect(lookupTitleCache(stale, "ep", "1")).toBeUndefined()
  })
})

describe("readTitleCache / writeTitleCache", () => {
  const dir = path.join(os.tmpdir(), `gangtise-title-test-${process.pid}`)
  const file = path.join(dir, "title-cache.json")

  beforeEach(() => {
    __resetTitleCacheForTests()
  })

  afterEach(async () => {
    // Two tests here spy on fs. The in-test restore runs after the assertions, so a
    // failing (or rejecting) test would leak its mock into the rest of the file and
    // turn one red into a cascade that hides the real cause.
    vi.restoreAllMocks()
    __resetTitleCacheForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("persists titles and reads them back", async () => {
    await writeTitleCache("insight.research.list", { "123": "Report" }, file)

    __resetTitleCacheForTests() // force a fresh read from disk
    const data = await readTitleCache(file)
    expect(data["insight.research.list"].titles).toEqual({ "123": "Report" })
    expect(typeof data["insight.research.list"].ts).toBe("number")
  })

  it("merges new titles into an existing endpoint entry", async () => {
    await writeTitleCache("ep", { "1": "one" }, file)
    await writeTitleCache("ep", { "2": "two" }, file)

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(data.ep.titles).toEqual({ "1": "one", "2": "two" })
  })

  it("persists every concurrent write, not just the one that won the flush", async () => {
    // The second writer is handed the FIRST writer's in-flight flush promise, which
    // already took its JSON snapshot. Without re-checking `dirty` after the rename,
    // the second entry lives in memory and never reaches disk — awaiting both calls
    // still resolves, so the loss is silent.
    await Promise.all([
      writeTitleCache("ep", { "1": "one" }, file),
      writeTitleCache("ep", { "2": "two" }, file),
      writeTitleCache("ep", { "3": "three" }, file),
    ])

    __resetTitleCacheForTests() // force a fresh read from disk
    const data = await readTitleCache(file)
    expect(data.ep.titles).toEqual({ "1": "one", "2": "two", "3": "three" })
  })

  it("persists writes that arrive while the flush is deciding to stop", async () => {
    // The loop's exit test and the release of `pendingWrite` must happen in ONE
    // synchronous block. Split by an await, a write landing between them attaches to
    // a flush that already decided nothing was left: its entry stays in memory, never
    // reaches disk, and its own `await` still resolves. Fired from inside the rename's
    // own resolution at three different scheduling points, so the test does not depend
    // on the exact microtask depth of the gap — a single-shot version only reddens at
    // one depth and would silently stop testing anything if V8 changed its tick count.
    const realRename = fs.rename.bind(fs)
    let fired = false
    const late: Promise<void>[] = []
    vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      await realRename(oldPath, newPath)
      if (fired) return
      fired = true
      void Promise.resolve().then(() => {
        late.push(writeTitleCache("ep", { x: "X" }, file))
        late.push(writeTitleCache("ep", { y: "Y" }, file))
      })
      queueMicrotask(() => { late.push(writeTitleCache("ep", { z: "Z" }, file)) })
    })

    await writeTitleCache("ep", { "1": "one" }, file)
    await new Promise((resolve) => setTimeout(resolve, 40))
    await Promise.all(late)
    await new Promise((resolve) => setTimeout(resolve, 40))
    vi.restoreAllMocks()

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(data.ep.titles).toEqual({ "1": "one", x: "X", y: "Y", z: "Z" })
  })

  it("drops the in-flight load handle on reset instead of reusing it", async () => {
    // Asserting on the RETURNED DATA is racy here: the in-flight load's continuation
    // cannot be cancelled, so it repopulates `memoryCache` after the reset and which
    // read wins depends on timing. The handle is what the reset owns, so count the
    // reads instead — both calls issue their readFile synchronously in this tick,
    // making the count order-independent. Without the reset clearing `pendingLoad`,
    // the second call is handed the pre-reset promise and readFile runs once.
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ ep: { ts: Date.now(), titles: { seed: "s" } } }), "utf8")
    __resetTitleCacheForTests()

    const readFile = vi.spyOn(fs, "readFile")
    const inflight = readTitleCache(file)
    __resetTitleCacheForTests()
    const afterReset = readTitleCache(file)
    const [, data] = await Promise.all([inflight, afterReset])

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(Object.keys(data)).toEqual(["ep"])
  })

  it("keeps concurrent loads of DIFFERENT files apart", async () => {
    // The coalescing that fixes the shared-object bug must be keyed by path. Keyed on
    // the promise alone, a caller asking for file B gets file A's contents back — a
    // worse failure than the one being fixed, because it is wrong data rather than a
    // lost cache entry.
    const other = path.join(dir, "other-cache.json")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ epA: { ts: Date.now(), titles: { a: "A" } } }), "utf8")
    await fs.writeFile(other, JSON.stringify({ epB: { ts: Date.now(), titles: { b: "B" } } }), "utf8")
    __resetTitleCacheForTests()

    const [a, b] = await Promise.all([readTitleCache(file), readTitleCache(other)])
    expect(Object.keys(a)).toEqual(["epA"])
    expect(Object.keys(b)).toEqual(["epB"])
  })

  it("shares one in-memory object across concurrent first-loads", async () => {
    // Both readers miss the cache and race to load it. If each builds its own object,
    // the last assignment wins and writes merged into the loser's reference vanish.
    await fs.mkdir(dir, { recursive: true }) // nothing has flushed yet, so the dir is absent
    await fs.writeFile(file, JSON.stringify({ ep: { ts: Date.now(), titles: { seed: "s" } } }), "utf8")
    __resetTitleCacheForTests()

    const [a, b] = await Promise.all([readTitleCache(file), readTitleCache(file)])
    expect(a).toBe(b) // same object identity, not merely deep-equal

    await writeTitleCache("ep", { "1": "one" }, file)
    __resetTitleCacheForTests()
    const onDisk = await readTitleCache(file)
    expect(onDisk.ep.titles).toEqual({ seed: "s", "1": "one" })
  })

  it("returns an empty object when the cache file is absent", async () => {
    const data = await readTitleCache(path.join(dir, "missing.json"))
    expect(data).toEqual({})
  })

  it("caps titles per endpoint to avoid unbounded growth", async () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < MAX_TITLES_PER_ENDPOINT + 100; i++) big[`id${i}`] = `T${i}`
    await writeTitleCache("ep", big, file)

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(Object.keys(data.ep.titles).length).toBe(MAX_TITLES_PER_ENDPOINT)
  })

  it("evicts older entries but keeps the freshly written ids when over the cap", async () => {
    const first: Record<string, string> = {}
    for (let i = 0; i < MAX_TITLES_PER_ENDPOINT; i++) first[`old${i}`] = `O${i}`
    await writeTitleCache("ep", first, file) // exactly at cap
    await writeTitleCache("ep", { new1: "N1", new2: "N2" }, file) // pushes over the cap

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(Object.keys(data.ep.titles).length).toBe(MAX_TITLES_PER_ENDPOINT)
    expect(data.ep.titles.new1).toBe("N1")
    expect(data.ep.titles.new2).toBe("N2")
  })

  it("evicts the OLDEST entries when over the cap, not the most recent batch", async () => {
    // Anti-LRU regression: the fill used to walk insertion order from the front,
    // protecting the oldest batch and evicting yesterday's — so a morning `list`
    // would lose its cache by the afternoon download.
    const oldBatch: Record<string, string> = {}
    for (let i = 0; i < 3000; i++) oldBatch[`old${i}`] = `O${i}`
    await writeTitleCache("ep", oldBatch, file)
    const midBatch: Record<string, string> = {}
    for (let i = 0; i < 3000; i++) midBatch[`mid${i}`] = `M${i}`
    await writeTitleCache("ep", midBatch, file) // 6000 merged → prune to 5000

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(Object.keys(data.ep.titles).length).toBe(MAX_TITLES_PER_ENDPOINT)
    expect(data.ep.titles.mid0).toBe("M0") // fresh batch fully kept
    expect(data.ep.titles.old2999).toBe("O2999") // newest of the old batch survives
    expect(data.ep.titles.old0).toBeUndefined() // oldest entries are the ones evicted
  })

  it("drops endpoint entries past the TTL on the next write", async () => {
    await fs.mkdir(dir, { recursive: true })
    const stale: TitleCacheData = { stale: { titles: { "1": "x" }, ts: Date.now() - 25 * 60 * 60 * 1000 } }
    await fs.writeFile(file, JSON.stringify(stale))

    __resetTitleCacheForTests() // force a read of the hand-written file
    await writeTitleCache("active", { "2": "y" }, file)

    __resetTitleCacheForTests()
    const data = await readTitleCache(file)
    expect(data.stale).toBeUndefined()
    expect(data.active.titles).toEqual({ "2": "y" })
  })
})
