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

  it("caches data — second call returns same reference", async () => {
    const first = await getLookupData("meeting-orgs")
    const second = await getLookupData("meeting-orgs")
    expect(first).toBe(second) // same reference
  })

  it("each lookup type loads independently", async () => {
    const brokers = await getLookupData("broker-orgs")
    const meetings = await getLookupData("meeting-orgs")
    expect(brokers).not.toBe(meetings)
  })
})
