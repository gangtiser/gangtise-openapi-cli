# Insight 命令详细参数

所有 `insight ... list` 共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

时间格式：`"YYYY-MM-DD HH:mm:ss"`（datetime，需引号）。

支持 `--rank-type` 的命令：opinion / summary / **pamirs-summary** / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。

**`--rank-type 1`（默认）按相关度挑条目，`--rank-type 2` 严格按 `publishTime` 倒序取最新的。** 两者从同一结果集里取的是**不同的子集**，不是同一批内容换个排法。

| 想要 | 用 |
| :--- | :--- |
| 最相关的内容（可以是旧的） | `--rank-type 1` + `--keyword` |
| 最新的内容（按时间铺） | `--rank-type 2` |

🔴 **两档差别有多大取决于关键词，别拿一个关键词去判断这个参数有没有用**。同一天、同一命令实测（前 50 条比条目 ID）：

| 关键词 | `research` 两档交集 | `summary` 两档交集 |
| :--- | ---: | ---: |
| `机器人` / `PCB` | 50/50（**完全相同**） | 50/50 |
| `固态电池` / `半导体设备` | 50/50 | 50/50 |
| `人形机器人` | 9/50 | 15/50 |
| `新能源汽车` | 2/50 | 0/50 |

**判据不是「词够不够具体」**（`固态电池` / `半导体设备` 都很具体，却毫无差别），而是**看 `total` 与组成词的关系**——用 `--size 1` 各查一次即可，免费：

| 关键词 | `total` | 与组成词比 | 两档 |
| :--- | --: | :--- | --: |
| `新能源汽车` | 79059 | **大于**「新能源」42406 与「汽车」48474 单独查 → 近似并集 | 差别大 |
| `人形机器人` | 12165 | ≈ 最大组成词「机器人」12164 → 也是拆词 | 差别大 |
| `固态电池` | 1156 | **小于**「固态」1541 与「电池」12569 → 近似交集 | 无差别 |

`total` 比组成词大（服务端把词拆开按 OR 找）时，候选里既有整词命中也有只中一半的，相关度拉得开，两档取的自然是不同的批；`total` 比组成词小（按整个短语找）时全是真命中、相关度并列，两档就是同一批。**这属正常，不是参数没生效**。

`新能源汽车` 那组里 `--rank-type 1` 前 50 有 47 条标题含「新能源」、22 条含完整词「新能源汽车」，`--rank-type 2` 分别是 28 条和 **0 条**——**综合排序确实在按相关度挑**。

⚠️ **`--search-type` 不影响 `--rank-type 1` 取回哪些条目**：实测多组「命令 × 关键词」组合无一例外：`--search-type 1` 与 `2` 下 `--rank-type 1` 的前 50 条**逐位相同**，其中一组 `total` 从 1522 涨到 45257（近 30 倍）仍逐位不变。`--search-type 2`（全文）扩大的是命中总数和 `--rank-type 2` 的候选池。**所以「要最相关」不需要加 `--search-type 2`。**

⚠️ **没有 `--keyword` 时两档结果一致**，这不是参数失效——没有关键词就无从计算相关度。

⚠️ **别用「返回结果是不是按时间倒序」判断综合排序有没有生效** —— `--rank-type 1` **挑完之后仍按时间倒序排列**，所以两种取值下返回序列都是时间单调的。要看差别就**比条目 ID 集合**，不是比排序。
**不支持** `--rank-type` 的命令：roadshow / site-visit / strategy / forum（API 无此参数）。

