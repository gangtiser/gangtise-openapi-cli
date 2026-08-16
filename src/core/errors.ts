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
  "999004": "整库/整接口未开通（如帕米尔专家纪要需单独购买），或该条记录本账号不可见——list 撞上多为前者，先确认该数据库是否已开通。",
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
  // 2026-08-14 起 list 类端点把单页上限（50）也归到此码，不再只是「一次要太多行」。
  "100006": "缩短日期范围或调小 --size / --limit（list 类端点单页上限为 50，CLI 自动翻页，直发接口时要自己遵守）。",
  // 按参数名判断，不要按命令组：AI 下 management-discuss 的 --report-date 是 date，
  // 而同属 AI 的 knowledge-batch 收时间戳或 datetime——旧文案笼统写"AI 用 datetime"会把
  // --report-date 的用户越导越错。
  "110001": "看参数名：`--*-date` 用 YYYY-MM-DD，`--*-time` 用 \"YYYY-MM-DD HH:mm:ss\"（`ai knowledge-batch` 的 --start-time/--end-time 收时间戳或 datetime，CLI 统一转 13 位毫秒）。",
  "110002": "起始晚于结束——检查 --start-date/--end-date 或 --start-time/--end-time 的先后。",
  // 超出的是账号数据权限的时间下界，不是单次窗口太宽——`--fiscal-year 2015` 这种
  // 整个区间都在界外的请求，怎么缩窗口都还是这个码（实测 2026-08-08）。
  "110003": "查询时间超出本账号的数据权限范围——把日期移进范围内（整个区间都早于下界时缩短窗口无用），或联系客户经理开通更长历史。",
  "120001": "用 `gangtise reference securities-search` 确认代码与后缀（如 600519.SH / 00700.HK）。",
  "130001": "未找到数据——先核对查询条件；EDE 指标端点此码也可能是未开通该指标权限，仍失败联系客户经理。",
  // 2026-08-14 起下载类把「file-type 非法」拆到 130005、「资源未生成」拆到 130003，
  // 但历史上两者都归过此码，所以提示保留对 --file-type 的指引。
  "130002": "确认下载 ID 有效且本账号可见；下载类还需检查 --file-type 取值是否合法。",
  "130003": "资源未生成或该条记录未附带文件——换一条有附件的记录（列表里 hasAttachment/hasFile 为 true 的），或稍后再试。",
  // 下载类命令各有各的 ID 参数（--report-id / --announcement-id / --chunk-id /
  // --summary-id / --conference-id / --record-id / --file-id / --article-id /
  // --independent-opinion-id）；--data-id 是异步 *-check 用的，不产生此码。
  "130004": "下载 ID 需为数字，检查该命令的 --*-id 参数是否传对。",
  "130005": "对照命令 --help 检查 --file-type / --content-type 取值。",
  "140001": "稍后用对应 *-check 命令查询。",
  // 两类来源共用此码：AI 异步生成失败，以及 EDE 的参数/表达式错误（实测 2026-08-02：
  // 枚举越界「参数 adjustType 的值 99 不在有效范围内 [1,2,3,4]」、表达式语法错误）。
  // 两者都是终态、都不该重试，所以文案只说「换参数重来」而不预设是哪一类。
  "140002": "终态失败，重试同一请求不会变——按 msg 改参数后重新提交；EDE 的指标参数名/枚举以 indicator search 的 parameterList 为准。",

  // ── 接口专有 2xxxxx ──
  "210001": "换一篇，或改用 list 取正文摘要。",
  "220001": "改用 list 取正文摘要。",
  "230001": "只有自己上传的文件可下载。",
  // 2026-08-07 新增码。私域模块，`vault wechat-*` 就在这个模块下且明确要求
  // 「已绑定并激活群消息助理」，所以本 CLI 够得着，不能当作不可达而不给提示。
  "230002": "微信账号未绑定——群消息类接口要求先在 Gangtise 端绑定并激活群消息助理、且助理已入群。",
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
  // EDE 专有旧码。2026-08-02 复测已不再出现——入参/表达式错走 100003，指标必填
  // 参数缺失与枚举越界走 140002。保留兜底：错误码是按模块分批迁移的，回滚或未迁完
  // 的路径仍可能吐旧码，届时给条能用的提示比 fallthrough 强。
  "410001": "补齐 --indicator / --security；`time-series` 不支持「多指标 × 多证券」，改用 `indicator cross-section`。",
  "410106": "读 `indicator search --format json` 的 parameterList，用 --indicator-param 补上 required:true 的参数（如 periodNum / sDate / fiscalYear）。",
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

