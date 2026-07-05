import { maybeArray, parseFrom, parseIndicatorParams, parseOptionalNumberOption, parseSize } from "./args.js"

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

export function buildIndicatorCrossSectionBody(options: IndicatorCrossSectionOptions) {
  return {
    indicatorCodeList: maybeArray(options.indicator),
    securityCodeList: maybeArray(options.security),
    date: options.date,
    currency: options.currency,
    scale: options.scale,
    indicatorParamList: parseIndicatorParams(options.indicatorParam),
  }
}

export function buildIndicatorTimeSeriesBody(options: IndicatorTimeSeriesOptions) {
  return {
    indicatorCodeList: maybeArray(options.indicator),
    securityCodeList: maybeArray(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    calendarType: options.calendarType,
    currency: options.currency,
    scale: options.scale,
    indicatorParamList: parseIndicatorParams(options.indicatorParam),
  }
}
