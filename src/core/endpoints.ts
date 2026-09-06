export interface EndpointDefinition {
  key: string
  method: "GET" | "POST"
  path: string
  /** "upload": multipart/form-data file POST — the body is a FormData, not JSON,
   * and only `client.uploadFile` can send it (`raw call` cannot carry a file). */
  kind: "json" | "download" | "upload"
  description: string
  pagination?: {
    enabled: true
    maxPageSize: number
  }
  /** Per-endpoint timeout floor in ms. Synchronous AI generation blocks well past
   * the 30s default; without a floor it times out and retries, and a retry can
   * re-bill the generation. `resolveTimeoutMs` lifts the request timeout to this
   * value (never lowering a higher user-configured timeout). */
  timeoutMs?: number
  /** "no-replay": never resend a request the server may already have executed
   * (no 5xx/timeout/999999 retry; connect-phase errors, 429 and token self-heal
   * still retry), because a replay can double-bill. Most endpoints carrying it are
   * per-call billed with no cache-hit exemption (probed 2026-07-11), which is why
   * a replayed 5xx charges twice.
   *
   * ⚠️ This is a REPLAY-SAFETY marker, NOT a billing-model one — never read it as
   * "per-call billed". `ai.hot-topic` carries it while being priced per returned
   * item; it is marked because replaying a page could re-bill rows the server
   * already delivered. Reading it as a billing flag is what once made the
   * total-cap probe skip that endpoint (see client.ts).
   * "no-999999": EDE used to answer a no-data query with HTTP 500 + 999999
   * (probed 2026-07-11). It stopped doing that on 2026-08-01, and since
   * 2026-08-07 a no-data answer is a null cell with its row and column intact,
   * so 999999 is now a generic server fault here — the marker stays because
   * replaying a billed EDE query on a fault helps nothing. */
  retry?: "no-replay" | "no-999999"
  /** Response fields that carry snowflake ids and must survive JSON.parse exactly.
   * `quoteBigIntFields` re-quotes them in the raw text first: a bare JSON number
   * past 2^53 silently rounds, and a rounded id can never fetch the (already
   * billed) task it belongs to. */
  bigIntFields?: readonly string[]
  /** "list": every successful answer is `{…, list: [...]}` — an empty range is
   * `{total: 0, list: []}` (probed 2026-09-05 on all four) — so a payload without a
   * `list` array (`data: null`, a bare object) is a broken response, not an empty one.
   * Checked in `requestJson`, where the envelope and its traceId are still in hand; a
   * `null` cannot carry the traceId symbol, so a check further down would report the
   * failure trace-less, and the flatteners would otherwise print `null` at exit 0.
   * All seven quote endpoints carry it: the three menu-retired per-market ones answer
   * an unknown code and an empty range with `{total: 0, list: []}` too (probed
   * 2026-09-05 on all three), so a legal empty answer always has its `list`. */
  expects?: "list"
}

/** Effective request timeout: the endpoint's floor, or the config timeout if higher
 * (a user who raised GANGTISE_TIMEOUT_MS keeps their value). */
export function resolveTimeoutMs(configTimeoutMs: number, endpoint: Pick<EndpointDefinition, "timeoutMs">): number {
  return Math.max(configTimeoutMs, endpoint.timeoutMs ?? 0)
}

