---
name: gangtise-openapi
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  覆盖：首席观点、纪要、路演、调研、策略会、论坛、研报、外资研报、公告、日K线行情（A股/港股）、基本面（利润表/资产负债表/现金流量表/主营/估值）、AI知识库搜索、投研线索、一页通、投资逻辑、同业对比、业绩点评、主题跟踪、调研提纲、AI云盘（Vault）。

  **触发场景（即使用户没有明确提到 API 或 CLI 也要使用）**：
  - 用户提到"调接口"、"CLI"、"openapi"、"导出"、"下载研报"、"批量查"
  - 需要原始数据（非经过其他 skill 加工）、批量导出 jsonl/csv、下载 PDF
  - 查行情K线、财务报表、估值指标等结构化金融数据
  - 调用 AI 能力（知识库搜索、一页通、投资逻辑、同业对比、投研线索）

  **不要用此 skill**：个股研究工作流用 gangtise-stock-research、观点分析用 gangtise-opinion-*、仅查证券详情/板块/股东用 gangtise-data-client。当此 skill 作为数据源被其他 skill 调用时，直接执行 CLI 命令，不要再转发给其他数据 skill。
---

# Gangtise OpenAPI CLI

## 1-核心规则

1. **agent 调用务必加 `--format json`** 便于解析
2. **opaque ID 参数**（research-area / broker / institution / chief / industry / concept）— **先用 `gangtise lookup` 查准确 ID，禁止凭记忆猜测**。常用 ID 见 `references/lookup-ids.md`，不确定时 lookup 优先
3. **证券代码带后缀**：`600519.SH`（沪）、`000858.SZ`（深）、`300750.SZ`（创）、`01913.HK`（港）
   - Insight/Quote 命令用 `--security`，Fundamental 命令用 `--security-code`，注意区分
4. **时间格式**：datetime 用 `"YYYY-MM-DD HH:mm:ss"`（带引号），date 用 `YYYY-MM-DD`
5. **多值参数重复传入**：`--security 600519.SH --security 000858.SZ`
6. **`--size` 使用策略**：
   - 有时间范围时（`--start-time`/`--end-time` 或 `--start-date`/`--end-date`）：**省略 `--size`，自动翻页查全**（除非用户明确指定了条数）
   - 无时间范围时：**指定 `--size 200`**，防止一次查询数据量过大
7. **`--field` 参数可重复传入**（CLI 用 `collectList` 实现）：`--field open --field close --field volume` 等效于 API 的 `["open","close","volume"]`

## 2-List 模式：单次调用传多值，替代多次调用

大多数 CLI 参数对应 API 的 List 字段，同一参数可重复传入多个值，一次调用覆盖更广。

| 命令 | 可重复参数 |
|------|-----------|
| 首席观点 | `--security` `--broker` `--industry` `--research-area` `--chief` `--concept` `--llm-tag` `--source` |
| 纪要 / 路演 / 调研 | `--security` `--institution` `--research-area` `--category` `--market` `--participant-role` `--broker-type` `--object` |
| 研报 / 外资研报 | `--security` `--broker` `--industry` `--category` `--region` `--llm-tag` `--rating` `--rating-change` |
| 公告 | `--security` `--announcement-type` `--category` |
| 日K线（A股） | `--security` `--field` |
| 日K线（港股） | `--security` `--field` |
| 利润表/资产负债表/现金流量表 | `--fiscal-year` `--period` `--report-type` `--field` |
| 主营业务 | `--fiscal-year` `--period` `--field` |
| 估值分析 | `--field` |
| 知识库搜索 | `--query`（最多 5 个）`--resource-type` |
| 投研线索 | `--gts-code` `--source` |
| AI云盘 | `--file-type` `--space-type`（Vault 域） |

## 3-快速路由

| 用户想要 | 命令 |
|----------|------|
| 首席/分析师观点 | `insight opinion list` |
| 纪要 | `insight summary list/download` |
| 路演 / 调研 / 策略会 / 论坛 | `insight roadshow/site-visit/strategy/forum list` |
| 研报（券商） | `insight research list/download` |
| 外资研报 | `insight foreign-report list/download` |
| 公告 | `insight announcement list/download` |
| K线行情（A股） | `quote day-kline` |
| K线行情（港股） | `quote day-kline-hk` |
| 利润表 | `fundamental income-statement` |
| 资产负债表 | `fundamental balance-sheet` |
| 现金流量表 | `fundamental cash-flow` |
| 主营业务 | `fundamental main-business` |
| PE/PB/PEG 估值 | `fundamental valuation-analysis` |
| 知识库搜索 | `ai knowledge-batch` |
| 投研线索 | `ai security-clue` |
| 一页通/投资逻辑/同业对比 | `ai one-pager/investment-logic/peer-comparison` |
| 业绩点评 | `ai earnings-review` |
| 主题跟踪 | `ai theme-tracking` |
| 调研提纲 | `ai research-outline` |
| AI云盘 | `vault drive-list/download` |
| 不确定 ID | `lookup` 先查 |

