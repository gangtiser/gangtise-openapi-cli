import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

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
