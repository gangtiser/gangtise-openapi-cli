/**
 * `fund etf-pcf-components`: the API answers each component's name but not its code, so the
 * CLI fills `componentCode` in from the name. A row that already carries a code keeps it,
 * which makes this a no-op once the API returns codes again — then remove the module.
 *
 * A name is looked up — in the whole-market securities list, fetched once per run, else with
 * reference securities-search — and the candidates are checked against the row's `close`,
 * a recent daily close of the component's own listing (probed on 14 ETFs — A share, Hong
 * Kong, US, A+H, bond, gold): first against the quote's latest price and previous close, then,
 * for rows the quote does not settle, against the closes of the day the list's prices in that
 * listing's market belong to (`listDates`). The price tells apart the A and H listings of one
 * company, which an A+H ETF lists as two rows under the same name. Where no price decides (an
 * ex-dividend day, a suspension, a bond with no quote), an exact name match stands only in an
 * ETF whose components all trade in one market — the ETF's own exchange breaking a tie within
 * it; in an ETF holding several markets the row stays null, as does anything else still open.
 */
import { beijingDateString } from "./args.js"
import { normalizeRows } from "./normalize.js"
import { PAGE_CONCURRENCY, runWithConcurrency } from "./transport.js"

interface Candidate { code: string; name: string; category: string; prefix: boolean }

export interface CodeLookup {
  /** securities-search rows for a keyword. */
  search(keyword: string): Promise<unknown[]>
  /** Previous close and latest price per code that the quote service knows. */
  quotes(codes: string[]): Promise<Map<string, number[]>>
  /** Daily closes per code between two dates, oldest first: for a list whose prices are a
   * day or more behind the quote. Without it such rows are left to the name. */
  closes?(codes: string[], startDate: string, endDate: string): Promise<Map<string, Array<[date: string, close: number]>>>
}

type Row = Record<string, unknown>

/** A component's close is the quoted price itself: on 14 ETFs (2026-10-27) every confirmed row
 * was equal to the cent, while the same name's listing in another market came as close as
 * 0.15% (A and H shares of one company, 0.3% often). The slack stays well under that. */
const PRICE_TOLERANCE = 0.0005
const agrees = (close: number, price: number) => price > 0 && Math.abs(close - price) / price <= PRICE_TOLERANCE
/** Code formats the realtime quote takes; nothing else is sent (bonds, listings in other
 * markets, placeholder codes the search returns). */
const QUOTABLE = /^(\d{6}\.(SH|SZ|BJ)|\d{5}\.HK|[A-Z][A-Z0-9.]*\.(O|N|A))$/
const QUOTE_BATCH = 500
/** Daily closes are fetched for this many calendar days back: a component list's prices lag
 * its trade date (2026-10-28 before the open, the 10-28 lists carried the A shares' 10-26
 * closes and the Hong Kong rows' 10-27 closes; later in a day they move up a day), and the
 * window also spans a long weekend. */
const CLOSES_WINDOW_DAYS = 10
/** Codes per daily-close request: the window's trading days times this stays under the
 * 10000-row cap of a day-kline request. */
const CLOSES_BATCH = 1000

const squash = (name: string) => name.replace(/\s+/g, "")
/** The exchange's short name drops the share-class suffix the search keeps ("小米集团-W"). */
const base = (name: string) => squash(name).replace(/-[A-Z]+$/, "")
const ticker = (code: string) => code.slice(0, code.lastIndexOf("."))
const exchange = (code: string) => code.slice(code.lastIndexOf(".") + 1)
const market = (code: string) => {
  const suffix = exchange(code)
  return ["SH", "SZ", "BJ"].includes(suffix) ? "CN" : ["O", "N", "A"].includes(suffix) ? "US" : suffix
}

function toCandidates(rows: unknown[]): Candidate[] {
  return rows.flatMap((row) => {
    const r = row as Row
    return typeof r.gtsCode === "string" && typeof r.gtsName === "string" && r.category !== "index"
      ? [{ code: r.gtsCode, name: r.gtsName, category: String(r.category), prefix: false }]
      : []
  })
}

/** The listings a component name can stand for: exact name (or ticker) matches, and names
 * that only start with it — the exchange truncates long names ("比亚迪电"), and a Hong Kong
 * listing can carry a longer name than the A share ("中国石油" / "中国石油股份"). A prefix
 * match needs its price to agree (see `byPrice` / `byName`). A US ticker the fuzzy search
 * misses is asked for again with its exchange suffix. */
