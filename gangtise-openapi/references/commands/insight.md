# Insight 命令详细参数

所有 `insight ... list` 共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

时间格式：`"YYYY-MM-DD HH:mm:ss"`（datetime，需引号）。

支持 `--rank-type` 的命令：opinion / summary / **pamirs-summary** / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。

⚠️ **`--rank-type` 的效果同时依赖 `--keyword` 和 `--search-type`，而且强弱按端点不同**（2026-08-08 全量实测三个端点 × 两种 searchType）：

下表三个端点是本次实测对象；**支持 `--rank-type` 的另外 8 个端点未验证**，别把结论外推过去。在这三个上，`--rank-type 2` 都是严格按 `publishTime` 倒序、稳定可依赖，差别全在 `1`（综合排序）上：

| 端点 | `--search-type 1`（标题） | `--search-type 2`（全文） |
| :--- | :--- | :--- |
| `pamirs-summary` | 与 `2` **完全相同**（结果集无并列时间戳） | 🔴 **真正的相关度重排**——`rank1` 对 `publishTime`/`summaryTime` 都不单调，`rank2` 的首条在 `rank1` 里排到第 118 位 |
| `summary` | 与 `2` 有差异，但 `rank1` **仍严格时间倒序**——差异只发生在时间戳并列处（`keyword=机器人` 前 200 条有 22 处并列） | 同左 |
| `research` | 与 `2` **完全相同** | 有差异，同样只在并列处（4 处并列） |

**没有 `--keyword` 时一律无差异**（综合排序无从计算），这不是参数失效。

实用结论：**要"最相关"而不是"最新"，三个实测端点里只有 `pamirs-summary --search-type 2` 真能做到**；`summary` / `research` 的 `rank-type 1` 至多改变同一时间戳内几条的先后，别指望它能把更相关的旧内容提到前面。未验证的端点按 `summary` 的保守预期对待，需要时自己按「跨 `searchType` × 全量取回 × 比 `total` 再比序列」复测。
**不支持** `--rank-type` 的命令：roadshow / site-visit / strategy / forum（API 无此参数）。

