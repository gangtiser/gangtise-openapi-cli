import type { IndicatorParamGroup } from "./args.js"
import { maybeArray, parseFrom, parseIndicatorParams, parseOptionalNumberOption, parseScreenerIndicators, parseSize } from "./args.js"
import { ValidationError } from "./errors.js"

interface QuoteKlineOptions {
  security: string[]
  startDate?: string
  endDate?: string
  limit?: string | number
  field: string[]
}

interface WechatMessageListOptions {
  from?: string | number
  size?: string | number
  startTime?: string
  endTime?: string
  keyword?: string
  security: string[]
  wechatGroupId: string[]
  industry: string[]
  category: string[]
  tag: string[]
}

interface WechatChatroomListOptions {
  from?: string | number
  size?: string | number
  roomName: string[]
}

interface StockPoolStocksOptions {
  poolId?: string[]
}

interface IndicatorCrossSectionOptions {
  indicator: string[]
  security: string[]
  date: string
  currency?: string
  scale?: string
  indicatorParam: string[]
}

interface IndicatorTimeSeriesOptions {
  indicator: string[]
  security: string[]
  startDate: string
  endDate: string
  calendarType?: string
  currency?: string
  scale?: string
  indicatorParam: string[]
}

interface IndicatorScreenerOptions {
  indicator: string[]
  security: string[]
  expression: string
  date: string
  indicatorParam: string[]
}

export function buildQuoteKlineBody(options: QuoteKlineOptions) {
  return {
    securityList: maybeArray(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1, max: 10000 }),
    fieldList: maybeArray(options.field),
  }
}

export function buildWechatMessageListBody(options: WechatMessageListOptions) {
  return {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    startTime: options.startTime,
    endTime: options.endTime,
    keyword: options.keyword,
    securityList: maybeArray(options.security),
    wechatGroupIdList: maybeArray(options.wechatGroupId),
    industryIdList: maybeArray(options.industry),
    categoryList: maybeArray(options.category),
    tagList: maybeArray(options.tag),
  }
}

export function buildWechatChatroomListBody(options: WechatChatroomListOptions) {
  return {
    from: parseFrom(options.from),
    size: parseSize(options.size),
    roomName: options.roomName.length > 0 ? options.roomName.join(",") : undefined,
  }
}

export function buildStockPoolStocksBody(options: StockPoolStocksOptions) {
  return {
    poolIdList: options.poolId?.length ? options.poolId : ["all"],
  }
}

/** Parameter keys that REPLACE an indicator's `tradeDate`. The 2026-08-01 EDE
 * revision dropped the root-level `date`, so `--date` now fans out into each
 * indicator's `tradeDate`. A caller-supplied `reportDate` suppresses that
 * injection for its indicator, so the two date fields are never sent together.
 *
 * This is load-bearing, and the server has moved twice on it. A report-period
 * indicator answered a `tradeDate` with an EMPTY result (probed 2026-08-01 on
 * `is_op_rev_mom`), then resolved it to the enclosing report period (2026-08-08,
 * same 33.4903 either way), and since 2026-08-14 REJECTS it outright:
 * `100003 指标 is_op_rev_mom 不支持参数 tradeDate; 缺少必填参数 reportDate`
 * (re-probed 2026-08-15; `reportDate` still returns 33.4903). So a caller-supplied
 * `reportDate` is now the only way to reach those indicators, and suppressing the
 * `tradeDate` injection is what makes it work rather than merely being tidier.
 * ⚠️ Injecting into an indicator that takes no date at all used to be harmless
 * (`pty_op_scope` answered normally with a stray `tradeDate` through 2026-08-03).
 * The 2026-08-14 tightening ended that.
 *
 * 🔴 THE RULE (one-way, NOT iff): `parameterList` contains `tradeDate` → injecting
 * is safe. It does not → the request is very likely refused. Known exception:
 * `cdr_conv_ratio` declares `[]` yet ACCEPTS the injected `tradeDate` (200, null
 * value) — so an empty parameterList does not guarantee refusal. `reportDate` does
 * not enter into it either way; do NOT write the rule as "has no
 * tradeDate/reportDate", because the ~117 `is_*` report-period indicators declare
 * `[reportDate]` and DO refuse an injected `tradeDate`. (Both corrections came from
 * cross-session review, 2026-08-15.) Four exits:
 *
 *   has tradeDate                       → inject, nothing to do
 *   no tradeDate, has reportDate        → caller passes reportDate; DATE_PARAM_KEYS
 *                                         suppresses the injection automatically
 *   no tradeDate, has other params      → pass those AND `"<code>:"` to suppress
 *   no tradeDate, parameterList empty   → `"<code>:"` alone
 *
 * The last two need the opt-out (`noQueryDate`, see args.ts). It works the same on
 * the screener since 2026-08-17 — before that the server silently dropped bindings
 * sent with `parameters: []`, so the spelling was refused there (`bug/closed.md` P1-7).
 *
 * 🔴 The RULE is the only stable thing — any list is a snapshot, structurally.
 * `indicator search` REQUIRES a keyword (server answers `100001 缺少必填参数` to an
 * empty one), caps `--limit` at 100 and has no `--from`, and the catch-all keyword
 * `_` returns exactly 100 (truncated). There is no list endpoint, so "scan every
 * prefix" has no terminus — you cannot know the prefixes up front. Regenerate per
 * family instead: `indicator search --keyword <prefix>_ --limit 100`, exhausted when
 * the count is under the limit.
 *
 * Snapshot 2026-08-15 (four families exhausted that way — `pty_` 19 / `scr_` 20 /
 * `div_` 18 / `frcst_` 8): the `pty_*` and `scr_*` static-attribute families, plus
 * `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg`. Other prefixes unscanned.
 *
 * `fiscalYear` is deliberately NOT in this set either. It looks like a date axis,
 * but five indicators require it TOGETHER with `tradeDate` — `frcst_op_rev` /
 * `frcst_op_rev_yoy` / `frcst_pe` / `frcst_shnp` / `frcst_shnp_yoy` (parameterList,
 * probed 2026-08-15; all five return values today). Adding it here to reach the
 * two `div_*` indicators would break those five, which is why the fix is the
 * per-indicator opt-out and not a wider key set.
 *
 * `sDate` is deliberately NOT here. It is an interval START, not a substitute:
 * `qte_vol_intvl` declares `tradeDate` required (the interval END) and `sDate`
 * optional. Treating it as a replacement dropped `--date` and silently moved the
 * interval end — probed 2026-08-02, 茅台 sDate=2024-01-02 returned 2,265,873,849
 * without a tradeDate vs 65,687,435 with tradeDate=2024-01-31, both exit 0. */