---

## 4-Insight 命令

所有 insight list 命令共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

### 首席观点

```bash
gangtise insight opinion list [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <source>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

```bash
gangtise insight opinion list --broker C100000027 --llm-tag strongRcmd --start-time "2025-04-01 00:00:00" --format json
```

### 纪要

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序
- `--market`：`aShares` A股 | `hkStocks` 港股 | `usChinaConcept` 美股中概 | `usStocks` 美股
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--source`：`1` 实时 | `2` 开放来源
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other` 其他

```bash
gangtise insight summary list --market aShares --participant-role management --start-time "2025-04-01 00:00:00" --format json
```

### 路演 / 调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list [options]       # category/market/participant-role/broker-type/permission
gangtise insight site-visit list [options]     # object/category/market/permission
gangtise insight strategy list [options]       # 仅 keyword/institution/research-area
gangtise insight forum list [options]          # 仅 keyword/security/research-area
```

共用参数：`--research-area` `--institution` `--security` `--keyword` `--start-time` `--end-time` `--from` `--size`

- `--category`（路演）：`earningsCall` 业绩交流 | `strategyMeeting` 策略会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `fundRoadshow` 基金路演
- `--category`（调研）：`single` 单场调研 | `series` 系列调研
- `--market`（路演/调研）：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`（路演/调研）：`management` | `expert`
- `--broker-type`（路演/调研）：`cnBroker` 内资券商 | `otherBroker` 外资卖方
- `--permission`（路演/调研）：`1` 公开 | `2` 私密
- `--object`（调研专有）：`company` 公司调研 | `industry` 行业调研

```bash
gangtise insight site-visit list --object company --start-time "2025-04-01 00:00:00" --format json
gangtise insight roadshow list --category earningsCall --start-time "2025-04-01 00:00:00" --format json
```

### 研报

```bash
gangtise insight research list [--search-type <n>] [--rank-type <n>] [--broker <id>] [--security <code>] [--industry <id>] [--category <name>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>] [--source <type>]
gangtise insight research download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--category`：`macro` 宏观 | `strategy` 策略 | `industry` 行业 | `company` 公司 | `bond` 债券 | `quant` 金工 | `morningNotes` 晨会 | `fund` 基金 | `forex` 外汇 | `futures` 期货 | `options` 期权 | `warrants` 权证 | `market` 市场 | `wealthManagement` 理财 | `other` 其他
- `--llm-tag`：`inDepth` 深度报告 | `earningsReview` 业绩点评 | `industryStrategy` 行业策略
- `--rating`：`buy` 买入 | `overweight` 增持 | `neutral` 中性 | `underweight` 减持 | `sell` 卖出
- `--rating-change`：`upgrade` 上调 | `maintain` 维持 | `downgrade` 下调 | `initiate` 首次
- `--source`：`1` PDF研报 | `2` 公众号
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown

```bash
gangtise insight research list --industry 104340000 --category company --llm-tag inDepth --rating buy --format json
gangtise insight research download --report-id <id> --output ./report.pdf
```

### 外资研报

```bash
gangtise insight foreign-report list [--search-type <n>] [--rank-type <n>] [--security <code>] [--region <id>] [--category <name>] [--industry <id>] [--broker <id>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>]
gangtise insight foreign-report download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--region`：`cn` 中国 | `cnHk` 香港 | `cnTw` 台湾 | `us` 美国 | `jp` 日本 | `sea` 东南亚 | `gl` 全球 | `uk` 英国 | `fr` 法国 | `de` 德国 | `kr` 韩国 | `in` 印度 | `ca` 加拿大 | `me` 中东 | `othAs` 亚洲其他 | `othEur` 欧洲其他 | `latAm` 拉美 | `oce` 大洋洲 | `af` 非洲
- `--category` / `--llm-tag` / `--rating` / `--rating-change`：同研报
- `--file-type`（download）：`1` 原始PDF | `2` Markdown | `3` 中文翻译PDF | `4` 中文翻译Markdown

```bash
gangtise insight foreign-report download --report-id <id> --file-type 3 --output ./report.pdf
gangtise insight foreign-report list --region us --llm-tag inDepth --format json
```

### 公告

```bash
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--announcement-type <id>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--announcement-type`：公告类型 ID，用 `lookup announcement-category list` 查
- `--category`：栏目 ID，支持一级和二级分类。一级如 `103910200` 财务报告、`103910700` 股权股本；二级如 `103910201` 业绩预告、`103910703` 质押冻结、`103910803` 股权激励、`103910818` 股份增减持、`103910823` 问询函及回复。完整列表见 `references/lookup-ids.md`
- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序
- `--file-type`（download）：`1` 原始PDF | `2` Markdown
- 时间参数自动转 13 位时间戳，照常传 `"YYYY-MM-DD HH:mm:ss"`

```bash
gangtise insight announcement list --security 600519.SH --category 103910200 --format json
gangtise insight announcement download --announcement-id <id> --file-type 2 --output ./announcement.md
```

---

## 5-Quote 命令

### 日K线（A股）

```bash
gangtise quote day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 仅支持 A 股：上交所（`.SH`）、深交所（`.SZ`）、北交所（`.BJ`）
- `--security`：可选，不传默认返回全市场；可重复传入多只
- `--start-date`：可选，默认 `endDate` 往前一年
- `--end-date`：可选，默认最新一条
- `--limit`：单次请求最大返回行数，默认 5000，系统上限 10000（超过请缩短日期区间分批拉取）

