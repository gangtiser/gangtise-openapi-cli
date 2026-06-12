import { describe, expect, it } from "vitest"

import { getLookupData } from "../../src/core/lookupData/index.js"

describe("getLookupData (lazy JSON loader)", () => {
  it("loads broker-orgs and returns LookupItem[]", async () => {
    const data = await getLookupData("broker-orgs")
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(50)
    expect(data[0]).toHaveProperty("id")
    expect(data[0]).toHaveProperty("name")
  })

  it("loads meeting-orgs data", async () => {
    const data = await getLookupData("meeting-orgs")
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(50)
  })

  it("loads industry-codes with code field", async () => {
    const data = await getLookupData("industry-codes") as Array<{ name: string; code: string }>
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("code")
    expect(data[0].code).toMatch(/\.SWI$/)
  })

  it("caches data — second call returns same reference", async () => {
    const first = await getLookupData("industry-codes")
    const second = await getLookupData("industry-codes")
    expect(first).toBe(second) // same reference
  })

  it("each lookup type loads independently", async () => {
    const brokers = await getLookupData("broker-orgs")
    const codes = await getLookupData("industry-codes")
    expect(brokers).not.toBe(codes)
    expect(brokers.length).not.toBe(codes.length)
  })
})
