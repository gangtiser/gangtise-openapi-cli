---
name: gangtise-openapi
version: "0.28.3"
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下 / 钢尼斯 / gtIC（Gangtise 语音误识别）

  **适用**：原始数据导出、批量 jsonl/csv、下载 PDF/MD、行情 K 线、财务报表、估值指标、证券级数据指标（EDE 截面/时序）、AI 能力（一页通/投资逻辑/同业对比/个股看点·投研总结/投研线索/业绩点评/观点PK·多空辩论/主题跟踪/热点话题/管理层讨论/调研提纲/知识库搜索）、云盘文件管理（Vault）

  **不适用**：不脱离 OpenAPI 自行撰写研报、编造投研结论或做自由问答——观点总结、多空 PK 等 AI 产物本 skill 只经由 Gangtise 平台 AI 接口获取，不自行生成

  **前置**：依赖 gangtise CLI，未安装时提示用户 `npm install -g gangtise-openapi-cli`
---

# Gangtise OpenAPI CLI

> **详细参数 → `references/commands/<group>.md`**（按需 Read）
> **响应字段 → `references/response-schema.md`** ｜ **典型示例 → `references/examples.md`**
> **高频 ID → `references/lookup-ids.md`** ｜ **K 线/财务字段 → `references/fields.md`**

## 必备规则

