import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, attachEnvelopeTraceId, isStructuralError, ValidationError } from "../../src/core/errors.js"
import { fetchOpinionDetails, type DetailClient } from "../../src/core/opinionDetail.js"

/** Answers each batch with a body for every requested ID except the ones in `gone`; throws
 * `failOn` for the batch whose first ID is in it. Records what each call asked for. */
function fakeClient(opts: { gone?: string[]; failOn?: { firstId: string; error: Error } } = {}) {
  const calls: string[][] = []
  const client: DetailClient = {
    async call(_key, body) {
      const ids = (body as { chiefOpinionIdList: string[] }).chiefOpinionIdList
      calls.push(ids)
      if (opts.failOn && ids[0] === opts.failOn.firstId) throw opts.failOn.error
      return ids.filter((id) => !opts.gone?.includes(id)).map((id) => ({ chiefOpinionId: id, content: `body ${id}` }))
    },
  }
  return { client, calls }
}

const ids = (n: number, prefix = "ID") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const run = (client: DetailClient, list: string[]) => fetchOpinionDetails(client, "insight.opinion.detail", "chiefOpinionIdList", "chiefOpinionId", list)

beforeEach(() => { vi.spyOn(process.stderr, "write").mockImplementation(() => true) })
afterEach(() => { vi.restoreAllMocks() })

describe("fetchOpinionDetails", () => {
  it("de-duplicates and sends at most 20 IDs per call, in order", async () => {
    const { client, calls } = fakeClient()
    const result = await run(client, [...ids(45), "ID1", "ID2"])
    expect(calls.map((c) => c.length)).toEqual([20, 20, 5])
    expect(calls.flat()).toEqual(ids(45))
    expect(result.total).toBe(45)
    expect(result.partial).toBeUndefined()
  })

  it("names the IDs the server skipped and marks the result partial", async () => {
    const { client } = fakeClient({ gone: ["ID2", "ID21"] })
    const result = await run(client, ids(25))
    expect(result.missingIds).toEqual(["ID2", "ID21"])
    expect(result.partial).toBe(true)
    expect(result.total).toBe(23)
  })

  it("keeps the bodies of earlier batches when a later one fails, and lists what was not fetched and why", async () => {
    const failure = new ApiError("参数值非法", "100003")
    const { client } = fakeClient({ failOn: { firstId: "ID21", error: failure } })
    const result = await run(client, ids(30))
    expect(result.total).toBe(20)
    expect(result.unfetchedIds).toEqual(ids(30).slice(20))
    expect(result.unfetchedError).toMatchObject({ message: "参数值非法", code: "100003" })
    // Not fetched is not the same as skipped: none of these may be reported as missing.
    expect(result.missingIds).toBeUndefined()
    expect(result.partial).toBe(true)
  })

  it("throws when the first batch fails — nothing was delivered, so there is nothing to keep", async () => {
    const failure = new ApiError("boom", "999999")
    const { client } = fakeClient({ failOn: { firstId: "ID1", error: failure } })
    await expect(run(client, ids(3))).rejects.toBe(failure)
  })

  it("drops a null element as a missing body and keeps the bodies returned beside it", async () => {
    const client: DetailClient = {
      async call(_key, body) {
        const batch = (body as { chiefOpinionIdList: string[] }).chiefOpinionIdList
        return batch[0] === "ID21" ? [null] : [...batch.slice(1).map((id) => ({ chiefOpinionId: id, content: `body ${id}` })), null]
      },
    }
    const result = await run(client, ids(21))
    // First batch: ID1 came back as null beside 19 bodies; second batch: ID21 as null.
    expect(result.total).toBe(19)
    expect(result.missingIds).toEqual(["ID1", "ID21"])
    expect(result.unfetchedIds).toBeUndefined()
    expect(result.partial).toBe(true)
    const warnings = vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join("")
    expect(warnings).toContain("no body returned for 2 ID(s): ID1, ID21 (2 came back as a null element)")
  })

  it.each([[1], ["x"], [[]]])("fails a batch holding a non-null non-object element (%j) as a layout change", async (element) => {
    const client: DetailClient = {
      async call(_key, body) {
        const batch = (body as { chiefOpinionIdList: string[] }).chiefOpinionIdList
        return attachEnvelopeTraceId(batch[0] === "ID21" ? [element] : batch.map((id) => ({ chiefOpinionId: id, content: `body ${id}` })), "T-21")
      },
    }
    // A later batch: the bodies already returned are kept and the rest listed as not fetched,
    // with the response's traceId.
    const later = await run(client, ids(21))
    expect(later.total).toBe(20)
    expect(later.unfetchedIds).toEqual(["ID21"])
    expect(later.unfetchedError).toMatchObject({ traceId: "T-21" })
    expect(later.partial).toBe(true)
    // The first batch: nothing was delivered, so the error surfaces as structural.
    const error = await run(client, ["ID21"]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(isStructuralError(error)).toBe(true)
    expect((error as ApiError).traceId).toBe("T-21")
  })

  it("keeps the bodies a batch returned beside a non-object element and lists only the rest as not fetched", async () => {
    const client: DetailClient = {
      async call(_key, body) {
        const batch = (body as { chiefOpinionIdList: string[] }).chiefOpinionIdList
        return batch[0] === "ID21" ? [{ chiefOpinionId: "ID21", content: "body ID21" }, "x"] : batch.map((id) => ({ chiefOpinionId: id, content: `body ${id}` }))
      },
    }
    const later = await run(client, ids(22))
    expect(later.total).toBe(21)
    expect(later.unfetchedIds).toEqual(["ID22"])
    expect(later.missingIds).toBeUndefined()
    expect(later.partial).toBe(true)
    // In the first batch too: a body was delivered, so it is kept rather than thrown away.
    const first = await run(client, ["ID21", "ID22"])
    expect(first.total).toBe(1)
    expect(first.unfetchedIds).toEqual(["ID22"])
    expect(first.partial).toBe(true)
  })

  it("refuses an empty ID list before any request", async () => {
    const { client, calls } = fakeClient()
    await expect(run(client, [])).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toHaveLength(0)
  })
})
