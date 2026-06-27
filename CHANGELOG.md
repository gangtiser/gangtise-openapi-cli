# Changelog

本项目完整版本历史。README 顶部仅展示最近几个版本。

### v0.20.0 — 2026-06-26

**新增接口**
- `insight announcement-us list` / `download` — 美股公司公告列表与下载（`--security TSLA.O`、`--category`〔分类用 `reference constant-list --category usShareAnnouncementCategory`，美股独立的 `103980xxx` 段〕、`--search-type`、`--rank-type`、下载 `--file-type 1` 原始 PDF / `2` Markdown）；自动翻页，单页上限 50
- `ai stock-summary` — 个股看点（精炼投研总结）：`--security` 传具体代码（A股/港股，可重复，单次最多 6000）或市场关键词 `aShares` / `hkStocks` 拉全市场；无看点的证券不返回、不扣分
- `fundamental income-statement-us` / `balance-sheet-us` / `cash-flow-us` — 美股三大财务报表（参数同其他财报：`--security-code` / `--period` / `--report-type` / `--fiscal-year` / `--field` 等）
- `reference chiefs-search` — 首席分析师 ID 搜索（`--keyword` 按姓名/机构/团队匹配，`--top` 默认 10）；用于 `insight opinion list --chief` 的入参

**变更**
- `insight announcement-hk download` 新增 `--file-type`（`1` 原始（默认）/ `2` Markdown），此前无格式选项

**行为变更（注意）**
- ⚠️ `auth login` / `auth status` 默认脱敏 access token：`--format json` 输出里 `authorization` 与 `cache.accessToken` 显示为 `<redacted>`，仅保留过期时间 / 用户名 / 产品码 / uid 等非敏感字段。**依赖 `auth login` 原始 token 输出的脚本会拿到 `<redacted>`**，需改用 `auth login --show-token` 获取明文。

**修复（安全）**
- `auth status` / `auth login` token 脱敏：按凭证字段名模式匹配（`token`/`key`/`secret`/`password`/`credential`），覆盖 `apiKey`/`privateKey`/`refreshToken` 等任何可能携带的凭证字段
- 自愈守卫：同时设 `GANGTISE_TOKEN` + AK/SK 时，注入 token 失效后重新登录不再被旧 token 短路，重试改用登录拿到的新 token

**修复（数据正确性 / 健壮性）**
- ⚠️ **CSV 负数不再被破坏**（影响所有 CSV 导出）：此前防公式注入会把负数（如跌幅 `-3.5`）加 `'` 前缀变成文本，Excel/pandas 无法参与计算；现仅对非有限数字的可疑串（`=`/`@`/`-1+cmd` 等）加前缀，合法数字原样输出
- 自动翻页改为 fail-soft：某页遇不可重试错误（限流 `903301` 等）不再丢弃已取的全部数据，返回已取页 + `partial` / `failedPages` 标记，并在首错后停止继续请求（避免撞限流多烧配额）
- 下载文件名 fallback（服务端 `Content-Disposition`）补清洗：含 `/`、`:` 等字符的文件名不再写到意外路径
- `ai stock-summary` / `ai knowledge-batch` 缺 `--security` / `--query` 时本地报错，不再发空请求（stock-summary 借此避免被后台当全市场误扣积分）
- `ai hot-topic` `--no-with-related-securities` / `--no-with-close-reading` 改为显式发 `false`（语义更明确，不依赖"字段缺失=排除"的隐含约定）

**修复（indicator 适配 EDE 后台新结构）**
- `indicator cross-section` / `time-series` 适配后台改版的返回结构（字段名加 `List` 后缀 `securityCodeList/indicatorCodeList/…`、截面 `values` 改二维 `[指标][证券]`）：此前后台改结构后 CLI 拍平失配、退化成原始矩阵，现恢复 `{date, security, name, 指标:值}` 宽表。配合后台同步变化——无数据从 `999999` 报错改为返回 `null`（截面不再 500、不丢行），缺必填参数从笼统 `410106` 改为直接指明缺哪个参数

### v0.19.0 — 2026-06-24