可选字段：`securityCode` 证券代码 | `tradeDate` 交易日期 | `open` 开盘价 | `high` 最高价 | `low` 最低价 | `close` 收盘价 | `preClose` 昨收价 | `change` 涨跌额 | `pctChange` 涨跌幅(%) | `volume` 成交量(手) | `amount` 成交总额(元) | `adjustFactor` 复权因子

```bash
gangtise quote day-kline --security 600519.SH --security 300750.SZ --start-date 2025-01-01 --end-date 2025-03-31 --format json
```

### 日K线（港股）

```bash
gangtise quote day-kline-hk [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 仅支持港股：港交所（`.HK`）
- 参数规则与 A 股日K线一致：`--security` 可选（不传返回全市场），`--start-date`/`--end-date` 可选，`--limit` 默认 5000 上限 10000

可选字段：`securityCode` 证券代码 | `tradeDate` 交易日期 | `open` 开盘价 | `high` 最高价 | `low` 最低价 | `close` 收盘价 | `preClose` 昨收价 | `change` 涨跌额 | `pctChange` 涨跌幅(%) | `volume` 成交量(手) | `amount` 成交总额(元) | `adjustFactor` 复权因子

```bash
gangtise quote day-kline-hk --security 00700.HK --start-date 2025-01-01 --end-date 2025-03-31 --format json
```

---

## 6-Fundamental 命令

三大报表（利润表/资产负债表/现金流量表）共享参数格式：

```bash
gangtise fundamental <command> --security-code <code> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- `--period`：`q1` 一季报 | `interim` 中报 | `q3` 三季报 | `annual` 年报 | `latest` 最新一期（默认）
- `--report-type`：`consolidated` 合并报表（默认）| `consolidatedRestated` 合并报表（调整）| `standalone` 母公司报表 | `standaloneRestated` 母公司报表（调整）
- `--start-date`/`--end-date`：有值时覆盖 `--fiscal-year` 筛选
- `--fiscal-year` 可重复：`--fiscal-year 2023 --fiscal-year 2024 --fiscal-year 2025`

### 利润表 (`income-statement`)

可选字段：`totalOpRev` 营业总收入 | `opRev` 营业收入 | `totalOpCost` 营业总成本 | `opCost` 营业成本 | `nonOpNetIncome` 非经营性净收益 | `opProfit` 营业利润 | `totalProfit` 利润总额 | `netProfit` 净利润 | `netProfitAttrParent` 归母净利润 | `basicEPS` 基本每股收益 | `dilutedEPS` 稀释每股收益 | `invIncome` 投资净收益 | `salesExp` 销售费用 | `totalAdminExp` 管理费用合计 | `rdExp` 研发费用 | `finExp` 财务费用 | `creditImpairLossProfit` 信用减值损失 | `assetImpairLossProfit` 资产减值损失 | `otherCompIncome` 其他综合收益税后净额 | `totalCompIncome` 综合收益总额

```bash
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2025 --period q3 --field totalOpRev --field netProfit --field basicEPS --format json
```

### 资产负债表 (`balance-sheet`)

