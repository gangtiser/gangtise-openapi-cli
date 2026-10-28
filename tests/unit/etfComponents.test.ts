import { describe, expect, it } from "vitest"

import { clientLookup, fillComponentCodes, loadSecurityTable, tableSearch, type CodeLookup } from "../../src/core/etfComponents.js"

// Names, codes and prices are taken from the live answers of 2026-10-27 (14 ETFs).
type Listing = [code: string, name: string, category?: string]

function lookup(search: Record<string, Listing[]>, prices: Record<string, number[]>, fail: { search?: string; quote?: string } = {}) {
  const searched: string[] = []
  const quoted: string[][] = []
  const api: CodeLookup = {
    async search(keyword) {
      searched.push(keyword)
      if (keyword === fail.search) throw new Error("search failed")
      return (search[keyword] ?? []).map(([gtsCode, gtsName, category = "stock"]) => ({ gtsCode, gtsName, category }))
    },
    async quotes(codes) {
      quoted.push(codes)
      // The quote answers 120001 for the whole batch when one code is unknown.
      if (fail.quote && codes.includes(fail.quote)) throw Object.assign(new Error("证券代码无效"), { code: "120001" })
      return new Map(codes.filter((c) => prices[c]).map((c) => [c, prices[c]]))
    },
  }
  return { api, searched, quoted }
}

const row = (fundCode: string, serialNumber: number, componentName: string, close: number | null) => ({ fundCode, serialNumber, componentName, close })
const codesOf = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.componentCode)

const AH_MOBILE: Listing[] = [["600941.SH", "中国移动"], ["00941.HK", "中国移动"]]
const MOBILE_PRICES = { "600941.SH": [101.3, 100.7], "00941.HK": [77.3, 78.1] }

