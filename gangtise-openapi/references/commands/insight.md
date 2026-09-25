# Insight 命令详细参数

`insight ... list` 大多共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`。**例外**：`highlight list` 与 `qa list` 没有 `--keyword`；`report-image list` 用 `--top` 而不是 `--from` / `--size`；`performance-calendar list` 用 `--start-date` / `--end-date` 且没有 `--keyword`

按条计费的列表省略 `--size` 时，CLI 先估算全量积分，超过 1000 积分报错退出 1（报错写明估算值）；确认后加 `--yes` 拉全量，或改传 `--size N`。

时间格式：`"YYYY-MM-DD HH:mm:ss"`（datetime，需引号）。**`--end-time` 写到当天末尾 `23:59:59`**——只写日期时，A 股公告按当日 00:00:00 处理，截止日当天的数据取不到。

支持 `--rank-type` 的命令：opinion / summary / **pamirs-summary** / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。

**`--rank-type 1`（默认）按相关度挑条目，`--rank-type 2` 严格按 `publishTime` 倒序取最新的。** 两者从同一结果集里取的是**不同的子集**，不是同一批内容换个排法。

| 想要 | 用 |
| :--- | :--- |
| 最相关的内容（可以是旧的） | `--rank-type 1` + `--keyword` |
| 最新的内容（按时间铺） | `--rank-type 2` |

🔴 **两档差别有多大取决于关键词，别拿一个关键词去判断这个参数有没有用**：有的关键词下两档取回的条目完全相同（如 `机器人`、`固态电池`），有的几乎没有交集（如 `新能源汽车`、`人形机器人`）。

**判据不是「词够不够具体」，而是看 `total` 与组成词的关系**——用 `--size 1` 各查一次即可（每次最多扣 1 条的积分，研报 / 纪要是 0.1）：

- `total` **比组成词单独查都大**（服务端把词拆开按 OR 找，近似并集）→ 候选里既有整词命中也有只中一半的，相关度拉得开，两档取的是不同的批
- `total` **比组成词小**（按整个短语找，近似交集）→ 全是真命中、相关度并列，两档就是同一批

**这属正常，不是参数没生效**。拆词的关键词下，`--rank-type 1` 的结果里含完整关键词的条目明显多于 `--rank-type 2`——综合排序确实在按相关度挑。

⚠️ **`--search-type` 不影响 `--rank-type 1` 取回哪些条目**：同一关键词下，`--search-type 1` 与 `2` 的 `--rank-type 1` 结果相同——即使 `--search-type 2` 把 `total` 放大一个数量级，取回的条目仍是同一批。`--search-type 2`（全文）扩大的是命中总数和 `--rank-type 2` 的候选池。**所以「要最相关」不需要加 `--search-type 2`。**

⚠️ **没有 `--keyword` 时两档结果一致**，这不是参数失效——没有关键词就无从计算相关度。

⚠️ **别用「返回结果是不是按时间倒序」判断综合排序有没有生效** —— `--rank-type 1` **挑完之后仍按时间倒序排列**，所以两种取值下返回序列都是时间单调的。要看差别就**比条目 ID 集合**，不是比排序。
**不支持** `--rank-type` 的命令：roadshow / site-visit / strategy / forum / performance-calendar / qa / highlight / report-image（API 无此参数）。

`--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

---

## 内资机构观点 `insight opinion list/detail`

```bash
gangtise insight opinion list [--keyword <text>] [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>] [--with-content]
gangtise insight opinion detail --chief-opinion-id <id> [--chief-opinion-id <id>...]
```

- **积分**：列表 1/条（只含摘要）；`--with-content` 30/条；`detail` 30/条

