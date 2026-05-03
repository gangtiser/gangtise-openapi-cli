import { maybeArray, parseFrom, parseOptionalNumberOption, parseSize } from "./args.js"

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

export function buildQuoteKlineBody(options: QuoteKlineOptions) {
  return {
    securityList: maybeArray(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1 }),
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