const DATE_PARAM_KEYS = new Set(["tradeDate", "reportDate"])

/**
 * Every `--indicator-param` group must name an indicator that `--indicator` also lists.
 * The screener has enforced the equivalent since it shipped (`parseScreenerIndicators`
 * rejects a param for an unbound `F<n>`); cross-section and time-series did not, so a
 * mistyped code went out as a parameter group for an indicator that was never queried:
 *
 *   --indicator is_op_rev --indicator-param "is_op_rve:reportDate=2025-06-30"
 *   → indicatorCodeList: ["is_op_rev"],  indicatorParamList: [{ indicatorCode: "is_op_rve", … }]
 *
 * On time-series that is silent end to end — nothing there injects a date, so the
 * parameters the caller believes they set simply never apply and the query runs on
 * whatever the server defaults to. Covers the bare `"<code>:"` opt-out too: mistyping
 * THAT leaves the real indicator with its injected `tradeDate`, which is the exact
 * thing the opt-out exists to remove.
 */
function assertParamCodesBound(groups: IndicatorParamGroup[] | undefined, codes: string[]): void {
  if (!groups?.length) return
  const bound = new Set(codes)
  for (const group of groups) {
    if (!bound.has(group.indicatorCode)) {
      throw new ValidationError(`--indicator-param references "${group.indicatorCode}", which no --indicator names`)
    }
  }
}

function withQueryDate(groups: IndicatorParamGroup[] | undefined, codes: string[], date: string): IndicatorParamGroup[] {
  const merged = new Map<string, IndicatorParamGroup>()
  for (const group of groups ?? []) merged.set(group.indicatorCode, group)
  for (const code of codes) {
    const group = merged.get(code)
    if (!group) {
      merged.set(code, { indicatorCode: code, parameters: [{ paramKey: "tradeDate", paramValue: date }] })
    } else if (!group.noQueryDate && !group.parameters.some((param) => DATE_PARAM_KEYS.has(param.paramKey))) {
      group.parameters.push({ paramKey: "tradeDate", paramValue: date })
    }
  }
  return [...merged.values()].map(stripMarker)
}

/** `noQueryDate` is a parse-time marker, not a server field. Sending it would land
 * in `server-open.md` P1-2's grey zone, where one of the three behaviours for an
 * unsupported body field is to silently filter the result to nothing. */
function stripMarker<T extends { noQueryDate?: true }>(item: T): Omit<T, "noQueryDate"> {
  const { noQueryDate, ...rest } = item
  return rest
}

export function buildIndicatorCrossSectionBody(options: IndicatorCrossSectionOptions) {
  const groups = parseIndicatorParams(options.indicatorParam)
  assertParamCodesBound(groups, options.indicator)
  return {
    indicatorCodeList: maybeArray(options.indicator),
    universe: maybeArray(options.security),
    currency: options.currency,
    scale: options.scale,
    indicatorParamList: withQueryDate(groups, options.indicator, options.date),
  }
}

export function buildIndicatorTimeSeriesBody(options: IndicatorTimeSeriesOptions) {
  const groups = parseIndicatorParams(options.indicatorParam)
  assertParamCodesBound(groups, options.indicator)
  return {
    indicatorCodeList: maybeArray(options.indicator),
    universe: maybeArray(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    calendarType: options.calendarType,
    currency: options.currency,
    scale: options.scale,
    // The endpoint requires the key even with nothing to configure. No date is
    // injected here, so `"code:"` is a no-op beyond sending an empty param list.
    indicatorParamList: (groups ?? []).map(stripMarker),
  }
}

export function buildIndicatorScreenerBody(options: IndicatorScreenerOptions) {
  const indicators = parseScreenerIndicators(options.indicator, options.indicatorParam, options.expression)
  return {
    universe: maybeArray(options.security),
    expression: options.expression,
    // Every indicator gets a date unless it opts out with the bare `"F1:"` spec —
    // the same escape hatch cross-section has, and for the same reason: indicators
    // whose parameterList declares no date key answer `100003 不支持参数 tradeDate`
    // for the WHOLE request. Sending them with `parameters: []` is how the screener
    // reaches them (probed 2026-08-17: the binding survives and the condition
    // applies — `scr_exchg_sctr contains '创业板'` picks 宁德时代 out of a four-stock
    // universe). Through 2026-08-16 the server dropped such bindings silently, which
    // is why this opt-out used to be refused here; that half is now fixed.
    indicatorList: indicators.map((indicator) => (indicator.noQueryDate || indicator.parameters.some((param) => DATE_PARAM_KEYS.has(param.paramKey))
      ? stripMarker(indicator)
      : { ...stripMarker(indicator), parameters: [...indicator.parameters, { paramKey: "tradeDate", paramValue: options.date }] })),
  }
}