**新增接口（Indicator · 证券级数据指标 EDE）**
- `indicator search` — 按名称搜索证券级数据指标，返回 `indicatorCode` 及可传参数 `parameterList`（含 `required` 必填标记与枚举）；取数前必先 search 拿 code，绝不猜编码
- `indicator cross-section` — 指标截面数据（多指标 × 多证券，单日快照）：`--indicator` / `--security`（均可重复）/ `--date` / `--currency` / `--scale` / `--indicator-param`
- `indicator time-series` — 指标时间序列（多指标 × 单证券 或 单指标 × 多证券，按区间）：另有 `--start-date` / `--end-date` / `--calendar-type`（`ND`/`TD`/`WD`）
- 复权等指标专属参数用 `--indicator-param "code:key=value"`，参数 key 与取值以 search 的 `parameterList` 为准（行情复权键为 `adjustmentType`：`1` 不复权 / `2` 前复权 / `3` 后复权）
- 很多指标有必填参数，默认调用会报 `410106`（缺必填参数）：N 期统计补 `periodNum`、区间/周期类补 `startDate`、年度/分红类补 `fiscalYear`；`999999` 多为「该证券公司类型/报告期无数据」而非系统故障。详见 `gangtise-openapi/references/commands/indicator.md`

**修复**
- `vault stock-pool-stocks --pool-id <id>` 过滤失效：此前因选项默认值 `["all"]` 泄漏，传具体 pool id 仍返回全部股票池证券；现已修复——传 id 精确过滤，省略则默认全量
- `auth` 缺凭证报错补充跨 shell（bash/zsh/fish）的 `export` 提示

**文档**
- README / SKILL 补充 indicator 命令组与取数最佳实践；`official-account` 命令文档补全

### v0.18.0 — 2026-06-17

**新增接口（Insight · 产业公众号资讯）**
- `insight official-account list` — 查询公众号资讯列表：支持 `--keyword`（需用数据中的具体词，非整句白话）/ `--account-id`（公众号 ID）/ `--security` / `--category`（文章类型枚举：`news`/`law`/`report`/`view`/`data`/`event`/`meeting`/`notice`/`recruit`/`investEdu`/`brand`/`notes`/`other`）/ `--industry`（`citicIndustry`/`swIndustry` 行业 ID）/ `--search-type`（`1` 标题 / `2` 全文）/ `--rank-type`（`1` 综合 / `2` 时间倒序）；返回含模型生成摘要 `summary` 及关联行业/题材/证券列表
- `insight official-account download --article-id <id>` — 下载公众号文章：`--file-type 1` txt（默认）/ `2` HTML

### v0.17.0 — 2026-06-15

**接口变更（Breaking）**
- 日程类命令（`roadshow` / `site-visit` / `strategy` / `forum` list）改为各自只暴露 API spec 支持的筛选选项，移除原先一刀切多出的无效选项：`strategy` 仅保留 `--institution` / `--location`；`forum` 仅保留 `--research-area` / `--location`；`site-visit` 移除 `--participant-role` / `--broker-type`；`roadshow` 移除 `--object`。传不支持的选项现由 commander 直接报 `unknown option`（此前会静默发送、服务端返回空结果）
- `insight announcement list` 移除无效的 `--announcement-type`（服务端忽略、恒返全量）；A 股公告分类筛选用 `--category`（`aShareAnnouncementCategory` 常量 ID）

**说明 / 修正**
- `--industry` 用 `citicIndustry` 码（`1008001xx`，全命令通用）；`--research-area` 用 `gangtiseIndustry` 码（行业 `1008001xx` + 宏观/策略/固收/金工/海外等方向 `122000xxx`）。详见 `gangtise-openapi/references/commands/reference-and-lookup.md`
- 日程类 `--location`（domesticCity）服务端过滤已生效（v0.16.0 时曾未生效）

### v0.16.0 — 2026-06-12

**新增接口（参考数据 · 常量查询，均免积分）**
- `reference constant-category` — 查询常量分类：全量导出常量分类及各分类适用于哪些接口的哪些参数（7 个分类：中信/申万/Gangtise 行业、国内城市、A股/港股公告分类、区域）
- `reference constant-list --category <code>` — 查询常量值：按分类导出全量常量（`constantId` / `constantName`，树形分类含 `children` 嵌套）
- `reference concept-search --keyword <kw>` — 查询题材 ID：按名称/拼音/分组名搜索，返回 `conceptId`（供 `alternative concept-info / concept-securities`、`ai theme-tracking` 使用）
- `reference sector-search --keyword <kw>` — 查询板块 ID：返回 `sectorId` + `hierarchy` 层级路径
- `reference sector-constituents --sector-id <id>` — 查询板块成分股：返回该板块全量成分股（`gtsCode` / `gtsName`）；注意 sectorId 必须来自 sector-search，题材 conceptId 查不到成分

