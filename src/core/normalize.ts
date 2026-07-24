import { ENVELOPE_TRACE_ID, ValidationError } from "./errors.js"

/** 信封 traceId 由 `client.ts` 挂在每个成功响应的 payload 上（非枚举 symbol）。
 * 结构异常报障没这个 id 服务端查不了，所以拍平失败时要一并带出。 */
function traceSuffix(source: unknown): string {
  if (!source || typeof source !== "object") return ""
  const traceId = (source as Record<symbol, unknown>)[ENVELOPE_TRACE_ID]
  return typeof traceId === "string" ? `（trace ${traceId}）` : ""
}

/** 按位置把列式响应的一行值拍平成对象。
 *
 * 上游对「fieldList 里有该接口不存在的字段名」有两套处理，实测 2026-07-24：
 * day-kline / minute-kline / fund-flow 把名和值一起丢、三大报表补 null——长度仍相等，安全；
 * 但 realtime / main-business / valuation-analysis 是**值只按有效字段返回、字段名却按请求
 * 原样回显**。长度一旦不等，按位置拍平就会把值贴到错误的字段上：realtime 传
 * ["securityCode","close","turnoverRate"]（realtime 根本没有 close）只回 2 个值，
 * 换手率 28.5573 被贴成 close，读起来就是「茅台收盘价 28.56」（真实价 1297.41）。
 * 不报错、数字看着还合理、却完全是另一个指标——静默错列必须变成显式失败。
 *
 * 文案不能一口咬定「字段名传错」：`alternative edb-data` 走同一个拍平却根本没有
 * `--field`（只有 `--indicator-id`），那里长度不等只可能是上游响应结构变了。 */
export function zipFieldRow(fields: unknown[], row: unknown[], source?: unknown): Record<string, unknown> {
  if (row.length !== fields.length) {
    throw new ValidationError(
      `响应字段数与 fieldList 不匹配（fieldList ${fields.length} 项、该行返回 ${row.length} 个值）——按位置拍平会把值贴到错误的字段上，已拒绝输出。带 --field 的命令多为传了该接口不存在的字段名（上游只返回有效字段的值、字段名却按请求回显）：核对 --field 取值（如 quote realtime 没有 close，最新价是 latestPrice），不确定就不传 --field（返回全量字段最稳）。没有 --field 的命令（如 alternative edb-data）出现此错，是上游响应结构异常，请报障${traceSuffix(source)}。`,
    )
  }
  return fields.reduce<Record<string, unknown>>((acc, field, index) => {
    acc[String(field)] = row[index]
    return acc
  }, {})
}

export function normalizeRows(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  if (Array.isArray(record.fieldList) && Array.isArray(record.list)) {
    const fields = record.fieldList as unknown[]
    const normalizedList = record.list.map((row) => (Array.isArray(row) ? zipFieldRow(fields, row, record) : row))
    const { fieldList, list, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list: normalizedList } : normalizedList
  }

  if (Array.isArray(record.list)) {
    const { list, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list } : list
  }

  if (Array.isArray(record.constants)) {
    const { constants, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list: constants } : constants
  }

  return value
}