可选字段：`totalCurrAssets` 流动资产合计 | `totalNonCurrAssets` 非流动资产合计 | `totalAssets` 资产总计 | `totalCurrLiab` 流动负债合计 | `totalNonCurrLiab` 非流动负债合计 | `totalLiab` 负债合计 | `totalParentEq` 归母所有者权益 | `totalEquity` 所有者权益合计 | `totalLAndE` 负债和所有者权益总计 | `monetaryAssets` 货币资金 | `inventory` 存货 | `goodwill` 商誉 | `shareCapital` 股本 | `retainedEarn` 未分配利润 | `ltEquityInvest` 长期股权投资 | `totalPPE` 固定资产合计 | `intangAssets` 无形资产 | `stBorrowings` 短期借款 | `ltBorrowings` 长期借款 | `contractLiab` 合同负债 | `capReserve` 资本公积 | `nonControllingInterests` 少数股东权益

```bash
gangtise fundamental balance-sheet --security-code 600519.SH --fiscal-year 2025 --period q3 --field totalCurrAssets --field totalCurrLiab --format json
```

### 现金流量表 (`cash-flow`)

可选字段：`netOpCashFlows` 经营活动现金流量净额 | `netInvCashFlows` 投资活动现金流量净额 | `netFinCashFlows` 筹资活动现金流量净额 | `cashFromSales` 销售商品收到的现金 | `cashPaidForGoodsServices` 购买商品支付的现金 | `cashPaidEmployees` 支付给职工的现金 | `cashPaidTaxes` 支付的各项税费 | `cashPaidInvestments` 投资支付的现金 | `cashPaidDebtRepayment` 偿还债务支付的现金 | `cashPaidDividendsInterest` 分配股利或偿付利息支付的现金 | `netIncCashEquivalents` 现金及现金等价物净增加额 | `closingCashBalance` 期末现金及现金等价物余额 | `addOpeningCashBalance` 期初现金及现金等价物余额 | `fxEffectOnCash` 汇率变动对现金的影响 | `subtotalOpInflows` 经营活动现金流入小计 | `subtotalOpOutflows` 经营活动现金流出小计

```bash
gangtise fundamental cash-flow --security-code 600519.SH --fiscal-year 2025 --period q3 --field netOpCashFlows --field netInvCashFlows --field netFinCashFlows --format json
```

### 主营业务 (`main-business`)

```bash
gangtise fundamental main-business --security-code <code> --breakdown <type> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <type>] [--field <name>]
```

- `--breakdown`（必选）：`product` 按产品 | `industry` 按行业 | `region` 按地区
- `--period`：`interim` 中报 | `annual` 年报

可选字段：`opRevenue` 营业收入 | `opRevenueYoy` 营业收入同比增速 | `opRevenueRatio` 营业收入占比 | `opCost` 营业成本 | `opCostYoy` 营业成本同比增速 | `opCostRatio` 营业成本占比 | `grossProfit` 毛利 | `grossProfitYoy` 毛利同比增速 | `grossProfitRatio` 毛利占比 | `grossMargin` 毛利率 | `grossMarginYoy` 毛利率同比变化 | `grossMarginRatio` 毛利率占比

```bash
gangtise fundamental main-business --security-code 600519.SH --breakdown region --format json
```

### 估值分析 (`valuation-analysis`)

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- `--indicator`（必选）：`peTtm` 滚动市盈率 | `pbMrq` 市净率 | `peg` PEG | `psTtm` 滚动市销率 | `pcfTtm` 滚动市现率 | `em` 企业倍数
- `--limit`：最大返回行数，默认 2000
- 默认查近一年（省略 `--start-date` 时自动向前一年）

可选字段：`value` 原始值 | `percentileRank` 分位点 | `average` 平均值 | `median` 中位数 | `p10` 10分位 | `p25` 25分位 | `p75` 75分位 | `p90` 90分位 | `upper1Std` +1标准差 | `lower1Std` -1标准差

```bash
gangtise fundamental valuation-analysis --security-code 600519.SH --indicator peTtm --start-date 2022-01-01 --end-date 2025-04-01 --format json
```

---

## 7-AI 命令

### 知识库搜索

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>] [--start-time <ms>] [--end-time <ms>]
```

- `--query`（可重复，最多 5 个）：语义搜索问题
- `--top`：返回文档数，默认 10，最大 20
- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库

```bash
gangtise ai knowledge-batch --query 贵州茅台 --query 白酒行业 --resource-type 10 --top 5 --format json
```

### 知识资源下载

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回结果），错误组合返回 `433007`。

### 投研线索

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>] [--from <n>] [--size <n>]
```

- `--query-mode`（必选）：`bySecurity` 按证券 | `byIndustry` 按行业
- `--source`：`researchReport` 研报 | `conference` 电话会议 | `announcement` 公告 | `view` 观点
- `--gts-code`：个股代码或申万行业代码（如 `821035.SWI`），行业代码用 `lookup industry-code list` 查