/** Hints keyed on the server's message rather than its code. Used where one code
 * covers many causes and the message identifies which — `100003` in particular is
 * the catch-all for every EDE input error, so its per-code hint can only be generic.
 *
 * Kept to cases where the server names the problem but not the CLI flag that fixes
 * it: the caller is told "缺少必填参数 reportDate" and still has to work out that
 * such indicators need `--indicator-param`, not `--date`.
 *
 * ⚠️ Do NOT restate this as a rule about code prefixes or as a clean two-way split.
 * Survey of 170 indicators (2026-08-15) says otherwise: 117 take `reportDate` only,
 * 51 take `tradeDate` only, `div_cash_yld` takes BOTH (both required), and
 * `div_cash_yr` / `div_cash_paid_ratio` take NEITHER (they want `fiscalYear`).
 * Prefixes cut across it too — 7 `finc_*` and 3 `div_*` want `reportDate`, while 8
 * `is_*` and 4 `cf_*` want `tradeDate`. The hint therefore points at
 * `indicator search` rather than asserting which indicators are affected.
 *
 * Both codes are listed because the server sends this same sentence under either:
 * `is_op_rev` answers 100003, `div_cash_yld` answers 100001 (probed 2026-08-15).
 *
 * 🔴 One rule per message SHAPE, not one rule for the whole family. The server sends
 * four distinct sentences here and only two of them say what the indicator wants:
 *
 *   ① 不支持参数 tradeDate; 缺少必填参数 reportDate  → swap to reportDate  (assertive)
 *   ② 缺少必填参数 reportDate                        → add reportDate     (assertive)
 *   ③ 不支持参数 X; 缺少必填参数 tradeDate            → swap X → tradeDate (assertive)
 *   ④ 不支持参数 X  (半句, neither ② nor ③ half)     → UNKNOWN key        (must not assert)
 *   ⑤ 缺少必填参数 tradeDate                         → injection was off  (K13 path)
 *
 * ④ only proves a key was refused. `scr_exchg_mkt` declares an EMPTY parameterList and
 * refuses reportDate as well; `div_cash_paid_ratio` wants `fiscalYear`. Through v0.34.1
 * a single regex OR-ed ① and ④ together, so ④ got ①'s assertive text and the user
 * followed it into `不支持参数 reportDate` — a shape with no rule at all.
 *
 * ③ is the mirror of ①, added 2026-08-16 after cross-session review: writing the keys
 * the wrong way round (`qte_close:reportDate=...`) yields `不支持参数 reportDate; 缺少
 * 必填参数 tradeDate`, which ④ used to claim as "the server did not say which key" and
 * prescribed the `"<code>:"` opt-out — wrong AND a dead end (`100001 缺少必填参数
 * tradeDate`). Same defect as v0.34.1's, moved one shape along. Whenever the server
 * names both halves it has told you the swap; only the lone half is unknown.
 *
 * Hence `notMatch` on ④ excludes BOTH `缺少必填参数` halves: the discriminator is
 * "did the server also name what it wants". Together with the `when` guard on every
 * rule (⓪ fires above one shape, ①③④⑤ at or below it), routing does not depend on
 * array order — mutation P2b (batch rule moved last, guards kept) is green, and that
 * is now a real result rather than an artifact: the one shape that exercises ④'s own
 * guard (several indicators, all lone 不支持参数, different refused keys) has a test.
 * Without it the same mutation was green for want of coverage.
 *
 * The remaining order dependency is ③ vs ⑤ — shape ③ matches both, and ③ must come
 * first. Pinned by the SWAP test, which goes red if ③ is removed. */