- 🔴 **列表只含摘要**：`brief` 是正文前 200 字的截断，**1 积分/条**。要正文用 `detail` 按 `chiefOpinionId` 取（`content`，**30 积分/条**，按返回条数计）；或 `list --with-content` 让列表直接带正文（30 积分/条）。只需判断相关性、做筛选时看 `brief` 就够，别默认加 `--with-content`
- `detail` 与 `--with-content` 都按返回条数计费，**超时 / 5xx 不自动重发**（重发可能对已交付的正文再计一次费），偶发失败自行重跑
- ⚠️ **`--with-content` 返回的是旧版结构**：标题与正文在 `contentList.title` / `contentList.content`（`contentList` 是对象，不是数组），顶层没有 `title` / `brief`。按 `content` 字段名取会取不到；要统一成 `detail` 的结构就走 `list` + `detail`
- `detail`：ID 可重复传或逗号分隔，CLI 去重后按 **20 个一批**自动拆分请求。**没有有效正文的 ID 不报错、直接跳过**（ID 写错时即如此；刚发布的观点也可能暂时取不到，稍后重取）。CLI 比对请求与返回，缺的 ID 列在 `missingIds`；某一批请求失败时，已取到的正文照常输出，没取的 ID 列在 `unfetchedIds`、原因在 `unfetchedError`，只需对这些 ID 重跑。两种情况都标 `partial`、**退出 3**
- 返回字段（list）：`chiefOpinionId` / `publishTime` / `title` / `brief` / `author{chiefId, chiefName, researchAreaList, brokerID, brokerName}` / `securityList[]` / `industryList[]` / `conceptList[]` / `llmTagList`；`detail` 另加 `content`。`author.chiefId` / `chiefName` 在机构点评类观点上为 `null`

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--industry`：用 `citicIndustry` 码 `1008001xx`；申万码 `104xx0000` 也生效，但**两套码的行业成分不同、取回的结果集不一致**，同一批查询别混用。`--research-area`：行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`，**申万码在本端点返 0**。详见 `reference-and-lookup.md`

## 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

- **积分**：列表 0.1/条；下载 50/篇

- `--search-type`：`1` 标题搜索（默认，速度快）| `2` 全文搜索
- `--source`：`1` 实时 | `2` 开放来源
- `--research-area`：行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`。summary 是少数**申万码 `104xx0000` 也生效**的端点，但两套行业码取到的集合略有出入，同一批查询里别混用
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`
- `--file-type`（download 可选）：`1` 原始内容（默认）| `2` HTML 格式；**仅影响来源为会议平台的纪要**

## 会议线索 `insight highlight list`

```bash
gangtise insight highlight list [--from N] [--size N] [--start-time <t>] [--end-time <t>] [--security <code>] [--research-area <id>]
```

Gangtise 会议内容的核心要点信息流（官方名「会议线索」），固定按发布时间倒序，适合做每日会议跟踪看板。

- 🔴 **5 积分/条**，按返回条数计。**务必带 `--size`**——省略时 CLI 先取 1 条拿到 `total` 估算，超过 1000 积分（约 200 条）报错退出 1，要全量须加 `--yes`。先 `--size 1` 看 stderr 的 `Total: N` 探量级，再决定取多少
- `--size` 单页上限 50
- 按偏移量**最多取到第 10000 条**（`--from` + 条数不能超过 10000）。命中更多时 CLI 取到第 10000 条为止、stderr 说明并**退出 3**；`--from` 本身 ≥10000 直接拒绝。要更多请缩短时间范围分段取
- `--start-time` / `--end-time`：`yyyy-MM-dd HH:mm:ss`，也接受 `yyyy-MM-dd`（自动补全）。超出账号数据权限窗口返回 `110003`
- `--security`：证券代码，**大小写敏感需精确匹配**。A 股 `601702.SH`、港股 **5 位数字** `09992.HK`、美股 `AAPL.O`
- `--research-area`：中信行业码 `1008001xx` 或 Gangtise 方向码 `122000xxx`。⚠️ **本端点不认申万码 `swIndustry`**
- 返回字段：`highlightId` / `title` 会议名称 / `publishTime` / `content` / `securityList`（含 `securityCode`+`securityName`）/ `researchAreaList`（含 `researchAreaId`+`researchAreaName`）
- ⚠️ **`content` 是 HTML 片段**：整体由 `<p>` 包裹，各要点小标题由 `<strong>` 包裹，除这两种标签外不含其他标签。要纯文本自行去标签（如 `re.sub(r"<[^>]+>", "", content)`）
- 要点可能不关联任何证券（`securityList` 为 `[]`），宏观 / 行业类会议尤其常见——按证券筛会漏掉这批

