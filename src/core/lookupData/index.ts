import type { IndustryCodeItem, LookupItem } from "./types.js"

type LookupKey = "broker-orgs" | "meeting-orgs" | "industry-codes"

type LookupData = LookupItem[] | IndustryCodeItem[]

const cache = new Map<string, LookupData>()

const loaders: Record<LookupKey, () => Promise<{ [k: string]: LookupData }>> = {
  "broker-orgs": () => import("./broker-orgs.js"),
  "meeting-orgs": () => import("./meeting-orgs.js"),
  "industry-codes": () => import("./industry-codes.js"),
}

export async function getLookupData(key: LookupKey): Promise<LookupData> {
  if (cache.has(key)) return cache.get(key)!
  const mod = await loaders[key]()
  const values = Object.values(mod)
  const data = values.find(v => Array.isArray(v)) as LookupData | undefined
  if (!data) throw new Error(`Lookup module "${key}" has no exported array`)
  cache.set(key, data)
  return data
}
