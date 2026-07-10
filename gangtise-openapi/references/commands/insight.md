# Insight 命令详细参数

所有 `insight ... list` 共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

时间格式：`"YYYY-MM-DD HH:mm:ss"`（datetime，需引号）。

支持 `--rank-type` 的命令：opinion / summary / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。
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