async function candidatesFor(name: string, lookup: CodeLookup): Promise<Candidate[]> {
  const key = squash(name)
  const found = toCandidates(await lookup.search(key))
  const exact = found.filter((c) => base(c.name) === base(key) || ticker(c.code) === key)
  // "TRI" finds TRI.LON by ticker but not Thomson Reuters' TRI.O.
  if (/^[A-Z][A-Z0-9]{0,6}$/.test(key) && !exact.some((c) => market(c.code) === "US")) {
    const bySuffix = (await Promise.all(["O", "N"].map((suffix) => lookup.search(`${key}.${suffix}`))))
      .flatMap((rows) => toCandidates(rows))
      .filter((c) => ticker(c.code) === key)
    exact.push(...bySuffix)
  }
  const prefix = base(key).length >= 2 ? found.filter((c) => !exact.includes(c) && base(c.name).startsWith(base(key))) : []
  return [...exact, ...prefix.map((c) => ({ ...c, prefix: true }))]
}

/** Among several that fit equally. A tie across markets (the A and the H listing of one
 * name) is broken only for an ETF whose components all trade in one market; in an ETF that
 * holds more than one, the name cannot say which listing a row is, and the row stays null.
 * A tie within one market (a bond on two exchanges) goes to the ETF's own exchange. */
function narrow(candidates: Candidate[], etf: EtfContext): string | null {
  let left = candidates
  if (new Set(left.map((c) => market(c.code))).size > 1) {
    if (!etf.market) return null
    left = left.filter((c) => market(c.code) === etf.market)
  }
  if (left.length > 1) {
    const same = left.filter((c) => exchange(c.code) === etf.exchange)
    if (same.length) left = same
  }
  return left.length === 1 ? left[0].code : null
}

/** `market`: set only when everything known about this ETF's components points to one market;
 * undefined for an ETF that holds several (an A+H ETF), or before that is known. */
interface EtfContext { market?: string; exchange: string; used: Set<string> }

/** The listing whose price agrees with the row's close: exact matches first, then prefix
 * matches. Undefined when none agrees — and when a listing of the tier has no price to check
 * (none, or 0 while suspended) and `unchecked` says it could still be the row: a match beside
 * it settles nothing. */
function byPrice(row: Row, candidates: Candidate[], prices: Map<string, number[]>, etf: EtfContext, unchecked: (c: Candidate) => boolean): string | null | undefined {
  const close = typeof row.close === "number" ? row.close : undefined
  if (close === undefined) return undefined
  const open = candidates.filter((c) => !etf.used.has(c.code))
  for (const tier of [open.filter((c) => !c.prefix), open.filter((c) => c.prefix)]) {
    if (tier.some((c) => !prices.get(c.code)?.some((p) => p > 0) && unchecked(c))) return undefined
    const matched = tier.filter((c) => prices.get(c.code)?.some((p) => agrees(close, p)))
    if (matched.length) return narrow(matched, etf)
  }
  return undefined
}

/** No price agrees — an ex-dividend day moves the previous close off the listed one, a
 * suspension quotes 0, a bond has no quote, a quote request failed. In an ETF that trades in
 * one market, an exact name match in that market stands. In one that holds several, nothing
 * does: a quote that disagrees does not rule a listing out (ex-dividend, suspended), and a
 * missing one does not rule it in, so the name cannot say which listing the row is. A prefix
 * match never stands on its name alone. */
function byName(candidates: Candidate[], etf: EtfContext): string | null {
  if (!etf.market) return null
  const pool = candidates.filter((c) => !c.prefix && !etf.used.has(c.code) && market(c.code) === etf.market)
  return pool.length ? narrow(pool, etf) : null
}

/** One code the quote does not know fails its whole batch with 120001, so such a batch is
 * halved — one half after the other — until the codes that fail are on their own; they are
 * left unquoted. Any other failure (throttling, auth, an outage) leaves the batch unquoted
 * as it is: splitting would only multiply the requests. */
