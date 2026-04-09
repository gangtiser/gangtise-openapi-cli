export interface EndpointDefinition {
  key: string
  method: "GET" | "POST"
  path: string
  kind: "json" | "download"
  description: string
  pagination?: {
    enabled: true
    maxPageSize: number
  }
}

export const ENDPOINTS = {
  authLogin: {
    key: "auth.login",
    method: "POST",
    path: "/application/auth/oauth/open/loginV2",
    kind: "json",
    description: "Get access token",
  },

  lookupResearchAreas: {
    key: "lookup.research-areas.list",
    method: "GET",
    path: "/guide/research-area-local",
    kind: "json",
    description: "List research areas from local docs",
  },
  lookupBrokerOrgs: {
    key: "lookup.broker-orgs.list",
    method: "GET",
    path: "/guide/broker-orgs-local",
    kind: "json",
    description: "List broker orgs from local docs",
  },
  lookupMeetingOrgs: {
    key: "lookup.meeting-orgs.list",
    method: "GET",
    path: "/guide/meeting-orgs-local",
    kind: "json",
    description: "List meeting orgs from local docs",
  },
  lookupIndustries: {
    key: "lookup.industries.list",
    method: "GET",
    path: "/guide/industries-local",
    kind: "json",
    description: "List industries from local docs",
  },
  lookupRegions: {
    key: "lookup.regions.list",
    method: "GET",
    path: "/guide/regions-local",
    kind: "json",
    description: "List regions from local docs",
  },
  lookupAnnouncementCategories: {
    key: "lookup.announcement-categories.list",
    method: "GET",
    path: "/guide/announcement-categories-local",
    kind: "json",
    description: "List announcement categories from local docs",
  },
  lookupIndustryCodes: {
    key: "lookup.industry-codes.list",
    method: "GET",
    path: "/guide/industry-codes-local",
    kind: "json",
    description: "List Shenwan industry codes from local docs",
  },

  insightOpinionList: {
    key: "insight.opinion.list",
    method: "POST",
    path: "/application/open-insight/chief-opinion/getList",
    kind: "json",
    description: "List chief opinions",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightSummaryList: {
    key: "insight.summary.list",
    method: "POST",
    path: "/application/open-insight/summary/v2/getList",
    kind: "json",
    description: "List summaries",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightSummaryDownload: {
    key: "insight.summary.download",
    method: "GET",
    path: "/application/open-insight/summary/v2/download/file",
    kind: "download",
    description: "Download summary file",
  },
  insightRoadshowList: {
    key: "insight.roadshow.list",
    method: "POST",
    path: "/application/open-insight/schedule/roadshow/getList",
    kind: "json",
    description: "List roadshows",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightSiteVisitList: {
    key: "insight.site-visit.list",
    method: "POST",
    path: "/application/open-insight/schedule/site-visit/getList",
    kind: "json",
    description: "List site visits",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightStrategyList: {
    key: "insight.strategy.list",
    method: "POST",
    path: "/application/open-insight/schedule/strategy-meeting/getList",
    kind: "json",
    description: "List strategy meetings",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightForumList: {
    key: "insight.forum.list",
    method: "POST",
    path: "/application/open-insight/schedule/forum/getList",
    kind: "json",
    description: "List forums",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightResearchList: {
    key: "insight.research.list",
    method: "POST",
    path: "/application/open-insight/broker-report/getList",
    kind: "json",
    description: "List broker research reports",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightResearchDownload: {
    key: "insight.research.download",
    method: "GET",
    path: "/application/open-insight/broker-report/download/file",
    kind: "download",
    description: "Download broker research report",
  },
  insightForeignReportList: {
    key: "insight.foreign-report.list",
    method: "POST",
    path: "/application/open-insight/foreign-report/getList",
    kind: "json",
    description: "List foreign reports",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightForeignReportDownload: {
    key: "insight.foreign-report.download",
    method: "GET",
    path: "/application/open-insight/foreign-report/download/file",
    kind: "download",
    description: "Download foreign report",
  },
  insightAnnouncementList: {
    key: "insight.announcement.list",
    method: "POST",
    path: "/application/open-insight/announcement/getList",
    kind: "json",
    description: "List announcements",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  insightAnnouncementDownload: {
    key: "insight.announcement.download",
    method: "GET",
    path: "/application/open-insight/announcement/download/file",
    kind: "download",
    description: "Download announcement file",
  },

  quoteDayKline: {
    key: "quote.day-kline",
    method: "POST",
    path: "/application/open-quote/kline/daily",
    kind: "json",
    description: "Query daily kline",
  },
  fundamentalIncomeStatement: {
    key: "fundamental.income-statement",
    method: "POST",
    path: "/application/open-fundamental/financial-report/income-statement",
    kind: "json",
    description: "Query income statement",
  },
  fundamentalMainBusiness: {
    key: "fundamental.main-business",
    method: "POST",
    path: "/application/open-fundamental/main-business",
    kind: "json",
    description: "Query main business composition",
  },
  fundamentalValuationAnalysis: {
    key: "fundamental.valuation-analysis",
    method: "POST",
    path: "/application/open-fundamental/valuation-analysis",
    kind: "json",
    description: "Query valuation analysis",
  },

  aiKnowledgeBatch: {
    key: "ai.knowledge-batch",
    method: "POST",
    path: "/application/open-data/ai/search/knowledge/batch",
    kind: "json",
    description: "Batch knowledge search",
  },
  aiKnowledgeResource: {
    key: "ai.knowledge-resource.download",
    method: "GET",
    path: "/application/open-data/ai/resource/download",
    kind: "download",
    description: "Download knowledge resource",
  },
  aiSecurityClue: {
    key: "ai.security-clue.list",
    method: "POST",
    path: "/application/open-ai/security-clue/getList",
    kind: "json",
    description: "List security clues",
    pagination: { enabled: true, maxPageSize: 500 },
  },
  aiOnePager: {
    key: "ai.one-pager",
    method: "POST",
    path: "/application/open-ai/agent/one-pager",
    kind: "json",
    description: "Generate one pager",
  },
  aiInvestmentLogic: {
    key: "ai.investment-logic",
    method: "POST",
    path: "/application/open-ai/agent/investment-logic",
    kind: "json",
    description: "Generate investment logic",
  },
  aiPeerComparison: {
    key: "ai.peer-comparison",
    method: "POST",
    path: "/application/open-ai/agent/peer-comparison",
    kind: "json",
    description: "Generate peer comparison",
  },
  aiCloudDiskList: {
    key: "ai.cloud-disk.list",
    method: "POST",
    path: "/application/open-ai/drive/getList",
    kind: "json",
    description: "List AI cloud disk files",
    pagination: { enabled: true, maxPageSize: 50 },
  },
  aiCloudDiskDownload: {
    key: "ai.cloud-disk.download",
    method: "GET",
    path: "/application/open-ai/drive/download/file",
    kind: "download",
    description: "Download AI cloud disk file",
  },
} as const satisfies Record<string, EndpointDefinition>

export const ENDPOINT_REGISTRY: Record<string, EndpointDefinition> = Object.values(ENDPOINTS).reduce<Record<string, EndpointDefinition>>((accumulator, endpoint) => {
  accumulator[endpoint.key] = endpoint
  return accumulator
}, {})