`--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

---

## 内资机构观点 `insight opinion list`

```bash
gangtise insight opinion list [--keyword <text>] [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--industry`：用 `citicIndustry` 码 `1008001xx`（申万码 `104xxx` 也等效）；`--research-area`：用 `gangtiseIndustry` 码（行业 `1008001xx` + 方向 `122000xxx`，申万码返 0）。详见 `reference-and-lookup.md`

## 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认，速度快）| `2` 全文搜索
- `--source`：`1` 实时 | `2` 开放来源
- `--research-area`：用 `gangtiseIndustry` 码（行业 `1008001xx` + 方向 `122000xxx`）；summary 的 spec 额外接受 citic/sw，但统一用 gangtise 最稳
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`
- `--file-type`（download 可选）：`1` 原始内容（默认）| `2` HTML 格式；**仅影响来源为会议平台的纪要**

## 帕米尔纪要 `insight pamirs-summary list/download`

```bash
gangtise insight pamirs-summary list [--search-type <n>] [--rank-type <n>] [--research-area <id>] [--security <code>] [--category <name>] [--market <name>]
gangtise insight pamirs-summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

帕米尔（Pamirs）是平台内一个特殊牵头机构的**专家纪要库**，走独立端点，不是 `summary list` 的一个筛选项。⚠️ **需单独购买专家纪要数据库**，未购买调用报权限错误。**不限制历史数据范围**（不受 3 个月窗口约束）。

- **筛选项比 `summary` 少**：没有 `--source` / `--institution` / `--participant-role`。服务端会静默丢弃不认识的 body 字段，所以别照搬 `summary` 的参数，那样只会拿到没过滤的全量
- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索。实测 `--keyword PCB`：标题 36 条 vs 全文 113 条
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序。⚠️ 效果依赖 `--keyword`，详见本文开头的公共说明；本端点是该结论的实测对象之一
- `--category`：`companyAnalysis` 公司分析 | `industryAnalysis` 行业分析（实测 2673 / 279）
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--research-area`：**citic（`1008001xx`）和申万（`104xx0000`）都生效**（实测食品饮料：citic 373 条 / 申万 145 条）——这点与多数 insight list 不同（那些的 `--research-area` 只吃 gangtise 码）
- `--file-type`（download 可选）：`1` 原始文件（默认）| `2` HTML；**只有这两种**
- 单页上限 50（CLI 按此翻页；服务端实测未执行该上限，传 100 会返 100），省略 `--size` 自动翻页拉全量。翻页完整性实测干净：三页无重复无缺口、可重放、`total` 不漂移
- 返回字段：`summaryId` / `title` / `brief`（摘要）/ `summaryTime`（纪要注明的生成时间）/ `publishTime`（发布时间）/ `categoryList` / `securityList[]{securityCode, securityName}` / `researchAreaList[]{researchAreaId, researchAreaName}` / `conceptList[]{conceptId, conceptName}` / `marketList`
- ⚠️ **标签字段大面积不回填**（2026-08-08 实测 6 种查法 × 30 条）：
  - **`conceptList` 在所有查法下恒为空**（无过滤 / category / market / security / researchArea / keyword 全是 `[]`），而接口**没有** concept 过滤参数——所以**目前拿不到主题概念标签，没有变通办法**，别写依赖它的逻辑
  - **`categoryList` 与 `marketList` 绑定在一起**：只要用 `--category` **或** `--market` 任一过滤，两个字段就都回填（30/30）；其余查法（含无过滤、`--security`、`--research-area`、`--keyword`）两个都是空。回填的是该记录的**全部**值（多市场纪要按 `aShares` 过滤也回 `["aShares","hkStocks"]`，不是"回显过滤值"）
  - **所以别拉全量再本地分组**——标签会全丢。要按类别/市场分组就逐个枚举值各查一遍再合并（请求数放大 2~4 倍），或直接让服务端筛
  - `researchAreaList`（抽 200 条 6% 空）和 `securityList`（10% 空）基本正常

```bash
# 近一周的帕米尔纪要
gangtise insight pamirs-summary list --start-time 2026-08-01 --end-time 2026-08-07 --format table

# 全文搜 + 时间倒序，只要前 20 条
gangtise insight pamirs-summary list --keyword PCB --search-type 2 --rank-type 2 --size 20

# 下载 HTML（省略 --output 自动用标题命名）
gangtise insight pamirs-summary download --summary-id 5863771 --file-type 2
# → PCB钻针：高端钻针扩产有壁垒，供需紧缺会持续到28年.html
```

## 路演 / 调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list   [--security <code>] [--institution <id>] [--research-area <id>] [--category <name>] [--market <name>] [--participant-role <name>] [--broker-type <name>] [--permission <n>] [--location <id>]
gangtise insight site-visit list [--security <code>] [--institution <id>] [--research-area <id>] [--object <name>] [--category <name>] [--market <name>] [--permission <n>] [--location <id>]
gangtise insight strategy list   [--institution <id>] [--location <id>]
gangtise insight forum list      [--research-area <id>] [--location <id>]
```

- 共用：`--keyword` `--start-time` `--end-time` `--from` `--size` `--location`
- `--location`：城市/省份 ID（`reference constant-list --category domesticCity` 查，如 `156440000` 广东省）。实测（2026-06-15）服务端过滤已生效，按省份正确命中
- 路演 `--category`：`earningsCall` | `strategyMeeting` | `companyAnalysis` | `industryAnalysis` | `fundRoadshow`
- 调研 `--category`：`single` 单场 | `series` 系列
- 调研 `--object`（仅调研）：`company` | `industry`
- `--broker-type`（仅路演）：`cnBroker` 内资 | `otherBroker` 外资
- `--participant-role`（仅路演）：`management` | `expert`
- `--permission`（路演/调研）：`1` 公开 | `2` 私密
- `--market`：路演 `aShares`｜`hkStocks`｜`usChinaConcept`｜`usStocks`；调研 `aShares`｜`hkStocks`｜`usChinaConcept`（无 usStocks）
- `--research-area`（路演/调研/论坛）：用 `gangtiseIndustry` 码（行业 `1008001xx` + 方向 `122000xxx`，见 `reference-and-lookup.md`）。**strategy 无 `--research-area`，只按 `--institution`/`--location` 筛**

## 财报日历 `insight performance-calendar list/download`

```bash
gangtise insight performance-calendar list [--start-date <date>] [--end-date <date>] [--market <name>] [--security <code>] [--category <name>] [--from <n>] [--size <n>]
gangtise insight performance-calendar download --performance-report-id <id> [--output <path>]
```

- ⚠️ **本命令用 `--start-date` / `--end-date`（`yyyy-MM-dd`），不是其余 insight list 的 `--start-time`**；过滤的是 `publishDate`（财报事件发布日）。也**没有** `--keyword` / `--rank-type` / `--search-type`
- `--category`：`performanceForecast` 业绩预告 | `performanceExpress` 业绩快报 | `performanceAnnouncement` 业绩公告（可重复）
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`（可重复）
- `--market` / `--category` 拼错 CLI 本地直接报错（不是静默返全量）——这两个参数的枚举值不必猜
- `--security`：证券代码，如 `000001.SZ`（可重复）
- 自动翻页（`{total,list}`，单页上限 50）。**不加任何筛选时 total 十万量级**（实测 2026-07-25 为 126683，含未来已排期的财报日程）——CLI 因此要求至少一个约束：`--start-date` + `--end-date`、或 `--security`、或显式 `--size`，裸跑直接报 `ValidationError`（不发请求、不扣分）
- 只给 `--security`（不给日期/`--size`）时，CLI 额外套一个 **1000 行隐式上限**：单只证券的整段日历只有几十条，正常查询感知不到；万一服务端哪天不再按 `securityList` 过滤，结果会在 1000 行截断并标 `partial`（stderr 警告 + 退出码 3），而不是闷头翻完全表。判据是 `total`：只有「取满 1000 行且 total 显示还有更多」才告警——恰好 1000 行且 total=1000 是完整结果，退出码仍是 0。看到告警说明筛选**可能**没生效，改用日期范围重查
- 返回字段：`performanceReportId`（下载用）/ `securityCodeList[]`（A+H 同时上市会有多个代码）/ `securityName` / `category` / `publishDate` / `title` / `hasAttachment`
- 实测 `publishDate` 返回的是 `yyyy-MM-dd 00:00:00`（文档写 `yyyy-MM-dd`），取日期请截前 10 位
- download：**只有 `hasAttachment: true` 的记录能下**（先 list 确认）；省略 `--output` 用真实标题命名（走 title-cache，未命中会回查 list 接口，那次回查按 0.1/条 计费——批量下载建议显式 `--output`）
- **积分**：list 0.1/条；download A 股 10/篇、港美股 20/篇

## 研报 `insight research list/download`

```bash
gangtise insight research list [--search-type <n>] [--rank-type <n>] [--broker <id>] [--security <code>] [--industry <id>] [--category <name>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>] [--source <type>]
gangtise insight research download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--category`：`macro` | `strategy` | `industry` | `company` | `bond` | `quant` | `morningNotes` | `fund` | `forex` | `futures` | `options` | `warrants` | `market` | `wealthManagement` | `other`
- `--llm-tag`：`inDepth` 深度 | `earningsReview` 业绩点评 | `industryStrategy` 行业策略
- `--industry`：仅 `industry`/`company` 类别研报时生效
- `--rating`：`buy` | `overweight` | `neutral` | `underweight` | `sell`
- `--rating-change`：`upgrade` | `maintain` | `downgrade` | `initiate`
- `--source`：`1` PDF研报 | `2` 公众号
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown
- **积分**：list 0.1/条；download 10/篇

## 外资研报 `insight foreign-report list/download`

```bash
gangtise insight foreign-report list [--search-type <n>] [--rank-type <n>] [--security <code>] [--region <id>] [--category <name>] [--industry <id>] [--broker <id>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>]
gangtise insight foreign-report download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--region`：`cn` 中国 | `cnHk` 香港 | `us` 美国 | `jp` 日本 | `sea` 东南亚 | `gl` 全球 | `uk` 英国 | `kr` 韩国 | `in` 印度（完整列表见 `references/lookup-ids.md`）
- `--category` / `--llm-tag` / `--rating` / `--rating-change`：同研报
- `--file-type`（download）：`1` 原始PDF | `2` Markdown | `3` 中文翻译PDF | `4` 中文翻译Markdown

## A 股公告 `insight announcement list/download`

```bash
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--category`：公告分类 ID，用 `reference constant-list --category aShareAnnouncementCategory` 查。常用：`103910200` 财务报告、`103910700` 股权股本、`103910201` 业绩预告、`103910703` 质押冻结、`103910803` 股权激励、`103910818` 股份增减持、`103910823` 问询函（完整列表见 `references/lookup-ids.md`）
- `--file-type`（download）：`1` 原始PDF | `2` Markdown
- 时间过滤时区：本命令（A 股公告，独有）会把 `--start-time`/`--end-time` 按**运行机器的时区**换算成毫秒时间戳（其余 insight 列表是把字符串直传服务端）。CST 机器上即北京时；在 UTC 云环境（cloud agent / CI）跑则日窗整体偏 8 小时。需跨机器精确边界时，直接传 13 位毫秒时间戳（原样透传，与机器时区无关）。

## 港股公告 `insight announcement-hk list/download`

```bash
gangtise insight announcement-hk list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement-hk download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--security`：港股代码，如 `01913.HK`（两位数字前缀需补零）
- `--category`：港股公告类型 ID（见 `references/lookup-ids.md`）
- `--file-type`（download）：`1` 原始（默认）| `2` Markdown

## 美股公告 `insight announcement-us list/download`

```bash
gangtise insight announcement-us list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement-us download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--security`：美股代码，如 `TSLA.O`（可重复）
- `--category`：美股公告分类 ID，用 `reference constant-list --category usShareAnnouncementCategory` 查（美股独立的 `103980xxx` 段，7 个一级分类：财务报告 / 证券发行 / 重大事项 / 交易提示 / 股本股东 / 股东大会 / 一般公告）
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown
- **积分**：list 0.1/条；download 20/篇
- 实测 `--security TSLA.O` 返回的 `sourceName` 为「美国证券交易委员会」

## 外资机构观点 `insight foreign-opinion list`

```bash
gangtise insight foreign-opinion list [--rank-type <n>] [--security <code>] [--region <code>] [--industry <id>] [--broker <id>] [--rating <name>] [--rating-change <name>]
```

- `--security`：境外证券代码，如 `UBER.N`
- `--region`：`cn` | `cnHk` | `cnTw` | `us` | `jp` | `uk`
- `--broker`：外资券商 ID（见 `references/lookup-ids.md`）
- `--rating` / `--rating-change`：同研报
- 返回字段：`foreignOpinionId` / `title` / `titleTranslate` / `content` / `contentTranslate` / `publishTime` / `publisher{brokerId, brokerName}` / `securityList[]{securityCode, rating, targetPrice, currency}` / `region`

## 外资独立观点 `insight independent-opinion list/download`

```bash
gangtise insight independent-opinion list [--rank-type <n>] [--security <code>] [--industry <id>] [--rating <name>] [--rating-change <name>]
gangtise insight independent-opinion download --independent-opinion-id <id> --file-type <n> [--output <path>]
```

- `--security`：境外证券代码，如 `GSK.N`
- `--rating` / `--rating-change`：同外资观点
- `--file-type`（download **必选**）：`1` 原文 HTML | `2` 中文翻译 HTML
- 返回字段：`independentOpinionId` / `title` / `titleTranslate` / `brief` / `briefTranslate` / `publishTime` / `analyst{analystId, analystName}` / `securityList[]` / `industryList[]`

## 产业公众号资讯 `insight official-account list/download`

```bash
gangtise insight official-account list [--search-type <n>] [--rank-type <n>] [--account-id <id>] [--security <code>] [--category <type>] [--industry <id>]
gangtise insight official-account download --article-id <id> [--file-type <n>] [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索
- `--account-id`：公众号 ID（取自 list 返回的 `accountId`），可多次传入限定账号
- `--category`：文章类型，可多选——`news` 新闻资讯 | `law` 法律法规 | `report` 报告类 | `view` 个人观点 | `data` 产业数据 | `event` 日程活动 | `meeting` 会议纪要 | `notice` 通知 | `recruit` 招聘 | `investEdu` 投资科普 | `brand` 品牌宣传 | `notes` 个人随笔 | `other` 其他
- `--industry`：行业 ID，用 `reference constant-list --category citicIndustry`（或 `swIndustry`）查
- `--keyword`：需用数据中的具体词（如 `泡泡玛特`），不能用整句白话
- `--file-type`（download）：`1` txt（默认）| `2` HTML
- 返回字段：`articleId` / `accountId` / `accountName` / `author` / `title` / `publishTime` / `url` / `originalFlag`（`0` 非原创 / `1` 原创）/ `articleCategory` / `summary`（模型摘要）/ `industryList[]{industryId, industryName}` / `conceptList[]{conceptId, conceptName}` / `securityList[]{securityCode, securityName}`

## 投资者问答 QA `insight qa list`

```bash
gangtise insight qa list --security-code <code> [--start-time <t>] [--end-time <t>] [--source <type>] [--question-category <name>] [--answer-important <0|1>] [--size <n>]
```

- `--security-code`（**必填**）：证券代码，如 `601012.SH`（按单只证券提取投资者问答）
- `--start-time` / `--end-time`：`yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`（字符串直传，不转时间戳）
- `--source`：问题来源，可多选——`conference` 电话会议 | `interactive` 互动平台 | `survey` 调研纪要
- `--question-category`：问题类型，可多选——`productAndBusiness` 产品技术与业务布局 | `capacityAndProjects` 产能与项目进展 | `ordersAndCustomers` 订单与客户 | `financialData` 财务与经营数据 | `materialEvents` 重大事项 | `capitalOperations` 资本运作 | `shareholdersAndDividends` 股东户数与常规分红 | `corporateGovernance` 治理与管理 | `marketAndValuation` 市场与估值 | `macroAndIndustry` 宏观与行业看法 | `risksAndOthers` 风险质疑其他
- `--answer-important`：答案是否涉及重要信息，可多选——`1` 是（回答匹配提问且涉及重要信息）| `0` 否；`--answer-important 1` 只取重要，省略或 `0 1` 两个都传=不按此维度筛选
- 自动翻页（`{total,list}`，单页上限 500）；省略 `--size` 拉全量
- 返回字段：`source` / `publishTime` / `question` / `answer` / `member`（回答方身份，如企业高管/董秘）/ `securityCode` / `questionCategory[]` / `answerImportant`（`1` 是 / `0` 否）
- **积分**：0.1/条

## 研报图表 `insight report-image list` / `download`

```bash
gangtise insight report-image list --keyword <text> [--top <n>] [--source-id <id>] [--start-time <t>] [--end-time <t>]
gangtise insight report-image download --chunk-id <id> [--output <path>]
```

- `--keyword`（**必填**，list）：搜索关键词，如 `AI`、`新能源汽车`
- `--top`：返回上限，默认 10，**最大 20**
- `--source-id`：研报 ID，限定到某篇研报（可从研报列表或知识库取）
- `--start-time` / `--end-time`：`yyyy-MM-dd HH:mm:ss`（兼容 `yyyy-MM-dd` 自动补全），限定图片所属研报的发布时间
- `--chunk-id`（**必填**，download）：图片唯一标识，取自 list 返回的 `chunkId`；直接下二进制原图（JPEG）。省略 `--output` 时优先用服务端返回的文件名，无则按 `report-image-<chunkId>` 命名
- list 返回字段：`chunkId` / `title` / `sourceId` / `broker` / `category` / `typeList[]` / `industry` / `publishTime` / `page` / `totalPages` / `imageCaption[]` / `imageFootnote[]` / `pageContent`（该页 OCR/描述文本）；扁平数组、无 `total`（不翻页，靠 `--top` 控量）
- **积分**：list 免费；download 0.1/张
