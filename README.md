# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 获取金融数据的命令行工具，同时提供Agent Skill。

## Changelog

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

## 首次安装

```bash
npm install -g gangtise-openapi-cli
```

验证安装：

```bash
gangtise --help
```

本地开发：

```bash
git clone git@github.com:gangtiser/gangtise-openapi-cli.git
cd gangtise-openapi-cli
npm install
npm run dev -- --help
```
## 版本更新

查看当前版本（自动与线上版本比对）：

```bash
gangtise --version
```

手动更新到最新版：

```bash
npm update -g gangtise-openapi-cli
```


## 环境配置

优先读取以下环境变量：

```bash
export GANGTISE_ACCESS_KEY="your-ak"
export GANGTISE_SECRET_KEY="your-sk"
export GANGTISE_BASE_URL="https://open.gangtise.com"
export GANGTISE_TOKEN="Bearer xxx"

# 性能/调试可选项
export GANGTISE_PAGE_CONCURRENCY=5     # 翻页并发数（默认 5）
export GANGTISE_VERBOSE=1              # 打印每个请求的耗时与字节数
export GANGTISE_TIMEOUT_MS=30000       # 请求超时（默认 30s）
```

如果没有 `GANGTISE_TOKEN`，CLI 会自动调用 token 接口并缓存到本地（`~/.config/gangtise/token.json`，权限 0600）。Token 失效（8000014/8000015）时会自动重新登录并重试一次。


## AI Agent Skill

本项目包含 Skill 定义（`gangtise-openapi/SKILL.md`），可让 AI agent 自动调用 `gangtise` CLI 完成投研数据查询。支持以下 AI 编程助手：