## 帕米尔纪要 `insight pamirs-summary list/download`

```bash
gangtise insight pamirs-summary list [--search-type <n>] [--rank-type <n>] [--research-area <id>] [--security <code>] [--category <name>] [--market <name>]
gangtise insight pamirs-summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

帕米尔（Pamirs）是平台内一个特殊牵头机构的**专家纪要库**，走独立端点，不是 `summary list` 的一个筛选项。⚠️ **需单独购买专家纪要数据库**：未开通时 `list` 直接报 `999004`（不是返回空列表），**整库拿不到**。**不限制历史数据范围**（不受 3 个月窗口约束）。

> 未开通该库时任何查询都直接报 `999004`，不必怀疑参数写错。

- **筛选项比 `summary` 少**：没有 `--source` / `--institution` / `--participant-role`。不认识的 body 字段会被丢弃且不报错，所以别照搬 `summary` 的参数，那样只会拿到没过滤的全量
- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索。同一关键词全文搜索的命中数明显多于标题搜索
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序。⚠️ 效果依赖 `--keyword`，详见本文开头的公共说明
- `--category`：`companyAnalysis` 公司分析 | `industryAnalysis` 行业分析（两者过滤均生效，公司分析占绝大多数）
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--research-area`：**行业码两套都生效**——citic `1008001xx` 和申万 `104xx0000`。申万码这点与多数 insight list 不同（那些只有 summary 认申万码）。⚠️ 反过来，**方向码 `122000xxx` 在本端点返 0**，别在这里传方向
- `--file-type`（download 可选）：`1` 原始文件（默认）| `2` HTML；**只有这两种**
- 单页上限 50，CLI 按 50 自动翻页；省略 `--size` 拉全量
- 返回字段：`summaryId` / `title` / `brief`（摘要）/ `summaryTime`（纪要注明的生成时间）/ `publishTime`（发布时间）/ `categoryList` / `securityList[]{securityCode, securityName}` / `researchAreaList[]{researchAreaId, researchAreaName}` / `conceptList[]{conceptId, conceptName}` / `marketList`
- ⚠️ **`conceptList` / `categoryList` / `marketList` 三个标签字段稀疏，且是否有值随记录和查法而变**：
  - **不带筛选时经常整条为空**，用 `--category` 或 `--market` 过滤时回填率明显更高（这两个字段是绑定的：用任一过滤，两个都会有值）。有值时给的是该记录的**全部**值（多市场纪要按 `aShares` 过滤也回 `["aShares","hkStocks"]`，不是"回显过滤值"）
  - **所以别拉全量再本地分组**——会漏掉大量记录。要按类别/市场分组就逐个枚举值各查一遍再合并（请求数放大 2~4 倍），或直接让服务端筛
  - **反过来也别据此断言某条记录没有该属性**——标签为空只说明这次查询没回填，不代表该纪要真的没有概念/分类/市场归属
  - `researchAreaList` 和 `securityList` 的回填要完整得多，不受上面这条影响，可以直接用来做本地分组