**接口变更（Breaking）**
- 移除已被新 API 覆盖的 6 个本地 lookup 子命令及静态数据：`lookup research-area / industry / region / announcement-category / theme-id / industry-code list`，请改用 `reference constant-list` / `reference concept-search` / `reference sector-constituents`（申万行业代码 `821xxx.SWI` 全量：`sector-constituents --sector-id 2000000014`，即申万一级行业指数板块）
- `lookup` 仅保留 2 个 API 未覆盖的本地表：`broker-org` / `meeting-org`
- 路演/调研/策略会/论坛 list 新增 `--location <id>` 按城市过滤（domesticCity 常量 ID；服务端过滤 v0.17.0 起已生效）

### v0.15.0 — 2026-05-29

**新增接口**
- `alternative concept-info` — 题材指数基本信息：返回题材整体画像（定义 / 投资逻辑 / 行业空间 / 竞争格局 / 催化事件）。按 `--concept-id` 查询，仅返回最新截面数据，不支持历史回溯
- `alternative concept-securities` — 题材指数成分股（题材深度 F8）：按分组结构返回当前成分股，每只含是否重点个股 `isKey` 与纳入理由 `inclusionReason`。按 `--concept-id` 查询

**接口变更**
- `quote index-day-kline` 返回字段新增 `securityName`（指数名称，如"上证指数"）

> `--concept-id` 与主题跟踪 `ai theme-tracking --theme-id` 共用同一套题材 ID 体系，可用 `gangtise lookup theme-id list` 按名称查询（如 机器人 → `121000130`）。

### v0.14.4 — 2026-05-29

**Bug fix（全市场 K 线分片容错）**
- `quote day-kline --security all` 等全市场查询的日期分片改为容错：部分分片失败时返回已成功分片的数据并标记 `partial: true` + `failedShards`（失败的日期区间），同时向 stderr 告警；只有全部分片失败才抛错。此前为 fail-fast，单片失败会让整次查询失败，或在异常路径上被误判为空结果。

### v0.14.3 — 2026-05-29

**性能 / 健壮性**
- 标题缓存按端点封顶（5000 条/端点）并清理过期项，修复 `title-cache.json` 无上限增长（曾达 ~58MB）拖慢启动的问题
- 下载接口遇鉴权失效（`8000014` / `8000015`）自动刷新 token 并重试一次（此前仅普通 JSON 调用具备 token 自愈）
- CLI handler 抽出 `emit` / `withClient` 公共封装去除重复样板；CSV 转义逻辑去重；翻页与 K 线分片统一走 `GANGTISE_PAGE_CONCURRENCY` 并发控制
- 补齐多个 core 模块的单元测试

### v0.14.2 — 2026-05-22

**Bug fix（A 股 / HK 全市场 K 线同源问题）**
- `quote day-kline --security all` 由 2 天/片改为 **1 天/片**（A 股全市场单日约 5500 行）
- `quote day-kline-hk --security all` 由 3 天/片改为 **2 天/片**（港股全市场单日约 2770 行）
- 根治性修复：`callKlineWithSharding` 在 `--security all` 路径上，若用户未显式传 `--limit`，强制写入 `limit: 10000`（API 上限），不再走默认 6000——这样即便分片日数估算偏大，每个 shard 也能拿满 10K 行。用户自己传的 `--limit` 仍然保留生效。

### v0.14.1 — 2026-05-22

**Bug fix**
- `quote day-kline-us --security all` 分片由 2 天/片改为 **1 天/片**。美股全市场单日约 5800 行，原 2 天/片会在第一个 shard 命中默认 `--limit 6000` 上限，导致 shard 内第二日数据被截断到几百行。改 1 天/片后每个 shard 数据完整。

### v0.14.0 — 2026-05-22

**新增接口**
- `quote realtime` — 个股实时行情快照，单接口同时覆盖 A 股 / 港股 / 美股；支持代码混合传入或市场关键字（`aShares` / `hkStocks` / `usStocks`）批量查询全市场
- `quote day-kline-us` — 美股历史日 K 线，数据范围 NYSE / NASDAQ / AMEX；支持 `--security all` 全市场（CLI 自动按 1 天/片切分并发拉取，美股全市场单日约 5800 行）

