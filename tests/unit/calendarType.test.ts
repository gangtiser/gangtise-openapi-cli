import { describe, expect, it, vi } from "vitest"

import { resolveCalendarType } from "../../src/core/calendarType.js"
import type { GangtiseClient } from "../../src/core/client.js"

/** parameterList shapes below are the real ones, probed 2026-09-19 via
 * `indicator search --keyword <code>`. The two that decide the guard are
 * `div_cash_yld` (declares BOTH reportDate and tradeDate) and the empty-list
 * families — both must land on ND, and both would be missed by a naive
 * "does it mention tradeDate" check. */
const CATALOG: Record<string, string[]> = {
  qte_close: ["tradeDate", "adjustType", "baseDate", "currency"],
  qte_vol: ["tradeDate"],
  finc_pe_ttm: ["tradeDate"],
  is_op_rev: ["reportDate", "reportType", "currency", "scale"],
  div_cash_yld: ["reportDate", "tradeDate"],
  div_cash_yr: ["fiscalYear"],
  cdr_conv_ratio: [],
  pty_op_scope: [],
}

function stubClient(overrides: { fail?: string[]; unknown?: string[] } = {}): { client: GangtiseClient; calls: string[] } {
  const calls: string[] = []
  const call = vi.fn(async (_key: string, body: unknown) => {
    const keyword = (body as { keyword: string }).keyword
    calls.push(keyword)
    if (overrides.fail?.includes(keyword)) throw new Error("search unavailable")
    if (overrides.unknown?.includes(keyword)) return []
    // client.call already unwraps the envelope for this endpoint, so the resolver sees
    // a bare array (verified against the live endpoint 2026-09-19). The server answers a
    // code keyword with near-matches too, so the resolver has to pick its entry out by
    // exact indicatorCode rather than taking [0] — hence the decoy first.
    return [
      { indicatorCode: `${keyword}_wk`, parameterList: [{ paramKey: "reportDate" }] },
      ...(CATALOG[keyword] ? [{ indicatorCode: keyword, parameterList: CATALOG[keyword].map((paramKey) => ({ paramKey })) }] : []),
    ]
  })
  return { client: { call } as unknown as GangtiseClient, calls }
}

describe("resolveCalendarType", () => {
  it("asks for TD when every indicator is trading-day typed", async () => {
    const { client } = stubClient()
    await expect(resolveCalendarType(client, ["qte_close", "qte_vol", "finc_pe_ttm"])).resolves.toBe("TD")
  })

  it("stays on the server default as soon as one indicator takes a report period", async () => {
    // The failure this prevents is not a missing column: TD returns a full grid of
    // null for is_op_rev and still exits 0, which reads as "no revenue data".
    const { client } = stubClient()
    await expect(resolveCalendarType(client, ["qte_close", "is_op_rev"])).resolves.toBeUndefined()
  })

  it("stays on ND for an indicator that declares BOTH date keys", async () => {
    // div_cash_yld requires reportDate AND tradeDate. A check that merely looked for
    // tradeDate would pick TD here and lose every value.
    const { client } = stubClient()
    await expect(resolveCalendarType(client, ["div_cash_yld"])).resolves.toBeUndefined()
    await expect(resolveCalendarType(client, ["qte_close", "div_cash_yld"])).resolves.toBeUndefined()
  })

  it("stays on ND for fiscalYear indicators and for an empty parameterList", async () => {
    const { client } = stubClient()
    await expect(resolveCalendarType(client, ["div_cash_yr"])).resolves.toBeUndefined()
    await expect(resolveCalendarType(client, ["cdr_conv_ratio"])).resolves.toBeUndefined()
    await expect(resolveCalendarType(client, ["pty_op_scope"])).resolves.toBeUndefined()
  })

  it("stays on ND when a probe throws — a search outage must not change the axis", async () => {
    const { client } = stubClient({ fail: ["qte_vol"] })
    await expect(resolveCalendarType(client, ["qte_close", "qte_vol"])).resolves.toBeUndefined()
  })

  it("stays on ND when the search cannot resolve the code", async () => {
    const { client } = stubClient({ unknown: ["qte_close"] })
    await expect(resolveCalendarType(client, ["qte_close"])).resolves.toBeUndefined()
  })

  it("probes each distinct code once and not at all for an empty list", async () => {
    const { client, calls } = stubClient()
    await resolveCalendarType(client, ["qte_close", "qte_close", "qte_vol"])
    expect(calls).toEqual(["qte_close", "qte_vol"])

    const empty = stubClient()
    await expect(resolveCalendarType(empty.client, [])).resolves.toBeUndefined()
    expect(empty.calls).toEqual([])
  })
})
