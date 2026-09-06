import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { streamOutputToFile } from "../../src/core/output.js"
import { attachRowSink, getRowSink, ExportSink, rowCount } from "../../src/core/rowSink.js"
import { MAX_TITLES_PER_ENDPOINT } from "../../src/core/titleCache.js"

const dir = path.join(os.tmpdir(), `gangtise-rowsink-test-${process.pid}`)

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const readLines = async (file: string) => (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown)

describe("ExportSink", () => {
  it("buffers a small result and hands it back raw without touching the disk", async () => {
    const sink = new ExportSink(path.join(dir, "small.jsonl"))
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
    const sink = new ExportSink(target)
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
    const sink = new ExportSink(target)
    sink.setFieldList(["id"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ id: i, extra: true })))
    await sink.finish()
    expect((await readLines(target))[999]).toEqual({ id: 999, extra: true })
  })

  it("abort removes the partial file; finish afterwards is a no-op and the target never appears", async () => {
    const target = path.join(dir, "aborted.jsonl")
    const sink = new ExportSink(target)
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ i })))
    expect(sink.opened).toBe(true)
    await sink.abort()
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await sink.finish()
    await expect(fs.access(target)).rejects.toThrow()
    // Nothing opened → nothing to remove: abort must be safe to call on the way out.
    await new ExportSink(path.join(dir, "never.jsonl")).abort()
  })

  it("collects download titles from the rows it writes, since the rows are gone afterwards", async () => {
    const target = path.join(dir, "titles.jsonl")
    const sink = new ExportSink(target, "jsonl", { endpointKey: "insight.research.list", idField: "reportId" })
    sink.setFieldList(["reportId", "title"])
    await sink.push(Array.from({ length: 1000 }, (_, i) => [`r${i}`, `T${i}`]))
    await sink.finish()
    expect(Object.keys(sink.titles)).toHaveLength(1000)
    expect(sink.titles.r999).toBe("T999")
  })

  it("rowCount reads a sink-backed result and a plain list alike", async () => {
    const sink = new ExportSink(path.join(dir, "count.jsonl"))
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

  it("csv: streams rows to a temp file and assembles header + rows on finish, byte-identical to the in-memory csv path", async () => {
    // Column union in first-appearance order, later columns padded on earlier rows, BOM up front.
    const rows = Array.from({ length: 1000 }, (_, i) => (i < 500 ? { a: i, b: `x,${i}` } : { a: i, c: true }))
    const target = path.join(dir, "big.csv")
    const sink = new ExportSink(target, "csv")
    await sink.push(rows)
    expect(sink.opened).toBe(true)
    await expect(fs.access(target)).rejects.toThrow()
    await sink.finish()
    const streamed = await fs.readFile(target, "utf8")
    const reference = path.join(dir, "reference.csv")
    expect(await streamOutputToFile({ total: rows.length, list: rows }, "csv", reference)).toBe(true)
    expect(streamed).toBe(await fs.readFile(reference, "utf8"))
    expect(streamed.startsWith("\ufeffa,b,c\n")).toBe(true)
    expect(streamed.split("\n")[501]).toBe("500,,true")
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await expect(fs.access(`${target}.rows.part`)).rejects.toThrow()
  })

  it("csv: zips columnar rows against the header and drops stray scalar rows like rowsFromList", async () => {
    const target = path.join(dir, "columnar.csv")
    const sink = new ExportSink(target, "csv")
    sink.setFieldList(["id", "name"])
    await sink.push([...Array.from({ length: 999 }, (_, i) => [i, `n${i}`]), null, "stray"])
    await sink.finish()
    const lines = (await fs.readFile(target, "utf8")).split("\n").filter(Boolean)
    expect(lines).toHaveLength(1000) // header + 999 object rows; null / "stray" dropped
    expect(lines[0]).toBe("\ufeffid,name")
    expect(lines[999]).toBe("998,n998")
    expect(sink.rows).toBe(1001)
    expect(sink.dataRows).toBe(999)
  })

  it("csv: an all-scalar list renders as index,value pairs", async () => {
    const target = path.join(dir, "scalars.csv")
    const sink = new ExportSink(target, "csv")
    await sink.push(Array.from({ length: 1000 }, (_, i) => `code${i}`))
    await sink.finish()
    const lines = (await fs.readFile(target, "utf8")).split("\n").filter(Boolean)
    expect(lines[0]).toBe("\ufeffindex,value")
    expect(lines[1]).toBe("0,code0")
    expect(lines[1000]).toBe("999,code999")
    expect(sink.dataRows).toBe(1000)
  })

  it("csv: abort removes both the rows file and the partial csv", async () => {
    const target = path.join(dir, "aborted.csv")
    const sink = new ExportSink(target, "csv")
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ i })))
    await sink.abort()
    await expect(fs.access(`${target}.rows.part`)).rejects.toThrow()
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await expect(fs.access(target)).rejects.toThrow()
  })

  it("csv: a failure in the second pass is cleaned up by abort and nothing reappears afterwards", async () => {
    const target = path.join(dir, "second-pass.csv")
    const sink = new ExportSink(target, "csv")
    await sink.push(Array.from({ length: 1000 }, (_, i) => ({ id: i })))
    // The rows file opens lazily; wait for it to exist before making it unreadable.
    for (let i = 0; i < 50; i++) { try { await fs.access(`${target}.rows.part`); break } catch { await new Promise((r) => setTimeout(r, 10)) } }
    await fs.chmod(`${target}.rows.part`, 0o000) // the second pass cannot read its own rows
    await expect(sink.finish()).rejects.toThrow()
    await sink.abort()
    // Give a lazily-opened writer every chance to recreate the file — it must not.
    await new Promise((r) => setTimeout(r, 300))
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await expect(fs.access(`${target}.rows.part`)).rejects.toThrow()
    await expect(fs.access(target)).rejects.toThrow()
  })

  it("csv: a read failure while a wide header is still draining rejects normally instead of escaping as an uncaught error", async () => {
    // 1000 long column names make a header far above the writer's 64 KiB buffer, so the
    // header write waits on the disk; the rows file is made unreadable meanwhile. The
    // reader's error must arrive through the iteration (a rejection), never as an
    // unhandled 'error' event — vitest would report that as an unhandled error.
    const target = path.join(dir, "wide-header.csv")
    const sink = new ExportSink(target, "csv")
    const wide: Record<string, number> = {}
    for (let c = 0; c < 1000; c++) wide[`a_rather_long_column_name_that_pads_the_header_out_to_many_kilobytes_${String(c).padStart(4, "0")}`] = c
    await sink.push([wide, ...Array.from({ length: 999 }, (_, i) => ({ id: i }))])
    for (let i = 0; i < 50; i++) { try { await fs.access(`${target}.rows.part`); break } catch { await new Promise((r) => setTimeout(r, 10)) } }
    await fs.chmod(`${target}.rows.part`, 0o000)
    await expect(sink.finish()).rejects.toThrow()
    await sink.abort()
    await new Promise((r) => setTimeout(r, 300))
    await expect(fs.access(`${target}.part`)).rejects.toThrow()
    await expect(fs.access(`${target}.rows.part`)).rejects.toThrow()
    await expect(fs.access(target)).rejects.toThrow()
  })

  it("applies the same header rules as the in-memory path once a result streams: duplicate names and missing fieldList are refused", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [i, 999])
    const dup = new ExportSink(path.join(dir, "dup.jsonl"))
    dup.setFieldList(["close", "close"])
    await expect(dup.push(rows)).rejects.toThrow(/重复列名（close）/)
    await dup.abort()
    const bare = new ExportSink(path.join(dir, "bare.csv"), "csv")
    await expect(bare.push(rows)).rejects.toThrow(/没有 fieldList/)
    await bare.abort()
    await expect(fs.access(path.join(dir, "dup.jsonl.part"))).rejects.toThrow()
    await expect(fs.access(path.join(dir, "bare.csv.rows.part"))).rejects.toThrow()
  })

  it("caps the collected titles at the cache's per-endpoint limit", async () => {
    const target = path.join(dir, "many-titles.jsonl")
    const sink = new ExportSink(target, "jsonl", { endpointKey: "insight.research.list", idField: "reportId" })
    sink.setFieldList(["reportId", "title"])
    await sink.push(Array.from({ length: MAX_TITLES_PER_ENDPOINT + 500 }, (_, i) => [`r${i}`, `T${i}`]))
    await sink.finish()
    expect(Object.keys(sink.titles)).toHaveLength(MAX_TITLES_PER_ENDPOINT)
    expect(sink.rows).toBe(MAX_TITLES_PER_ENDPOINT + 500)
  })
})
