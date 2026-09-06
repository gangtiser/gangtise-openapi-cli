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
 * 上游对「fieldList 里有该接口不存在的字段名」有两套处理（实测 2026-07-24，realtime 一项
 * 2026-09-05 复测已换边）：day-kline / minute-kline / fund-flow / realtime 把名和值一起丢、
 * 三大报表补 null——长度仍相等，拍平安全，少列的那一半由 `flagMissingFields` 兜；但
 * main-business / valuation-analysis 是**值只按有效字段返回、字段名却按请求原样回显**
 * （main-business 请求 3 列回显 6 项、每行 3 值）。长度一旦不等，按位置拍平就会把值贴到
 * 错误的字段上——不报错、数字看着还合理、却完全是另一个指标。静默错列必须变成显式失败。
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

/** 列式响应能否按位置读：`fieldList` 存在、列名不重复、每个数组行的宽度都等于它。
 * 不满足的响应没有可信的列名，按位置拍平就是静默错列——分片合并与逐只合并都用这条
 * 判据把这种片当作结构异常处理，而不是补齐、截断或借用别的片的列名。 */
export function columnarSchemaValid(fields: unknown[] | undefined, list: unknown[]): boolean {
  if (!fields) return false
  if (new Set(fields.map(String)).size !== fields.length) return false
  return list.every((row) => !Array.isArray(row) || row.length === fields.length)
}

/** 请求的 `--field` 与响应 `fieldList` 的差集。realtime / day-kline / minute-kline / fund-flow
 * 对不存在（或已下线）的字段名是名和值一起丢、HTTP 200——结果就是少一列、退出 0，脚本按列名
 * 取值拿到 undefined 而不是报错（实测 2026-09-05：realtime 传 `turnoverRate` 只回其余列）。
 * CLI 知道请求了什么，缺列就标 `partial` + `missingFields`（printData → 退出码 3）并告警。
 * 只判「请求了但没回」，服务端多回的列不管，所以不依赖任何字段白名单。 */
export function flagMissingFields(data: unknown, requested: string[] | undefined, label: string): void {
  if (!requested?.length || !data || typeof data !== "object" || Array.isArray(data)) return
  const rec = data as Record<string, unknown>
  if (!Array.isArray(rec.fieldList)) return
  const returned = new Set(rec.fieldList.map(String))
  const missing = requested.filter((field) => !returned.has(field))
  if (missing.length === 0) return
  rec.partial = true
  rec.missingFields = missing
  process.stderr.write(`[gangtise] warning: ${label} returned no column for ${missing.join(", ")} — the server drops a field name it does not recognise (or no longer serves) without an error. Check the name against references/fields.md; result marked partial (exit 3).\n`)
}

/** Header check for array (columnar) rows, shared by normalizeRows and the streamed
 * export so the 1000-row threshold cannot change what is accepted: a fieldList must exist
 * and carry unique names, or the rows cannot be read by position. */
export function assertColumnarHeader(fields: unknown[] | undefined, source?: unknown): asserts fields is unknown[] {
  if (!fields) {
    // Array rows can only be read through a fieldList; without one there is no column
    // meaning to attach, and printing bare arrays as a "success" hides that.
    throw new ValidationError(`响应包含数组形式的行但没有 fieldList，无法确定各列的含义，已拒绝输出。这是上游响应结构异常，请报障${traceSuffix(source)}。`)
  }
  // Two columns with one name would silently collapse to the last value under it —
  // close:10 and close:999 become close:999, exit 0. Refuse, like zipFieldRow does for
  // a width mismatch: the shard and per-security merges already apply this rule.
  const names = fields.map(String)
  const dupes = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))]
  if (dupes.length > 0) {
    throw new ValidationError(`响应 fieldList 有重复列名（${dupes.join(", ")}）——按位置拍平时后一列会覆盖前一列，已拒绝输出。这是上游响应结构异常，请报障${traceSuffix(source)}。`)
  }
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
    if (record.list.some(Array.isArray)) assertColumnarHeader(fields, record)
    const normalizedList = record.list.map((row) => (Array.isArray(row) ? zipFieldRow(fields, row, record) : row))
    const { fieldList, list, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list: normalizedList } : normalizedList
  }

  if (Array.isArray(record.list)) {
    if (record.list.some(Array.isArray)) assertColumnarHeader(undefined, record)
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
