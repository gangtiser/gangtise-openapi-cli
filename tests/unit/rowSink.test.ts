import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { attachRowSink, getRowSink, JsonlRowSink, rowCount } from "../../src/core/rowSink.js"

const dir = path.join(os.tmpdir(), `gangtise-rowsink-test-${process.pid}`)

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const readLines = async (file: string) => (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown)

describe("JsonlRowSink", () => {
  it("buffers a small result and hands it back raw without touching the disk", async () => {
    const sink = new JsonlRowSink(path.join(dir, "small.jsonl"))
    await sink.push([[1, "a"]])
    await sink.push([[2, "b"]])
    expect(sink.opened).toBe(false)
    expect(sink.count).toBe(2)
    expect(sink.rows).toBe(0)
    expect(sink.takeBuffer()).toEqual([[1, "a"], [2, "b"]])
    expect(sink.count).toBe(0)
    await expect(fs.access(dir)).rejects.toThrow()
  })

  it("opens the file at the threshold, zips columnar rows against the header, keeps order and renames on finish", async () => {
    const target = path.join(dir, "big.jsonl")
    const sink = new JsonlRowSink(target)
    sink.setFieldList(["id", "v"])
    for (let i = 0; i < 1200; i += 100) {
      await sink.push(Array.from({ length: 100 }, (_, j) => [i + j, "x"]))
    }
    expect(sink.opened).toBe(true)
    expect(sink.rows).toBe(1200)
    expect(sink.count).toBe(1200)
    // Still a .part until finish(): a reader must never see a half-written export.
    await expect(fs.access(target)).rejects.toThrow()
    await sink.finish()
    const lines = await readLines(target)
    expect(lines).toHaveLength(1200)
    expect(lines[0]).toEqual({ id: 0, v: "x" })
    expect(lines[1199]).toEqual({ id: 1199, v: "x" })
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
  })

  it("writes object rows as they are, even when a header is set", async () => {
    const target = path.join(dir, "objects.jsonl")
    const sink = new JsonlRowSink(target)
    sink.setFieldList(["id"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ id: i, extra: true })))
    await sink.finish()
    expect((await readLines(target))[999]).toEqual({ id: 999, extra: true })
  })

  it("abort removes the partial file; finish afterwards is a no-op and the target never appears", async () => {
    const target = path.join(dir, "aborted.jsonl")
    const sink = new JsonlRowSink(target)
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ i })))
    expect(sink.opened).toBe(true)
    await sink.abort()
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await sink.finish()
    await expect(fs.access(target)).rejects.toThrow()
    // Nothing opened → nothing to remove: abort must be safe to call on the way out.
    await new JsonlRowSink(path.join(dir, "never.jsonl")).abort()
  })

  it("collects download titles from the rows it writes, since the rows are gone afterwards", async () => {
    const target = path.join(dir, "titles.jsonl")
    const sink = new JsonlRowSink(target, { endpointKey: "insight.research.list", idField: "reportId" })
    sink.setFieldList(["reportId", "title"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => [`r${i}`, `T${i}`]))
    await sink.finish()
    expect(Object.keys(sink.titles)).toHaveLength(1000)
    expect(sink.titles.r999).toBe("T999")
  })

  it("rowCount reads a sink-backed result and a plain list alike", async () => {
    const sink = new JsonlRowSink(path.join(dir, "count.jsonl"))
    await sink.push([{ a: 1 }, { a: 2 }, { a: 3 }])
    const result = attachRowSink({ total: 3, list: [] }, sink)
    expect(getRowSink(result)).toBe(sink)
    expect(rowCount(result)).toBe(3)
    expect(rowCount({ total: 2, list: [{ a: 1 }, { a: 2 }] })).toBe(2)
    expect(rowCount(null)).toBe(0)
    // The attachment is invisible to spreads and JSON: no consumer can trip over it.
    expect(Object.keys(result)).toEqual(["total", "list"])
    expect(JSON.stringify(result)).toBe('{"total":3,"list":[]}')
    expect(getRowSink({ ...result })).toBeUndefined()
  })
})