async function splitting<T>(codes: string[], fetch: (codes: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
  try {
    return await fetch(codes)
  } catch (error) {
    if (codes.length === 1 || (error as { code?: unknown })?.code !== "120001") return new Map()
    const half = Math.ceil(codes.length / 2)
    const first = await splitting(codes.slice(0, half), fetch)
    return new Map([...first, ...await splitting(codes.slice(half), fetch)])
  }
}

const inBatches = (codes: string[], size: number) => Array.from({ length: Math.ceil(codes.length / size) }, (_, i) => codes.slice(i * size, (i + 1) * size))

/** The trading day this ETF's list prices are the closes of, per market — one list can carry
 * its A shares' closes of one day and its H shares' of another: the day on which the most rows
 * with a single exact listing in that market equal that listing's close. A market gets none
 * unless at least two rows agree on one day and no other day ties with it. */
function listDates(rows: Row[], candidates: Map<string, Candidate[]>, history: Map<string, Array<[string, number]>>): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (typeof row.close !== "number") continue
    const exact = (candidates.get(row.componentName as string) ?? []).filter((c) => !c.prefix)
    if (exact.length !== 1) continue
    const tally = votes.get(market(exact[0].code)) ?? new Map<string, number>()
    for (const [date, close] of history.get(exact[0].code) ?? []) {
      if (agrees(row.close, close)) tally.set(date, (tally.get(date) ?? 0) + 1)
    }
    votes.set(market(exact[0].code), tally)
  }
  const dates = new Map<string, string>()
  for (const [where, tally] of votes) {
    const ranked = [...tally].sort((a, b) => b[1] - a[1])
    if (ranked.length && ranked[0][1] >= 2 && ranked[1]?.[1] !== ranked[0][1]) dates.set(where, ranked[0][0])
  }
  return dates
}

/** Each code's close on its market's date, or its last close before it (a market closed that
 * day, or a suspension). */
function closesOn(dates: Map<string, string>, history: Map<string, Array<[string, number]>>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const [code, series] of history) {
    const date = dates.get(market(code))
    if (!date) continue
    const last = series.filter(([d]) => d <= date).at(-1)
    if (last) out.set(code, [last[1]])
  }
  return out
}

export interface FilledComponents {
  rows: Row[]
  /** Rows left without a code: cash lines, commodities, names without a confident match. */
  unresolved: Array<{ fundCode: unknown; serialNumber: unknown; componentName: unknown }>
}

/** A row the API answered with a code of its own; `null` or an empty string is no code. */
const carriesCode = (row: Row) => typeof row.componentCode === "string" && row.componentCode !== ""
const needsCode = (row: Row) => !carriesCode(row) && typeof row.componentName === "string"