`--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

---

## 内资机构观点 `insight opinion list`

```bash
gangtise insight opinion list [--keyword <text>] [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--industry`：用 `citicIndustry` 码 `1008001xx`；申万码 `104xx0000` 也生效，但**两套码的行业成分不同、取回的结果集不一致**（同一行业实测相差约 5%），同一批查询别混用。`--research-area`：行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`，**申万码在本端点返 0**。详见 `reference-and-lookup.md`

## 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认，速度快）| `2` 全文搜索
- `--source`：`1` 实时 | `2` 开放来源
- `--research-area`：行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`。summary 是少数**申万码 `104xx0000` 也生效**的端点，但两套行业码取到的集合略有出入（同一行业实测相差约 2%），同一批查询里别混用
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`
- `--file-type`（download 可选）：`1` 原始内容（默认）| `2` HTML 格式；**仅影响来源为会议平台的纪要**

## 帕米尔纪要 `insight pamirs-summary list/download`

```bash
gangtise insight pamirs-summary list [--search-type <n>] [--rank-type <n>] [--research-area <id>] [--security <code>] [--category <name>] [--market <name>]
gangtise insight pamirs-summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

帕米尔（Pamirs）是平台内一个特殊牵头机构的**专家纪要库**，走独立端点，不是 `summary list` 的一个筛选项。⚠️ **需单独购买专家纪要数据库**：未开通时 `list` 直接报 `999004`（不是返回空列表），**整库拿不到**。**不限制历史数据范围**（不受 3 个月窗口约束）。

> 未开通该库时任何查询都直接报 `999004`，不必怀疑参数写错。下面各参数的行为描述来自已开通账号的实测。

- **筛选项比 `summary` 少**：没有 `--source` / `--institution` / `--participant-role`。不认识的 body 字段会被丢弃且不报错，所以别照搬 `summary` 的参数，那样只会拿到没过滤的全量
- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索。同一关键词全文搜索的命中数明显多于标题搜索
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序。⚠️ 效果依赖 `--keyword`，详见本文开头的公共说明
- `--category`：`companyAnalysis` 公司分析 | `industryAnalysis` 行业分析（两者过滤均生效，公司分析占绝大多数）
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--research-area`：**行业码两套都生效**——citic `1008001xx` 和申万 `104xx0000`。申万码这点与多数 insight list 不同（那些只有 summary 认申万码）。⚠️ 反过来，**方向码 `122000xxx` 在本端点返 0**，别在这里传方向
- `--file-type`（download 可选）：`1` 原始文件（默认）| `2` HTML；**只有这两种**
- 单页上限：spec 写 50，实际传更大的 `size` 也会照数返回。**CLI 仍按 50 翻页**——保守值在上限某天开始执行时不会被静默截断。省略 `--size` 自动翻页拉全量。翻页完整性实测干净：连续三页无重复无缺口、可重放、`total` 不漂移
- 返回字段：`summaryId` / `title` / `brief`（摘要）/ `summaryTime`（纪要注明的生成时间）/ `publishTime`（发布时间）/ `categoryList` / `securityList[]{securityCode, securityName}` / `researchAreaList[]{researchAreaId, researchAreaName}` / `conceptList[]{conceptId, conceptName}` / `marketList`
- ⚠️ **`conceptList` / `categoryList` / `marketList` 三个标签字段稀疏，且是否有值随记录和查法而变**：
  - **不带筛选时经常整条为空**，用 `--category` 或 `--market` 过滤时回填率明显更高（这两个字段是绑定的：用任一过滤，两个都会有值）。有值时给的是该记录的**全部**值（多市场纪要按 `aShares` 过滤也回 `["aShares","hkStocks"]`，不是"回显过滤值"）
  - **所以别拉全量再本地分组**——会漏掉大量记录。要按类别/市场分组就逐个枚举值各查一遍再合并（请求数放大 2~4 倍），或直接让服务端筛
  - **反过来也别据此断言某条记录没有该属性**——标签为空只说明这次查询没回填，不代表该纪要真的没有概念/分类/市场归属
  - `researchAreaList` 和 `securityList` 相对完整，抽样空值比例都在 10% 以内

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
- ⚠️ `--region`：`cn` | `cnHk` | `cnTw` | `us` | `jp` | `uk` | `gl`——**本端点上该过滤当前取不到数据**：除 `gl` 外的取值返回 `null` payload 而不是报错。需要按区域筛请不带该参数取回后按 `region` 字段本地筛。注意这是本端点的情况，`insight foreign-report` 的 `--region` 可正常收窄结果
- ⚠️ `--industry`：**当前传任何值都拿不到数据**（中信码 / 申万码 / 乱码一样，不报错、退出码 0）。🔴 **返回的 payload 是字面 `null`，不是 `{total:0,list:[]}`** ——按空列表解析的脚本（`data.list.length`、`for row in data["list"]`）会在这里抛错或静默跳过，务必先判 `null`。需要按行业筛时不带该参数取回后本地按 `industryList[]` 筛
- `--broker`：外资券商 ID（见 `references/lookup-ids.md`）
- `--rating` / `--rating-change`：同研报
- 返回字段：`foreignOpinionId` / `title` / `titleTranslate` / `content` / `contentTranslate` / `publishTime` / `publisher{brokerId, brokerName}` / `securityList[]{securityCode, rating, targetPrice, currency}` / `region`

## 外资独立观点 `insight independent-opinion list/download`

```bash
gangtise insight independent-opinion list [--rank-type <n>] [--security <code>] [--industry <id>] [--rating <name>] [--rating-change <name>]
gangtise insight independent-opinion download --independent-opinion-id <id> --file-type <n> [--output <path>]
```

- `--security`：境外证券代码，如 `GSK.N`
- ⚠️ `--industry`：**当前传任何值都拿不到数据，且 payload 是字面 `null` 而非空 list**（同 foreign-opinion，注意事项见上），改用不带该参数取回后按 `industryList[]` 本地筛
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