```bash
# 近一周的帕米尔纪要
gangtise insight pamirs-summary list --start-time "2026-08-01 00:00:00" --end-time "2026-08-07 23:59:59" --format table

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

- **积分**：列表 **20/条**——务必带 `--size`

- 共用：`--keyword` `--start-time` `--end-time` `--from` `--size` `--location`
- `--location`：城市/省份 ID（`reference constant-list --category domesticCity` 查，如 `156440000` 广东省）。传省份 ID 会命中该省
- 路演 `--category`：`earningsCall` | `strategyMeeting` | `companyAnalysis` | `industryAnalysis` | `fundRoadshow`
- 调研 `--category`：`single` 单场 | `series` 系列
- 调研 `--object`（仅调研）：`company` | `industry`
- `--broker-type`（仅路演）：`cnBroker` 内资 | `otherBroker` 外资
- `--participant-role`（仅路演）：`management` | `expert`
- `--permission`（路演/调研）：`1` 公开 | `2` 私密
- `--market`：路演 `aShares`｜`hkStocks`｜`usChinaConcept`｜`usStocks`；调研 `aShares`｜`hkStocks`｜`usChinaConcept`（无 usStocks）
- `--research-area`（路演/调研/论坛）：行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`，**申万码 `104xx0000` 在这三个端点返 0**（见 `reference-and-lookup.md`）。**strategy 无 `--research-area`，只按 `--institution`/`--location` 筛**

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
- 自动翻页（`{total,list}`，单页上限 50）。**不加任何筛选时 total 十万量级**（含未来已排期的财报日程）——CLI 因此要求至少一个约束：`--start-date` + `--end-date`、或 `--security`、或显式 `--size`，裸跑直接报 `ValidationError`（不发请求、不扣分）
- 只给 `--security`（不给日期/`--size`）时，CLI 额外套一个 **1000 行隐式上限**：单只证券的整段日历只有几十条，正常查询感知不到；筛选没有收窄时，结果会在 1000 行截断并标 `partial`（stderr 警告 + 退出码 3），而不是翻完全表。判据是 `total`：只有「取满 1000 行且 total 显示还有更多」才告警——恰好 1000 行且 total=1000 是完整结果，退出码仍是 0。看到告警说明筛选**可能**没生效，改用日期范围重查
- 返回字段：`performanceReportId`（下载用）/ `securityCodeList[]`（A+H 同时上市会有多个代码）/ `securityName` / `category` / `publishDate` / `title` / `hasAttachment`
- `publishDate` 返回的是 `yyyy-MM-dd 00:00:00`，取日期请截前 10 位
- download：**只有 `hasAttachment: true` 的记录能下**（先 list 确认）；省略 `--output` 用 title-cache 里的真实标题命名，**未命中不自动回查**，退回服务端文件名或 `<type>-<id>`。要回查加 `--resolve-title`——拉 200 条、按 0.1/条 约 20 积分，取回的标题会写回缓存供同批复用
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

- **积分**：列表 0.1/条；下载 50/篇

- `--region`：`cn` 中国 | `cnHk` 香港 | `us` 美国 | `jp` 日本 | `sea` 东南亚 | `gl` 全球 | `uk` 英国 | `kr` 韩国 | `in` 印度（完整列表见 `references/lookup-ids.md`）。⚠️ 写错区域码不会报错，会返回不按区域筛选的全量结果——传之前核对取值
- `--category` / `--llm-tag` / `--rating` / `--rating-change`：同研报
- `--file-type`（download）：`1` 原始PDF | `2` Markdown | `3` 中文翻译PDF | `4` 中文翻译Markdown

## A 股公告 `insight announcement list/download`

```bash
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- **积分**：列表 0.1/条；下载 10/篇

- `--category`：公告分类 ID，用 `reference constant-list --category aShareAnnouncementCategory` 查。常用：`103910200` 财务报告、`103910700` 股权股本、`103910201` 业绩预告、`103910703` 质押冻结、`103910803` 股权激励、`103910818` 股份增减持、`103910823` 问询函（完整列表见 `references/lookup-ids.md`）
- `--file-type`（download）：`1` 原始PDF | `2` Markdown
- 时间过滤时区：本命令（A 股公告）会把 `--start-time`/`--end-time` 换算成毫秒时间戳发出，日期与时刻一律按**北京时间**解释，与运行机器的时区无关（UTC 云环境与本机结果相同）；13 位毫秒时间戳原样发出，10 位按秒换算成毫秒。其余 insight 列表把字符串直传服务端。

## 港股公告 `insight announcement-hk list/download`

```bash
gangtise insight announcement-hk list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement-hk download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- **积分**：列表 0.1/条；下载 20/篇

- `--security`：港股代码，如 `01913.HK`（两位数字前缀需补零）
- `--category`：港股公告类型 ID（见 `references/lookup-ids.md`）
- `--file-type`（download）：`1` 原始（默认）| `2` Markdown

## 美股公告 `insight announcement-us list/download`

```bash
gangtise insight announcement-us list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement-us download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--security`：美股代码，如 `TSLA.O`（可重复）
- `--category`：美股公告分类 ID，用 `reference constant-list --category usShareAnnouncementCategory` 查（美股独立的 `103980xxx` 段，一级分类：财务报告 / 证券发行 / 重大事项 / 交易提示 / 股本股东 / 股东大会 / 一般公告）
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown
- **积分**：list 0.1/条；download 20/篇
- `--security TSLA.O` 的 `sourceName` 为「美国证券交易委员会」