/** How many DISTINCT failure shapes the server described in one message.
 *
 * `cross-section` is a batch endpoint, so a single 100003 routinely carries clauses for
 * several indicators. Counting INDICATORS is the wrong question — what decides whether
 * one piece of advice fits is whether they failed the same way:
 *
 *   same shape  `指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数
 *               reportDate; 指标 is_dnrpnp <同上>`  → one fix covers both
 *   diff shapes `指标 qte_close 不支持参数 reportDate; 指标 qte_close 缺少必填参数
 *               tradeDate; 指标 pty_cn_name 不支持参数 tradeDate`  → opposite fixes;
 *               the swap rule's "别用空冒号" is exactly what pty_cn_name needs
 *
 * Two rounds of cross-session review landed here. First the assertive hints spoke in
 * the singular about mixed batches (wrong for every indicator but one). Then gating on
 * distinct INDICATOR count over-corrected: a batch of several `is_*` — the most common
 * batch failure there is — got downgraded to generic triage even though one sentence
 * covered all of them. Shape count is the question both were approximating.
 *
 * A message with no `指标 <code>` clauses yields 1: unparsed means unambiguous here,
 * and the assertive rules stay reachable. */
function distinctFailureShapes(message: string): number {
  const byCode = new Map<string, Set<string>>()
  for (const clause of message.split(/[;；]/)) {
    const m = /指标\s+(\S+)\s+(不支持参数|缺少必填参数)[:：]?\s*(\S+)/.exec(clause)
    if (!m) continue
    const [, code, kind, key] = m
    let shape = byCode.get(code)
    if (!shape) {
      shape = new Set<string>()
      byCode.set(code, shape)
    }
    shape.add(`${kind}:${key}`)
  }
  if (byCode.size === 0) return 1
  return new Set([...byCode.values()].map((shape) => [...shape].sort().join("|"))).size
}