export async function fillComponentCodes(rows: Row[], lookup: CodeLookup): Promise<FilledComponents> {
  const pending = rows.filter(needsCode)
  const names = [...new Set(pending.map((r) => r.componentName as string))]
  const candidates = new Map<string, Candidate[]>()
  // A failed lookup leaves that name without candidates: the component list itself was
  // fetched (and billed) already, and is printed whatever happens here.
  await runWithConcurrency(names, PAGE_CONCURRENCY, async (name) => {
    candidates.set(name, await candidatesFor(name, lookup).catch(() => []))
  })
  const quotable = [...new Set([...candidates.values()].flat().filter((c) => ["stock", "dr"].includes(c.category) && QUOTABLE.test(c.code)).map((c) => c.code))]
  const prices = new Map((await runWithConcurrency(inBatches(quotable, QUOTE_BATCH), PAGE_CONCURRENCY, (batch) => splitting(batch, (codes) => lookup.quotes(codes)))).flatMap((quoted) => [...quoted]))
  const isQuotable = (c: Candidate) => ["stock", "dr"].includes(c.category) && QUOTABLE.test(c.code)

  const codes = new Map<Row, string | null>()
  const etfs = new Map<unknown, { own: Row[]; etf: EtfContext }>()
  const place = (row: Row, code: string | null, etf: EtfContext) => {
    codes.set(row, code)
    if (code) etf.used.add(code)
  }
  // Prices first, over every row: a listing its own price confirms is taken before a row
  // of the same name (the other share class of an A+H pair) can claim it by name alone.
  for (const fundCode of new Set(pending.map((r) => r.fundCode))) {
    const own = pending.filter((r) => r.fundCode === fundCode)
    const etf: EtfContext = { exchange: exchange(String(fundCode)), used: new Set() }
    etfs.set(fundCode, { own, etf })
    for (const row of own) {
      // A listing the quote misses is checked against its daily closes below.
      const code = byPrice(row, candidates.get(row.componentName as string) ?? [], prices, etf, isQuotable)
      if (code !== undefined) place(row, code, etf)
    }
  }
  // A list whose prices lag the quote by a day or more leaves its rows unplaced, as do a
  // suspension and an ex-dividend day: those are checked against the daily closes of the day
  // the list's prices in each market belong to.
  const open = (own: Row[]) => own.filter((r) => !codes.has(r) && typeof r.close === "number" && (candidates.get(r.componentName as string) ?? []).some(isQuotable))
  const lagging = [...etfs.values()].filter(({ own }) => open(own).length)
  if (lagging.length && lookup.closes) {
    const wanted = [...new Set(lagging.flatMap(({ own }) => own.flatMap((r) => (candidates.get(r.componentName as string) ?? []).filter(isQuotable).map((c) => c.code))))]
    const end = beijingDateString(new Date())
    const start = beijingDateString(new Date(Date.now() - CLOSES_WINDOW_DAYS * 86_400_000))
    const history = new Map((await runWithConcurrency(inBatches(wanted, CLOSES_BATCH), PAGE_CONCURRENCY, (batch) => splitting(batch, (codes) => lookup.closes!(codes, start, end)))).flatMap((part) => [...part]))
    for (const { own, etf } of lagging) {
      const dates = listDates(own, candidates, history)
      const onDate = closesOn(dates, history)
      for (const row of open(own)) {
        // A listing without a close on its market's day (that market has none, or the listing
        // no daily closes) is ruled out only when none of its recent closes agrees.
        const unchecked = (c: Candidate) => isQuotable(c) && (history.get(c.code)?.some(([, close]) => agrees(row.close as number, close)) ?? true)
        const code = byPrice(row, candidates.get(row.componentName as string) ?? [], onDate, etf, unchecked)
        if (code !== undefined) place(row, code, etf)
      }
    }
  }
  for (const { own, etf } of etfs.values()) {
    // The markets this ETF holds, as far as anything shows: listings its prices confirmed, and
    // names whose exact listings all trade in one market. Only when all of it points to one
    // market is that market trusted for what the prices could not settle (byName / narrow).
    const markets = new Set([...etf.used].map(market))
    for (const r of own) {
      const held = new Set((candidates.get(r.componentName as string) ?? []).filter((c) => !c.prefix).map((c) => market(c.code)))
      if (held.size === 1) markets.add([...held][0])
    }
    if (markets.size === 1) etf.market = [...markets][0]
    for (const row of own) if (!codes.has(row)) place(row, byName(candidates.get(row.componentName as string) ?? [], etf), etf)
  }

  const unresolved: FilledComponents["unresolved"] = []
  const filled = rows.map((row) => {
    if (!codes.has(row)) return row
    const code = codes.get(row) ?? null
    if (!code) unresolved.push({ fundCode: row.fundCode, serialNumber: row.serialNumber, componentName: row.componentName })
    // Where the API used to put it, so table and csv columns read as before.
    const out: Row = {}
    for (const [key, value] of Object.entries(row)) {
      if (key === "componentCode") continue
      out[key] = value
      if (key === "serialNumber") out.componentCode = code
    }
    if (!("componentCode" in out)) out.componentCode = code
    return out
  })
  return { rows: filled, unresolved }
}

/** The component list with `componentCode` filled in — null where nothing matched with
 * confidence — and a note on stderr that the codes are the CLI's own matching, naming the
 * rows left null. The answer keeps its shape. */
export async function addComponentCodes(data: unknown, lookup: CodeLookup): Promise<unknown> {
  const list = (data as { list?: unknown })?.list
  if (!Array.isArray(list)) return data
  const rows = list as Row[]
  const pending = rows.filter(needsCode).length
  if (!pending) return data
  const filled = await fillComponentCodes(rows, lookup)
  const left = filled.unresolved.map((u) => `${String(u.fundCode)} ${String(u.componentName)}`)
  const shown = left.length > 20 ? `${left.slice(0, 20).join(", ")}, …` : left.join(", ")
  process.stderr.write(`[gangtise] note: the API returns component names only; componentCode is the CLI's match for each name (looked up in the securities list, and checked against the component's close where it can be quoted): ${pending - left.length} of ${pending} rows.${left.length ? ` Left null (cash lines, commodities, names without a confident match): ${shown}` : ""}\n`)
  return { ...(data as object), list: filled.rows }
}

/** Every listed stock's code and name: the whole-market sectors of reference
 * sector-constituents — 全部A股, 全部港股, 全部美股. One request each instead of one search per
 * component name. Not kept between runs: fetching the three takes well under a second. */
const MARKET_SECTORS = ["1000000002", "1000002615", "1000002618"]

type Listing = [code: string, name: string]

