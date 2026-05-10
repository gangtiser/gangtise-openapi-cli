# Insight 命令详细参数

所有 `insight ... list` 共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

时间格式：`"YYYY-MM-DD HH:mm:ss"`（datetime，需引号）。

支持 `--rank-type` 的命令：opinion / summary / research / foreign-report / announcement / announcement-hk / foreign-opinion / independent-opinion。
**不支持** `--rank-type` 的命令：roadshow / site-visit / strategy / forum（API 无此参数）。

`--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

---

## 内资机构观点 `insight opinion list`

```bash
gangtise insight opinion list [--keyword <text>] [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源

## 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--file-type <n>] [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认，速度快）| `2` 全文搜索
- `--source`：`1` 实时 | `2` 开放来源
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`
- `--file-type`（download 可选）：`1` 原始内容（默认）| `2` HTML 格式；**仅影响来源为会议平台的纪要**

## 路演 / 调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list   [--security <code>] [--institution <id>] [--research-area <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight site-visit list [--security <code>] [--institution <id>] [--research-area <id>] [--category <name>] [--market <name>] [--participant-role <name>] [--broker-type <name>] [--permission <n>] [--object <name>]
gangtise insight strategy list   [--institution <id>]
gangtise insight forum list      [--security <code>] [--research-area <id>]
```

- 共用：`--keyword` `--start-time` `--end-time` `--from` `--size`
- 路演 `--category`：`earningsCall` | `strategyMeeting` | `companyAnalysis` | `industryAnalysis` | `fundRoadshow`
- 调研 `--category`：`single` 单场 | `series` 系列
- 调研 `--object`：`company` | `industry`
- `--broker-type`（调研）：`cnBroker` 内资 | `otherBroker` 外资
- `--permission`（调研）：`1` 公开 | `2` 私密
- `--market`（路演/调研）：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` | `expert`

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
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--announcement-type <id>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--announcement-type`：公告类型 ID，用 `lookup announcement-category list` 查
- `--category`：栏目 ID。常用：`103910200` 财务报告、`103910700` 股权股本、`103910201` 业绩预告、`103910703` 质押冻结、`103910803` 股权激励、`103910818` 股份增减持、`103910823` 问询函（完整列表见 `references/lookup-ids.md`）
- `--file-type`（download）：`1` 原始PDF | `2` Markdown

## 港股公告 `insight announcement-hk list/download`

```bash
gangtise insight announcement-hk list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement-hk download --announcement-id <id> [--output <path>]
```

- `--security`：港股代码，如 `01913.HK`（两位数字前缀需补零）
- `--category`：港股公告类型 ID（见 `references/lookup-ids.md`）
- download 无 `--file-type`，直接下载原始文件

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
