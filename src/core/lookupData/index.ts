import type { AnnouncementCategoryItem, IndustryCodeItem, IndustryLookupItem, LookupItem } from "./types.js"

type LookupKey = "research-areas" | "broker-orgs" | "meeting-orgs" | "industries" | "regions" | "announcement-categories" | "industry-codes" | "theme-ids"

type LookupData = LookupItem[] | IndustryLookupItem[] | AnnouncementCategoryItem[] | IndustryCodeItem[]

const cache = new Map<string, LookupData>()

const loaders: Record<LookupKey, () => Promise<{ [k: string]: LookupData }>> = {
  "research-areas": () => import("./research-areas.js"),
  "broker-orgs": () => import("./broker-orgs.js"),
  "meeting-orgs": () => import("./meeting-orgs.js"),
  "industries": () => import("./industries.js"),
  "regions": () => import("./regions.js"),
  "announcement-categories": () => import("./announcement-categories.js"),
  "industry-codes": () => import("./industry-codes.js"),
  "theme-ids": () => import("./theme-ids.js"),
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