- [Claude Code](https://claude.ai/claude-code) — `~/.claude/skills/`
- [OpenClaw](https://github.com/openclaw/openclaw) — `~/.openclaw/skills/`
- [Hermes](https://github.com/nicepkg/hermes) — `~/.hermes/skills/`

Skill 目录结构：

```
gangtise-openapi/
├── SKILL.md                          # 主 skill 文件（必备规则、速查表、按需引用 references）
└── references/
    ├── commands/                     # 按命令组拆分的详细参数文档（agent 按需 Read）
    │   ├── ai.md                     #   AI 能力命令（one-pager / earnings-review / viewpoint-debate 等）
    │   ├── fundamental.md            #   财务数据命令（三大报表 / 估值 / 盈利预测 / 股东）
    │   ├── insight.md                #   投研内容命令（研报 / 观点 / 纪要 / 公告 / 外资）
    │   ├── quote.md                  #   行情命令（A股/港股/指数 K 线）
    │   ├── reference-and-lookup.md   #   GTS Code 搜索与枚举速查
    │   └── vault.md                  #   云盘/录音/会议/群消息
    ├── examples.md                   # 典型场景的端到端示例
    ├── fields.md                     # K线/财务字段中英文对照速查表
    ├── lookup-ids.md                 # 常用 ID 速查表（行业/券商/机构/公告分类等）
    └── response-schema.md            # 各接口响应字段说明
```

安装：

```bash
# Claude Code
cp -r gangtise-openapi ~/.claude/skills/gangtise-openapi

# OpenClaw
cp -r gangtise-openapi ~/.openclaw/skills/gangtise-openapi

# Hermes
cp -r gangtise-openapi ~/.hermes/skills/gangtise-openapi
```

> **版本更新**：每次 CLI 发版时，`gangtise-openapi/SKILL.md` 的 `version` 字段会自动同步。更新 CLI 后，请将项目中的 `gangtise-openapi/` 目录重新复制到对应的 skills 目录覆盖更新：
>
> ```bash
> # 示例：更新 Claude Code 的 skill
> cp -r gangtise-openapi ~/.claude/skills/gangtise-openapi
> ```
>
> 可通过查看 SKILL.md 头部的 `version` 字段确认当前版本。

安装后，可以用自然语言触发，例如：
- "帮我查今天所有的研报"
- "用 gangtise 命令查一下贵州茅台的日K线"
- "导出最近一周的首席观点到 jsonl"

## 数据接口覆盖

| 模块 | 子命令 | 说明 |
|------|--------|------|
| **Auth** | `login` / `status` | 认证登录、状态查询 |
| **Lookup** | `research-area list` / `broker-org list` / `meeting-org list` / `industry list` / `industry-code list` / `region list` / `announcement-category list` / `theme-id list` | 枚举速查（内置，无需额外文档） |
| **Insight** | `opinion list` | 内资机构观点 |
| | `summary list` / `download` | 纪要（含下载，支持 `--file-type` 选原始/HTML） |
| | `roadshow list` | 路演 |
| | `site-visit list` | 调研 |
| | `strategy list` | 策略 |
| | `forum list` | 论坛 |
| | `research list` / `download` | 研报（含 Markdown 下载） |
| | `foreign-report list` / `download` | 外资研报（含中文翻译下载） |
| | `announcement list` / `download` | A股公告（含 Markdown 下载） |
| | `announcement-hk list` / `download` | 港股公告（含下载） |
| | `foreign-opinion list` | 外资机构观点 |
| | `independent-opinion list` / `download` | 外资独立分析师观点（含原文/翻译HTML下载） |
| **Reference** | `securities-search` | GTS Code 搜索（按名称/代码/拼音匹配） |
| **Quote** | `day-kline` / `day-kline-hk` | A股/港股日K线 |
| | `index-day-kline` | 沪深京指数日K线 |
| | `minute-kline` | A股分钟K线 |
| **Fundamental** | `income-statement` / `balance-sheet` / `cash-flow` | 三大财务报表（累计） |
| | `income-statement-quarterly` / `cash-flow-quarterly` | 利润表/现金流量表（单季度） |
| | `main-business` | 主营构成（按地区/产品拆分） |
| | `valuation-analysis` | 估值分析 |
| | `earning-forecast` | 盈利预测（一致预期） |
| | `top-holders` | 前十大股东/前十大流通股东 |
| **AI** | `knowledge-batch` | 知识库批量检索 |
| | `knowledge-resource-download` | 知识资源下载 |
| | `security-clue` | 个股线索 |
| | `one-pager` | 一页通 |
| | `investment-logic` | 投资逻辑 |
| | `peer-comparison` | 同业对比 |
| | `earnings-review` / `earnings-review-check` | 业绩回顾 |
| | `theme-tracking` | 主题跟踪 |
| | `hot-topic` | 热点话题 |
| | `research-outline` | 研究提纲 |
| | `management-discuss-announcement` | 管理层讨论-财报 |
| | `management-discuss-earnings-call` | 管理层讨论-业绩会 |
| | `viewpoint-debate` / `viewpoint-debate-check` | 观点PK（异步） |
| **Vault** | `drive-list` / `drive-download` | 云盘文件列表与下载 |
| | `record-list` / `record-download` | 录音速记列表与下载 |
| | `my-conference-list` / `my-conference-download` | 我的会议列表与下载 |
| | `wechat-message-list` / `wechat-chatroom-list` | 群消息列表与群ID查询 |
| **Raw** | `call` | 原始接口调用（可访问任意 endpoint） |

## 命令概览

- `gangtise auth ...`
- `gangtise lookup ...`
- `gangtise insight ...`
- `gangtise quote ...`
- `gangtise fundamental ...`
- `gangtise ai ...`
- `gangtise vault ...`
- `gangtise reference ...`
- `gangtise raw call ...`

## 推荐工作流

先查枚举/参数：

```bash
gangtise lookup research-area list
gangtise lookup broker-org list
gangtise lookup meeting-org list
gangtise lookup industry list
gangtise lookup region list              # 外资研报区域
gangtise lookup announcement-category list  # 公告分类
gangtise lookup industry-code list   # 申万行业代码（用于 security-clue --gts-code）
```

再调用业务命令：

```bash
gangtise insight opinion list --industry 104710000
gangtise insight summary list --institution C100000017
gangtise quote day-kline --security 600519.SH --start-date 2025-03-01 --end-date 2025-03-12
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
```

## 性能特性

- **并发翻页**：自动翻页接口的首页拿到 `total` 后，剩余页用 `Promise.all` 并发拉取（默认并发数 5，可通过 `GANGTISE_PAGE_CONCURRENCY` 调整）。20 页查询从串行 ~10s 降到 ~2s。
- **HTTP keep-alive**：所有请求复用同一个 `undici.Agent`（连接池 16），避免重复 TLS 握手。
- **流式下载**：指定 `--output` 时，二进制响应（PDF 等）直接 `pipeline` 到磁盘，不经过内存缓冲；50MB PDF 内存占用近乎为零。
- **流式输出**：`jsonl`/`csv` 格式且 `--output` 指定时，超过 1000 行自动切换为逐行写盘，避免一次性构建百 MB 字符串。
- **自动重试**：5xx / `ECONNRESET` / `ETIMEDOUT` / `999999` 系统错误自动指数退避重试 2 次。
- **Token 自愈**：调用返回 8000014/8000015 时自动强制刷新 Token 并重试一次。
- **K线自动分片**：`quote day-kline --security all` 等全市场查询自动按日期切分（A股 2 天/片、HK 3 天/片、指数 30 天/片），并发执行后合并结果。
- **Token 内存缓存**：Token 在进程内存中缓存，避免每次请求读盘。
- **`--verbose`**：打印每个请求的方法、路径、状态码、耗时和响应大小到 stderr，方便定位慢查询。

## 自动翻页

以下列表接口会自动翻页：
- `insight opinion list`
- `insight summary list`
- `insight roadshow list`
- `insight site-visit list`
- `insight strategy list`
- `insight forum list`
- `insight research list`
- `insight foreign-report list`
- `insight announcement list`
- `insight announcement-hk list`
- `insight foreign-opinion list`
- `insight independent-opinion list`
- `ai security-clue`
- `vault drive-list`
- `vault record-list`
- `vault my-conference-list`
- `vault wechat-message-list`
- `ai hot-topic`

规则：
- **有时间范围时**（传了 `--start-time/--end-time` 或 `--start-date/--end-date`）：**省略 `--size`**，CLI 自动翻页查全
- **无时间范围时**（未传时间参数）：默认 `--size 200`，防止一次查询数据量过大
- 如果显式传了 `--size`，则按指定值翻页，直到达到 `size` 或数据取完
- `--from` 必须是非负整数，`--size` 必须是正整数；非法数字会在本地直接报 `ValidationError`，不会继续请求 API
- 安全上限：自动翻页最多 1000 页，防止异常循环
- 分页结果中 `total` 字段会被保留（json 格式输出 `{total, list}`），同时 stderr 输出 `Total: N, showing: M`

## 智能文件命名

下载命令（`summary download`、`research download`、`foreign-report download`、`announcement download`、`vault drive-download`、`vault record-download`、`vault my-conference-download`）省略 `--output` 时，自动使用真实标题作为文件名：

1. **缓存优先** — 如果之前执行过对应的 `list` 命令，标题已缓存在 `~/.config/gangtise/title-cache.json`，直接使用，无额外 API 调用
2. **API 回查** — 缓存未命中时，自动查询最近 200 条记录匹配标题
3. **兜底** — 都找不到时使用服务器返回的原始文件名或 `{type}-{id}.{ext}`

推荐工作流：先 `list` 再 `download`，文件名自动正确。

## 常用示例

### 认证

```bash
gangtise auth login
gangtise auth status
```

### Insight

```bash
# 有时间范围 → 省略 --size，自动查全
gangtise insight research list --start-time "2026-04-01 00:00:00" --end-time "2026-04-09 23:59:59"

# 无时间范围 → 默认 --size 200
gangtise insight research list --industry 104270000 --category company --llm-tag inDepth --rating buy

# 多值 List 模式：一次查多家券商 + 多个行业 + 多个评级
gangtise insight research list --broker C100000027 --broker C100000014 --industry 104340000 --industry 104370000 --rating buy --rating overweight --format json

gangtise insight opinion list --keyword AI
gangtise insight summary list --keyword 算力

# 下载：先 list 再 download，自动使用真实标题作为文件名
gangtise insight summary download --summary-id 4902586
# → 超颖电子：2026年4月7日投资者关系活动记录表.txt

# 下载 Markdown 版本
gangtise insight research download --report-id 432092410345574400 --file-type 2
# 下载外资研报中文翻译版
gangtise insight foreign-report download --report-id RPT20260401001 --file-type 4
# 下载公告 Markdown 版本
gangtise insight announcement download --announcement-id 123456 --file-type 2

# 也可手动指定文件名
gangtise insight research download --report-id 12345 --output ./report.pdf

gangtise insight roadshow list --institution C100000017

# 港股公告
gangtise insight announcement-hk list --security 01913.HK --rank-type 2 --size 20 --format json
gangtise insight announcement-hk download --announcement-id ANN2026040200012345

# 外资机构观点
gangtise insight foreign-opinion list --keyword "自动驾驶" --region us --rank-type 2 --format json
gangtise insight foreign-opinion list --security APP.O --rating buy --format json

# 外资独立观点
gangtise insight independent-opinion list --keyword "肿瘤" --industry 104370000 --format json
gangtise insight independent-opinion download --independent-opinion-id 207051900018372 --file-type 2

# 纪要下载（会议平台来源可选 HTML 格式）
gangtise insight summary download --summary-id 4906813 --file-type 2
```

### Reference

```bash
# GTS Code 搜索：按公司名/代码/拼音查证券代码
gangtise reference securities-search --keyword "贵州茅台" --category stock
gangtise reference securities-search --keyword "600519" --category stock
gangtise reference securities-search --keyword gzmt --top 5
gangtise reference securities-search --keyword "银行" --category stock --category index
```

### Quote

```bash
gangtise quote day-kline --security 600519.SH --start-date 2026-03-01 --end-date 2026-03-31
# 查最近/最新 K 线建议显式传 --start-date/--end-date；只传 --limit 会截取查询窗口开头，不等于最近N条
gangtise quote day-kline --format json
# 全市场查询（--security all）
gangtise quote day-kline --security all --start-date 2026-04-01 --end-date 2026-04-01 --limit 100 --format json
# 港股日K线
gangtise quote day-kline-hk --security 00700.HK --start-date 2026-03-01 --end-date 2026-03-31
# 港股全市场
gangtise quote day-kline-hk --security all --start-date 2026-04-01 --end-date 2026-04-01 --limit 100 --format json
# 沪深京指数日K线
gangtise quote index-day-kline --security 000001.SH --security 399001.SZ --start-date 2024-05-01 --end-date 2024-05-20 --field securityCode --field tradeDate --field close --field volume
# A股分钟K线
gangtise quote minute-kline --security 600519.SH --start-time "2026-04-15 09:30:00" --end-time "2026-04-15 15:00:00" --field open --field close --field volume
```

### Fundamental

```bash
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2025 --period q3 --field netProfit
# 多年度：同时查2023-2025年报净利润
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2023 --fiscal-year 2024 --fiscal-year 2025 --period annual --field netProfit
# 最新一期完整利润表
gangtise fundamental income-statement --security-code 600519.SH --format json
gangtise fundamental balance-sheet --security-code 600519.SH --fiscal-year 2025 --period q3 --field totalCurrAssets --field totalCurrLiab
# 最新一期完整资产负债表
gangtise fundamental balance-sheet --security-code 600519.SH --format json
gangtise fundamental cash-flow --security-code 600519.SH --fiscal-year 2025 --period q3 --field netOpCashFlows --field netInvCashFlows --field netFinCashFlows
# 最新一期完整现金流量表
gangtise fundamental cash-flow --security-code 600519.SH --format json
gangtise fundamental main-business --security-code 600519.SH --breakdown region
# 多报告期：--period 可传多个值
gangtise fundamental main-business --security-code 600519.SH --breakdown product --period annual --period interim
gangtise fundamental valuation-analysis --security-code 600519.SH --indicator peTtm
# 盈利预测（一致预期）
gangtise fundamental earning-forecast --security-code 600519.SH --consensus netIncome --consensus eps --consensus pe
# 利润表（单季度）
gangtise fundamental income-statement-quarterly --security-code 600519.SH --fiscal-year 2025 --period q2 --field netProfit
# 现金流量表（单季度）
gangtise fundamental cash-flow-quarterly --security-code 600519.SH --fiscal-year 2025 --period q2 --field netOpCashFlows
# 前十大股东
gangtise fundamental top-holders --security-code 600519.SH --holder-type top10 --fiscal-year 2025 --format json
# 前十大流通股东（按日期范围）
gangtise fundamental top-holders --security-code 600519.SH --holder-type top10Float --start-date 2025-01-01 --end-date 2025-12-31 --period q3 --format json
```

### AI

```bash
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
# 多 resource-type：同时搜索券商研报和外资研报
gangtise ai knowledge-batch --query 新能源汽车 --resource-type 10 --resource-type 11 --top 10
gangtise ai security-clue --start-time "2026-04-01 00:00:00" --end-time "2026-04-09 23:59:59" --query-mode byIndustry --gts-code 821035.SWI --source researchReport --source announcement
gangtise ai one-pager --security-code 600519.SH
gangtise ai investment-logic --security-code 600519.SH
gangtise ai peer-comparison --security-code 600519.SH
gangtise ai earnings-review --security-code 600519.SH --period 2025q3
gangtise ai theme-tracking --theme-id 121000131 --date 2026-03-01 --type morning
gangtise ai hot-topic --start-date 2026-03-22 --end-date 2026-03-27 --category morningBriefing --category noonBriefing --with-related-securities --with-close-reading
# 不传 --category 默认查全部类型（早报+午报+盘中快报+晚报），--with-related-securities 和 --with-close-reading 默认开启，可用 --no-with-related-securities / --no-with-close-reading 关闭
gangtise ai hot-topic --start-date 2026-04-15 --end-date 2026-04-17
gangtise ai research-outline --security-code 600519.SH
# 管理层讨论-财报
gangtise ai management-discuss-announcement --report-date 2025-06-30 --security-code 000001.SZ --dimension businessOperation
# 管理层讨论-业绩会
gangtise ai management-discuss-earnings-call --report-date 2025-06-30 --security-code 000001.SZ --dimension financialPerformance
# 观点PK（异步，返回 dataId）
gangtise ai viewpoint-debate --viewpoint "飞天茅台的批价低点是1500元"
# 等待生成完成后查询结果
gangtise ai viewpoint-debate-check --data-id 202603310528
# 也可以 --wait 同步等待结果（最长3分钟）
gangtise ai viewpoint-debate --viewpoint "比亚迪股价将突破500元" --wait
gangtise ai knowledge-resource-download --resource-type 60 --source-id 3052524 --output ./resource.txt
```

### Vault

```bash
gangtise vault drive-list --keyword 部门文档 --space-type 1 --file-type 1

# 云盘下载：自动使用文件标题命名
gangtise vault drive-download --file-id 62130
# → 2028 全球智能危机  一份来自未来的金融史思想实验  .pdf

# 录音速记列表
gangtise vault record-list --keyword 晨会 --category upload --category mobile
# 录音速记下载（--content-type: original/asr/summary）
gangtise vault record-download --record-id 49412 --content-type summary

# 我的会议列表
gangtise vault my-conference-list --keyword AI --category earningsCall --institution C100000027
# 我的会议下载（--content-type: asr/summary）
gangtise vault my-conference-download --conference-id 43319 --content-type asr

# 群消息：先按群名称查群ID，再按群ID查消息
gangtise vault wechat-chatroom-list --room-name "AI学习群,投研分享群" --size 50
gangtise vault wechat-message-list --keyword AI应用 --wechat-group-id ueKEGyhdjFGkjyebh --category text --category url --tag roadShow --tag meetingSummary --size 50
```

### Raw

```bash
gangtise raw call insight.opinion.list --body '{"from":0,"size":120}'
```

说明：对已标记为自动翻页的 endpoint，`raw call` 也会复用同一套 client 翻页逻辑；这里的 `size` 仍表示最终希望返回的记录数。

## 输出格式

支持：

- `table`
- `json`（分页结果保留 `{total, list}` 结构）
- `jsonl`（每行一条记录）
- `csv`
- `markdown`

所有格式均支持 `--output <path>` 输出到文件（自动创建父目录）。

## 参数校验

CLI 会在本地校验常见数值参数，避免把明显非法的请求发到 API：

- `--from`：非负整数
- `--size` / `--limit` / `--top`：正整数
- `--file-type` / `--resource-type` 以及数值型列表参数：有限数字
- 公告 `--start-time` / `--end-time`：可解析的时间字符串或 Unix 时间戳

校验失败会输出 `ValidationError: Invalid ...` 并以非 0 状态退出。

## 常见错误

| 错误/错误码 | 说明 |
|-----------|------|
| `ValidationError` | 本地参数校验失败，检查 `--size` / `--limit` / `--from` / `--file-type` 等数值参数 |
| `API error (HTTP 4xx/5xx)` | HTTP 层失败；CLI 会把 4xx/5xx 响应视为错误，即使响应体不是标准 `{code,msg,data}` 信封 |
| `8000014` | `GANGTISE_ACCESS_KEY` 错误 |
| `8000015` | `GANGTISE_SECRET_KEY` 错误 |
| `8000016` | 开发账号状态异常 |
| `8000018` | 开发账号已到期 |
| `900001` | 请求参数为空或缺少必填项 |
| `900002` | 请求缺少 uid |
| `903301` | 今日调用次数已达上限 |
| `999995` | 积分不足 |
| `999997` | 未开通接口权限 |
| `999999` | Gangtise 系统错误，请稍后重试 |
| `433007` | 不支持该数据源（`knowledge-resource-download` 需正确的 `resourceType + sourceId` 组合） |
| `430007` | 行情查询超出限制（数据量过大，请缩短日期范围或减少 `--limit`） |
| `410110` | 异步任务生成中（非终态，需继续轮询） |
| `410111` | 异步任务生成失败（终态，不可重试） |
