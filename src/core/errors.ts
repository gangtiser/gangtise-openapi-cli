export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ConfigError extends CliError {}
export class ValidationError extends CliError {}
export class DownloadError extends CliError {}

/** Outer-envelope traceId, stashed on the unwrapped payload so it survives
 * `unwrapEnvelope` discarding the envelope. Needed by the EDE endpoints alone:
 * they double-wrap, and probing 2026-07-20 showed the traceId lives only on the
 * OUTER envelope — the inner failure envelope (`{code, status:false, msg}`) has
 * none. Without this the one correlation id Gangtise support can trace is gone
 * exactly where the inner failure is raised. Non-enumerable so it never reaches
 * JSON/CSV output. */
export const ENVELOPE_TRACE_ID = Symbol("gangtise.envelopeTraceId")

export function attachEnvelopeTraceId<T>(payload: T, traceId: unknown): T {
  if (payload && typeof payload === "object" && (typeof traceId === "string" || typeof traceId === "number")) {
    Object.defineProperty(payload, ENVELOPE_TRACE_ID, { value: String(traceId), enumerable: false, configurable: true })
  }
  return payload
}

/** Keyed by the code as a string — `unwrapEnvelope` runs every envelope code
 * through `String()` first, which matters because the 2026-07-17 error-code
 * overhaul emits the new codes as JSON *numbers* while legacy codes stay strings.
 *
 * Both generations are listed on purpose. Probed 2026-07-20: the rollout is
 * partial — the business layer already answers with the new codes (`999011`,
 * `130001`, `130002`, `100003`, `999010`), but the outer token filter still
 * emits `0000001007` / `0000001008` / `900002`. Dropping either set would leave
 * a live code hintless. */