1. **`--format json`**：列表/数据类必加。AI 内容生成（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `*-check`）也加 json，但呈现时**直接取 `content` 字段**，不要展示 JSON 包装层。
2. **opaque ID**：先读 `references/lookup-ids.md`；找不到再按类型查：行业/区域/公告分类/城市 → `reference constant-list --category <分类>`（分类代码用 `reference constant-category` 查）；题材 → `reference concept-search --keyword <名>`；板块 → `reference sector-search --keyword <名>`；申万 `--gts-code` 行业代码全量 → `sector-search --keyword 申万一级行业指数` 取指数数据板块层级的 sectorId 再 `sector-constituents`；券商/牵头/观点机构（按名称找 ID）→ `reference institution-search --keyword <名> [--category ...]`（服务端搜索，返回 `institutionId` + `usageScopes` 标明该 ID 用于哪个接口的哪个参数；覆盖 `--broker` / `--institution` 全部 5 类机构，含 `foreignOpinionInstitution`）——仅当要**全量枚举**时才用本地表 `gangtise lookup broker-org/meeting-org list`（institution-search 是搜索型：top≤10、非全量）。**绝不猜测**。
3. **公司名 → 证券代码**：先查下方速查表（5 只 mega-cap），其余一律 `gangtise reference securities-search --keyword <名> --category stock` 取 `list[0].gtsCode`。
4. **时间格式**：datetime `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date `YYYY-MM-DD`。
5. **多值参数**：优先重复传（最稳、最明确）：`--security 600519.SH --security 000858.SZ`。CLI 也支持半/全角逗号分隔（`args.ts` 为语音输入容错），但重复传不易被 shell 吞。
6. **K 线"最近 N 条"**：必须用 `--start-date`/`--end-date` 拉日期范围，从结果按 `tradeDate` 取尾部最近 N 条。**不要只用 `--limit N`**（截取的是窗口开头）。
6.1. **日 K 仅历史**：`day-kline` / `day-kline-hk` / `day-kline-us` **不返回盘中实时数据**。当日数据入库时间：A 股 ~15:30 / 港股 ~16:30 / 美股 ~07:00（北京时间）。需要盘中快照请走 `quote realtime`。
6.2. **多标的日 K 不自动分片**：只有 `--security all` 才按日切片提额；显式传多个 `--security` 时走单请求（默认 `--limit 6000` / 上限 10000）。**v0.23.0 起：返回行数撞上 `--limit` 时结果会标 `partial`、退出码 3、stderr 警告**（不再静默截断；`--limit` 超 10000 本地直接报错）。仍建议先估 标的数 × 交易日数，接近/超 6000 → 逐只分开拉、或显式 `--limit 10000` 并按日期区间分批。
7. **CLI 已内置自动化，不要手动复刻**：
   - 翻页 → 首页拿 total 后剩余页并发拉取
   - K 线 `--security all` 跨日期 → 自动按日切片并合并
   - 5xx / `429` / 网络错误 / `999999` → 自动指数退避重试（🔴 贵档端点例外：仅连接失败 / 429 / token 自愈重试，5xx/超时不重放防重复扣分，v0.26.0；`indicator` 端点对 `999999` 不重试——该码=查询无数据，v0.27.0）
   - Token 失效（`0000001008` / `999002`，含已废弃的 `8000014`/`8000015`）→ 自动重新登录并重试一次；凭证错 `999011` → **不重试**（AK/SK 不对不会自己好），查环境变量
8. **参数命名差异**：Insight/Quote/Vault 用 `--security`，Fundamental/AI 用 `--security-code`（例外：`ai stock-summary` 用 `--security`，`ai security-clue` 用 `--gts-code`）。
9. **调试**：`--verbose` 或 `GANGTISE_VERBOSE=1` 打印每个请求的耗时/字节数到 stderr。
10. **`--field` 字段名必须核对，不确定就别传**（返回全量最稳）：`quote realtime` / `fundamental main-business` / `valuation-analysis` 遇到不存在的字段名时，上游只丢**值**、字段名照请求**回显**，按位置拍平会把值贴到错误的字段上（实测 realtime 传 `close`——它没有这个字段——换手率 28.5573 被贴成 `close`，茅台真实价 1297.41）。v0.28.3 起 CLI 检测到长度不匹配直接报错（退出码 1）：**带 `--field` 的命令看到这个报错，先去 `references/fields.md` 核对字段名**（没有 `--field` 的命令如 `alternative edb-data` 报此错则是上游响应结构异常，报障时若报错末尾附了 `（trace …）` 就一并带上）。另：realtime **无 `close`**（用 `latestPrice`）、**无市值**（总市值走 `indicator cross-section --indicator qte_mkt_cptl`，仅 A 股）。

## 工作流（3 步）

```
意图 → 命令（路由表）  →  执行（pre-flight + 拼参数）  →  呈现（按响应模式）
```

### Pre-flight（执行前必过）

🔴 **需用户确认**：
- `gangtise auth status` 未登录 → 提示配置 AK/SK 并中止
- 多个命令同时匹配 → 复述理解让用户挑（如"搜索研报" → research list 还是 knowledge-batch？）
- 用户说"全部 / 全量 / 全市场" → 确认量级再拉：省略 `--size` 就是拉全量（自动翻页，上限 1000 页）；先 `--size 1` 看 stderr 的 `Total: N` 再决定（探量这步别加 `--format json`——json 下不打 `Total` 行）；全市场/跨一年分片等大批量可 `GANGTISE_PAGE_CONCURRENCY=10` 提速（默认 5，同时管翻页与 K 线分片）
- **高积分操作先确认**：任何 50 积分/次及以上、或"按条 × 大批量"（如 `stock-summary` 全市场数千只、`opinion` 全量翻页、`concept-info` 500/次）→ 先估总积分告知用户再执行（单价见下「积分计费速查」）
- 下载**必选**格式未定才问：`independent-opinion --file-type`（必选）、`vault record/my-conference --content-type`（record 三种 original/asr/summary、my-conference 两种 asr/summary）；其余 download 有默认（多为 `1`=PDF/原始），用户没提格式就用默认、不必问
- list→download 用户没指定具体文件 → 展示前 10 条让用户挑

🟡 **自行判断**：
- 公司名 → 先速查表，否则 `reference securities-search`
- opaque ID → 先 `references/lookup-ids.md`
- 模糊时间词 → 查"时间词映射"
- 无时间范围且用户没要求全量 → 主动加 `--size 200` 兜底（不必问）；注意 CLI 省略 `--size` 会拉全量
- 预估结果 >200 行 → 别全量 `--format json` 引进上下文，改 `--format jsonl --output <file>` 落盘（CLI ≥1000 行自动流式、stdout 只回显文件路径），再 `wc -l` + `head` 采样呈现
- 路由到 AI 同步生成命令 → 7 个 agent 类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，无需前缀；`stock-summary` / `hot-topic` 仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。**贵档端点超时/5xx 已不再自动重试**（v0.26.0；重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调仍会**再扣一次**（实测无缓存豁免），所以一次调用给足超时比失败重跑省钱。`earnings-review` / `viewpoint-debate` 是异步（`--wait` 或 `*-check` 轮询），不吃这个超时
- "AI速记/智能摘要/会议纪要"→`summary`、"原始文件/原文件"→`original`、"语音识别/转写文本/ASR"→`asr` — 用户已明示时直接映射 content-type，不必问

### 积分计费速查

"免费"=0 积分；**只列单价**，数据范围（可查多久）随账号等级不同、不在此列。

- **免费**：所有 `quote` 行情、`fundamental` 报表/主营/估值/股东（**盈利预测除外**）、`reference`/`constant` 查询（含 `official-account-search`）、`alternative edb-search`、`vault`（record/wechat/股票池/drive/AI云盘）、`insight report-image list`
- **0.1/条 list**：research / foreign-report / official-account / announcement(A/港/美) / summary / qa 的 list、`vault my-conference-list`；`insight report-image download` 0.1/张
- **按条（观点/含详情类 list）**：independent-opinion list 与 `ai security-clue` 5；roadshow/site-visit/strategy/forum list 20；opinion / foreign-opinion list 30；`fundamental earning-forecast` 0.5；`ai stock-summary` 3（无看点的证券不返回也不扣）；`alternative edb-data` 30
- **各 download（/篇）**：announcement / official-account / research 10；announcement-hk / announcement-us 20；independent-opinion 30；summary / foreign-report / my-conference 50
- 🔴 **按次贵**：`ai knowledge-batch` 10、`management-discuss-*` 10；AI Agent（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `earnings-review` / `viewpoint-debate` / `theme-tracking`）**50/次**；`ai hot-topic` 50/篇
- 🔴 **极贵**：`alternative concept-info` / `concept-securities` **500/次**
- ⚠️ **同参数重复调用不免费**：按次计费无缓存命中豁免（2026-07-11 实测 `one-pager` 重复调用每次扣分，即使秒回缓存内容）——生成类结果拿到后自行留存复用，别为"刷新"重调；CLI 已对上述 🔴 贵档端点关闭 5xx/超时自动重放（v0.26.0），50/篇 的 `summary` / `foreign-report` / `my-conference` download 同样不重放（v0.27.0），正是为防重复扣分
- **按单元格**：`indicator cross-section` / `time-series`（A股 0.05 / 港股 0.1 / 美股 0.2 积分每 100 单元格，见 `indicator.md`）；`ai knowledge-resource-download` 按下游资源计费

### 下载规则（`--file-type` / `--content-type`）

| 命令 | 参数 | 取值 |
|------|------|------|
| `insight research download` | `--file-type` | `1` PDF（默认）/ `2` Markdown |
| `insight foreign-report download` | `--file-type` | `1` PDF / `2` MD / `3` 中译 PDF / `4` 中译 MD |
| `insight announcement download` | `--file-type` | `1` PDF / `2` Markdown |
| `insight summary download` | `--file-type`（可选） | `1` 原始（默认）/ `2` HTML（仅会议平台来源） |
| `insight independent-opinion download` | `--file-type` **必选** | `1` 原文 HTML / `2` 翻译 HTML |
| `insight announcement-hk download` | `--file-type` | `1` 原始（默认）/ `2` Markdown |
| `insight announcement-us download` | `--file-type` | `1` 原始 PDF（默认）/ `2` Markdown |
| `insight official-account download` | `--file-type` | `1` txt（默认）/ `2` HTML |
| `vault record-download` | `--content-type` | `original` 原始文件 / `asr` 语音识别 / `summary` AI 速记 |
| `vault my-conference-download` | `--content-type` | `asr` 语音识别 / `summary` AI 速记 |

省略 `--output` 时 CLI 自动用真实标题做文件名（先读本地 title-cache，未命中则回查 list 接口）。**批量下载或下载旧文件**（跳过 list 直接按 ID 下）时 title-cache 大概率未命中、每个文件都回查一次 list，建议显式 `--output ./<名>.<ext>` 省掉回查。

## 意图路由表

| 用户意图 | 命令 |
|---------|------|
| 研报 / 券商报告 | `insight research list` |
| 外资研报 | `insight foreign-report list` |
| 首席观点 / 内资机构观点 / 分析师观点 | `insight opinion list` |
| 外资机构观点 / 外资券商观点 | `insight foreign-opinion list` |
| 外资独立观点 / 独立分析师观点 | `insight independent-opinion list` |
| 纪要 / 会议纪要（外部） | `insight summary list` |
| 路演 / 调研 / 策略会 / 论坛 | `insight roadshow / site-visit / strategy / forum list` |
| A 股公告 / 公告 | `insight announcement list` |
| 港股公告 / HK 公告 | `insight announcement-hk list` |
| 美股公告 / US 公告 | `insight announcement-us list` |
| 公众号资讯 / 产业资讯 / 公众号文章 | `insight official-account list` |
| 投资者问答 / 互动平台 / 电话会议 / 调研纪要 QA | `insight qa list`（按证券，`--security-code` 必填；`--source`/`--question-category`/`--answer-important` 精筛） |
| 研报图表 / 研报图片搜索 | `insight report-image list`（`--keyword`；下载原图 `insight report-image download --chunk-id`） |
| 跨类型语义搜索（研报+纪要+...） | `ai knowledge-batch`（多个 `--resource-type`） |
| 知识库原文下载（搜到后取全文） | `ai knowledge-resource-download`（前置：`knowledge-batch` 拿 `resourceType`+`sourceId`；`250001`/旧 `433007`=组合不匹配） |
| 一页通 / 投资逻辑 / 同业对比 / 调研提纲 | `ai one-pager / investment-logic / peer-comparison / research-outline` |
| 个股看点 / 投研总结 / 公司速览 | `ai stock-summary`（`--security` 代码或 `aShares`/`hkStocks` 全市场；仅 A 股/港股） |
| 业绩点评（异步） | `ai earnings-review` |
| 观点 PK / 多空辩论（异步） | `ai viewpoint-debate` |
| 投研线索 | `ai security-clue`（前置：`reference securities-search` 拿 `gts-code`） |
| 主题跟踪 | `ai theme-tracking`（前置：`reference concept-search` 拿 `theme-id`） |
| 热点话题 / 早午晚报 | `ai hot-topic` |
| 管理层讨论（财报） | `ai management-discuss-announcement` |
| 管理层讨论（业绩会） | `ai management-discuss-earnings-call` |
| A 股日 K（历史） | `quote day-kline` |
| 港股日 K（历史） | `quote day-kline-hk` |
| 美股日 K（历史） | `quote day-kline-us` |
| 指数日 K（沪深京） | `quote index-day-kline` |
| 分钟 K（A 股） | `quote minute-kline` |
| 实时行情（A / 港 / 美） | `quote realtime` |
| A股资金流向（主力/大单净流入，日频） | `quote fund-flow`（`--security` 或 `aShares` 全市场〔须带 `--start-date`/`--end-date`，按日自动分片〕；免费） |
| 单证券 A股完整利润表 / 资产负债 / 现金流（累计 / 单季） | `fundamental income-statement[-quarterly] / balance-sheet / cash-flow[-quarterly]` |
| 单证券 港股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-hk / balance-sheet-hk / cash-flow-hk` |
| 单证券 美股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-us / balance-sheet-us / cash-flow-us` |
| 单证券主营业务 / 收入结构 | `fundamental main-business` |
| A股单证券估值序列 / PE / PB / 历史分位 | `fundamental valuation-analysis` |
| A股盈利预测 / 一致预期 | `fundamental earning-forecast` |
| 前十大股东 | `fundamental top-holders` |
| 云盘文件 | `vault drive-list / drive-download` |
| 录音速记 | `vault record-list / record-download` |
| 我的会议（业绩会/策略会/路演内部记录） | `vault my-conference-list / my-conference-download` |
| 微信群消息 | `vault wechat-message-list`（先 `vault wechat-chatroom-list` 拿群 ID） |
| 自选股股票池 | `vault stock-pool-list / stock-pool-stocks` |
| 行业指标搜索（EDB） | `alternative edb-search` |
| 行业指标时序数据（EDB） | `alternative edb-data` |
| 题材画像 / 投资逻辑 / 行业空间 / 竞争格局 / 催化事件 | `alternative concept-info`（前置：`reference concept-search` 拿 `concept-id`） |
| 题材成分股 / 题材深度 F8 / 题材龙头 | `alternative concept-securities`（前置：`reference concept-search` 拿 `concept-id`） |
| 多证券已实现财务 / 估值指标搜索（含总市值） | `indicator search` |
| 多证券已实现指标截面（多指标 × 多证券，同一查询日期） | `indicator cross-section`（前置：`indicator search --format json` 通过三项校验） |
| 多证券已实现指标时序（单指标 × 多证券，按区间） | `indicator time-series`（前置：`indicator search --format json` 通过三项校验） |
| 证券代码 / gtsCode 搜索 | `reference securities-search` |
| 首席 ID / 分析师 ID 搜索 | `reference chiefs-search`（按姓名/机构/团队，用于 `insight opinion --chief`） |
| 机构 ID 搜索（内资券商/外资/牵头/观点机构） | `reference institution-search`（按机构名，用于 `--institution` / `--broker`；免费） |
| 公众号 ID 搜索（按公众号名/机构/分类） | `reference official-account-search`（返回 `accountId`，喂 `insight official-account list --account-id`；免费） |
| 常量/枚举 ID（行业/城市/公告分类/区域） | `reference constant-list --category <code>`（分类代码用 `reference constant-category` 查） |
| 题材 ID 搜索 | `reference concept-search` |
| 板块 ID 搜索 | `reference sector-search` |
| 板块成分股 | `reference sector-constituents`（前置：`reference sector-search` 拿 `sector-id`） |

**易混淆消歧**：
- "纪要" → 外部信息走 `insight summary`；公司内部录音/会议走 `vault my-conference`
- "搜索 X" → 数据维度精确（按行业/券商）走对应 `insight ... list`；跨类型语义搜索走 `ai knowledge-batch`
- 港股代码用在 `insight foreign-opinion --security` 还是 `quote day-kline-hk --security`？前者要"境外"格式（`UBER.N`），后者要 `.HK`
- "成分股" → 题材深度（分组/重点标记/纳入理由）走 `alternative concept-securities`；板块（行业/概念分类树，纯代码名单）走 `reference sector-constituents`
- **证券基本面 / 指标先按任务形态路由，不是搜到 EDE 就一律走 EDE**：
  - 单证券先优先对应 `fundamental` 专用命令（财务、估值、盈利预测、股东、主营或完整三大报表，多数免费 / 低价）。其中 `valuation-analysis` / `earning-forecast` 实测仅支持 A 股；港 / 美股的估值历史分位、盈利预测、以及 PE/PB 等核心估值（EDE 也仅 A 股）当前 CLI 均无可用接口，如实说明不支持、勿用别的语义顶替
  - 多证券批量取一组**已实现**财务 / 估值指标 → 优先 `indicator search` 后用 EDE 一次拉取，替代逐只循环；单日或同一报告期横向比较用 `cross-section`，区间走势用 `time-series`（后者不能多指标 × 多证券同时）。**批量按 code 回填加 `--key-by code`**（列头用 `indicatorCode`，防同名指标碰撞 + 服务端重排列序导致的错位）
  - 始终排除 EDE：A股盈利预测 / 一致预期（含预测 EPS）→ `fundamental earning-forecast`；A股估值历史分位 → `fundamental valuation-analysis`；开高低收 / 成交量等行情与 K 线 → `quote`；单证券完整报表 → 对应三大报表命令。**例外：总市值只有 EDE 有**——`quote realtime` / `day-kline` 都不返回市值，走 `indicator cross-section --indicator qte_mkt_cptl`（仅 A 股，默认单位「元」，用 `--scale` 缩放）。EDE 搜到的基本 / 稀释 EPS 是已实现值，**不能冒充预测 EPS**；港 / 美股缺少上述专用能力时应如实说明不支持，不能用别的语义代替
  - EDE 取数前必须用 `search --format json` 同时核对：`indicatorName` + `description` 语义准确、`scopeList` 覆盖全部目标市场 / 证券类型、`parameterList` 必填参数与枚举可满足；`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退专用接口。专用接口也不覆盖目标市场时，说明当前不可用，不要硬调。`scopeList` 按指标各不相同，不能因 EDE 服务支持 A / 港 / 美股就假定某个指标三市场都覆盖
  - `indicator search` 免费，`cross-section` / `time-series` 按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`
- 行业 / 宏观指标（空调销量、社融等，无证券维度）走 `alternative edb-*`（EDB），不要与证券级 EDE 混用
- EDE 单元格级缺值返回 `null` 且保留证券行；**整个查询无数据仍可能报 `999999`**。日期语义按指标分三类：财务报表指标=报告期末（可为非交易日）、`finc_pe_ttm` 等日频估值=最新交易日、`finc_pb_mrq`(MRQ) 等=最近报告期末（交易日取 `null`）；混合取数按各自有效日期分次 `cross-section` 再按证券合并，别塞进同一个 `--date`。详见 `references/commands/indicator.md`
- "业绩点评"双义消歧：**检索已有**（研报/纪要里的业绩点评内容）走 `insight ... list --llm-tag earningsReview`（0.1/条）；**AI 现生成**一份走 `ai earnings-review`（异步、50/次）。不确定问一句

## 公司名 → 证券代码

**速查表**（仅 mega-cap，命中率不高的一律走 securities-search）：

| 公司 | A 股 | 港股 | 美股 |
|------|------|------|------|
| 贵州茅台 | `600519.SH` | — | — |
| 宁德时代 | `300750.SZ` | — | — |
| 比亚迪 | `002594.SZ` | `01211.HK` | — |
| 中国平安 | `601318.SH` | `02318.HK` | — |
| 腾讯控股 | — | `00700.HK` | — |
| 苹果 Apple | — | — | `AAPL.O` |
| 微软 Microsoft | — | — | `MSFT.O` |

**其余一律**：
```bash
gangtise reference securities-search --keyword <公司名> --category stock --top 3 --format json
```
取 `data.list[0].gtsCode`。matchScore < 0.5 时让用户从前 3 条选。

**交易所后缀**：`.SH` 上交所（6 开头）｜ `.SZ` 深交所（0/3 开头）｜ `.BJ` 北交所 ｜ `.HK` 港股 ｜ `.O` 纳斯达克 ｜ `.N` 纽交所 ｜ `.A` AMEX。

**跨市场**：日 K 线需分别调对应命令（`day-kline` / `day-kline-hk` / `day-kline-us`）。**实时行情可一次混合**：`quote realtime --security 600519.SH --security 00700.HK --security AAPL.O` 单接口同时返回。

## 响应解析骨架（5 类通用模式）

| 模式 | 出现命令 | 结构 | 处理 |
|------|---------|------|------|
| **列表** | 大多数 `list` | `{list: [...], total: N}` | 遍历 list；CLI 已自动翻页 |
| **下载** | 各 `download` | stdout = 文件路径字符串 | 直接读 stdout 整行 |
| **AI 内容** | one-pager / investment-logic / peer-comparison / research-outline | `{content: "markdown文本"}` | 取 `content` 直接呈现 |
| **K 线** | quote * | `{list: [{tradeDate, ...}]}` | 按 tradeDate 排序，取需要的尾部 |
| **异步（含 *-check）** | earnings-review / viewpoint-debate / earnings-review-check / viewpoint-debate-check | 提交 `{dataId, status, hint}`；check 成功 `{date, content}` / pending `{status:"pending"}` 或抛 `140001`（旧 `410110`） | 见下方"异步任务流程" |

完整字段对照见 `references/response-schema.md`。

### 异步任务流程

`earnings-review` / `viewpoint-debate` 异步生成，两条路径：

- **`--wait`（推荐）**：命令带 `--wait` 阻塞到出结果（CLI 内轮询最长 ≈316s）。**把工具/命令超时设到 ≥360s**，否则外层先超时。直接拿 `{date, content}` 呈现。
- **手动轮询**（不带 `--wait`）：① 提交 → 拿 `{dataId, status, hint}`；② 间隔 ~30s 调 `*-check --data-id <id>`（预算给足 ~2-3 分钟）；③ `{date, content}`=成功 / `{status:"pending"}`=继续等 / 终态失败=换参重试；④ 多次仍 pending → 把 `dataId` 交用户稍后再 check。

**别把原始码甩给用户**：`140001`/旧 `410110`=生成中（继续等）、`140002`/旧 `410111`=终态失败（换参），按 `status` + 退出码判断后用人话说明。

### 呈现规范

- 列表 ≤20 行表格 + 总数；>20 条仅展示前 20 条 + 询问是否导出全量
- 下载完成后告知文件路径
- AI content 直接 markdown 呈现
- K 线展示最近 10 个交易日表格

## 时间词映射

| 模糊词 | Insight / Vault / AI | Quote K 线 | Fundamental（财报/估值） |
|--------|---------------------|-----------|----------------------|
| 最近 / 近期 | 7 天 | 45 天 | 1 年 |
| 最近一周 | 7 天 | 7 天 | — |
| 最近一个月 | 30 天 | 30 天 | — |
| 过去一年 / 近一年 | 1 年 | 1 年 | 1 年 |
| 今年 | 1/1 至今 | 1/1 至今 | 1/1 至今 |
| 今天 / 今日 | 当天（`start=end=`今天） | 见下行「最新 / 今日 / 当前（K 线）」 | — |
| 最新 / 今日 / 当前（K 线） | — | **45 天范围 → 从尾部取最近交易日**，不要只用 `--limit` | — |
| 最新一期 / 最新报告期（财报） | — | — | 省略 `--fiscal-year`，传 `--period latest`（默认） |
| 最新观点 / 今日观点 | 1 天范围 + `--rank-type 2` | — | — |

日期参数**按参数名判断、不按命令组**（命令组会误导——AI 里既有 `--start-time` 又有 `--date`/`--report-date`）：名字带 `-date` 的（`--start-date`/`--end-date`/`--date`/`--report-date`）一律 `YYYY-MM-DD`，覆盖 Quote/Fundamental、AI 的 `theme-tracking`(`--date`)/`hot-topic`/`management-discuss-*`(`--report-date`)、Alternative `edb-data`、Indicator `cross-section`(`--date`)/`time-series`；名字带 `-time` 的（`--start-time`/`--end-time`）用 `YYYY-MM-DD[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔）或 10/13 位时间戳，覆盖 Insight/Vault 各 list、`quote minute-kline`、`ai security-clue`、`ai knowledge-batch`。其中 **A 股公告（`insight announcement list`）与 `knowledge-batch` 会把输入转成 13 位毫秒**（10 位秒自动 ×1000），其余 `-time` 命令（含 `announcement-hk`/`announcement-us`）原样透传字符串；CLI 输入统一接受 10/13 位纯数字或 `YYYY-MM-DD[ HH:mm[:ss]]`（同上：秒可省、空格或 `T` 分隔）。

支持时间倒序的命令加 `--rank-type 2`：opinion / summary / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。其他 list 命令按 API 默认排序。

## 异常处理

服务端 2026-07-17 重排了错误码（41 个公开码，三层：`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层），信封新增 `errorType` 和 `traceId`。

**2026-07-20 逐码实测的结论：迁移是按「错误处理层」而非按业务模块进行的，不能假定文档即现状。**
- 判别方式：**新码 `code` 是 JSON 数字且带 `errorType`；旧码是字符串且没有**。但这判断的是**这一条错误路径**切没切，不是整个接口——同一个 Insight 接口内，参数校验已发新码 `100003`、路由不存在发新码 `999010`，方法用错却仍发旧码 `900002`。（成功响应也没有 `errorType`，别拿它当判据。）
- **异步端点（`earnings-review` / `viewpoint-debate`）的生成状态没切**——实测仍是 `410110`/`410111`，HTTP 400，无 `errorType`
- **token 过滤器没切**——仍是 `0000001007`/`0000001008`；方法路由层的 `900002` 同理
- 参数校验层、路由层已切
- 更外层的未知路径（不属于任何已识别路由）**根本不返回统一信封**，是纯文本 `default backend - 404`
- CLI 对两代都认，报错行带 `[trace <id>]`，**报障给 Gangtise 时务必带上这个 traceId**

**实测确认在用的码**（按遇到概率排；✅=已实测复现）

| 错误码 | 含义 | CLI 行为 | Agent 是否介入 |
|--------|------|---------|--------------|
| ✅ `100003` | 参数值非法——**最宽的兜底码**：类型错、`limit` 越界都归这里。**msg 通常已指明字段**（如「请求体字段类型不匹配: size 期望类型 Integer」「limit 最小为 1，最大为 10000」），先读 msg 再猜 | — | 按 msg 指的字段改；msg 没指明才对照 `--help` 查枚举拼写，**不要重试同命令** |
| ✅ `999999` | 系统错误；但 **`indicator`（EDE）用此码 + HTTP 500 表示查询无数据**（节假日 / 未来日期 / 未覆盖标的，2026-07-11 实测）——单元格级缺值才是 `null` | 普通端点自动重试 ×2；🔴 贵档与 `indicator` 端点不重试 | `indicator` 遇到先检查日期/标的是否该有数据，别盲目重试 |
| ✅ `410110` | **异步生成中**（HTTP 400，旧码未切）。新码 `140001`，CLI 两码都认 | 轮询视为 pending | 继续等 |
| ✅ `410111` | **异步生成失败**（HTTP 400，旧码未切）。新码 `140002`，CLI 两码都认 | 终态 | **不重试**，换参数 |
| ✅ `130002` | 资源不存在——**下载类的兜底码**：`reportId` 不存在 / 非数字 / `fileType` 非法**全归这里**（`130003`/`130004`/`130005` 实测均未启用） | — | 确认 ID 有效且本账号可见；换 `--file-type` 或换一篇验证 |
| ✅ `130001` | 数据未找到，或**该指标无权限**（`indicator` 内层失败会带具体 msg 如"指标无权限"） | — | 检查查询条件与指标权限 |
| ✅ `100001` | 缺必填参数——**msg 带字段名**（「缺少必填参数: reportId」） | — | 按 msg 指的字段补上 |
| ✅ `110001` / `110002` | 日期格式错（msg 带字段名）/ 起晚于止。**哪个格式报错、哪个被静默误读是端点相关的**（实测 `fundamental` 对 `2020/01/01` 报 110001，`insight research list` 对 `30/06/2025` 却宽松解析返回数据）——别按命令组预判 | — | 按参数名：`--*-date` 用 `YYYY-MM-DD`、`--*-time` 用 `YYYY-MM-DD HH:mm:ss`；`ai knowledge-batch` 的 --start-time/--end-time 收时间戳或 datetime，CLI 统一转 13 位毫秒 |
| ✅ `120001` | 证券代码无效——msg 带原因（「非有效A股」）。**只有 Fundamental 系报**，Quote 系静默返回空 | — | `reference securities-search` 确认代码与后缀（`600519.SH` / `00700.HK`） |
| ✅ `100006` | 查询/下载数量超限——**取代旧 `430007`**；实测 `fund-flow` 全市场不传日期即此码 | — | 缩短日期范围或调小 `--size`/`--limit`；全市场场景应已自动分片 |
| ✅ `240001` | 财报期未披露或超出查询期（`earnings-review` 提交阶段就报，**不扣积分**） | — | 换更早的 `--period`（`2025q3` → `2025interim`） |
| ✅ `250001` | 不支持的数据源——**取代旧 `433007`** | — | 检查 `resourceType + sourceId` 组合 |
| ✅ `999011` | 开发账号凭证无效——**取代旧 `8000014`/`8000015`，已合并，不再区分 AK 错还是 SK 错** | 登录即失败，**不重试** | 检查 `GANGTISE_ACCESS_KEY`/`GANGTISE_SECRET_KEY` 是否写反或未 export |
| ✅ `999010` | 接口地址不存在 | — | `raw call` 的 key 可能已下线，用 `gangtise raw list` 核对 |
| ✅ `0000001008` | Token 服务端失效（他处登录挤掉）——**旧码未切，token 自愈依赖它** | **强制重新登录并重试一次** | 无 AK/SK 时无法自愈，提示重新登录 |
| ✅ `0000001007` | 请求未携带 Bearer token | — | 检查 `GANGTISE_TOKEN` / AK/SK 是否已 export |
| ✅ `900002` | **请求方法不正确**（msg「请求类型有误」，HTTP 405）——旧文档写作"缺少 uid"是错的 | — | `raw call` 时确认该 endpoint 是 GET 还是 POST |
| `410106` / 缺参 | `indicator` 缺必填参数（msg 直接指明，如「必填参数 periodNum 不能为空」；HTTP 500 故 CLI 重试 ×2） | **自动重试 ×2** | 读 `indicator search --format json` 的 `parameterList` 补 `required:true` 参数 |

**⚠️ 实测发现的坑（都是"不报错"型，最难发现）**
- 🔴 **日期只写 `YYYY-MM-DD`、时间只写 `YYYY-MM-DD HH:mm:ss`（或 10/13 位时间戳）；CLI v0.28.0 起 date 与 datetime 两类、含所有 insight/vault 透传参数都本地拦截**。服务端对「年在后」格式**日月顺序随分隔符翻转**且静默误解析（HTTP 200、不回显实际用的日期）：`07/01/2026`（斜杠）读成 **2026-01-07**、`07-01-2026`（横杠）读成 **2026-07-01**，差半年。实测 `insight research list --start-time`：`07/01/2026` 命中 1562 条、`07-01-2026` 命中 210 条（分别 = 标准 `2026-01-07` / `2026-07-01`）；`quote day-kline`/`kline-hk`/`kline-us`/`index`、`fundamental balance-sheet` 同理。v0.28.0 前透传命令（research/summary/announcement-hk/us/vault/minute-kline 等）**静默放行**，且同值在本地转时间戳的 `announcement`（A 股）与透传的 hk/us 之间还会差半年、都 exit 0。现在全部在发请求前报 `ValidationError`，**但绕过 CLI 直连接口务必自己保证格式**
- **财报接口的日期按「报告期末」过滤**，不是公告日：`fundamental balance-sheet` 等的 `--start-date`/`--end-date` 匹配的是 `endDate` 字段（如 `20200630`），响应里的 `announcementDate`（如 `20200729`）只是公告日。**查某期财报要传季度末日期**（`2020-06-30` / `2020-03-31` / `2020-09-30` / `2020-12-31`）；传 `2020-07-01` 这类非报告期日期会返回 0 行，属正常行为，不是没数据
- 🔴 **Quote 系对非法证券代码不报错**，静默返回 `total:0` 空列表——无法区分"代码写错"和"该票该区间真无数据"。**空结果先回头核对代码后缀**。Fundamental 系会正常报 `120001`
- **枚举值拼错、分页参数越界服务端不报错**——静默忽略该条件返回全量/正常结果。所以 `100004`/`100005` 实测触发不到。CLI 只对**部分**参数加了本地白名单（`--top` 上限；`--category` 仅 `reference securities-search` / `institution-search` / `official-account-search` 三个命令），**`insight research --category` 等仍是自由字符串、拼错不报错也不生效**。**拼错的筛选条件会伪装成"结果正常"，枚举拼写要自己保证**
- **`viewpoint-debate` 传敏感内容不会被提前拦截**——实测不返回 `240002`，而是照常受理、扣满 50 积分、生成阶段才以 `410111` 失败。**提交前自己把关措辞**
- **`ai one-pager` 的非法 `mode` 被静默忽略**，照常生成并扣 50 积分

**官方文档列出、但实测未触发的码**（遇到再查，多数被上面的兜底码接管）

| 错误码 | 含义 | 实测情况 |
|--------|------|---------|
| `999001` / `999002` | 缺 token / token 无效 | 实际返回旧码 `0000001007` / `0000001008` |
| `999007` / `999008` / `999009` | 方法/媒体类型/请求体不支持 | 实际返回 `900002` / `999999` / `100003` |
| `999003` / `999004` / `999005` / `999006` | 无接口权限 / 无资源权限 / 积分不足 / 限流 | 未构造出（需特定账号状态） |
| `999012`–`999016` | 账号禁用/过期、租户失效、无长期 token、IP 不合规 | 未构造出 |
| `100002` / `100004` / `100005` | 类型错 / 分页非法 / 枚举非法 | 类型错归 `100003`；后两者服务端静默忽略 |
| `110003` | 超出时间范围限制 | 未触发（1900 年至今的范围仍正常返回） |
| `130003` / `130004` / `130005` | 无文件可下 / ID 非数字 / 文件类型不支持 | 全部归 `130002` |
| `140001` / `140002` | 结果生成中 / 处理失败 | 异步端点仍用 `410110` / `410111` |
| `210001` / `220001` / `230001` | 研报/观点/分享文件不支持下载 | 未构造出 |
| `240002` / `240003` | 敏感词 / 模式不支持 | 敏感词走 `410111`；`one-pager` 的非法 `mode` 被静默忽略 |
| `903301` / `10011401` | 今日调用上限 / 白名单未开通 | 历史遗留，**均未实测触发**。不臆断对应新码——`10011401` 按语义更接近 `999003`（未开通接口权限）而非 `999016`（IP 限制），别据此去查 IP |

**非错误码**

| 情形 | CLI 行为 | Agent 是否介入 |
|------|---------|--------------|
| HTTP 5xx / `ECONNRESET` / 超时 | **自动指数退避重试 ×2**（🔴 贵档端点不重放） | 仍失败提示用户 |
| `ValidationError` | 本地参数校验失败 | 检查 `--from` / `--size` / `--limit` 数值，**不要重试同命令** |

**其他场景**：
- CLI 未安装 → `npm install -g gangtise-openapi-cli`
- **退出码 3 = 部分结果**：翻页/K线分片有页失败、或服务端返回行数与 `total` 矛盾（提前短页）时，已取到的数据保留——stderr 有 warning，`--format json` 可见 `partial: true`（页失败另有 `failedPages`；分片失败为 `failedShards`、分片撞行数上限为 `truncatedShards`，均带具体日期区间可定向缩窗补拉）；table/csv/jsonl 只有数据行、看不出缺失。拿部分数据继续前必须告知用户缺了哪段
- 空结果（list 为空数组） → 建议扩大时间范围、换关键词、去掉部分筛选
- 模糊公司名匹配多只（"平安" → 中国平安 / 平安银行 / ...） → 列出让用户选
- 下载文件路径冲突 → 询问覆盖

## Troubleshooting（常见困境自救）

按问题→诊断顺序依次尝试，第一条解决就停。

**`securities-search` 找不到公司**
1. 试拼音 / 首字母（如"贵州茅台"试 `gzmt`）
2. 去掉"股份/有限公司/集团"等后缀重试
3. 不传 `--category` 查所有分类（可能是 fund / DR）
4. 还不行 → 请用户提供精确代码

**`list` 全空但参数看着对**
1. 时间窗太窄 → 扩到 30 天试
2. `--security` 后缀拼错（如 `300750` 漏了 `.SZ`）
3. 行业 ID 用错体系：`--industry`（用 `citicIndustry` 码 `1008001xx`）/ `--research-area`（用 `gangtiseIndustry`：行业 `1008001xx` + 方向 `122000xxx`）/ `--gts-code`（申万 `821xxx.SWI`）——三套体系不同，详见 `references/commands/reference-and-lookup.md`
4. `--rating` / `--category` 等枚举值拼错（参考对应命令的 references 文件）

**`999011` 凭证无效**（旧码 `8000014`/`8000015`；服务端已合并为一个码，不再指明是 AK 错还是 SK 错，**登录直接失败、CLI 不重试**）
1. `echo $GANGTISE_ACCESS_KEY` 验环境变量是否 export
2. AK 和 SK 是否写反
3. 账号是否到期 / 异常（`gangtise auth status`；对应 `999012`/`999013`）

**异步任务 `410111` 反复**（生成失败，终态）
1. `viewpoint-debate`：先检查观点措辞——实测敏感内容不会被提前拦截，会扣满 50 积分再以 `410111` 失败
2. `earnings-review`：换更早的 `--period`（如 `2025q3` → `2025interim`）
3. `report-date` 用已发布的标准期：`xxxx-06-30` / `xxxx-12-31`
4. 若提交阶段就返回 `240001`（财报期未披露），说明该期不可查且**未扣积分**，别再换参数试
5. 直接告知用户该期数据暂不可用

**K 线返回的不是"最近"几条** → 只用 `--limit` 截的是窗口开头。必须改用 `--start-date`/`--end-date` 拉范围，再从结果尾部按 `tradeDate` 取最近 N 条。

**翻页很慢 / 卡住** → `--verbose` 看哪一页慢；可 `GANGTISE_PAGE_CONCURRENCY=10` 提速，或缩小时间范围。

**`--security all` 报 `100006`**（旧码 `430007`）→ 单日数据仍超 10K 行（极端情况）→ 临时改用更窄的 `--start-date`/`--end-date`，或改为单只 `--security` 单独拉。

**AI agent 命令（one-pager 等）超时** → 服务端生成耗时长，CLI 默认 30s → `GANGTISE_TIMEOUT_MS=120000` 后重试。

**估值结果出现大量 `null`** → 最新交易日数据未入库 → 加 `--skip-null` 过滤掉 `value` / `percentileRank` 为 null 的行。

**下载文件名乱码 / 截断** → terminal locale 或 shell quoting 问题 → 显式 `--output ./<title>.<ext>` 避开。

**同一公司既是股票又是 DR** → `securities-search` 默认返回所有分类 → 加 `--category stock` 收敛。

**`sector-constituents` 返回 0 条** → sectorId 不对（题材 conceptId 与板块 sectorId 是两套 ID，不通用）→ 先 `reference sector-search --keyword <名>` 拿 `sectorId` 重试。

## 详细参数

按需 Read 对应文件：

- 内资观点 / 纪要 / 路演 / 调研 / 策略 / 论坛 / 研报 / 外资研报 / A 股公告 / 港股公告 / 美股公告 / 外资观点 / 独立观点 / 公众号（official-account）/ 投资者问答（qa）/ 研报图表（report-image）→ `references/commands/insight.md`
- 行情命令（A 股 / 港股 / 美股日 K / 指数日 K / 分钟 K / 实时行情 / 资金流向 fund-flow） → `references/commands/quote.md`
- 三大报表（A 股 / 港股 / 美股）/ 主营 / 估值 / 盈利预测 / 股东 → `references/commands/fundamental.md`
- knowledge-batch / security-clue / 个股看点（stock-summary）/ AI agent / 异步任务 / 主题跟踪 / 热点 / 管理层讨论 → `references/commands/ai.md`
- drive / record / my-conference / wechat / 股票池 → `references/commands/vault.md`
- 行业指标数据库（EDB）/ 题材指数画像与成分股（concept-info / concept-securities）→ `references/commands/alternative.md`
- 数据指标（EDE：search / cross-section / time-series，证券级指标截面与时序）→ `references/commands/indicator.md`
- securities-search / chiefs-search（首席 ID）/ institution-search（机构 ID）/ official-account-search（公众号 ID）/ 常量查询（constant-category / constant-list）/ 题材 ID（concept-search）/ 板块（sector-search / sector-constituents）/ lookup 本地表 / 行业别名 / raw call → `references/commands/reference-and-lookup.md`

跑通流程对照 → `references/examples.md`