## 外资机构观点 `insight foreign-opinion list/detail`

```bash
gangtise insight foreign-opinion list [--rank-type <n>] [--security <code>] [--region <code>] [--industry <id>] [--broker <id>] [--rating <name>] [--rating-change <name>] [--with-content]
gangtise insight foreign-opinion detail --foreign-opinion-id <id> [--foreign-opinion-id <id>...]
```

- **积分**：列表 1/条（只含摘要）；`--with-content` 30/条；`detail` 30/条

- 🔴 **列表只含摘要**：`brief`（英文）/ `briefTranslate`（中文），取正文前 200 字，**1 积分/条**。原文与译文（`content` / `contentTranslate`）用 `detail` 按 `foreignOpinionId` 取（**30 积分/条**），或 `list --with-content`（30 积分/条，`content` / `contentTranslate` 直接在顶层，不含 `brief`）。`detail` 的分批与缺失 ID 处理同内资 `opinion detail`

- `--security`：境外证券代码，如 `UBER.N`
- ⚠️ `--region`：**本端点只接受 6 个取值**——`cn` | `cnHk` | `cnTw` | `us` | `jp` | `uk`。`regionCategory` 常量表里另外 13 个（`sea` / `gl` / `fr` / `de` / `kr` / `in` / `ca` / `me` / `othAs` / `othEur` / `latAm` / `oce` / `af`）在这里一律报 `100005 枚举值非法`，**而它们在 `insight foreign-report` 上全部合法且能正常收窄**。要按这 13 个区域筛，只能用 `foreign-report`，或不带该参数取回后按 `region` 字段本地筛
- ⚠️ `--industry`：**只认申万码**（`104xx0000`）。中信码报 `100005 枚举值非法`——即使 `reference constant-category` 把本端点列在 `citicIndustry` 的 `usageScopes` 里也一样。⚠️ **返回记录的 `industryList[]` 同时带两套码**（如 `100800122 中信非银` + `104490000 申万非银金融`），**回查时要挑申万那条**，拿中信码回查会报错
- `--broker`：外资券商 ID（见 `references/lookup-ids.md`）
- `--rating` / `--rating-change`：同研报
- 返回字段（list）：`foreignOpinionId` / `title` / `titleTranslate` / `brief` / `briefTranslate` / `publishTime` / `publisher{brokerId, brokerName}` / `securityList[]{securityCode, securityName, rating, ratingChange, targetPrice, currency}` / `industryList[]` / `region{regionCode, regionName}`；`detail` 另加 `content` / `contentTranslate`

## 外资独立观点 `insight independent-opinion list/download`

```bash
gangtise insight independent-opinion list [--rank-type <n>] [--security <code>] [--industry <id>] [--rating <name>] [--rating-change <name>]
gangtise insight independent-opinion download --independent-opinion-id <id> --file-type <n> [--output <path>]
```

- **积分**：列表 **5/条**——务必带 `--size`；下载 30/篇

- `--security`：境外证券代码，如 `GSK.N`
- ⚠️ `--industry`：**只认申万码**（`104xx0000`），中信码报 `100005 枚举值非法`（同 `foreign-opinion`，见上）。返回记录的 `industryList[]` 两套码都带，回查挑申万那条
- `--rating` / `--rating-change`：同外资观点
- `--file-type`（download **必选**）：`1` 原文 HTML | `2` 中文翻译 HTML
- 返回字段：`independentOpinionId` / `title` / `titleTranslate` / `brief` / `briefTranslate` / `publishTime` / `analyst{analystId, analystName}` / `securityList[]` / `industryList[]`

## 产业公众号资讯 `insight official-account list/download`

```bash
gangtise insight official-account list [--search-type <n>] [--rank-type <n>] [--account-id <id>] [--security <code>] [--category <type>] [--industry <id>]
gangtise insight official-account download --article-id <id> [--file-type <n>] [--output <path>]
```

- **积分**：列表 0.1/条；下载 10/篇

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