const ERROR_HINTS: Record<string, string> = {
  // The hint is appended after the server's own msg, so it must carry the *action*,
  // never restate the diagnosis — "资源不存在 资源不存在，确认 ID 有效" reads as a stutter.
  // ── 服务统一层 999xxx ──
  "999001": "检查 GANGTISE_TOKEN 或 AK/SK 是否已 export。",
  "999002": "有 AK/SK 时 CLI 会自动重新登录重试一次，否则请重新登录。",
  "999003": "定制接口需联系客户经理开通。",
  "999004": "换一条本账号可见的记录重试。",
  "999005": "联系客户经理充值，或缩小查询范围降低消耗。",
  "999006": "触发限流，稍后再试或联系客户经理提额；429 所有端点都退避重试，5xx 仅普通端点重试（贵档 no-replay 端点的 5xx 不重放，但其 429 仍重试）。",
  // CLI 自身发不出这三类请求（method / Content-Type 都由 endpoint 定义固定），
  // 只有 raw call 打错端点或服务端行为变化才可能撞上。实测 2026-07-20 分别落到
  // 900002 / 999999 / 100003，此处为服务端接上新码后的预置。
  "999007": "请求方法不支持——`raw call` 时确认该 endpoint 是 GET 还是 POST。",
  "999008": "Content-Type 不支持，该接口只收 application/json。",
  "999009": "请求体无法解析，检查 JSON 是否合法。",
  "999010": "`raw call` 传的 endpoint key 可能已下线，用 `gangtise raw list` 核对。",
  "999011": "检查 GANGTISE_ACCESS_KEY / GANGTISE_SECRET_KEY 是否写反或未 export。",
  "999012": "联系客户经理。",
  "999013": "联系客户经理续期。",
  "999014": "联系客户经理。",
  "999015": "联系客户经理开通长期 token。",
  "999016": "联系客户经理登记当前出口 IP。",
  "999999": "请稍后重试；持续失败请带上面的 trace 报障。",

  // ── 业务通用 1xxxxx ──
  "100001": "对照命令 --help 检查必填项。",
  "100002": "检查数值/字符串参数是否传反。",
  // 实测两种形态都有：类型/范围错的 msg 带字段（「请求体字段类型不匹配: size 期望类型
  // Integer」「limit 最小为 1，最大为 10000」），枚举错的 msg 只有笼统的「参数值非法」。
  // 条件句让两种形态都读得通——v0.25.0 的旧文案断言"服务端不会指明"，与前一种直接打架。
  "100003": "msg 已指明字段名或取值范围时直接按 msg 改；msg 只说「参数值非法」时多为枚举参数拼写错误（如 --source / --question-category / --answer-important），对照命令 --help 列出的合法值检查。",
  "100004": "检查 --size / --from 是否为非负数且未超单页上限。",
  "100005": "对照命令 --help 列出的合法取值检查。",
  "100006": "缩短日期范围或调小 --size / --limit。",
  // 按参数名判断，不要按命令组：AI 下 management-discuss 的 --report-date 是 date，
  // 而同属 AI 的 knowledge-batch 收时间戳或 datetime——旧文案笼统写"AI 用 datetime"会把
  // --report-date 的用户越导越错。
  "110001": "看参数名：`--*-date` 用 YYYY-MM-DD，`--*-time` 用 \"YYYY-MM-DD HH:mm:ss\"（`ai knowledge-batch` 的 --start-time/--end-time 收时间戳或 datetime，CLI 统一转 13 位毫秒）。",
  "110002": "起始晚于结束——检查 --start-date/--end-date 或 --start-time/--end-time 的先后。",
  "110003": "缩短查询窗口后重试。",
  "120001": "用 `gangtise reference securities-search` 确认代码与后缀（如 600519.SH / 00700.HK）。",
  "130001": "未找到数据——先核对查询条件；EDE 指标端点此码也可能是未开通该指标权限，仍失败联系客户经理。",
  "130002": "确认下载 ID 有效且本账号可见；下载类还需检查 --file-type 取值是否合法（非法 file-type 也归此码）。",
  "130003": "该条记录可能未附带文件。",
  // 下载类命令各有各的 ID 参数（--report-id / --announcement-id / --chunk-id /
  // --summary-id / --conference-id / --record-id / --file-id / --article-id /
  // --independent-opinion-id）；--data-id 是异步 *-check 用的，不产生此码。
  "130004": "下载 ID 需为数字，检查该命令的 --*-id 参数是否传对。",
  "130005": "对照命令 --help 检查 --file-type / --content-type 取值。",
  "140001": "稍后用对应 *-check 命令查询。",
  "140002": "异步生成失败（终态）——换参数重新提交，重试同一 dataId 不会变。",

  // ── 接口专有 2xxxxx ──
  "210001": "换一篇，或改用 list 取正文摘要。",
  "220001": "改用 list 取正文摘要。",
  "230001": "只有自己上传的文件可下载。",
  "240001": "换更早的 --period（如 2025q3 → 2025interim）。",
  "240002": "改述后重新提交。",
  "240003": "对照命令 --help 检查取值。",
  "250001": "检查 resourceType 与 sourceId 组合（两者都来自 knowledge-batch 返回）。",

  // ── 旧码（2026-07-20 实测仍在线，或历史遗留） ──
  "0000001007": "请求未携带 Bearer token，检查 GANGTISE_TOKEN 或 AK/SK 是否已 export。",
  "0000001008": "Token 已失效（多为他处登录挤掉本会话）；有 AK/SK 时 CLI 会自动重新登录重试一次，否则请重新登录。",
  "900001": "对照命令 --help 检查必填项。",
  "900002": "请求方法不正确（服务端 msg 为「请求类型有误」）——`raw call` 时检查该 endpoint 是 GET 还是 POST。",
  "903301": "次日再试，或联系客户经理提额。",
  // EDE 专有旧码，未被 2026-07-17 重排收编但仍是 indicator 取数的主要报错
  // （references/commands/indicator.md 把这两个列为首要排查项）。
  "410001": "补齐 --indicator / --security；`time-series` 不支持「多指标 × 多证券」，改用 `indicator cross-section`。",
  "410106": "读 `indicator search --format json` 的 parameterList，用 --indicator-param 补上 required:true 的参数（如 periodNum / startDate / fiscalYear）。",
  "410004": "换证券或日期确认该条件下本应有数据；仍失败多为未开通该指标，联系客户经理。",
  "410110": "稍后用对应 *-check 命令查询。",
  "410111": "终态，换参数后重新提交，重试同一请求不会变。",
  "430004": "确认 reportId 有效，或更换 --file-type 重试（官方未文档化错误码）。",
  "430007": "缩短日期范围或调小 --limit。",
  "433007": "检查 resourceType 与 sourceId 组合（两者都来自 knowledge-batch 返回）。",
  "8000014": "检查 GANGTISE_ACCESS_KEY 是否正确、是否与 SECRET_KEY 写反。",
  "8000015": "检查 GANGTISE_SECRET_KEY 是否正确、是否与 ACCESS_KEY 写反。",
  "8000016": "联系客户经理核查账号状态。",
  "8000018": "联系客户经理续期。",
  "999995": "联系客户经理充值，或缩小查询范围降低消耗。",
  "999997": "联系客户经理开通。",
  "10011401": "联系客户经理开通白名单。",
}

export class ApiError extends CliError {
  readonly hint?: string

  constructor(
    message: string,
    readonly code?: string,
    readonly statusCode?: number,
    readonly details?: unknown,
    /** Server-specified Retry-After (ms), set on 429 responses so the transport
     * backoff can honor it instead of the default exponential schedule. */
    readonly retryAfterMs?: number,
    /** Context-specific hint that beats the generic per-code table — e.g. EDE's
     * 999999 means "no data", not the table's "系统错误，请稍后重试". */
    hintOverride?: string,
  ) {
    super(message)
    this.hint = hintOverride ?? (code ? ERROR_HINTS[code] : undefined)
  }

  /** Server-side correlation id from the 2026-07-17 envelope
   * (`{code, errorType, msg, status, data, traceId}`). Read off `details` rather
   * than threading a 7th positional constructor arg through every call site.
   * Worth surfacing: it is the only handle Gangtise support can trace a 999999 by. */
  get traceId(): string | undefined {
    if (!this.details || typeof this.details !== "object") return undefined
    // Fall back to the outer envelope's id for double-wrapped (EDE) responses,
    // whose inner failure envelope carries no traceId of its own.
    const details = this.details as { traceId?: unknown } & Record<symbol, unknown>
    const value = details.traceId ?? details[ENVELOPE_TRACE_ID]
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined
  }
}
