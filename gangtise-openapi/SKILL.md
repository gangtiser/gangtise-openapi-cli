---
name: gangtise-openapi
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下

  **适用**：原始数据导出、批量jsonl/csv、下载PDF/MD、行情K线、财务报表、估值指标、AI能力（一页通/投资逻辑/同业对比/线索/业绩点评/主题跟踪/调研提纲/知识库搜索）、云盘文件管理（Vault）

  **不适用**：个股研究→gangtise-stock-research；观点总结/PK→gangtise-opinion-*；证券详情/板块/股东元数据→gangtise-data-client
---

# Gangtise OpenAPI CLI

## 核心规则

1. **始终加 `--format json`** — agent 需要解析返回值进行下一步处理，纯文本格式会丢失结构信息
2. **opaque ID 先查再用** — research-area / broker / institution / chief / industry / concept 等 ID 不是连续数字，凭猜测几乎必错。先用 `gangtise lookup` 查，高频 ID 见 `references/lookup-ids.md`
3. **证券代码带交易所后缀**：`600519.SH`（沪）、`000858.SZ`（深）、`300750.SZ`（创）、`01913.HK`（港）
   - Insight/Quote 命令：`--security`；Fundamental 命令：`--security-code`（注意区分）
4. **时间格式**：datetime 用 `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date 用 `YYYY-MM-DD`
5. **多值参数重复传**：`--security 600519.SH --security 000858.SZ`（不是逗号分隔）
6. **分页策略**：
   - Insight/Vault/投研线索 命令用 `--size`，Quote/Fundamental 命令用 `--limit`
   - 有时间范围 → 省略分页参数，自动翻页查全
   - 无时间范围 → 指定 `--size 200`（Insight）或 `--limit 500`（Quote/Fundamental），避免拉取过量数据
   - `--from` 表示起始偏移量，可与 `--size` 配合实现自定义分页
7. **`--field` 可重复传入**：`--field open --field close --field volume`。可用字段见 `references/fields.md`

## List 模式：同一参数可重复，一次调用覆盖多值

| 命令组 | 可重复参数 |
|--------|-----------|
| 首席观点 | `--security` `--broker` `--industry` `--research-area` `--chief` `--concept` `--llm-tag` `--source` |
| 纪要/路演/调研 | `--security` `--institution` `--research-area` `--category` `--market` `--participant-role` `--broker-type` `--object` |
| 研报/外资研报 | `--security` `--broker` `--industry` `--category` `--region` `--llm-tag` `--rating` `--rating-change` |
| 公告 | `--security` `--announcement-type` `--category` |
| 日K线(A股/港股) | `--security` `--field` |
| 财务报表 | `--fiscal-year` `--period` `--report-type` `--field` |
| 知识库搜索 | `--query`（最多5个）`--resource-type` |
| 投研线索 | `--gts-code` `--source` |
| AI云盘 | `--file-type` `--space-type` |

## 执行工作流

每次调用遵循以下步骤：

1. **解析意图** — 从「意图路由表」匹配命令；匹配不到时按命令组名猜测（如"研报"→insight research）
2. **解析参数** — 公司名→证券代码（查「公司名速查表」或 fallback 查询）；opaque ID→查 lookup 或 `references/lookup-ids.md`
3. **过检查点** — 逐条过「决策检查点」，需要用户确认的必须先问
4. **拼命令** — 加 `--format json`；按核心规则处理时间/分页/多值参数
5. **执行** — 运行命令，检查返回 `code` 字段：`200` 成功，其他查错误码表
6. **处理结果** — 空结果时建议扩大范围或换关键词；异步任务按轮询流程处理

### 模糊时间词默认映射

用户说"最近/近期"时，如果未明确指定天数，按以下规则处理：

| 模糊词 | 默认时间范围 | 对应参数 |
|--------|------------|----------|
| 最近/近期 | 当前日期往前 7 天 | `--start-time "<7天前日期> 00:00:00"` `--end-time "<当前日期> 23:59:59"` |
| 最近一个月 | 当前日期往前 30 天 | 同上，30 天 |
| 今年 | 当年 1/1 至今 | `--start-time "<当年>-01-01 00:00:00"` |

同时在洞察命令加 `--rank-type 2`（时间倒序），确保最新结果优先。

### 典型执行示例

**用户说："帮我查一下贵州茅台最近一周的研报"**

```
Step 1: 意图路由 → insight research list
Step 2: 贵州茅台 → 600519.SH（速查表）；"最近一周" → --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59"
Step 3: 检查点 → 认证OK、代码已知、有明确时间范围无需确认数据量
Step 4: gangtise insight research list --security 600519.SH --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --format json
Step 5: 检查返回 code=200，提取 data 数组
```

**用户说："比亚迪的一页通"**

```
Step 1: 意图路由 → ai one-pager
Step 2: 比亚迪 → 002594.SZ（速查表）；一页通用 --security-code（不是 --security）
Step 3: 检查点 → 认证OK、代码已知
Step 4: gangtise ai one-pager --security-code 002594.SZ --format json
```

**用户说："查一下最近有哪些首席观点提到AI"**

```
Step 1: 意图路由 → insight opinion list
Step 2: "最近"→默认7天；"AI"→--keyword AI
Step 3: 检查点 → 模糊时间已自动映射，无需确认
Step 4: gangtise insight opinion list --keyword AI --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --rank-type 2 --format json
```

## 意图路由表

用户意图 → 命令快速映射（避免从 20+ 子命令中猜测）：

| 用户意图 | 命令 | 关键参数 |
|----------|------|----------|
| 研报/券商报告 | `insight research list` | `--security` `--broker` `--industry` `--start-time` |
| 外资研报 | `insight foreign-report list` | `--security` `--region` `--broker` |
| 首席观点/分析师观点 | `insight opinion list` | `--keyword` `--research-area` `--chief` |
| 纪要/会议纪要 | `insight summary list` | `--security` `--institution` `--category` |
| 路演 | `insight roadshow list` | `--security` `--institution` |
| 调研 | `insight site-visit list` | `--security` `--institution` |
| 策略会 | `insight strategy list` | `--keyword` `--institution` |
| 论坛 | `insight forum list` | `--keyword` `--security` |
| 公告 | `insight announcement list` | `--security` `--category` |
| 日K线/行情 | `quote day-kline` | `--security` `--start-date` `--field` |
| 港股K线 | `quote day-kline-hk` | `--security` `--start-date` |
| 利润表/营收/净利润 | `fundamental income-statement` | `--security-code` `--fiscal-year` `--field` |
| 资产负债表 | `fundamental balance-sheet` | `--security-code` `--fiscal-year` `--field` |
| 现金流量表 | `fundamental cash-flow` | `--security-code` `--fiscal-year` `--field` |
| 主营业务/收入结构 | `fundamental main-business` | `--security-code` `--breakdown` |
| 估值/PE/PB | `fundamental valuation-analysis` | `--security-code` `--indicator` |
| 知识库搜索 | `ai knowledge-batch` | `--query` `--resource-type` |
| 一页通/个股概览 | `ai one-pager` | `--security-code` |
| 投资逻辑 | `ai investment-logic` | `--security-code` |
| 同业对比/竞对 | `ai peer-comparison` | `--security-code` |
| 业绩点评 | `ai earnings-review` | `--security-code` `--period` |
| 投研线索 | `ai security-clue` | `--query-mode` `--gts-code` `--source` |
| 主题跟踪 | `ai theme-tracking` | `--theme-id` `--date` |
| 调研提纲 | `ai research-outline` | `--security-code` |
| 云盘文件 | `vault drive-list` | `--keyword` `--file-type` |
| 下载文件 | `insight <type> download` 或 `vault drive-download` | `--<type>-id` `--output` |

## 公司名 → 证券代码

用户常只给公司名（如"茅台"），agent 需转为带交易所后缀的代码。查找方式（按优先级）：

1. **常用代码速查**（高频可直接映射）：
   | 公司 | 代码 | 公司 | 代码 |
   |------|------|------|------|
   | 贵州茅台 | `600519.SH` | 宁德时代 | `300750.SZ` |
   | 比亚迪 | `002594.SZ` | 招商银行 | `600036.SH` |
   | 中国平安 | `601318.SH` | 腾讯控股 | `00700.HK` |
   | 工商银行 | `601398.SH` | 美团 | `03690.HK` |
   | 中芯国际 | `688981.SH` | 药明康德 | `603259.SH` |

2. **不确定时**：用 `gangtise-data-client` skill 查证券详情（如果可用），或用 `gangtise ai knowledge-batch --query <公司名>` 搜索，从返回结果中提取代码

3. **交易所后缀规则**：`.SH` 上交所（6开头）| `.SZ` 深交所（0/3开头）| `.BJ` 北交所 | `.HK` 港股

## 决策检查点

调用任何命令前，按顺序过以下检查：

1. **认证** — 先 `gangtise auth status`，未登录则提示配置 AK/SK，不要盲目调接口
2. **ID 参数** — 需要传 broker / institution / industry / chief / region / theme-id 等 opaque ID 时：
   - 高频 → 查 `references/lookup-ids.md`
   - 不确定 → 先 `gangtise lookup <type> list`，**绝不猜测**
3. **证券代码** — 用户只给公司名（如"茅台"）→ 须补交易所后缀 `600519.SH`；不确定时先搜索确认，不要用错后缀
4. **数据量** — 无时间范围的 list 查询默认 `--size 200`；若用户未指定范围且数据量可能很大，先确认是否需要全量
5. **下载格式** — download 前确认用户需要原始 PDF（`--file-type 1`）还是 Markdown（`--file-type 2`）；外资研报另有中文翻译版本（`--file-type 3/4`）
6. **异步任务** — `ai earnings-review` 默认立即返回 dataId，需告知用户等待流程：调一次 → 等 2min → `earnings-review-check` → 若 pending 再等

---

## Insight 命令

所有 insight list 共享：`--keyword` `--start-time` `--end-time` `--from` `--size`

### 首席观点 `insight opinion list`

```bash
gangtise insight opinion list [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

### 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--output <path>]
```

- `--search-type`：`1` 标题（默认）| `2` 全文
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--source`：`1` 实时 | `2` 开放来源
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`

### 路演/调研/策略会/论坛

```bash
gangtise insight roadshow list [options]     # 路演
gangtise insight site-visit list [options]   # 调研
gangtise insight strategy list [options]     # 策略会（仅 keyword/institution）
gangtise insight forum list [options]        # 论坛（仅 keyword/security/research-area）
```

共用参数：`--research-area` `--institution` `--security` `--keyword` `--start-time` `--end-time` `--from` `--size`

路演/调研额外参数：
- `--category`（路演）：`earningsCall` | `strategyMeeting` | `companyAnalysis` | `industryAnalysis` | `fundRoadshow`
- `--category`（调研）：`single` 单场 | `series` 系列
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` | `expert`
- `--broker-type`：`cnBroker` 内资 | `otherBroker` 外资
- `--permission`：`1` 公开 | `2` 私密
- `--object`（调研专有）：`company` | `industry`

### 研报 `insight research list/download`

```bash
gangtise insight research list [--search-type <n>] [--rank-type <n>] [--broker <id>] [--security <code>] [--industry <id>] [--category <name>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>] [--source <type>]
gangtise insight research download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--category`：`macro` | `strategy` | `industry` | `company` | `bond` | `quant` | `morningNotes` | `fund` | `forex` | `futures` | `options` | `warrants` | `market` | `wealthManagement` | `other`
- `--llm-tag`：`inDepth` 深度报告 | `earningsReview` 业绩点评 | `industryStrategy` 行业策略
- `--industry`：仅 `industry`/`company` 类别研报时生效
- `--rating`：`buy` | `overweight` | `neutral` | `underweight` | `sell`
- `--rating-change`：`upgrade` | `maintain` | `downgrade` | `initiate` 首次
- `--source`：`1` PDF研报 | `2` 公众号
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown

### 外资研报 `insight foreign-report list/download`

```bash
gangtise insight foreign-report list [--search-type <n>] [--rank-type <n>] [--security <code>] [--region <id>] [--category <name>] [--industry <id>] [--broker <id>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>]
gangtise insight foreign-report download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--region`：`cn` 中国 | `cnHk` 香港 | `us` 美国 | `jp` 日本 | `sea` 东南亚 | `gl` 全球 | `uk` 英国 | `kr` 韩国 | `in` 印度 等（完整列表见 `references/lookup-ids.md`）
- `--category` / `--llm-tag` / `--rating` / `--rating-change`：同研报
- `--file-type`（download）：`1` 原始PDF | `2` Markdown | `3` 中文翻译PDF | `4` 中文翻译Markdown

### 公告 `insight announcement list/download`

```bash
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--announcement-type <id>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--announcement-type`：公告类型 ID，用 `lookup announcement-category list` 查
- `--category`：栏目 ID。常用：`103910200` 财务报告、`103910700` 股权股本、`103910201` 业绩预告、`103910703` 质押冻结、`103910803` 股权激励、`103910818` 股份增减持、`103910823` 问询函。完整列表见 `references/lookup-ids.md`
- `--file-type`（download）：`1` 原始PDF | `2` Markdown

---

## Quote 命令

### 日K线（A股）`quote day-kline`

```bash
gangtise quote day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 仅支持 A 股（`.SH` `.SZ` `.BJ`），不传 `--security` 返回全市场
- `--limit` 默认 5000，上限 10000（超过请缩短日期区间分批拉取）
- 常用字段：`open` `high` `low` `close` `pctChange` `volume` `amount`（完整列表见 `references/fields.md`）

### 日K线（港股）`quote day-kline-hk`

```bash
gangtise quote day-kline-hk [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 仅支持港股（`.HK`），参数规则与 A 股日K线一致

---

## Fundamental 命令

三大报表共享参数：

```bash
gangtise fundamental <income-statement|balance-sheet|cash-flow> --security-code <code> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- `--period`：`q1` | `interim` 中报 | `q3` | `annual` | `latest`（默认）
- `--report-type`：`consolidated`（默认）| `consolidatedRestated` | `standalone` | `standaloneRestated`
- `--fiscal-year` 可重复：`--fiscal-year 2023 --fiscal-year 2024`
- `--start-date`/`--end-date` 有值时覆盖 `--fiscal-year` 筛选
- 各报表可用字段见 `references/fields.md`
- **固定返回字段**（无需通过 `--field` 指定）：`securityCode` `companyName` `category` `announcementDate` `endDate` `fiscalYear` `period` `reportType` `companyType` `currency` `unit`

**常用字段速查：**
- 利润表：`totalOpRev` 营收 | `netProfit` 净利润 | `netProfitAttrParent` 归母 | `basicEPS` EPS | `rdExp` 研发
- 资产负债表：`totalAssets` 总资产 | `totalLiab` 总负债 | `totalParentEq` 归母权益 | `monetaryAssets` 货币资金
- 现金流：`netOpCashFlows` 经营净现金流 | `netInvCashFlows` 投资净现金流 | `netFinCashFlows` 筹资净现金流

### 主营业务 `fundamental main-business`

```bash
gangtise fundamental main-business --security-code <code> --breakdown <type> [--fiscal-year <year>] [--period <type>] [--field <name>]
```

- `--breakdown`（必选）：`product` 按产品 | `industry` 按行业 | `region` 按地区
- `--period`：`interim` 中报 | `annual` 年报
- 可用字段见 `references/fields.md`

### 估值分析 `fundamental valuation-analysis`

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- `--indicator`（必选）：`peTtm` 滚动PE | `pbMrq` PB | `peg` PEG | `psTtm` 滚动PS | `pcfTtm` 滚动PCF | `em` 企业倍数
- `--limit` 默认 2000，省略 `--start-date` 时自动查近一年
- 可用字段见 `references/fields.md`

---

## AI 命令

### 知识库搜索 `ai knowledge-batch`

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>]
```

- `--query` 可重复（最多 5 个），`--top` 默认 10 最大 20
- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库

### 知识资源下载 `ai knowledge-resource-download`

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回），错配返回 `433007`。

### 投研线索 `ai security-clue`

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>]
```

- `--query-mode`（必选）：`bySecurity` 按证券 | `byIndustry` 按行业
- `--source`：`researchReport` | `conference` | `announcement` | `view`
- `--gts-code`：个股代码或申万行业代码（如 `821035.SWI`），行业代码用 `lookup industry-code list` 查

### 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager --security-code <code>          # A股/港股
gangtise ai investment-logic --security-code <code>    # A股/港股
gangtise ai peer-comparison --security-code <code>     # A股/港股
```

### 业绩点评 `ai earnings-review`

```bash
gangtise ai earnings-review --security-code <code> --period <period> [--wait]
gangtise ai earnings-review-check --data-id <id>
```

- `--period`（必选）：`年份+报告期`，如 `2025q3`（q1/interim/q3/annual），仅支持 A 股，覆盖最近 6 期
- `--wait`：阻塞等待（最多 3 分钟），默认立即返回 dataId
- **异步流程**：① `earnings-review` → 得到 `dataId` → ② 等 2 分钟 → ③ `earnings-review-check --data-id xxx` → 若仍 pending 再等 2 分钟重试

### 主题跟踪 `ai theme-tracking`

```bash
gangtise ai theme-tracking --theme-id <id> --date <yyyy-MM-dd> [--type <name>]
```

- `--theme-id`（必选）：用 `lookup theme-id list` 查
- `--date`（必选）：支持近 30 天
- `--type`：`morning` 晨报 | `night` 晚报（不传返回两者）

### 调研提纲 `ai research-outline`

```bash
gangtise ai research-outline --security-code <code>    # 仅 A 股
```

---

## Vault 命令（私域数据）

### AI 云盘 `vault drive-list/download`

```bash
gangtise vault drive-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault drive-download --file-id <id> [--output <path>]
```

- `--file-type`：`1` 文档 | `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 租户云盘

---

## Lookup 命令

ID 不确定时先查枚举，避免无效调用：

```bash
gangtise lookup research-area list        # 研究方向
gangtise lookup broker-org list           # 券商机构
gangtise lookup meeting-org list          # 会议机构
gangtise lookup industry list             # 行业
gangtise lookup region list               # 外资研报区域
gangtise lookup announcement-category list # 公告分类
gangtise lookup industry-code list        # 申万行业代码（security-clue --gts-code 用）
gangtise lookup theme-id list             # 主题 ID（theme-tracking 用）
```

高频 ID 见 `references/lookup-ids.md`，没有时务必 `gangtise lookup` 查询。

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
| `8000014` / `8000015` | AK/SK 错误 | 检查 accessKey/secretKey |
| `8000016` | 开发账号状态异常 | 联系管理员 |
| `8000018` | 开发账号已到期 | 续费或联系管理员 |
| `903301` | 今日调用次数达上限 | 等待次日或升级配额 |
| `433007` | 数据源不匹配 | 检查 resourceType + sourceId 组合 |
| `410004` | 数据未找到 | 检查查询条件 |
| `10011401` | 白名单权限控制 | 联系管理员开通 |