const MESSAGE_HINTS: Array<{ codes: string[]; match: RegExp; also?: RegExp; notMatch?: RegExp; when?: (message: string) => boolean; hint: string }> = [
  {
    // Must come first: when the server named several indicators, no singular hint below
    // can be right about all of them.
    codes: ["100001", "100003"],
    match: /不支持参数\s*(?:tradeDate|reportDate)|缺少必填参数[:：]?\s*(?:tradeDate|reportDate)/,
    when: (message) => distinctFailureShapes(message) > 1,
    hint: "🔴 **这条报错涉及多个指标，而且它们失败的方式不同**——同一个改法套不到全部，按 msg 里每个指标各自说的话分别处理：msg 里对某个指标说「不支持参数 X; 缺少必填参数 Y」= 把 X 换成 Y（`--indicator-param \"<该指标code>:Y=...\"`）；只说「不支持参数 X」而没说缺什么 = 该指标一个日期都不要，给它加 `--indicator-param \"<该指标code>:\"`（冒号后留空）；只说「缺少必填参数 Y」= 补上 Y。**最省事的办法是把这批指标拆成几次单独查**，那样每条报错只对应一个指标，提示也能给准。以 `indicator search --keyword <指标code> --format json` 的 parameterList 为准。",
  },
  {
    codes: ["100001", "100003"],
    match: /缺少必填参数[:：]?\s*reportDate/,
    when: (message) => distinctFailureShapes(message) <= 1,
    hint: "报错点名的指标要的是 reportDate（报告期），不是 --date 下发的 tradeDate。给每个被点名的指标各补一条 --indicator-param \"<指标code>:reportDate=YYYY-MM-DD\"（screener 用 \"F1:reportDate=...\"），--date 仍要保留——补上后 CLI 就不再为该指标注入 tradeDate。⚠️ 少数指标两个日期都要（如 div_cash_yld），补完若再报缺 tradeDate，就把 tradeDate 也显式传上。**以 `indicator search` 返回的 parameterList 为准，别按 code 前缀推断**。",
  },
  {
    codes: ["100001", "100003"],
    match: /不支持参数\s*(?:tradeDate|reportDate)/,
    also: /缺少必填参数[:：]?\s*tradeDate/,
    when: (message) => distinctFailureShapes(message) <= 1,
    hint: "服务端在同一句里**已经点名了两边**：一个键不该出现，另一个键缺了——把前者换成后者即可，别再往里加键。多半是两个日期键写反了：删掉 --indicator-param 里被拒的那个，改成 msg 里说缺的那个（如 --indicator-param \"<指标code>:tradeDate=YYYY-MM-DD\"，screener 用 \"F1:tradeDate=...\"）。⚠️ 别在这一步用 --indicator-param \"<指标code>:\"（「不要日期」的写法）——服务端明说了它要一个日期，那样只会撞下一个报错。",
  },
  {
    codes: ["100001", "100003"],
    match: /不支持参数\s*(?:tradeDate|reportDate)/,
    notMatch: /缺少必填参数[:：]?\s*(?:reportDate|tradeDate)/,
    when: (message) => distinctFailureShapes(message) <= 1,
    hint: "服务端只说这个键不该出现，**没说该换成哪个**——别照着「改用 reportDate」做，那多半同样被拒。报错点名的指标，其 parameterList 里没有 --date 下发的那个日期键，给每个被点名的指标各加一条 --indicator-param \"<指标code>:\"（冒号后留空）声明「本指标不要查询日期」即可，它与真实参数可以共存。跑 `indicator search --keyword <指标code> --format json` 确认还缺什么：parameterList 为空就只加这一条；还列了 fiscalYear 之类的就连同 --indicator-param \"<指标code>:fiscalYear=2025\" 一起给。⚠️ screener 上这个写法用不了（服务端会静默丢弃该指标并返 0 行），改用 `indicator cross-section` 取回来本地筛。",
  },
  {
    codes: ["100001", "100003"],
    match: /缺少必填参数[:：]?\s*tradeDate/,
    when: (message) => distinctFailureShapes(message) <= 1,
    hint: "--date 的 tradeDate 这次没有下发——你为该指标传了 reportDate/tradeDate，或者用了 --indicator-param \"<指标code>:\" 这个「不要日期」的写法，两者都会关掉自动注入。对症改：如果这个指标两个日期都必填（如 div_cash_yld），把 tradeDate 也显式传上 --indicator-param \"<指标code>:tradeDate=YYYY-MM-DD\"（screener 用 \"F1:tradeDate=...\"）；如果是空冒号那条加错了指标，删掉它即可。",
  },
]

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
    /** Context-specific hint that beats the generic per-code table — e.g. the
     * EDE fetch endpoints replace 999999's generic "系统错误，请稍后重试" with a
     * parameter checklist, because a wrong param name or date axis there yields
     * an empty TABLE rather than this code. */
    hintOverride?: string,
  ) {
    super(message)
    // Precedence: explicit override > message-specific > per-code. The message rule
    // sits in the middle because it identifies a narrower cause than the code alone,
    // but a call site that already knows the context still knows better.
    const byMessage = code
      ? MESSAGE_HINTS.find((rule) => rule.codes.includes(code)
        && rule.match.test(message)
        && (rule.also?.test(message) ?? true)
        && !rule.notMatch?.test(message)
        && (rule.when?.(message) ?? true))?.hint
      : undefined
    this.hint = hintOverride ?? byMessage ?? (code ? ERROR_HINTS[code] : undefined)
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