// Registry entries omit `key`: it is derived from the record key when ENDPOINTS is
// built below, so the two can never drift.
const ENDPOINT_DEFS: Record<string, Omit<EndpointDefinition, "key">> = {
  // ─── auth ───
  "auth.login": {
    method: "POST",
    path: "/application/auth/oauth/open/loginV2",
    kind: "json",
    description: "Get access token",
  },

  // ─── lookup (served from local data, not HTTP) ───
  "lookup.broker-orgs.list": {
    method: "GET",
    path: "/guide/broker-orgs-local",
    kind: "json",
    description: "List broker orgs from local docs",
  },
  "lookup.meeting-orgs.list": {
    method: "GET",
    path: "/guide/meeting-orgs-local",
    kind: "json",
    description: "List meeting orgs from local docs",
  },

  // ─── insight ───
  "insight.opinion.list": {
    method: "POST",
    path: "/application/open-insight/chief-opinion/getList",
    kind: "json",
    description: "List domestic institution chief opinions",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.summary.list": {
    method: "POST",
    path: "/application/open-insight/summary/v2/getList",
    kind: "json",
    description: "List summaries",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.summary.download": {
    method: "GET",
    path: "/application/open-insight/summary/v2/download/file",
    kind: "download",
    description: "Download summary file",
    // 50/篇 — same price tier as the AI Agent calls; billing probed non-idempotent.
    retry: "no-replay",
  },
  "insight.pamirs-summary.list": {
    method: "POST",
    path: "/application/open-insight/pamirs-summary/getList",
    kind: "json",
    description: "List Pamirs expert summaries (requires the expert-summary database)",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.pamirs-summary.download": {
    method: "GET",
    path: "/application/open-insight/pamirs-summary/download/file",
    kind: "download",
    description: "Download a Pamirs expert summary file",
    // The 2026-08-07 spec states an entitlement (the expert-summary database) but
    // no per-call price. Treated as non-idempotent anyway, like its
    // `insight.summary.download` sibling: if it does meter, a 5xx replay
    // double-bills, and the only cost of being wrong is losing one retry.
    retry: "no-replay",
  },
  "insight.roadshow.list": {
    method: "POST",
    path: "/application/open-insight/schedule/roadshow/getList",
    kind: "json",
    description: "List roadshows",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.site-visit.list": {
    method: "POST",
    path: "/application/open-insight/schedule/site-visit/getList",
    kind: "json",
    description: "List site visits",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.strategy.list": {
    method: "POST",
    path: "/application/open-insight/schedule/strategy-meeting/getList",
    kind: "json",
    description: "List strategy meetings",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.forum.list": {
    method: "POST",
    path: "/application/open-insight/schedule/forum/getList",
    kind: "json",
    description: "List forums",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.performance-calendar.list": {
    method: "POST",
    path: "/application/open-insight/schedule/performance-calendar/getList",
    kind: "json",
    description: "List earnings calendar events (forecast / express / announcement)",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.performance-calendar.download": {
    method: "GET",
    path: "/application/open-insight/schedule/performance-calendar/download/file",
    kind: "download",
    description: "Download an earnings report file (A-share 10 credits, HK/US 20)",
  },
  "insight.research.list": {
    method: "POST",
    path: "/application/open-insight/broker-report/getList",
    kind: "json",
    description: "List broker research reports",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.research.download": {
    method: "GET",
    path: "/application/open-insight/broker-report/download/file",
    kind: "download",
    description: "Download broker research report",
  },
  "insight.foreign-report.list": {
    method: "POST",
    path: "/application/open-insight/foreign-report/getList",
    kind: "json",
    description: "List foreign reports",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.foreign-report.download": {
    method: "GET",
    path: "/application/open-insight/foreign-report/download/file",
    kind: "download",
    description: "Download foreign report",
    retry: "no-replay",
  },
  "insight.announcement.list": {
    method: "POST",
    path: "/application/open-insight/announcement/getList",
    kind: "json",
    description: "List A-share announcements",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.announcement.download": {
    method: "GET",
    path: "/application/open-insight/announcement/download/file",
    kind: "download",
    description: "Download A-share announcement file",
  },
  "insight.announcement-hk.list": {
    method: "POST",
    path: "/application/open-insight/announcement-hk/getList",
    kind: "json",
    description: "List HK announcements",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.announcement-hk.download": {
    method: "GET",
    path: "/application/open-insight/announcement-hk/download/file",
    kind: "download",
    description: "Download HK announcement file",
  },
  "insight.announcement-us.list": {
    method: "POST",
    path: "/application/open-insight/announcement-us/getList",
    kind: "json",
    description: "List US announcements",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.announcement-us.download": {
    method: "GET",
    path: "/application/open-insight/announcement-us/download/file",
    kind: "download",
    description: "Download US announcement file",
  },
  "insight.foreign-opinion.list": {
    method: "POST",
    path: "/application/open-insight/foreign-opinion/getList",
    kind: "json",
    description: "List foreign institution opinions",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.independent-opinion.list": {
    method: "POST",
    path: "/application/open-insight/independent-opinion/getList",
    kind: "json",
    description: "List foreign independent analyst opinions",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.independent-opinion.download": {
    method: "GET",
    path: "/application/open-insight/independent-opinion/download/file",
    kind: "download",
    description: "Download foreign independent opinion file",
  },
  "insight.official-account.list": {
    method: "POST",
    path: "/application/open-insight/officialAccount/getList",
    kind: "json",
    description: "List WeChat official account articles",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "insight.official-account.download": {
    method: "GET",
    path: "/application/open-insight/officialAccount/download/file",
    kind: "download",
    description: "Download WeChat official account article (txt/HTML)",
  },
  "insight.qa.list": {
    method: "POST",
    // The literal '&' is the vendor's path segment (Q&A-data), not a query separator.
    path: "/application/open-insight/Q&A-data/getList",
    kind: "json",
    description: "List investor Q&A (conference/interactive/survey) for a security",
    pagination: { enabled: true, maxPageSize: 500 },
  },
  "insight.report-image.list": {
    method: "POST",
    path: "/application/open-insight/report-image/getList",
    kind: "json",
    description: "Search research report images by keyword (returns chunkId + metadata)",
  },
  "insight.report-image.download": {
    method: "GET",
    path: "/application/open-insight/report-image/download/file",
    kind: "download",
    description: "Download a research report image by chunkId",
  },

  // ─── reference ───
  "reference.securities-search": {
    method: "POST",
    path: "/application/open-reference/securities/search",
    kind: "json",
    description: "Search GTS codes (securities)",
  },
  "reference.chiefs-search": {
    method: "POST",
    path: "/application/open-reference/chiefs/search",
    kind: "json",
    description: "Search chief analyst IDs by name / institution / team",
  },
  "reference.institution-search": {
    method: "POST",
    path: "/application/open-reference/institutions/search",
    kind: "json",
    description: "Search institution IDs by keyword (domestic broker / foreign / lead / opinion institution)",
  },
  "reference.official-account-search": {
    method: "POST",
    path: "/application/open-reference/officialAccount/search",
    kind: "json",
    description: "Search official account (WeChat public account) IDs by name / institution / category",
  },
  "reference.constant-category": {
    method: "GET",
    path: "/application/open-reference/constants/category",
    kind: "json",
    description: "List constant categories and their API usage scopes",
  },
  "reference.constant-list": {
    method: "POST",
    path: "/application/open-reference/constants/getList",
    kind: "json",
    description: "List all constant values of a category",
  },
  "reference.concept-search": {
    method: "POST",
    path: "/application/open-reference/concepts/search",
    kind: "json",
    description: "Search concept (theme) IDs by keyword",
  },
  "reference.sector-search": {
    method: "POST",
    path: "/application/open-reference/sectors/search",
    kind: "json",
    description: "Search sector IDs by keyword",
  },
  "reference.sector-constituents": {
    method: "POST",
    path: "/application/open-reference/sectors/constituents",
    kind: "json",
    description: "List constituent securities of a sector",
  },

  // ─── quote ───
  "quote.day-kline": {
    method: "POST",
    path: "/application/open-quote/kline/daily",
    kind: "json",
    description: "Query A-share historical daily kline (SH/SZ/BJ)",
    expects: "list",
  },
  "quote.day-kline-hk": {
    method: "POST",
    path: "/application/open-quote/kline-hk/daily",
    kind: "json",
    description: "Query HK stock historical daily kline (HK)",
    expects: "list",
  },
  "quote.day-kline-us": {
    method: "POST",
    path: "/application/open-quote/kline-us/daily",
    kind: "json",
    description: "Query US stock historical daily kline (NYSE/NASDAQ/AMEX)",
    expects: "list",
  },
  "quote.index-day-kline": {
    method: "POST",
    path: "/application/open-quote/index/kline/daily",
    kind: "json",
    description: "Query SH/SZ/BJ index daily kline",
    expects: "list",
  },
  "quote.minute-kline": {
    method: "POST",
    path: "/application/open-quote/kline/minute",
    kind: "json",
    description: "Query A-share minute kline (SH/SZ/BJ)",
    expects: "list",
  },
  "quote.realtime": {
    method: "POST",
    path: "/application/open-quote/quote/realtime",
    kind: "json",
    description: "Query realtime quote snapshot (A-share / HK / US)",
    expects: "list",
  },
  "quote.fund-flow": {
    method: "POST",
    path: "/application/open-quote/fund-flow/daily",
    kind: "json",
    description: "Query A-share daily fund flow (SH/SZ/BJ; small/medium/large/xlarge orders + main net inflow)",
    expects: "list",
  },

  // ─── fundamental ───
  "fundamental.income-statement": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/income-statement/accumulated",
    kind: "json",
    description: "Query A-share income statement (accumulated)",
  },
  "fundamental.income-statement-quarterly": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/income-statement/quarterly",
    kind: "json",
    description: "Query A-share income statement (quarterly)",
  },
  "fundamental.balance-sheet": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/balance-sheet/accumulated",
    kind: "json",
    description: "Query A-share balance sheet (accumulated)",
  },
  "fundamental.cash-flow": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/cash-flow-statement/accumulated",
    kind: "json",
    description: "Query A-share cash flow statement (accumulated)",
  },
  "fundamental.cash-flow-quarterly": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/cash-flow-statement/quarterly",
    kind: "json",
    description: "Query A-share cash flow statement (quarterly)",
  },
  "fundamental.income-statement-hk": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/income-statement/hk",
    kind: "json",
    description: "Query HK income statement (China GAAP)",
  },
  "fundamental.balance-sheet-hk": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/balance-sheet/hk",
    kind: "json",
    description: "Query HK balance sheet (China GAAP)",
  },
  "fundamental.cash-flow-hk": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/cash-flow-statement/hk",
    kind: "json",
    description: "Query HK cash flow statement (China GAAP)",
  },
  "fundamental.income-statement-us": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/income-statement/us",
    kind: "json",
    description: "Query US income statement",
  },
  "fundamental.balance-sheet-us": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/balance-sheet/us",
    kind: "json",
    description: "Query US balance sheet",
  },
  "fundamental.cash-flow-us": {
    method: "POST",
    path: "/application/open-fundamental/financial-report/cash-flow-statement/us",
    kind: "json",
    description: "Query US cash flow statement",
  },
  "fundamental.main-business": {
    method: "POST",
    path: "/application/open-fundamental/main-business",
    kind: "json",
    description: "Query main business composition",
  },
  "fundamental.valuation-analysis": {
    method: "POST",
    path: "/application/open-fundamental/valuation-analysis",
    kind: "json",
    description: "Query valuation analysis",
  },
  "fundamental.top-holders": {
    method: "POST",
    path: "/application/open-fundamental/capital-structure/top-holders",
    kind: "json",
    description: "Query top holders (top10 / top10 float)",
  },
  "fundamental.earning-forecast": {
    method: "POST",
    path: "/application/open-fundamental/earning-forecast",
    kind: "json",
    description: "Query earning forecast (consensus estimates)",
  },

  // ─── ai ───
  "ai.stock-summary.list": {
    method: "POST",
    path: "/application/open-ai/stock-summary/getList",
    kind: "json",
    description: "Stock highlights (refined research summary per security)",
  },
  "ai.knowledge-batch": {
    method: "POST",
    path: "/application/open-data/ai/search/knowledge/batch",
    kind: "json",
    description: "Batch knowledge search",
    retry: "no-replay",
  },
  "ai.knowledge-resource.download": {
    method: "GET",
    path: "/application/open-data/ai/resource/download",
    kind: "download",
    description: "Download knowledge resource",
  },
  "ai.security-clue.list": {
    method: "POST",
    path: "/application/open-ai/security-clue/getList",
    kind: "json",
    description: "List security clues",
    pagination: { enabled: true, maxPageSize: 500 },
  },
  "ai.one-pager": {
    method: "POST",
    path: "/application/open-ai/agent/one-pager",
    kind: "json",
    description: "Generate one pager",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.investment-logic": {
    method: "POST",
    path: "/application/open-ai/agent/investment-logic",
    kind: "json",
    description: "Generate investment logic",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.peer-comparison": {
    method: "POST",
    path: "/application/open-ai/agent/peer-comparison",
    kind: "json",
    description: "Generate peer comparison",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.earnings-review.get-id": {
    method: "POST",
    path: "/application/open-ai/agent/earnings-review-getid",
    kind: "json",
    description: "Get earnings review ID",
    retry: "no-replay",
  },
  "ai.earnings-review.get-content": {
    method: "POST",
    path: "/application/open-ai/agent/earnings-review-getcontent",
    kind: "json",
    description: "Get earnings review content",
  },
  "ai.theme-tracking": {
    method: "POST",
    path: "/application/open-ai/agent/theme-tracking",
    kind: "json",
    description: "Get theme tracking daily report",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.research-outline": {
    method: "POST",
    path: "/application/open-ai/agent/research-outline",
    kind: "json",
    description: "Get company research outline",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.hot-topic": {
    method: "POST",
    path: "/application/open-ai/hot-topic/getList",
    kind: "json",
    description: "List hot topic reports",
    pagination: { enabled: true, maxPageSize: 20 },
    retry: "no-replay",
  },
  "ai.management-discuss-announcement": {
    method: "POST",
    path: "/application/open-ai/management-discuss/from-announcement",
    kind: "json",
    description: "Management discussion from financial reports (half-year/annual)",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.management-discuss-earnings-call": {
    method: "POST",
    path: "/application/open-ai/management-discuss/from-earningsCall",
    kind: "json",
    description: "Management discussion from earnings calls",
    timeoutMs: 120_000,
    retry: "no-replay",
  },
  "ai.viewpoint-debate.get-id": {
    method: "POST",
    path: "/application/open-ai/agent/viewpoint-debate-getid",
    kind: "json",
    description: "Get viewpoint debate ID",
    retry: "no-replay",
  },
  "ai.viewpoint-debate.get-content": {
    method: "POST",
    path: "/application/open-ai/agent/viewpoint-debate-getcontent",
    kind: "json",
    description: "Get viewpoint debate content",
  },

  // ─── vault ───
  "vault.drive.list": {
    method: "POST",
    path: "/application/open-vault/drive/getList",
    kind: "json",
    description: "List vault drive files",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "vault.drive.download": {
    method: "GET",
    path: "/application/open-vault/drive/download/file",
    kind: "download",
    description: "Download vault drive file",
  },
  "vault.record.list": {
    method: "POST",
    path: "/application/open-vault/record/getList",
    kind: "json",
    description: "List voice recording transcriptions",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "vault.record.download": {
    method: "GET",
    path: "/application/open-vault/record/download/file",
    kind: "download",
    description: "Download voice recording transcription file",
  },
  "vault.my-conference.list": {
    method: "POST",
    path: "/application/open-vault/my-conference/getList",
    kind: "json",
    description: "List my conferences",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "vault.my-conference.download": {
    method: "GET",
    path: "/application/open-vault/my-conference/download/file",
    kind: "download",
    description: "Download my conference resource",
    retry: "no-replay",
  },
  "vault.wechat-message.list": {
    method: "POST",
    path: "/application/open-vault/wechatgroupmsg/list",
    kind: "json",
    description: "List WeChat group messages",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "vault.wechat-chatroom.list": {
    method: "POST",
    path: "/application/open-vault/wechatgroupmsg/chatroomId",
    kind: "json",
    description: "List WeChat group chatroom IDs",
    // Response is `{ total, list }` (server caps size at 50); auto-paginate by total.
    pagination: { enabled: true, maxPageSize: 50 },
  },
  "vault.stock-pool.list": {
    method: "POST",
    path: "/application/open-vault/stock-pool/getPoolList",
    kind: "json",
    description: "List user stock pool IDs and names",
  },
  "vault.stock-pool.stocks": {
    method: "POST",
    path: "/application/open-vault/stock-pool/getStockList",
    kind: "json",
    description: "List securities in stock pool(s)",
  },

  // ─── alternative ───
  "alternative.edb-search": {
    method: "POST",
    path: "/application/open-alternative/EDB/search",
    kind: "json",
    description: "Search industry indicator list by keyword",
  },
  "alternative.edb-data": {
    method: "POST",
    path: "/application/open-alternative/EDB/getData",
    kind: "json",
    description: "Get industry indicator time-series data by indicator ID list",
  },
  "alternative.concept-info": {
    method: "POST",
    path: "/application/open-alternative/concept/info",
    kind: "json",
    description: "Query latest concept (theme index) profile by conceptId",
    retry: "no-replay",
  },
  "alternative.concept-securities": {
    method: "POST",
    path: "/application/open-alternative/concept/securities",
    kind: "json",
    description: "Query concept (theme index) constituent securities, grouped",
    retry: "no-replay",
  },

  // ─── indicator (EDE: security-level data indicators) ───
  "indicator.search": {
    method: "POST",
    path: "/application/open-indicator/EDE/search",
    kind: "json",
    description: "Search data indicators by keyword (returns indicatorCode + params)",
    retry: "no-999999",
  },
  "indicator.cross-section": {
    method: "POST",
    path: "/application/open-indicator/EDE/cross-section",
    kind: "json",
    description: "Get cross-section data (multi-indicator x multi-security, single date)",
    retry: "no-999999",
  },
  "indicator.time-series": {
    method: "POST",
    path: "/application/open-indicator/EDE/time-series",
    kind: "json",
    description: "Get time-series data (multi-indicator x single-security OR single-indicator x multi-security)",
    retry: "no-999999",
  },
  // Note the path: the screener sits directly under open-indicator, NOT under
  // the EDE/ prefix its three siblings share.
  "indicator.screener": {
    method: "POST",
    path: "/application/open-indicator/screener",
    kind: "json",
    description: "Screen securities by an expression over indicator values (条件选股)",
    retry: "no-999999",
  },

  // ─── tool (open-tool: async file parsing) ───
  "tool.file-parse.submit": {
    method: "POST",
    path: "/application/open-tool/file-parse/submit",
    kind: "upload",
    description: "Submit a PDF for parsing (multipart upload), returns taskId",
    // Billed per page (0.8/页) at submit time, and the upload itself can take
    // minutes on a 100MB file — never replay it, and don't let the default 30s
    // headers timeout kill an in-flight upload.
    timeoutMs: 300_000,
    retry: "no-replay",
    // Probed 2026-07-25: taskId comes back as a string today. Guard anyway — if it
    // ever arrives as a bare number, rounding would strand a paid parse job.
    bigIntFields: ["taskId"],
  },
  "tool.file-parse.result": {
    method: "POST",
    path: "/application/open-tool/file-parse/result",
    kind: "download",
    description: "Fetch a file-parse result ZIP by taskId (140001 = still generating)",
  },
}

export const ENDPOINTS: Record<string, EndpointDefinition> = Object.fromEntries(
  Object.entries(ENDPOINT_DEFS).map(([key, def]) => [key, { key, ...def }]),
)

/** Flat catalog of every registered endpoint, for `raw list` discoverability
 * (so `raw call` doesn't require memorizing endpoint keys). */
export function listEndpoints(): Array<{ key: string; method: string; path: string; description: string }> {
  return Object.values(ENDPOINTS).map(({ key, method, path, description }) => ({ key, method, path, description }))
}