**接口变更**
- `quote day-kline` / `quote day-kline-hk` 明确仅返回**历史**日 K 线，不包含盘中实时数据；当日数据入库时间：A 股 ~15:30 / 港股 ~16:30（北京时间）。盘中实时请走 `quote realtime`
- `fundamental valuation-analysis` 返回字段移除 `p10` / `p25` / `p75` / `p90`（仍保留 `value` / `percentileRank` / `average` / `median` / `upper1Std` / `lower1Std`）

### v0.13.0 — 2026-05-15

**新增接口**
- `fundamental income-statement-hk / balance-sheet-hk / cash-flow-hk` — 港股三大报表（中国会计准则）
- `alternative edb-search` — 行业指标列表搜索（按关键词匹配指标名称，返回 indicatorId 等元信息）
- `alternative edb-data` — 行业指标时序数据（批量按 indicatorId 拉取时间序列，最多 10 个指标）
- `vault stock-pool-list` — 查询用户自选股股票池列表（poolId / poolName）
- `vault stock-pool-stocks` — 查询股票池证券明细（支持 `--pool-id all` 全量查询）

**接口变更**
- `fundamental income-statement / balance-sheet / cash-flow / income-statement-quarterly / cash-flow-quarterly` 名称调整为 A股报表（路径不变）
- `ai management-discuss-announcement` `--dimension` 新增 `all` 选项，返回报告中完整的管理层讨论内容（内容可能较长）
- `vault wechat-message-list` 新增 `--security <code>` 参数（按证券代码过滤），返回结果增加 `securityList` 字段

### v0.12.0 — 2026-05-10

**性能 / 架构**
- 翻页并行化：自动翻页接口拉到首页 `total` 后，剩余页通过 `Promise.all` 并发请求（默认并发 5，`GANGTISE_PAGE_CONCURRENCY` 可调）
- 共享 `undici.Agent`：所有请求复用连接池（keep-alive 60s，max 16 连接），避免重复 TLS 握手
- 流式下载：`--output` 指定时二进制响应直接 `pipeline` 到磁盘，不再走内存 `Uint8Array`
- 流式输出：`--format jsonl/csv --output xxx` 且 ≥1000 行时逐行写盘
- Token 内存缓存：Token 在进程内不再每次读盘
- 自动重试：5xx / `ECONNRESET` / `ETIMEDOUT` / `999999` 自动指数退避重试 2 次
- Token 自愈：8000014/8000015 自动重新登录并重试一次
- 异步轮询退避：`earnings-review` / `viewpoint-debate` 轮询从固定 15s 改为 5→8→13→20→30s 指数退避
- K线自动分片：`quote day-kline --security all` 等全市场查询自动按日期切分并发执行
- 标题缓存：原"读全文→改→写全文"改为内存快照 + 原子写入（temp+rename）

**调试 / 可观测性**
- 新增 `--verbose` / `GANGTISE_VERBOSE=1`：打印每个请求的耗时、状态码、响应字节数到 stderr

### v0.11.1 — 2026-05-10

**新增接口**
- `insight announcement-hk list/download` — 查询/下载港股公告
- `insight foreign-opinion list` — 查询外资机构观点（外资券商）
- `insight independent-opinion list/download` — 查询/下载外资独立分析师观点
- `reference securities-search` — GTS Code 搜索（按名称/代码/拼音多维度匹配证券）

**接口变更**
- `insight summary download` 新增可选 `--file-type`（`1`=原始内容 / `2`=HTML），仅影响来源为会议平台的纪要
- `insight announcement list/download` 名称调整为"查询A股公告列表/下载A股公告文件"（路径不变）
- `insight opinion list` 名称调整为"查询内资机构观点列表"（路径不变）

### v0.11.0 — 2026-04-17

- 新增 `ai viewpoint-debate` / `viewpoint-debate-check` — 观点PK（异步）
- 新增 `ai management-discuss-announcement` / `management-discuss-earnings-call` — 管理层讨论

### v0.10.9 — 2026-04-10

- 修复信封检测、版本更新检查、端点去重
- 新增 `quote index-day-kline` 指数日K线
- 新增 `vault wechat-message-list` / `wechat-chatroom-list` 群消息