```bash
gangtise ai security-clue --start-time "2025-03-01 00:00:00" --end-time "2025-04-01 00:00:00" --query-mode byIndustry --gts-code 821035.SWI --format json
```

### 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager --security-code <code>         # 支持 A 股、港股
gangtise ai investment-logic --security-code <code>   # 支持 A 股、港股
gangtise ai peer-comparison --security-code <code>    # 支持 A 股、港股
```

### 业绩点评

```bash
gangtise ai earnings-review --security-code <code> --period <period> [--wait]
gangtise ai earnings-review-check --data-id <id>
```

- `--security-code`（必选）：目前仅支持 A 股
- `--period`（必选）：`年份+报告期`，如 `2025q3`（q1/interim/q3/annual）
- `--wait`：阻塞等待生成（最多 3 分钟），默认立即返回 dataId
- 支持最近 6 期财报，生成需 1-3 分钟

**异步工作流：**
1. 执行 `gangtise ai earnings-review ... --format json` → 返回 `{"dataId":"xxx","status":"pending"}`
2. 等待约 2 分钟
3. 执行 `gangtise ai earnings-review-check --data-id xxx --format json`
4. 若仍 `pending` → 再等 2 分钟重试；若返回内容 → 展示给用户

```bash
gangtise ai earnings-review --security-code 600519.SH --period 2025q3 --format json
```

### 主题跟踪

```bash
gangtise ai theme-tracking --theme-id <id> --date <yyyy-MM-dd> [--type <name>]
```

- `--theme-id`（必选）：主题 ID，完整列表用 `lookup theme-id list` 查
- `--date`（必选）：查询日期，支持近 30 天
- `--type`：`morning` 晨报 | `night` 晚报（不传则返回晨报+晚报）

```bash
gangtise ai theme-tracking --theme-id 121000131 --date 2026-03-01 --type morning --format json
```

### 调研提纲

```bash
gangtise ai research-outline --security-code <code>
```

- `--security-code`（必选）：目前仅支持 A 股

```bash
gangtise ai research-outline --security-code 600519.SH --format json
```

## 8-Vault数据（私域）

### AI 云盘

```bash
gangtise vault drive-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault drive-download --file-id <id> [--output <path>]
```

- `--file-type`：`1` 文档 | `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 租户云盘

---

## Lookup 命令

不确定 ID 时先查枚举，避免无效调用：

```bash
gangtise lookup research-area list        # 研究方向 ID
gangtise lookup broker-org list           # 券商机构 ID
gangtise lookup meeting-org list          # 会议机构 ID
gangtise lookup industry list             # 行业 ID
gangtise lookup region list               # 外资研报区域 ID
gangtise lookup announcement-category list # 公告分类 ID
gangtise lookup industry-code list        # 申万行业代码（security-clue --gts-code 用）
gangtise lookup theme-id list             # 主题 ID（theme-tracking --theme-id 用）
```

```bash
gangtise lookup broker-org list --format json | grep 中信建投
```

## Raw 调用

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

endpoint key 如 `insight.opinion.list`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch` 等。

---

## 常见错误码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `999999` | 系统错误 | 重试或联系管理员 |
| `999997` | 未开通接口权限 | 联系管理员开通 |
| `999995` | 积分不足 | 联系管理员充值 |
| `900002` | uid 为空 | 检查认证状态 |
| `900001` | 请求参数为空 | 检查请求参数 |
| `8000014` | 开发账号 AK 错误 | 检查 accessKey |
| `8000015` | 开发账号 SK 错误 | 检查 secretKey |
| `8000016` | 开发账号状态异常 | 联系管理员 |
| `8000018` | 开发账号已到期 | 续费或联系管理员 |
| `903301` | 今日调用次数达上限 | 等待次日或升级配额 |
| `433007` | 数据源不匹配 | 检查 resourceType + sourceId 组合 |
| `410004` | 数据未找到 | 检查查询条件 |
| `10011401` | 数据受白名单权限控制 | 联系管理员开通白名单 |

## 常用 ID 速查

需要查 ID 时优先使用 `gangtise lookup` 命令。高频 ID 可参考 `references/lookup-ids.md`，其中包含：

- 中信行业分类 / 申万行业分类 / 申万行业代码
- 常用内资券商 / 外资券商 / 会议机构 / 研究方向
- 外资研报区域 / 公告分类（含二级分类）

当 `references/lookup-ids.md` 中没有所需 ID 时，务必执行 `gangtise lookup` 查询，不要凭记忆猜测。
