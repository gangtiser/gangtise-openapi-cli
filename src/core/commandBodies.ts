import type { IndicatorParamGroup } from "./args.js"
import { maybeArray, parseFrom, parseIndicatorParams, parseOptionalNumberOption, parseScreenerIndicators, parseSize } from "./args.js"

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
  date?: string
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

/** Parameter keys that carry an indicator's own query date. The 2026-08-01 EDE
 * revision dropped the root-level `date`, so `--date` now fans out into each
 * indicator's `tradeDate`. Report-period indicators read `reportDate`/`sDate`
 * instead and answer a `tradeDate` with an EMPTY result rather than an error
 * (probed 2026-08-01 on `is_op_rev_mom`), so a caller-supplied date of any of
 * these kinds suppresses the injection for that indicator. Injecting into an
 * indicator that takes no date at all is harmless — `pty_op_scope` still
 * answers normally with a stray `tradeDate` attached. */
const DATE_PARAM_KEYS = new Set(["tradeDate", "reportDate", "sDate"])

function withQueryDate(groups: IndicatorParamGroup[] | undefined, codes: string[], date: string): IndicatorParamGroup[] {
  const merged = new Map<string, IndicatorParamGroup>()
  for (const group of groups ?? []) merged.set(group.indicatorCode, group)
  for (const code of codes) {
    const group = merged.get(code)
    if (!group) {
      merged.set(code, { indicatorCode: code, parameters: [{ paramKey: "tradeDate", paramValue: date }] })
    } else if (!group.parameters.some((param) => DATE_PARAM_KEYS.has(param.paramKey))) {
      group.parameters.push({ paramKey: "tradeDate", paramValue: date })
    }
  }
  return [...merged.values()]
}

export function buildIndicatorCrossSectionBody(options: IndicatorCrossSectionOptions) {
  return {
    indicatorCodeList: maybeArray(options.indicator),
    universe: maybeArray(options.security),
    currency: options.currency,
    scale: options.scale,
    indicatorParamList: withQueryDate(parseIndicatorParams(options.indicatorParam), options.indicator, options.date),
  }
}

export function buildIndicatorTimeSeriesBody(options: IndicatorTimeSeriesOptions) {
  return {
    indicatorCodeList: maybeArray(options.indicator),
    universe: maybeArray(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    calendarType: options.calendarType,
    currency: options.currency,
    scale: options.scale,
    // The endpoint requires the key even with nothing to configure.
    indicatorParamList: parseIndicatorParams(options.indicatorParam) ?? [],
  }
}

export function buildIndicatorScreenerBody(options: IndicatorScreenerOptions) {
  const indicators = parseScreenerIndicators(options.indicator, options.indicatorParam)
  return {
    universe: maybeArray(options.security),
    expression: options.expression,
    indicatorList: options.date
      ? indicators.map((indicator) => (indicator.parameters.some((param) => DATE_PARAM_KEYS.has(param.paramKey))
        ? indicator
        : { ...indicator, parameters: [...indicator.parameters, { paramKey: "tradeDate", paramValue: options.date as string }] }))
      : indicators,
  }
}
