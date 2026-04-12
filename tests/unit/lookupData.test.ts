import { describe, expect, it } from "vitest"

import { getLookupData } from "../../src/core/lookupData/index.js"

describe("getLookupData (lazy JSON loader)", () => {
  it("loads research-areas and returns LookupItem[]", async () => {
    const data = await getLookupData("research-areas")
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("id")
    expect(data[0]).toHaveProperty("name")
  })

  it("loads broker-orgs data", async () => {
    const data = await getLookupData("broker-orgs")
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(50)
  })

  it("loads industries with taxonomy field", async () => {
    const data = await getLookupData("industries") as Array<{ id: string; name: string; taxonomy: string }>
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("taxonomy")
    expect(data[0].taxonomy).toBe("sw")
  })

  it("loads announcement-categories with level and parentId", async () => {
    const data = await getLookupData("announcement-categories") as Array<{ id: string; name: string; level: number; parentId: string }>
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("level")
    expect(data[0]).toHaveProperty("parentId")
  })

  it("loads industry-codes with code field", async () => {
    const data = await getLookupData("industry-codes") as Array<{ name: string; code: string }>
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("code")
    expect(data[0].code).toMatch(/\.SWI$/)
  })

  it("loads theme-ids with 400+ entries", async () => {
    const data = await getLookupData("theme-ids")
    expect(data.length).toBeGreaterThan(400)
  })

  it("loads regions data", async () => {
    const data = await getLookupData("regions")
    expect(data.length).toBeGreaterThan(10)
  })

  it("loads meeting-orgs data", async () => {
    const data = await getLookupData("meeting-orgs")
    expect(data.length).toBeGreaterThan(50)
  })

  it("caches data — second call returns same reference", async () => {
    const first = await getLookupData("regions")
    const second = await getLookupData("regions")
    expect(first).toBe(second) // same reference
  })

  it("each lookup type loads independently", async () => {
    const regions = await getLookupData("regions")
    const industries = await getLookupData("industries")
    expect(regions).not.toBe(industries)
    expect(regions.length).not.toBe(industries.length)
  })
})