describe("fillComponentCodes", () => {
  it("tells the A and H rows of one name apart by price, whichever comes first", async () => {
    for (const order of [[77.3, 101.3], [101.3, 77.3]]) {
      const { api } = lookup({ 中国移动: AH_MOBILE }, MOBILE_PRICES)
      const { rows, unresolved } = await fillComponentCodes(order.map((close, i) => row("517180.SH", i + 1, "中国移动", close)), api)
      expect(codesOf(rows)).toEqual(order.map((close) => (close === 77.3 ? "00941.HK" : "600941.SH")))
      expect(unresolved).toEqual([])
    }
  })

  it("takes the listing the price confirms, and puts componentCode right after serialNumber", async () => {
    const { api } = lookup(
      { 建设银行: [["00939.HK", "建设银行"], ["601939.SH", "建设银行"]], 小米集团: [["01810.HK", "小米集团-W"], ["81810.HK", "小米集团-WR"], ["XC180001.SH", "小米集团-D", "dr"]] },
      { "00939.HK": [9.92, 9.95], "601939.SH": [9.1, 9.2], "01810.HK": [26.9, 27.1], "81810.HK": [24.6, 24.8] },
    )
    const { rows } = await fillComponentCodes([row("159920.SZ", 4, "建设银行", 9.92), row("159920.SZ", 5, "小米集团", 26.9)], api)
    expect(codesOf(rows)).toEqual(["00939.HK", "01810.HK"])
    expect(Object.keys(rows[0])).toEqual(["fundCode", "serialNumber", "componentCode", "componentName", "close"])
  })

  it("searches a padded name without its spaces", async () => {
    const { api, searched } = lookup({ 五粮液: [["000858.SZ", "五粮液"]] }, { "000858.SZ": [75.63, 75.1] })
    const { rows } = await fillComponentCodes([row("510300.SH", 9, "五 粮 液", 75.63)], api)
    expect(searched).toEqual(["五粮液"])
    expect(codesOf(rows)).toEqual(["000858.SZ"])
  })

  it("lets an exact name in the ETF's market stand when no price agrees, and never a prefix guess", async () => {
    // Ex-dividend day: the previous close is adjusted (9.25), the component list keeps 9.55.
    const { api } = lookup(
      {
        上海银行: [["601229.SH", "上海银行"], ["212480009.IB", "24上海银行债01", "bond"]],
        贵州茅台: [["600519.SH", "贵州茅台"]],
        中海油: [["601808.SH", "中海油服"], ["02883.HK", "中海油田服务"]],
      },
      { "601229.SH": [9.25, 9.45], "600519.SH": [1335, 1349.98], "601808.SH": [14.6, 14.7], "02883.HK": [7.5, 7.6] },
    )
    const { rows, unresolved } = await fillComponentCodes([row("510300.SH", 1, "贵州茅台", 1349.98), row("510300.SH", 2, "上海银行", 9.55), row("510300.SH", 3, "中海油", 20.1)], api)
    expect(codesOf(rows)).toEqual(["600519.SH", "601229.SH", null])
    expect(unresolved).toEqual([{ fundCode: "510300.SH", serialNumber: 3, componentName: "中海油" }])
  })

  it("does not let a name match outside the ETF's market stand on the name alone", async () => {
    // A Hong Kong ETF's 中国石化 row is the H share, which the search lists as 中国石油化工股份.
    const { api } = lookup(
      { 中国石化: [["600028.SH", "中国石化"]], 腾讯控股: [["00700.HK", "腾讯控股"]], 汇丰控股: [["00005.HK", "汇丰控股"]] },
      { "600028.SH": [5.56, 5.51], "00700.HK": [386.4, 390], "00005.HK": [120, 121] },
    )
    const { rows } = await fillComponentCodes([row("159920.SZ", 1, "腾讯控股", 386.4), row("159920.SZ", 2, "汇丰控股", 120), row("159920.SZ", 3, "中国石化", 4.64)], api)
    expect(codesOf(rows)).toEqual(["00700.HK", "00005.HK", null])
  })

  it("gives a listing to the row its price confirms before another row of the same name can take it by name", async () => {
    // The H row (中国建筑国际, 8.44) is not found under this name; the A row's price confirms 601668.SH.
    const { api } = lookup({ 中国建筑: [["601668.SH", "中国建筑"]] }, { "601668.SH": [4.58, 4.6] })
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "中国建筑", 8.44), row("517180.SH", 2, "中国建筑", 4.58)], api)
    expect(codesOf(rows)).toEqual([null, "601668.SH"])
  })

  it("matches a longer Hong Kong name by prefix when the price confirms it", async () => {
    const { api } = lookup(
      { 比亚迪: [["002594.SZ", "比亚迪"], ["00285.HK", "比亚迪电子"], ["01211.HK", "比亚迪股份"]], 腾讯控股: [["00700.HK", "腾讯控股"]] },
      { "002594.SZ": [82.4, 82.01], "00285.HK": [22.58, 22.3], "01211.HK": [70.8, 70.05], "00700.HK": [386.4, 390] },
    )
    const { rows } = await fillComponentCodes([row("159920.SZ", 1, "腾讯控股", 386.4), row("159920.SZ", 2, "比亚迪", 70.8)], api)
    expect(codesOf(rows)).toEqual(["00700.HK", "01211.HK"])
  })

  it("asks for a US ticker with its exchange suffix when the search only finds it elsewhere", async () => {
    const { api, searched } = lookup(
      { TRI: [["TRI.LON", "Trifast"]], "TRI.O": [["TRI.O", "汤森路透"], ["ITRI.O", "埃创"]], NVDA: [["NVDA.O", "英伟达"]] },
      { "TRI.O": [122.08, 121], "NVDA.O": [216, 218] },
    )
    const { rows } = await fillComponentCodes([row("513100.SH", 1, "NVDA", 216), row("513100.SH", 2, "TRI", 122.08)], api)
    expect(codesOf(rows)).toEqual(["NVDA.O", "TRI.O"])
    expect(searched.sort()).toEqual(["NVDA", "TRI", "TRI.N", "TRI.O"])
  })

  it("quotes no bond, and takes the bond listed on the ETF's own exchange", async () => {
    // 26国债08 has one listing, which shows the ETF holds Shanghai/Shenzhen/Beijing bonds only.
    const { api, quoted } = lookup({ "26国债15": [["802615.BJ", "26国债15", "bond"], ["019848.SH", "26国债15", "bond"]], "26国债08": [["019834.SH", "26国债08", "bond"]] }, {})
    const { rows } = await fillComponentCodes([row("511010.SH", 1, "26国债15", 100.264), row("511010.SH", 2, "26国债08", 100.746)], api)
    expect(codesOf(rows)).toEqual(["019848.SH", "019834.SH"])
    expect(quoted).toEqual([])
  })

  it("leaves cash lines and names without a match null, and a row that carries a code untouched", async () => {
    const { api, searched } = lookup({ 申赎现金: [], 黄金9999: [] }, {})
    const carried = { fundCode: "510300.SH", serialNumber: 1, componentCode: "600519", componentName: "贵州茅台", close: 1 }
    const { rows, unresolved } = await fillComponentCodes([carried, row("510300.SH", 2, "申赎现金", null), row("518880.SH", 1, "黄金9999", null)], api)
    expect(rows[0]).toBe(carried)
    expect(codesOf(rows)).toEqual(["600519", null, null])
    expect(unresolved.map((u) => u.componentName)).toEqual(["申赎现金", "黄金9999"])
    expect(searched.sort()).toEqual(["申赎现金", "黄金9999"])
  })

  it("isolates a code the quote rejects instead of losing every price in its batch", async () => {
    const { api, quoted } = lookup({ 中国移动: AH_MOBILE, 某某控股: [["00001.HK", "某某控股"]] }, MOBILE_PRICES, { quote: "00001.HK" })
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "某某控股", 5), row("517180.SH", 2, "中国移动", 77.3), row("517180.SH", 3, "中国移动", 101.3)], api)
    // The pair still gets its prices; the rejected code has none, and in an A+H ETF a row its
    // price cannot place stays null.
    expect(codesOf(rows)).toEqual([null, "00941.HK", "600941.SH"])
    expect(quoted.length).toBeGreaterThan(1)
  })

  it("leaves an A/H name null in an ETF holding both markets when no price can decide, but not in a single-market ETF", async () => {
    const search: Record<string, Listing[]> = {
      龙源电力: [["001289.SZ", "龙源电力"], ["00916.HK", "龙源电力"]],
      招商银行: [["600036.SH", "招商银行"], ["03968.HK", "招商银行"]],
      中国石油: [["601857.SH", "中国石油"]],
      华润啤酒: [["00291.HK", "华润啤酒"]],
      贵州茅台: [["600519.SH", "贵州茅台"]],
    }
    const failing: CodeLookup = { ...lookup(search, {}).api, quotes: async () => { throw Object.assign(new Error("服务故障"), { code: "999999" }) } }
    const mixed = await fillComponentCodes([row("517180.SH", 1, "中国石油", 13.38), row("517180.SH", 2, "华润啤酒", 19.48), row("517180.SH", 70, "龙源电力", 5.065)], failing)
    expect(codesOf(mixed.rows)).toEqual([null, null, null])
    const pure = await fillComponentCodes([row("510300.SH", 1, "贵州茅台", 1349.98), row("510300.SH", 5, "招商银行", 42.5)], failing)
    expect(codesOf(pure.rows)).toEqual(["600519.SH", "600036.SH"])
  })

  it("in an ETF holding both markets, leaves a row null when its price decides nothing, quoted or not", async () => {
    // 中国移动 is the A row: suspended (quote 0) or ex-dividend (quote off the list), and the H
    // quote is missing. Neither says which listing the row is; the unquoted H share must not win.
    const search: Record<string, Listing[]> = { 中国移动: AH_MOBILE, 中国石油: [["601857.SH", "中国石油"]], 华润啤酒: [["00291.HK", "华润啤酒"]] }
    for (const mobileA of [[0, 0], [99.9, 100.7]]) {
      const { api } = lookup(search, { "600941.SH": mobileA, "601857.SH": [13.38, 13.2], "00291.HK": [19.48, 19.6] })
      const { rows, unresolved } = await fillComponentCodes([row("517180.SH", 1, "中国石油", 13.38), row("517180.SH", 2, "华润啤酒", 19.48), row("517180.SH", 3, "中国移动", 101.3)], api)
      expect(codesOf(rows), JSON.stringify(mobileA)).toEqual(["601857.SH", "00291.HK", null])
      expect(unresolved.map((u) => u.componentName)).toEqual(["中国移动"])
    }
  })

  it("does not take a listing in a market the ETF's prices never confirmed on the name alone", async () => {
    // The search found only London's TRI (Trifast); the Nasdaq ETF's other rows are US.
    const { api } = lookup({ NVDA: [["NVDA.O", "英伟达"]], TRI: [["TRI.LON", "Trifast"]] }, { "NVDA.O": [216, 218] })
    const { rows } = await fillComponentCodes([row("513100.SH", 1, "NVDA", 216), row("513100.SH", 2, "TRI", 122.08)], api)
    expect(codesOf(rows)).toEqual(["NVDA.O", null])
  })

  it("counts a price only when it is the row's own: an A share 0.4% off an H row's close confirms nothing", async () => {
    // The H quote is missing; 紫金矿业's A share (27.85) is close to the H row (27.74) by chance.
    // Not confirmed by it, the row falls to the name, which in a Hong Kong ETF is the H share.
    const { api } = lookup({ 紫金矿业: [["02899.HK", "紫金矿业"], ["601899.SH", "紫金矿业"]], 腾讯控股: [["00700.HK", "腾讯控股"]] }, { "00700.HK": [386.4, 390], "601899.SH": [27.47, 27.85] })
    const { rows } = await fillComponentCodes([row("159920.SZ", 1, "腾讯控股", 386.4), row("159920.SZ", 2, "紫金矿业", 27.74)], api)
    expect(codesOf(rows)).toEqual(["00700.HK", "02899.HK"])
  })

  it("splits a failed quote batch only on 120001, one half at a time, and sends any other failure once", async () => {
    const names = Array.from({ length: 16 }, (_, i) => `名称${i}`)
    const search = Object.fromEntries(names.map((n, i) => [n, [[`${600000 + i}.SH`, n]] as Listing[]]))
    const rows16 = names.map((n, i) => row("510300.SH", i, n, 1))
    for (const [code, expectCalls] of [["999999", 1], ["429", 1]] as const) {
      let calls = 0
      const api: CodeLookup = { ...lookup(search, {}).api, quotes: async () => { calls++; throw Object.assign(new Error("x"), { code }) } }
      await fillComponentCodes(rows16, api)
      expect(calls, code).toBe(expectCalls)
    }
    let inflight = 0
    let peak = 0
    const splitting: CodeLookup = {
      ...lookup(search, {}).api,
      async quotes(codes) {
        inflight++
        peak = Math.max(peak, inflight)
        await new Promise((resolve) => setTimeout(resolve, 2))
        inflight--
        if (codes.includes("600003.SH")) throw Object.assign(new Error("证券代码无效"), { code: "120001" })
        return new Map(codes.map((c) => [c, [1]]))
      },
    }
    const { rows } = await fillComponentCodes(rows16, splitting)
    expect(peak).toBe(1)
    expect(codesOf(rows).filter(Boolean)).toHaveLength(16)
  })

  it("fills a row the API answered with componentCode null or empty, once, right after serialNumber", async () => {
    const { api } = lookup({ 贵州茅台: [["600519.SH", "贵州茅台"]] }, { "600519.SH": [1335, 1349.98] })
    for (const given of [null, ""]) {
      const { rows, unresolved } = await fillComponentCodes([{ fundCode: "510300.SH", serialNumber: 1, componentCode: given, componentName: "贵州茅台", close: 1349.98 }], api)
      expect(rows[0]).toEqual({ fundCode: "510300.SH", serialNumber: 1, componentCode: "600519.SH", componentName: "贵州茅台", close: 1349.98 })
      expect(Object.keys(rows[0])).toEqual(["fundCode", "serialNumber", "componentCode", "componentName", "close"])
      expect(unresolved).toEqual([])
    }
  })

  it("checks a list whose prices lag the quote against the closes of the day they belong to", async () => {
    // 517180.SH's 10-28 list carried 10-26 closes for its A shares (its H shares were current);
    // the quote has moved on to 10-27.
    // 中国铁建's A share has not traded since 10-23 (suspended): its last close stands for 10-26.
    const search: Record<string, Listing[]> = { 中国移动: AH_MOBILE, 中国石油: [["601857.SH", "中国石油"]], 中国神华: [["601088.SH", "中国神华"]], 华润啤酒: [["00291.HK", "华润啤酒"]], 中国铁建: [["601186.SH", "中国铁建"], ["01186.HK", "中国铁建"]] }
    const history = new Map<string, Array<[string, number]>>([
      ["601186.SH", [["2026-10-23", 6.11]]],
      ["01186.HK", [["2026-10-26", 4.5], ["2026-10-27", 4.6]]],
      ["600941.SH", [["2026-10-23", 99.14], ["2026-10-26", 101.3], ["2026-10-27", 100.7]]],
      ["00941.HK", [["2026-10-23", 77.1], ["2026-10-26", 77.3], ["2026-10-27", 78.1]]],
      ["601857.SH", [["2026-10-23", 12.75], ["2026-10-26", 13.38], ["2026-10-27", 13.2]]],
      ["601088.SH", [["2026-10-23", 38.1], ["2026-10-26", 38.6], ["2026-10-27", 38.4]]],
      ["00291.HK", [["2026-10-26", 19.3], ["2026-10-27", 19.48]]],
    ])
    const asked: string[][] = []
    const base = lookup(search, { "600941.SH": [100.7, 100.7], "00941.HK": [78.1, 78.1], "601857.SH": [13.2, 13.2], "601088.SH": [38.4, 38.4], "00291.HK": [19.48, 19.48] }).api
    const api: CodeLookup = { ...base, async closes(codes) { asked.push(codes); return new Map(codes.filter((c) => history.has(c)).map((c) => [c, history.get(c)!])) } }
    const rows = [row("517180.SH", 1, "中国石油", 13.38), row("517180.SH", 2, "中国神华", 38.6), row("517180.SH", 3, "中国移动", 101.3), row("517180.SH", 4, "中国移动", 78.1), row("517180.SH", 5, "华润啤酒", 19.48), row("517180.SH", 6, "中国铁建", 6.11)]
    const { rows: out } = await fillComponentCodes(rows, api)
    expect(codesOf(out)).toEqual(["601857.SH", "601088.SH", "600941.SH", "00941.HK", "00291.HK", "601186.SH"])
    expect(asked).toHaveLength(1)
    // Without the daily closes the lagging rows are left to the name: an A+H ETF places none.
    const { rows: unaided } = await fillComponentCodes(rows, base)
    expect(codesOf(unaided)).toEqual([null, null, null, "00941.HK", "00291.HK", null])
  })

  // An A+H ETF (华润啤酒 is Hong Kong only and current) whose A rows lag; the quote is no help.
  const lagging = (history: Array<[string, Array<[string, number]>]>, extra: Record<string, Listing[]> = {}) => {
    const search: Record<string, Listing[]> = { 中国移动: AH_MOBILE, 中国石油: [["601857.SH", "中国石油"]], 中国神华: [["601088.SH", "中国神华"]], 华润啤酒: [["00291.HK", "华润啤酒"]], ...extra }
    const series = new Map(history)
    return { ...lookup(search, { "00291.HK": [19.48, 19.48] }).api, async closes(codes: string[]) { return new Map(codes.filter((c) => series.has(c)).map((c) => [c, series.get(c)!])) } } as CodeLookup
  }
  const MOBILE_A = row("517180.SH", 3, "中国移动", 101.3)
  const BEER = row("517180.SH", 2, "华润啤酒", 19.48)

  it("does not settle a list's date on a single row", async () => {
    // Only 中国石油 has a single listing with daily closes: one row says 10-26, nothing else votes.
    const api = lagging([["600941.SH", [["2026-10-26", 101.3]]], ["00941.HK", [["2026-10-26", 77.3]]], ["601857.SH", [["2026-10-26", 13.38]]]])
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "中国石油", 13.38), BEER, MOBILE_A], api)
    expect(codesOf(rows)).toEqual([null, "00291.HK", null])
  })

  it("does not settle a market's date on a tie between two days", async () => {
    // 中国石油 and 中国神华 say the A shares are 10-26; 贵州茅台 and 五粮液 say 10-27.
    const api = lagging([
      ["600941.SH", [["2026-10-26", 101.3]]], ["00941.HK", [["2026-10-26", 77.3]]],
      ["601857.SH", [["2026-10-26", 13.38]]], ["601088.SH", [["2026-10-26", 38.6]]],
      ["600519.SH", [["2026-10-27", 1349.98]]], ["000858.SZ", [["2026-10-27", 75.63]]],
    ], { 贵州茅台: [["600519.SH", "贵州茅台"]], 五粮液: [["000858.SZ", "五粮液"]] })
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "中国石油", 13.38), row("517180.SH", 4, "中国神华", 38.6), row("517180.SH", 5, "贵州茅台", 1349.98), row("517180.SH", 6, "五粮液", 75.63), BEER, MOBILE_A], api)
    expect(codesOf(rows)).toEqual([null, null, null, null, "00291.HK", null])
  })

  it("matches the lagging rows against that one day's closes, not any day's", async () => {
    // On 10-23 the H share closed at 101.3 HKD — the A row's 10-26 price, by chance. The H
    // shares' day is 10-27.
    const api = lagging([
      ["600941.SH", [["2026-10-23", 99.14], ["2026-10-26", 101.3]]], ["00941.HK", [["2026-10-23", 101.3], ["2026-10-26", 77.3]]],
      ["601857.SH", [["2026-10-26", 13.38]]], ["601088.SH", [["2026-10-26", 38.6]]],
      ["00291.HK", [["2026-10-27", 19.48]]], ["00700.HK", [["2026-10-27", 385.2]]],
    ], { 腾讯控股: [["00700.HK", "腾讯控股"]] })
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "中国石油", 13.38), row("517180.SH", 4, "中国神华", 38.6), BEER, row("517180.SH", 5, "腾讯控股", 385.2), MOBILE_A], api)
    expect(codesOf(rows)).toEqual(["601857.SH", "601088.SH", "00291.HK", "00700.HK", "600941.SH"])
  })

  // An A+H list whose A rows carry 10-20 closes and whose H rows 10-22's; the quote is no help.
  // 恒瑞医药's H row (47.44 HKD on 10-22) is within 0.05% of the A share's 10-20 close (47.45).
  const SPLIT_DATES = new Map<string, Array<[string, number]>>([
    ["601857.SH", [["2026-10-20", 13.38], ["2026-10-22", 13.0]]], ["601088.SH", [["2026-10-20", 38.6], ["2026-10-22", 38.0]]],
    ["600519.SH", [["2026-10-20", 1400], ["2026-10-22", 1420]]], ["600941.SH", [["2026-10-20", 101.3], ["2026-10-22", 100.2]]],
    ["00941.HK", [["2026-10-20", 77.0], ["2026-10-22", 77.3]]], ["00291.HK", [["2026-10-20", 19.0], ["2026-10-22", 19.48]]],
    ["00700.HK", [["2026-10-20", 380], ["2026-10-22", 385.2]]], ["00005.HK", [["2026-10-20", 118], ["2026-10-22", 120]]],
    ["600276.SH", [["2026-10-20", 47.45], ["2026-10-22", 48.3]]], ["01276.HK", [["2026-10-20", 46.1], ["2026-10-22", 47.44]]],
    ["001289.SZ", [["2026-10-20", 5.065], ["2026-10-22", 5.1]]],
  ])
  const splitDates = () => {
    const search: Record<string, Listing[]> = {
      中国石油: [["601857.SH", "中国石油"]], 中国神华: [["601088.SH", "中国神华"]], 贵州茅台: [["600519.SH", "贵州茅台"]], 中国移动: AH_MOBILE,
      华润啤酒: [["00291.HK", "华润啤酒"]], 腾讯控股: [["00700.HK", "腾讯控股"]], 汇丰控股: [["00005.HK", "汇丰控股"]], 恒瑞医药: [["600276.SH", "恒瑞医药"], ["01276.HK", "恒瑞医药"]],
      龙源电力: [["001289.SZ", "龙源电力"], ["00916.HK", "龙源电力"]],
    }
    return { ...lookup(search, {}).api, async closes(codes: string[]) { return new Map(codes.filter((c) => SPLIT_DATES.has(c)).map((c) => [c, SPLIT_DATES.get(c)!])) } } as CodeLookup
  }
  const etf517 = (...rows: Array<[string, number]>) => rows.map(([name, close], i) => row("517180.SH", i + 1, name, close))

  it("dates each market's prices on their own, so the market with fewer rows is not checked against the other's day", async () => {
    const { rows } = await fillComponentCodes(etf517(["中国石油", 13.38], ["中国神华", 38.6], ["华润啤酒", 19.48], ["腾讯控股", 385.2], ["汇丰控股", 120], ["中国移动", 101.3]), splitDates())
    expect(codesOf(rows)).toEqual(["601857.SH", "601088.SH", "00291.HK", "00700.HK", "00005.HK", "600941.SH"])
  })

  it("leaves a row null when a listing it could be trades in a market whose day is unknown, or agrees as well", async () => {
    // Two H rows date the H shares to 10-22: both of 恒瑞医药's listings agree with the H row.
    const dated = await fillComponentCodes(etf517(["中国石油", 13.38], ["中国神华", 38.6], ["贵州茅台", 1400], ["华润啤酒", 19.48], ["腾讯控股", 385.2], ["恒瑞医药", 47.44]), splitDates())
    expect(codesOf(dated.rows)).toEqual(["601857.SH", "601088.SH", "600519.SH", "00291.HK", "00700.HK", null])
    // One H row dates nothing: the H share can be neither confirmed nor ruled out — by an
    // agreeing close (恒瑞医药), or by none at all (龙源电力's H share has no daily closes).
    const undated = await fillComponentCodes(etf517(["中国石油", 13.38], ["中国神华", 38.6], ["贵州茅台", 1400], ["华润啤酒", 19.48], ["恒瑞医药", 47.44], ["龙源电力", 5.065]), splitDates())
    expect(codesOf(undated.rows)).toEqual(["601857.SH", "601088.SH", "600519.SH", null, null, null])
  })

  it("leaves a row null when a listing it could be has no close on its market's day", async () => {
    // Both markets are dated; 恒瑞医药's H share alone has no daily closes, and its A share's
    // 10-20 close agrees with the H row.
    const api = splitDates()
    const { rows } = await fillComponentCodes(etf517(["中国石油", 13.38], ["中国神华", 38.6], ["贵州茅台", 1400], ["华润啤酒", 19.48], ["腾讯控股", 385.2], ["恒瑞医药", 47.44]), {
      ...api,
      async closes(codes) { return new Map([...await api.closes!(codes, "", "")].filter(([code]) => code !== "01276.HK")) },
    })
    expect(codesOf(rows)).toEqual(["601857.SH", "601088.SH", "600519.SH", "00291.HK", "00700.HK", null])
  })

  it("does not take a quoted listing when another the row could be has no quote, or quotes 0", async () => {
    // 恒瑞医药's H row; the A share's latest price happens to agree with it.
    const search: Record<string, Listing[]> = { 中国石油: [["601857.SH", "中国石油"]], 华润啤酒: [["00291.HK", "华润啤酒"]], 恒瑞医药: [["600276.SH", "恒瑞医药"], ["01276.HK", "恒瑞医药"]] }
    for (const quoteH of [undefined, [0, 0]]) {
      const prices: Record<string, number[]> = { "601857.SH": [13.38, 13.2], "00291.HK": [19.48, 19.6], "600276.SH": [47.1, 47.45], ...(quoteH ? { "01276.HK": quoteH } : {}) }
      const { rows } = await fillComponentCodes(etf517(["中国石油", 13.38], ["华润啤酒", 19.48], ["恒瑞医药", 47.44]), lookup(search, prices).api)
      expect(codesOf(rows), JSON.stringify(quoteH)).toEqual(["601857.SH", "00291.HK", null])
    }
  })

  it("lets an exact listing its price confirms stand beside a longer name without a price", async () => {
    // 中国石油股份 (the H share's name) starts with the A row's name and quotes 0 (suspended):
    // a prefix match would lose to the exact one anyway.
    const search: Record<string, Listing[]> = { 中国石油: [["601857.SH", "中国石油"], ["00857.HK", "中国石油股份"]], 华润啤酒: [["00291.HK", "华润啤酒"]] }
    const { api } = lookup(search, { "601857.SH": [13.38, 13.2], "00857.HK": [0, 0], "00291.HK": [19.48, 19.6] })
    const { rows } = await fillComponentCodes(etf517(["中国石油", 13.38], ["华润啤酒", 19.48]), api)
    expect(codesOf(rows)).toEqual(["601857.SH", "00291.HK"])
  })

  it("does not hold a row back for a listing another row's price has taken", async () => {
    // The H row of 中国移动 is current and takes 00941.HK (the A share quotes on, off its lagging
    // row); the H shares have no day of their own, and 00941.HK's 10-20 close happens to equal
    // the A row's price.
    const api = splitDates()
    const now: Record<string, number[]> = { "00941.HK": [78.1, 78.1], "600941.SH": [100.7, 100.9] }
    const quoted: CodeLookup = { ...api, quotes: async (codes) => new Map(codes.filter((c) => now[c]).map((c) => [c, now[c]])) }
    const history = new Map([...SPLIT_DATES, ["00941.HK", [["2026-10-20", 101.3], ["2026-10-22", 77.3]] as Array<[string, number]>]])
    const { rows } = await fillComponentCodes(etf517(["中国石油", 13.38], ["中国神华", 38.6], ["中国移动", 78.1], ["中国移动", 101.3]), { ...quoted, async closes(codes) { return new Map(codes.filter((c) => history.has(c)).map((c) => [c, history.get(c)!])) } })
    expect(codesOf(rows)).toEqual(["601857.SH", "601088.SH", "00941.HK", "600941.SH"])
  })

  it("takes a name whose exact listings all trade in one market as a sign of that market", async () => {
    // 腾讯控股 has two Hong Kong listings (the HKD and the RMB counter): the ETF holds Hong Kong
    // stocks too, so with no price to decide, the 中国移动 row is not taken for the A share.
    const search: Record<string, Listing[]> = { 贵州茅台: [["600519.SH", "贵州茅台"]], 腾讯控股: [["00700.HK", "腾讯控股"], ["80700.HK", "腾讯控股-R"]], 中国移动: AH_MOBILE }
    const failing: CodeLookup = { ...lookup(search, {}).api, quotes: async () => { throw Object.assign(new Error("服务故障"), { code: "999999" }) } }
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "贵州茅台", 1349.98), row("517180.SH", 2, "腾讯控股", 386.4), row("517180.SH", 3, "中国移动", 78.1)], failing)
    expect(codesOf(rows)).toEqual([null, null, null])
  })

  it("leaves only the name whose search failed null", async () => {
    const { api } = lookup({ 中国移动: AH_MOBILE }, MOBILE_PRICES, { search: "腾讯控股" })
    const { rows } = await fillComponentCodes([row("517180.SH", 1, "腾讯控股", 386.4), row("517180.SH", 2, "中国移动", 101.3)], api)
    expect(codesOf(rows)).toEqual([null, "600941.SH"])
  })
})