/** The three markets' listings. Undefined when a market fails or comes back empty — a table
 * without one market would place the H row of an A+H name in the A market — and the lookup
 * then falls back to searching. */
export async function loadSecurityTable(fetchSector: (sectorId: string) => Promise<unknown>): Promise<Listing[] | undefined> {
  try {
    const markets = await Promise.all(MARKET_SECTORS.map(async (sectorId) => {
      const data = await fetchSector(sectorId) as { list?: unknown }
      const list = (Array.isArray(data?.list) ? data.list : []).flatMap((row): Listing[] => {
        const r = row as Row
        return typeof r.gtsCode === "string" && typeof r.gtsName === "string" ? [[r.gtsCode, r.gtsName]] : []
      })
      if (!list.length) throw new Error(`sector ${sectorId} listed nothing`)
      return list
    }))
    return markets.flat()
  } catch {
    return undefined
  }
}

/** Search over the table, shaped like securities-search rows: the listings carrying the name
 * (or ticker, or code) exactly, plus those whose name starts with it. Undefined when none
 * carries it exactly — a bond, a name the exchange truncated, a cash line — so the caller asks
 * the search service, which knows more than stocks. */
export function tableSearch(list: Listing[]): (keyword: string) => unknown[] | undefined {
  const byBase = new Map<string, Listing[]>()
  const byTicker = new Map<string, Listing[]>()
  const byCode = new Map<string, Listing>()
  const add = (index: Map<string, Listing[]>, key: string, listing: Listing) => {
    const listed = index.get(key)
    if (listed) listed.push(listing)
    else index.set(key, [listing])
  }
  for (const listing of list) {
    add(byBase, base(listing[1]), listing)
    add(byTicker, ticker(listing[0]), listing)
    byCode.set(listing[0], listing)
  }
  const bases = [...byBase.keys()]
  return (keyword) => {
    const key = squash(keyword)
    const name = base(key)
    const coded = byCode.get(key)
    const exact = [...(byBase.get(name) ?? []), ...(byTicker.get(key) ?? []), ...(coded ? [coded] : [])]
    if (!exact.length) return undefined
    const prefix = name.length >= 2 ? bases.filter((b) => b !== name && b.startsWith(name)).flatMap((b) => byBase.get(b)!) : []
    return [...new Set([...exact, ...prefix])].map(([gtsCode, gtsName]) => ({ gtsCode, gtsName, category: "stock" }))
  }
}

/** The lookups over a live client: names looked up in the securities table first (fetched once
 * per lookup) and in securities-search when the table does not carry them; the realtime
 * quote's previous close and latest price. */
export function clientLookup(client: { call(endpoint: string, body: unknown): Promise<unknown> }): CodeLookup {
  let table: Promise<((keyword: string) => unknown[] | undefined) | undefined> | undefined
  const local = () => (table ??= loadSecurityTable((sectorId) => client.call("reference.sector-constituents", { sectorId })).then((list) => list && tableSearch(list)))
  return {
    async search(keyword) {
      const hits = (await local())?.(keyword)
      if (hits) return hits
      const data = await client.call("reference.securities-search", { keyword, top: 10 }) as { list?: unknown }
      return Array.isArray(data?.list) ? data.list : []
    },
    async closes(codes, startDate, endDate) {
      const data = normalizeRows(await client.call("quote.day-kline", { securityList: codes, startDate, endDate, fieldList: ["securityCode", "tradeDate", "close"], limit: 10_000 }))
      const list = Array.isArray(data) ? data : ((data as { list?: unknown[] })?.list ?? [])
      const out = new Map<string, Array<[string, number]>>()
      for (const k of list as Row[]) {
        if (typeof k.securityCode !== "string" || typeof k.tradeDate !== "string" || typeof k.close !== "number") continue
        const series = out.get(k.securityCode) ?? []
        series.push([k.tradeDate, k.close])
        out.set(k.securityCode, series)
      }
      for (const series of out.values()) series.sort((a, b) => (a[0] < b[0] ? -1 : 1))
      return out
    },
    async quotes(codes) {
      const data = normalizeRows(await client.call("quote.realtime", { securityList: codes }))
      const list = Array.isArray(data) ? data : ((data as { list?: unknown[] })?.list ?? [])
      const out = new Map<string, number[]>()
      for (const q of list as Row[]) {
        const prices = [q.preClose, q.latestPrice].filter((p): p is number => typeof p === "number")
        if (typeof q.securityCode === "string" && prices.length) out.set(q.securityCode, prices)
      }
      return out
    },
  }
}
