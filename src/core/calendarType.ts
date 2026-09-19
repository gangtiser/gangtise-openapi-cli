import type { GangtiseClient } from "./client.js"
import { unwrapIndicatorData } from "./indicatorMatrix.js"
import { runWithConcurrency } from "./transport.js"

/** Date parameter keys that decide which calendar a time series should use.
 * `tradeDate` is the only one that makes a trading-day axis correct; the other two
 * mark an indicator whose values land on dates the trading calendar may not contain. */
const TRADE_DATE_KEY = "tradeDate"
const PERIOD_DATE_KEYS = ["reportDate", "fiscalYear"]

/** How many `indicator search` probes run at once. They are free and read-only, and
 * a time series takes at most a handful of indicators, so this only bounds the burst. */
const PROBE_CONCURRENCY = 5

/** Decides the `calendarType` for a time-series request when the caller did not pass one.
 *
 * The server's own default is `ND` (natural days), and that default is deliberately the
 * SAFE one: report-period indicators carry values on dates like 2024-03-31 and 2024-06-30,
 * both Sundays, which a trading-day axis simply does not contain. Asking for `TD` there
 * does not lose a column — it loses the only columns that had values, and the request
 * still returns 200 with a full grid of `null` (probed 2026-09-19: `is_op_rev` over
 * 2024-03-25..2024-07-05 gives 72 all-null columns under `TD`, and 457.76亿 / 819.31亿 on
 * those two dates under `ND`). A caller reads that as "this company has no revenue data".
 *
 * `ND` costs something though, and on a pure quote series it is pure waste: over a year
 * `ND` returns 366 columns where `TD` returns 248 (probed 2026-09-19 on `qte_close`), so
 * ~a third of the cells are weekend `null`s — cells that count against both the bill and
 * the 30000-cell ceiling.
 *
 * So: ask for `TD` only when EVERY indicator is provably trading-day typed, and treat
 * anything else — a report-period key, an empty `parameterList`, a code the search cannot
 * resolve, a failed probe — as a reason to stay on the server default. The asymmetry is
 * the whole point: guessing `ND` wrong only wastes cells, guessing `TD` wrong silently
 * empties the result.
 *
 * ⚠️ This is NOT the "auto-send reportDate" idea that was considered and declined
 * (`bug/cli-backlog.md` K9). That one rewrites a request PARAMETER, so getting it wrong
 * fetches the wrong numbers. This one picks a date AXIS, and getting it wrong falls back
 * to exactly what the server would have done anyway.
 *
 * @returns `"TD"` when every indicator is trading-day typed, otherwise `undefined`
 *   (send nothing and let the server apply `ND`).
 */
export async function resolveCalendarType(client: GangtiseClient, indicators: string[]): Promise<"TD" | undefined> {
  const codes = [...new Set(indicators.filter((code) => typeof code === "string" && code.length > 0))]
  if (codes.length === 0) return undefined

  const verdicts = await runWithConcurrency(codes, PROBE_CONCURRENCY, (code) => isTradingDayTyped(client, code))
  return verdicts.every((verdict) => verdict === true) ? "TD" : undefined
}

/** One indicator's verdict. `false` covers every form of "not proven", including a probe
 * that threw — a search outage must not change what a time-series request asks for. */
async function isTradingDayTyped(client: GangtiseClient, code: string): Promise<boolean> {
  let entry: Record<string, unknown> | undefined
  try {
    entry = await findIndicator(client, code)
  } catch {
    return false
  }
  if (!entry) return false

  const keys = paramKeys(entry.parameterList)
  // An empty parameterList is not evidence of anything — the static-attribute families
  // (pty_* / scr_*) report one, and so does cdr_conv_ratio, which takes a date anyway.
  if (keys.length === 0) return false
  if (keys.some((key) => PERIOD_DATE_KEYS.includes(key))) return false
  return keys.includes(TRADE_DATE_KEY)
}

/** `indicator search` matches on a keyword, so the code itself is the query and the
 * answer has to be picked out of the hits by exact code — a keyword search returns
 * near-matches too (probed 2026-09-19: `qte_close` comes back among 5 results). */
async function findIndicator(client: GangtiseClient, code: string): Promise<Record<string, unknown> | undefined> {
  const raw = await client.call("indicator.search", { keyword: code, limit: 100 })
  const data = unwrapIndicatorData(raw)
  const list = Array.isArray(data) ? data : (data as { list?: unknown })?.list
  if (!Array.isArray(list)) return undefined
  return list.find((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" && (item as Record<string, unknown>).indicatorCode === code)
}

function paramKeys(parameterList: unknown): string[] {
  if (!Array.isArray(parameterList)) return []
  return parameterList
    .map((param) => (param && typeof param === "object" ? (param as Record<string, unknown>).paramKey : undefined))
    .filter((key): key is string => typeof key === "string")
}