// The three whole-market lists (全部A股 / 全部港股 / 全部美股), a few rows each.
const SECTORS: Record<string, Array<{ gtsCode: string; gtsName: string }>> = {
  "1000000002": [{ gtsCode: "600941.SH", gtsName: "中国移动" }, { gtsCode: "002594.SZ", gtsName: "比亚迪" }, { gtsCode: "000858.SZ", gtsName: "五粮液" }],
  "1000002615": [{ gtsCode: "00941.HK", gtsName: "中国移动" }, { gtsCode: "01211.HK", gtsName: "比亚迪股份" }, { gtsCode: "00285.HK", gtsName: "比亚迪电子" }, { gtsCode: "01810.HK", gtsName: "小米集团-W" }, { gtsCode: "81810.HK", gtsName: "小米集团-WR" }],
  "1000002618": [{ gtsCode: "TRI.O", gtsName: "Thomson Reuters" }, { gtsCode: "BESS.A", gtsName: "Bimergen Energy" }],
}

describe("securities table", () => {
  const fetchedFrom = (sectors: Record<string, unknown>) => {
    const asked: string[] = []
    return { asked, fetch: async (id: string) => { asked.push(id); return sectors[id] instanceof Error ? Promise.reject(sectors[id]) : { total: 0, list: sectors[id] } } }
  }

  it("is the three markets' listings together", async () => {
    const fetched = fetchedFrom(SECTORS)
    expect(await loadSecurityTable(fetched.fetch)).toHaveLength(10)
    expect(fetched.asked.sort()).toEqual(["1000000002", "1000002615", "1000002618"])
  })

  it("is not used when a market fails or lists nothing, so the lookup searches instead", async () => {
    for (const broken of [new Error("120001"), []]) {
      expect(await loadSecurityTable(fetchedFrom({ ...SECTORS, "1000002615": broken }).fetch)).toBeUndefined()
    }
  })

  it("finds a name exactly (share-class suffixes and spaces aside), by ticker or by code, with the names that start with it", () => {
    const search = tableSearch(Object.values(SECTORS).flat().map((r) => [r.gtsCode, r.gtsName] as [string, string]))
    const codes = (keyword: string) => search(keyword)?.map((r) => (r as { gtsCode: string }).gtsCode)
    expect(codes("中国移动")).toEqual(["600941.SH", "00941.HK"])
    expect(codes("比亚迪")).toEqual(["002594.SZ", "01211.HK", "00285.HK"])
    expect(codes("小米集团")).toEqual(["01810.HK", "81810.HK"])
    expect(codes("五 粮 液")).toEqual(["000858.SZ"])
    expect(codes("TRI")).toEqual(["TRI.O"])
    expect(codes("TRI.O")).toEqual(["TRI.O"])
    // Nothing carries these exactly: a truncated name, a bond, a cash line — left to the search.
    for (const keyword of ["比亚迪电", "26国债15", "申赎现金"]) expect(search(keyword)).toBeUndefined()
  })

  it("reads the daily closes of a day-kline answer, oldest first, per code", async () => {
    const calls: Array<[string, unknown]> = []
    const client = {
      async call(endpoint: string, body: unknown) {
        calls.push([endpoint, body])
        return { total: 3, fieldList: ["securityCode", "tradeDate", "close"], list: [["00941.HK", "2026-10-27", 78.1], ["00941.HK", "2026-10-26", 77.3], ["600941.SH", "2026-10-26", 101.3]] }
      },
    }
    const closes = await clientLookup(client).closes!(["00941.HK", "600941.SH"], "2026-10-18", "2026-10-28")
    expect([...closes]).toEqual([["00941.HK", [["2026-10-26", 77.3], ["2026-10-27", 78.1]]], ["600941.SH", [["2026-10-26", 101.3]]]])
    expect(calls).toEqual([["quote.day-kline", { securityList: ["00941.HK", "600941.SH"], startDate: "2026-10-18", endDate: "2026-10-28", fieldList: ["securityCode", "tradeDate", "close"], limit: 10_000 }]])
  })

  it("is fetched once per lookup, and only the names it does not carry are searched", async () => {
    const calls: Array<[string, unknown]> = []
    const client = {
      async call(endpoint: string, body: unknown) {
        calls.push([endpoint, body])
        if (endpoint === "reference.sector-constituents") return { list: SECTORS[(body as { sectorId: string }).sectorId] }
        if (endpoint === "reference.securities-search") return { list: [{ gtsCode: "00285.HK", gtsName: "比亚迪电子", category: "stock" }] }
        throw new Error(`unexpected ${endpoint}`)
      },
    }
    const lookup = clientLookup(client)
    const found = await Promise.all(["中国移动", "小米集团", "比亚迪电"].map((k) => lookup.search(k)))
    expect(found.map((rows) => rows.length)).toEqual([2, 2, 1])
    expect(calls.filter(([e]) => e === "reference.sector-constituents")).toHaveLength(3)
    expect(calls.filter(([e]) => e === "reference.securities-search")).toEqual([["reference.securities-search", { keyword: "比亚迪电", top: 10 }]])
  })
})
