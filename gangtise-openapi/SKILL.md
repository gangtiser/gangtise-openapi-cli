---
name: gangtise-openapi
version: "0.10.7"
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下

  **适用**：原始数据导出、批量jsonl/csv、下载PDF/MD、行情K线、财务报表、估值指标、AI能力（一页通/投资逻辑/同业对比/线索/业绩点评/主题跟踪/调研提纲/知识库搜索）、云盘文件管理（Vault）

  **不适用**：个股研究→gangtise-stock-research；观点总结/PK→gangtise-opinion-*；证券详情/板块/股东元数据→gangtise-data-client

  **与其他 gangtise skill 协作**：本 skill 是底层数据通道，其他 skill（stock-research/competitive-analysis/event-review 等）需要 CLI 数据时也通过本 skill 获取。当本 skill 不可用（如 CLI 未安装），不要替代为 gangtise-data-client 或 gangtise-file-client 获取同类数据，应提示用户安装 CLI。
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

## 执行工作流

每次调用遵循以下步骤：

1. **解析意图** — 从「意图路由表」匹配命令；匹配不到时按命令组名猜测（如"研报"→insight research）；**歧义时先向用户复述理解并确认**
   - 输出：命令名 + 命令组
2. **解析参数** — 公司名→证券代码（查「公司名速查表」或 fallback 查询）；opaque ID→查 lookup 或 `references/lookup-ids.md`
   - 输出：参数键值对
3. **过检查点** — 逐条过「决策检查点」，🔴 必须等用户确认才能继续
   - 输出：通过/等待确认
4. **拼命令** — 加 `--format json`；按核心规则处理时间/分页/多值参数
   - 输出：完整可执行命令
5. **执行** — 运行命令，检查返回 `code` 字段：`200` 成功，其他查异常处理表
   - 输出：code + data
6. **处理结果** — 按响应解析表提取关键字段呈现给用户；空结果时建议扩大范围或换关键词；异步任务按轮询流程处理
   - 输出：用户可读的结果摘要

### 结果呈现规范

| 命令类型 | 呈现方式 | 摘要字段 |
|----------|---------|---------|
| insight list | 表格（≤20 行）+ 总数 | 标题 / 日期 / 机构 / 评级（如有） |
| insight download | 文件路径 + 文件大小 | — |
| quote day-kline | 表格（最近 10 个交易日） | 日期 / 收盘 / 涨跌幅 / 成交量 |
| fundamental 报表 | 表格（按年度/报告期分行） | 报告期 + 所选字段值 |
| fundamental valuation | 表格 + 分位点标注 | 日期 / 值 / 分位 |
| fundamental earning-forecast | 表格（按日期×预测年份） | 预测年份 + 所选指标值 |
| fundamental top-holders | 表格（按报告期×排名） | 报告期 / 排名 / 股东名 / 持股数 / 持股比例 / 变动 |
| ai knowledge-batch | 编号列表 + 摘要 | 标题 / 类型 / 摘要前 100 字 |
| ai one-pager / investment-logic / peer-comparison | 直接输出 markdown | — |
| ai earnings-review | 告知 dataId + 预计等待时间 | — |
| ai hot-topic | 表格（≤20 行）+ 总数 | 报告日期 / 类型 / 话题标题 / 驱动事件 |
| ai management-discuss-* | 直接输出内容 | 证券代码 / 报告期 / 维度 / 内容摘要 |
| ai viewpoint-debate | 告知 dataId + 预计等待时间 | — |
| vault drive-list | 编号列表 | 标题 / 文件类型 / 上传日期 |
| vault record-list | 编号列表 + 总数 | 标题 / 录音类型 / 创建时间 / 时长 |
| vault my-conference-list | 编号列表 + 总数 | 标题 / 会议类型 / 机构 / 时间 |

超过 20 条时仅展示前 20 条 + 总数，询问是否导出全量。

### list→download 子工作流

用户要求下载但未指定具体文件时：

1. 先执行 `list` 获取结果
2. 展示前 10 条，让用户选择（🔴 确认）
3. 🔴 确认下载格式（仅 research / foreign-report / announcement download 支持 `--file-type`；summary download 不支持，无需确认；vault record-download 需确认 `--content-type`，但用户已明确说明"AI速记"/"原始文件"/"语音识别"时直接映射无需确认；vault my-conference-download 同理）
4. 执行 `download`

### 响应解析

CLI 自动处理信封格式：当响应含 `code` 字段时，按 `{code, msg, data}` 信封解包（`code="000000"` 时取 `data`）；无 `code` 的响应直接透传。

| 命令类型 | data 结构 | 关键提取字段 |
|----------|----------|------------|
| insight list | `{list: [...], total: N}` | `list[].id` / `list[].title` / `list[].publishDate` / `list[].securityCode` / `list[].institutionName` |
| insight download | 文件路径（stdout） | 解析输出路径字符串 |
| quote day-kline | `{list: [...]}` | `list[].tradeDate` / `list[].close` / `list[].pctChange` / `list[].volume` |
| fundamental 报表 | `{list: [...]}` | `list[].fiscalYear` / `list[].period` + 各 `--field` 字段 |
| fundamental valuation | `{list: [...]}` | `list[].tradeDate` / `list[].value` / `list[].percentileRank` |
| fundamental earning-forecast | `{securityCode, securityName, updateList: [...]}` | `updateList[].date` / `updateList[].fieldList[].forecastYear` + 各 consensus 指标 |
| fundamental top-holders | `{holderType, list: [...]}` | `list[].reportPeriod` / `list[].rank` / `list[].shareholderName` / `list[].holdingNum` / `list[].holdingPct` / `list[].chgNum` / `list[].chgPct` |
| ai knowledge-batch | `{list: [...]}` | `list[].resourceType` / `list[].sourceId` / `list[].title` / `list[].summary` |
| ai one-pager / investment-logic / peer-comparison | `{content: "markdown文本"}` | `content` 直接使用 |
| ai earnings-review | `{dataId: "xxx"}` | `dataId` 用于后续 `earnings-review-check` |
| ai earnings-review-check | pending: `{dataId, status: "pending", hint}` / completed: `{date, content}` | `content` 直接使用（Markdown） |
| ai security-clue | `{list: [...]}` | `list[].securityCode` / `list[].title` / `list[].clueType` |
| ai theme-tracking | `{morningReport: {...}, nightReport: {...}}` | 按 `--type` 提取对应报告 |
| ai research-outline | `{content: "markdown文本"}` | `content` 直接使用 |
| ai hot-topic | `{list: [...], total: N}` | `list[].title` / `list[].reportDate` / `list[].category` / `list[].topics[].topicTitle` / `list[].topics[].driverEvent` / `list[].topics[].investLogic` |
| ai management-discuss-* | `{securityCode, reportDate, discussionDimension, content}` | `content` 为字符串数组（财报）或字符串（业绩会） |
| ai viewpoint-debate | `{dataId: "xxx"}` | `dataId` 用于后续 `viewpoint-debate-check` |
| ai viewpoint-debate-check | `{date, content}` | `content` 直接使用（Markdown） |
| vault drive-list | `{list: [...]}` | `list[].id` / `list[].title` / `list[].fileType` |
| vault drive-download | 文件路径（stdout） | 解析输出路径字符串 |
| vault record-list | `{list: [...], total: N}` | `list[].recordId` / `list[].title` / `list[].category` / `list[].createTime` / `list[].recordDuration` |
| vault record-download | 文件路径（stdout） | 解析输出路径字符串 |
| vault my-conference-list | `{list: [...], total: N}` | `list[].conferenceId` / `list[].title` / `list[].category` / `list[].institution.institutionName` / `list[].publishTime` |
| vault my-conference-download | 文件路径（stdout） | 解析输出路径字符串 |
| lookup list | `[...]` | `[].id` / `[].name` |

### 异常处理

| 场景 | 处理方式 |
|------|---------|
| CLI 未安装/命令找不到 | 提示 `npm install -g gangtise-openapi-cli`，不要重试 |
| 认证 token 过期 | 自动重新登录（AK/SK 模式），无需用户干预；若 AK/SK 也失败则提示检查环境变量 |
| 网络超时/连接失败 | 最多重试 1 次，仍失败则提示用户检查网络 |
| 空结果（data 为空数组） | 建议扩大时间范围、换关键词、或去掉部分筛选条件 |
| 返回结果 >200 条 | 仅展示前 20 条摘要 + 总数，询问用户是否导出全量 |
| K线数据超 10000 条 | 按季度分批拉取：先取 Q1（1/1-3/31），再取 Q2，依此类推。全市场查询（`--security all`）建议缩短日期范围 |
| 速率限制（903301） | 不重试，提示用户"今日调用次数已达上限，建议明日重试或联系管理员升级配额" |
| 异步任务轮询超过 3 次仍 pending | 终止轮询，返回 dataId 给用户，建议稍后手动 `earnings-review-check` 或 `viewpoint-debate-check` |
| 410110（生成中） | 异步任务仍在生成，视为 pending 继续等待 |
| 410111（生成失败） | 异步任务生成失败，终态不可重试，建议换参数重新提交 |
| 模糊公司名匹配多只证券 | 列出所有匹配项让用户选择（如"平安"→ 中国平安 601318.SH / 平安银行 000001.SZ） |
| 下载文件路径冲突 | 若 `--output` 指定路径已存在，先询问用户是否覆盖 |
| 无效证券代码 | 返回空结果或错误码，提示用户检查代码和交易所后缀是否正确 |

### 模糊时间词默认映射

用户说"最近/近期"等模糊时间词时，按以下规则处理（不同命令组默认范围不同）：

| 模糊词 | Insight/Vault/AI 默认 | Quote/Fundamental 默认 |
|--------|----------------------|----------------------|
| 最近/近期 | 7 天 | **1 年**（K线/估值需足够数据点） |
| 最近一周 | 7 天 | 7 天 |
| 最近一个月 | 30 天 | 30 天 |
| 过去一年/近一年 | 1 年 | 1 年 |
| 今年 | 当年 1/1 至今 | 当年 1/1 至今 |

datetime 参数（Insight/Vault/AI）：`--start-time "<日期> 00:00:00"` `--end-time "<日期> 23:59:59"`
date 参数（Quote/Fundamental）：`--start-date <日期>` `--end-date <日期>`

同时在支持 `--rank-type` 的洞察命令加 `--rank-type 2`（时间倒序），确保最新结果优先。支持 `--rank-type` 的命令：opinion / summary / research / foreign-report / announcement；**不支持**的命令：roadshow / site-visit / strategy / forum（API 无此参数）。

### 典型执行示例

**用户说："帮我查一下贵州茅台最近一周的研报"**

```
Step 1: 意图路由 → insight research list
Step 2: 贵州茅台 → 600519.SH（速查表）；"最近一周" → --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59"
Step 3: 检查点 → 认证OK、代码已知、有明确时间范围无需确认数据量
Step 4: gangtise insight research list --security 600519.SH --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --rank-type 2 --format json
Step 5: 检查返回 code=200，提取 data.list[].title / publishDate / reportId
```

**用户说："比亚迪的一页通"**

```
Step 1: 意图路由 → ai one-pager
Step 2: 比亚迪 → 002594.SZ（速查表）；一页通用 --security-code（不是 --security）
Step 3: 检查点 → 认证OK、代码已知
Step 4: gangtise ai one-pager --security-code 002594.SZ --format json
Step 5: 返回 data.content（Markdown 文本），直接呈现给用户
```

**用户说："查一下最近有哪些首席观点提到AI"**

```
Step 1: 意图路由 → insight opinion list
Step 2: "最近"→默认7天；"AI"→--keyword AI
Step 3: 检查点 → 模糊时间已自动映射，无需确认
Step 4: gangtise insight opinion list --keyword AI --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --rank-type 2 --format json
Step 5: 提取 data.list[].title / chiefName / publishDate，按时间倒序列表呈现
```

**用户说："下载中金最近的宏观策略研报"**（多步编排示例）

```
Step 1: 意图路由 → insight research list + download
Step 2: 中金 → 查 references/lookup-ids.md → C100000026；"宏观策略" → 宏观 122000001 + 策略 122000002（两个 research-area）；"最近"→默认7天
Step 3: 检查点 → 认证OK；ID已知无需lookup；结果可能>200条需确认🔴；下载格式需确认🔴
Step 4: gangtise insight research list --broker C100000026 --research-area 122000001 --research-area 122000002 --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --rank-type 2 --format json
Step 5: 从返回 data[] 中提取 reportId + title，展示给用户
Step 6: 确认 file-type 后 → gangtise insight research download --report-id <id> --file-type <n> --output ./<title>.pdf
```

**用户说："贵州茅台过去一年的PE估值"**

```
Step 1: 意图路由 → fundamental valuation-analysis
Step 2: 贵州茅台 → 600519.SH → --security-code 600519.SH；"PE" → --indicator peTtm；"过去一年" → Quote/Fundamental 默认1年，省略 --start-date 自动查近一年
Step 3: 检查点 → 认证OK、代码已知
Step 4: gangtise fundamental valuation-analysis --security-code 600519.SH --indicator peTtm --format json
Step 5: 提取 data.list[].tradeDate / value / percentileRank，表格呈现 + 分位点标注
```

**用户说："帮我下载云盘里那个AI相关的PDF"**

```
Step 1: 意图路由 → vault drive-list → drive-download
Step 2: "AI相关" → --keyword AI；"PDF" → --file-type 1（文档含PDF）
Step 3: 检查点 → 认证OK；"那个"暗示特定文件 → 🔴 展示结果让用户选择
Step 4: gangtise vault drive-list --keyword AI --file-type 1 --format json
Step 5: 展示匹配文件列表，用户选择后 → gangtise vault drive-download --file-id <id> --output ./<title>.pdf
```

**用户说："比亚迪A股和港股最近的日K线"**（跨市场示例）

```
Step 1: 意图路由 → quote day-kline + quote day-kline-hk（跨市场需分别调用）
Step 2: 比亚迪 A股 → 002594.SZ，港股 → 01211.HK（速查表）；"最近" → Quote 默认1年
Step 3: 检查点 → 认证OK、代码已知
Step 4a: gangtise quote day-kline --security 002594.SZ --format json
Step 4b: gangtise quote day-kline-hk --security 01211.HK --format json
Step 5: 合并两次结果，表格呈现最近 10 个交易日
```

**用户说："搜索一下新能源相关的研报和纪要"**（多资源类型搜索示例）

```
Step 1: 意图路由 → ai knowledge-batch（"搜索多类文档"优先走 knowledge-batch）
Step 2: "新能源" → 行业别名映射 → 电力设备；"研报和纪要" → resource-type 10(券商研报) + 60(会议平台纪要) + 70(调研纪要公告)
Step 3: 检查点 → 认证OK；意图明确无需确认
Step 4: gangtise ai knowledge-batch --query "新能源" --resource-type 10 --resource-type 60 --resource-type 70 --format json
Step 5: 提取 data.list[].title / resourceType / summary，编号列表呈现
```

## 意图路由表

用户意图 → 命令快速映射（避免从 20+ 子命令中猜测）：

| 用户意图 | 命令 |
|----------|------|
| 研报/券商报告 | `insight research list` |
| 外资研报 | `insight foreign-report list` |
| 首席观点/分析师观点 | `insight opinion list` |
| 纪要/会议纪要 | `insight summary list` |
| 路演 | `insight roadshow list` |
| 调研 | `insight site-visit list` |
| 策略会 | `insight strategy list` |
| 论坛 | `insight forum list` |
| 公告 | `insight announcement list` |
| 搜索/语义搜索 | `ai knowledge-batch` |
| 搜索多类文档（研报+纪要等）| `ai knowledge-batch`（用多个 `--resource-type`）|
| 日K线/行情 | `quote day-kline` |
| 港股K线 | `quote day-kline-hk` |
| 利润表/营收/净利润 | `fundamental income-statement` |
| 资产负债表 | `fundamental balance-sheet` |
| 现金流量表 | `fundamental cash-flow` |
| 主营业务/收入结构 | `fundamental main-business` |
| 估值/PE/PB | `fundamental valuation-analysis` |
| 盈利预测/一致预期/净利润预测 | `fundamental earning-forecast` |
| 前十大股东/股东/流通股东/股东结构 | `fundamental top-holders` |
| 知识库搜索 | `ai knowledge-batch` |
| 一页通/个股概览 | `ai one-pager` |
| 投资逻辑 | `ai investment-logic` |
| 同业对比/竞对 | `ai peer-comparison` |
| 业绩点评 | `ai earnings-review` |
| 投研线索 | `ai security-clue` |
| 主题跟踪 | `ai theme-tracking` |
| 热点话题/热点/早报午报晚报 | `ai hot-topic` |
| 管理层讨论/财报讨论 | `ai management-discuss-announcement` |
| 管理层讨论/业绩会讨论 | `ai management-discuss-earnings-call` |
| 观点PK/多空辩论 | `ai viewpoint-debate` |
| 分钟K线/分时行情 | `quote minute-kline` |
| 利润表(单季)/单季利润表 | `fundamental income-statement-quarterly` |
| 现金流量表(单季)/单季现金流 | `fundamental cash-flow-quarterly` |
| 调研提纲 | `ai research-outline` |
| 云盘文件 | `vault drive-list` |
| 录音速记/速记 | `vault record-list` |
| 我的会议/会议助理/会议/有哪些会议 | `vault my-conference-list` |
| 业绩会/策略会/基金路演（我的） | `vault my-conference-list --category earningsCall/strategyMeeting/fundRoadshow` |
| 下载文件 | `insight <type> download` / `vault drive-download` / `vault record-download` / `vault my-conference-download` |

## 公司名 → 证券代码

用户常只给公司名（如"茅台"），agent 需转为带交易所后缀的代码。查找方式（按优先级）：

1. **常用代码速查**（高频可直接映射）：
   | 公司 | A股代码 | 港股代码 |
   |------|---------|---------|
   | 贵州茅台 | `600519.SH` | — |
   | 宁德时代 | `300750.SZ` | — |
   | 比亚迪 | `002594.SZ` | `01211.HK` |
   | 招商银行 | `600036.SH` | `03968.HK` |
   | 中国平安 | `601318.SH` | `02318.HK` |
   | 工商银行 | `601398.SH` | `01398.HK` |
   | 中芯国际 | `688981.SH` | `00981.HK` |
   | 药明康德 | `603259.SH` | — |
   | 腾讯控股 | — | `00700.HK` |
   | 美团 | — | `03690.HK` |
   | 阿里巴巴 | — | `09988.HK` |
   | 京东集团 | — | `09618.HK` |
   | 小米集团 | — | `01810.HK` |
   | 网易 | — | `09999.HK` |

2. **不确定时**：用 `gangtise-data-client` skill 查证券详情（如果可用），或用 `gangtise ai knowledge-batch --query <公司名>` 搜索，从返回 data.list[].securityCode 提取代码

3. **交易所后缀规则**：`.SH` 上交所（6开头）| `.SZ` 深交所（0/3开头）| `.BJ` 北交所 | `.HK` 港股
4. **跨市场**：用户同时需要 A 股+港股数据时，需分别调对应命令（如 `quote day-kline` + `quote day-kline-hk`），不能合并为一次调用

## 决策检查点

调用任何命令前，按顺序过以下检查（🔴 必须用户确认，🟡 可自行判断）：

1. 🔴 **认证** — 先 `gangtise auth status`，未登录则提示配置 AK/SK 并中止（不要盲目调接口）；用户可运行 `gangtise auth login` 恢复
2. 🟡 **意图歧义** — 多个命令匹配时向用户复述理解并确认（如"搜索研报"→ knowledge-batch 还是 research list？）
3. 🟡 **ID 参数** — 需要传 broker / institution / industry / chief / region / theme-id 等 opaque ID 时：
   - 高频 → 查 `references/lookup-ids.md`
   - 不确定 → 先 `gangtise lookup <type> list`，**绝不猜测**
4. 🟡 **证券代码** — 用户只给公司名（如"茅台"）→ 须补交易所后缀 `600519.SH`；不确定时先搜索确认，不要用错后缀
5. 🔴 **数据量** — 无明确时间范围时默认 `--size 200`，若用户要求全量则先询问确认
6. 🔴 **下载格式** — 仅以下 download 命令支持 `--file-type`，需确认格式：research download（`1`PDF/`2`MD）、foreign-report download（`1`PDF/`2`MD/`3`翻译PDF/`4`翻译MD）、announcement download（`1`PDF/`2`MD）；**summary download 不支持 `--file-type`**，无需确认格式；vault record-download 需确认 `--content-type`（`original`/`asr`/`summary`）——用户明确说了"AI速记"/"原始文件"/"语音识别"时可直接映射，无需确认；vault my-conference-download 需确认 `--content-type`（`asr`/`summary`）——同上
7. 🔴 **异步任务** — `ai earnings-review` / `ai viewpoint-debate` 默认立即返回 dataId，需告知用户等待流程：调一次 → 等 2min → `*-check` → 若 pending 再等
8. 🔴 **文件选择** — list→download 流程中，展示结果让用户选择具体文件后再下载
9. 🟡 **耗时提醒** — AI 命令（one-pager/investment-logic/peer-comparison/earnings-review）可能耗时较长，首次调用时告知用户

---

## Insight 命令

所有 insight list 共享：`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

### 首席观点 `insight opinion list`

```bash
gangtise insight opinion list [--keyword <text>] [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <src>] [--rank-type <n>]
```

- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

### 纪要 `insight summary list/download`

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--output <path>]
```

- `--search-type`：`1` 标题搜索（默认，速度快）| `2` 全文搜索（更全面，适合精确查找）
- `--market`：`aShares` | `hkStocks` | `usChinaConcept` | `usStocks`
- `--participant-role`：`management` 管理层 | `expert` 专家
- `--source`：`1` 实时 | `2` 开放来源
- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`

### 路演/调研/策略会/论坛

```bash
gangtise insight roadshow list [--security <code>] [--institution <id>] [--research-area <id>] [--category <name>] [--market <name>] [--participant-role <name>] [--keyword <text>] [--start-time <dt>] [--end-time <dt>] [--from <n>] [--size <n>]
gangtise insight site-visit list [--security <code>] [--institution <id>] [--research-area <id>] [--category <name>] [--market <name>] [--participant-role <name>] [--broker-type <name>] [--permission <n>] [--object <name>] [--keyword <text>] [--start-time <dt>] [--end-time <dt>] [--from <n>] [--size <n>]
gangtise insight strategy list [--keyword <text>] [--institution <id>] [--start-time <dt>] [--end-time <dt>] [--from <n>] [--size <n>]
gangtise insight forum list [--keyword <text>] [--security <code>] [--research-area <id>] [--start-time <dt>] [--end-time <dt>] [--from <n>] [--size <n>]
```

共用参数：`--research-area` `--institution` `--security` `--keyword` `--start-time` `--end-time` `--from` `--size`

> **注意**：这四个命令不支持 `--rank-type`，API 无此参数。结果按 API 默认排序返回。

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

- 支持 A 股（`.SH` `.SZ` `.BJ`），传 `--security all` 返回全市场数据
- `--limit` 默认 6000，上限 10000（超过请缩短日期区间分批拉取）
- 常用字段：`open` `high` `low` `close` `pctChange` `volume` `amount`（完整列表见 `references/fields.md`）

### 日K线（港股）`quote day-kline-hk`

```bash
gangtise quote day-kline-hk [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 支持港股（`.HK`），传 `--security all` 返回全市场数据
- `--limit` 默认 6000，上限 10000（超过请缩短日期区间分批拉取）

### 分钟K线（A股）`quote minute-kline`

```bash
gangtise quote minute-kline [--security <code>] [--start-time <datetime>] [--end-time <datetime>] [--limit <n>] [--field <name>]
```

- 仅支持 A 股（`.SH` `.SZ` `.BJ`），**必须传 `--security`**，否则返回 430007（行情查询超出限制）
- `--start-time` / `--end-time`：格式 `yyyy-MM-dd HH:mm:ss`（兼容 `yyyy-MM-dd` 自动补全）
- `--limit` 默认 5000，上限 10000（超过请缩短时间区间分批拉取）
- 常用字段：`securityCode` `tradeTime` `open` `high` `low` `close` `change` `pctChange` `volume` `amount`

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

**示例：** 查贵州茅台 2023-2025 年报净利润
```bash
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2023 --fiscal-year 2024 --fiscal-year 2025 --period annual --field netProfit --field netProfitAttrParent --format json
```
- 资产负债表：`totalAssets` 总资产 | `totalLiab` 总负债 | `totalParentEq` 归母权益 | `monetaryAssets` 货币资金
- 现金流：`netOpCashFlows` 经营净现金流 | `netInvCashFlows` 投资净现金流 | `netFinCashFlows` 筹资净现金流

### 利润表（单季度）`fundamental income-statement-quarterly`

```bash
gangtise fundamental income-statement-quarterly --security-code <code> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- 参数与累计利润表一致，区别在于返回单季度数据而非累计数据
- `--period`：`q1` | `q2` | `q3` | `q4` | `latest`（默认）

### 现金流量表（单季度）`fundamental cash-flow-quarterly`

```bash
gangtise fundamental cash-flow-quarterly --security-code <code> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- 参数与累计现金流量表一致，区别在于返回单季度数据而非累计数据
- `--period`：`q1` | `q2` | `q3` | `q4` | `latest`（默认）

### 主营业务 `fundamental main-business`

```bash
gangtise fundamental main-business --security-code <code> --breakdown <type> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--period <type>] [--field <name>]
```

- `--breakdown`（必选）：`product` 按产品 | `industry` 按行业 | `region` 按地区
- `--period`：`interim` 中报 | `annual` 年报（可重复：`--period annual --period interim`）
- `--start-date`/`--end-date` 筛选时间区间（默认：endDate 当前日期、startDate 三年前）
- 该命令不支持 `--fiscal-year`（API 不接受，误传会触发 900001）；按年份筛选请用 `--start-date`/`--end-date`
- 可用字段见 `references/fields.md`

### 估值分析 `fundamental valuation-analysis`

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>] [--skip-null]
```

- `--indicator`（必选）：`peTtm` 滚动PE | `pbMrq` PB | `peg` PEG | `psTtm` 滚动PS | `pcfTtm` 滚动PCF | `em` 企业倍数
- `--limit` 默认 2000，省略 `--start-date` 时自动查近一年
- `--skip-null`：丢弃 `value` 或 `percentileRank` 为 null 的行。最新交易日可能因估值数据未入库返回 null，调用方用脚本消费（如 Python 拿 value 和阈值比较）时务必加此开关或自行判空
- 可用字段见 `references/fields.md`

### 盈利预测 `fundamental earning-forecast`

```bash
gangtise fundamental earning-forecast --security-code <code> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--consensus <name>]
```

- `--security-code`（必选）：证券代码，如 `600519.SH`
- `--start-date` / `--end-date`：日期格式 `YYYY-MM-DD`，不传时默认近一年（start-date=一年前，end-date=今天）
- `--consensus` 可重复：一致预期指标
  - `netIncome` 归母净利润 | `netIncomeYoy` 归母净利润同比增速 | `eps` 每股收益
  - `pe` 市盈率 | `bps` 每股净资产 | `pb` 市净率 | `peg` PEG
  - `roe` 净资产收益率 | `ps` 市销率
- 返回格式：`{securityCode, securityName, updateList: [{date, fieldList: [{forecastYear, ...consensus}]}]}`
  - 每个日期固定返回 3 年预测（如 `2026E` / `2027E` / `2028E`）

### 前十大股东 `fundamental top-holders`

```bash
gangtise fundamental top-holders --security-code <code> --holder-type <type> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--fiscal-year <year>] [--period <p>]
```

- `--security-code`（必选）：证券代码，如 `600519.SH`
- `--holder-type`（必选）：`top10` 前十大股东 | `top10Float` 前十大流通股东
- `--start-date` / `--end-date`：日期格式 `YYYY-MM-DD`，有值时覆盖 `--fiscal-year` 筛选
- `--fiscal-year` 可重复：`--fiscal-year 2024 --fiscal-year 2025`
- `--period`：`q1` 一季报 | `interim` 中报 | `q3` 三季报 | `annual` 年报 | `latest` 最新一期（默认）；可重复传多值
- 返回字段：`reportPeriod` / `rank` / `shareholderName` / `shareholderType` / `holdingNum` / `holdingPct` / `chgNum` / `chgPct` / `shareCategory`

**示例：** 查贵州茅台 2025 年前十大股东
```bash
gangtise fundamental top-holders --security-code 600519.SH --holder-type top10 --fiscal-year 2025 --format json
```

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
- `--gts-code`（必选）：个股代码（如 `600519.SH`）或申万行业代码（如 `821035.SWI`），行业代码用 `lookup industry-code list` 查
- `--source`：`researchReport` | `conference` | `announcement` | `view`

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
- **异步流程**：① `earnings-review` → 得到 `dataId` → ② 等 2 分钟 → ③ `earnings-review-check --data-id xxx` → 若返回 `{date, content}` 则成功，若返回 `{status: "pending"}` 则再等 2 分钟 → 最多轮询 3 次，超过则终止并返回 dataId 给用户。注意：410110（生成中）视为 pending 继续等待，410111（生成失败）为终态

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

### 热点话题 `ai hot-topic`

```bash
gangtise ai hot-topic [--start-date <date>] [--end-date <date>] [--category <name>] [--with-related-securities] [--no-with-related-securities] [--with-close-reading] [--no-with-close-reading] [--from <n>] [--size <n>]
```

- 获取热点话题报告中各热点话题的结构化数据，包括驱动事件、投资逻辑、核心标的、话题精读
- `--category`：`morningBriefing` 早报 | `noonBriefing` 午报 | `afternoonFlash` 盘中快报 | `eveningBriefing` 晚报（可重复传多值；不传时默认全部四种类型）
- `--with-related-securities` / `--no-with-related-securities`：返回核心标的信息（默认开启）
- `--with-close-reading` / `--no-with-close-reading`：返回话题精读内容（默认开启）
- `--start-date` / `--end-date`：日期格式 `yyyy-MM-dd`
- 分页：`--from` 默认 0，`--size` 单页最大 20，自动翻页

### 管理层讨论-财报 `ai management-discuss-announcement`

```bash
gangtise ai management-discuss-announcement --report-date <date> --security-code <code> --dimension <name>
```

- 获取上市公司半年报/年报中管理层讨论与分析的结构化数据
- `--report-date`（必选）：报告期，严格约束为 `yyyy-MM-dd`，仅接受 `xxxx-06-30`（半年报）和 `xxxx-12-31`（年报）
- `--security-code`（必选）：证券代码，如 `000001.SZ`
- `--dimension`（必选）：讨论维度
  - `businessOperation` 业务经营与行业情况
  - `financialPerformance` 财务状况与经营成果
  - `developmentAndRisk` 发展规划与风险
- 返回 `content` 为字符串数组，每个元素是一个段落

### 管理层讨论-业绩会 `ai management-discuss-earnings-call`

```bash
gangtise ai management-discuss-earnings-call --report-date <date> --security-code <code> --dimension <name>
```

- 获取上市公司业绩会中管理层讨论与分析的结构化数据
- `--report-date`（必选）：报告期，严格约束为 `yyyy-MM-dd`，接受 `xxxx-03-31`、`xxxx-06-30`、`xxxx-09-30`、`xxxx-12-31`
- `--security-code`（必选）：证券代码，如 `000001.SZ`
- `--dimension`（必选）：同上，`businessOperation` / `financialPerformance` / `developmentAndRisk`
- 返回 `content` 为字符串

### 观点PK `ai viewpoint-debate`

```bash
gangtise ai viewpoint-debate --viewpoint <text> [--wait]
gangtise ai viewpoint-debate-check --data-id <id>
```

- 对标的/产业/政策等相关观点进行双向逻辑校验：输入看多观点时拆解潜在风险，输入看空逻辑时挖掘反转机会
- `--viewpoint`（必选）：观点文本，上限 1000 字
- `--wait`：阻塞等待（最多 3 分钟），默认立即返回 dataId
- **异步流程**：① `viewpoint-debate` → 得到 `dataId` → ② 等 2 分钟 → ③ `viewpoint-debate-check --data-id xxx` → 若返回 `{date, content}` 则成功，若返回 `{status: "pending"}` 则再等 2 分钟 → 最多轮询 3 次。注意：410110（生成中）视为 pending 继续等待，410111（生成失败）为终态

---

## Vault 命令（私域数据）

### AI 云盘 `vault drive-list/download`

```bash
gangtise vault drive-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault drive-download --file-id <id> [--output <path>]
```

- `--file-type`：`1` 文档（含 PDF/Word/PPT 等）| `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 租户云盘

### 录音速记 `vault record-list/download`

```bash
gangtise vault record-list [--keyword <text>] [--category <name>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault record-download --record-id <id> --content-type <type> [--output <path>]
```

- `--category`：`upload` 上传文件 | `link` 导入链接 | `mobile` 手机录音 | `gtNote` 录音卡 | `pc` PC录音 | `share` 与我分享（可重复传多值）
- `--space-type`：`1` 我的速记 | `2` 租户速记
- `--content-type`（download 必选）：`original` 原始文件 | `asr` 语音识别 | `summary` AI速记
  - 口语映射：「原始文件/原文件」→`original`、「语音识别/转写文本/ASR」→`asr`、「AI速记/智能摘要/会议纪要」→`summary`
  - 注意：「与我分享」类型的录音无法下载原始文件
- 返回字段：`recordId` / `title` / `createTime` / `category` / `recordDuration`（秒） / `recordSize`（Byte）/ `url` / `spaceType` / `uploader`

### 我的会议 `vault my-conference-list/download`

```bash
gangtise vault my-conference-list [--keyword <text>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault my-conference-download --conference-id <id> --content-type <type> [--output <path>]
```

- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`（可重复传多值）
- `--research-area` / `--security` / `--institution`：同 Insight 命令的 ID 体系
- `--keyword`：文本搜索（标题模糊匹配）；`--research-area`：按行业方向精确过滤。用户说"关于AI的"→用 `--keyword AI`；用户说"电子行业的会议"→用 `--research-area 104270000`
- `--content-type`（download 必选）：`asr` 语音识别 | `summary` AI速记
  - 口语映射：「语音识别/转写文本/ASR」→`asr`、「AI速记/智能摘要/会议纪要」→`summary`
- 返回字段：`conferenceId` / `title` / `publishTime` / `category` / `institution{institutionId, institutionName}` / `security{securityCode, securityName}` / `researchArea{researchAreaId, researchAreaName}` / `guest`

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

**常见行业别名映射**（用户口语 → 标准行业 ID）：

| 用户说法 | 标准行业 | `--industry` ID | `--research-area` 同用 | `--gts-code`（security-clue） |
|----------|---------|----------------|----------------------|---------------------------|
| 新能源 / 光伏 / 风电 | 电力设备 | `104630000` | ✅ | `821052.SWI` |
| 电新 | 电力设备 | `104630000` | ✅ | `821052.SWI` |
| AI / 人工智能 / 算力 | 计算机 | `104710000` | ✅ | `821055.SWI` |
| 半导体 / 芯片 | 电子 | `104270000` | ✅ | `821035.SWI` |
| 互联网 / 平台 | 传媒 | `104720000` | ✅ | `821056.SWI` |
| 白酒 | 食品饮料 | `104340000` | ✅ | `821038.SWI` |
| 医药 / 创新药 | 医药生物 | `104370000` | ✅ | `821041.SWI` |
| 地产 | 房地产 | `104430000` | ✅ | `821044.SWI` |
| 券商 / 券商股 | 非银金融 | `104490000` | ✅ | `821048.SWI` |
| 银行 / 银行股 | 银行 | `104480000` | ✅ | `821047.SWI` |
| 汽车 / 新车 | 汽车 | `104280000` | ✅ | `821036.SWI` |
| 消费 / 大消费 | 见下方 | — | — | — |

> **参数名选择规则**：
> - `--industry`：用于 opinion / research / foreign-report（行业筛选参数名）
> - `--research-area`：用于 roadshow / site-visit / forum / summary（研究方向参数名，ID 值相同可复用）
> - `--gts-code`：仅用于 `ai security-clue`（需申万行业代码格式如 `821035.SWI`，不是数字 ID）
>
> **"消费"歧义处理**：用户说"消费/大消费"时覆盖多个子行业，应向用户确认具体方向（食品饮料 `104340000` / 商贸零售 `104450000` / 社会服务 `104460000` / 家电 `104330000` / 纺织服饰 `104350000` / 美容护理 `104770000`），或用 `--keyword 消费` 做宽泛搜索。

## Raw 调用

直接调用任意 endpoint，绕过 CLI 封装。适合调试或 CLI 未覆盖的新接口。

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

- endpoint key 格式：`<命令组>.<子命令>.<操作>`，如 `insight.opinion.list`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch`
- `--body` 传 JSON 字符串，自动翻页的 endpoint 会复用 client 翻页逻辑
- 返回格式与封装命令一致：`{code, msg, success, data}`

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
| `430007` | 行情查询超出限制 | 缩短日期范围或减少 `--limit` 值；全市场查询数据量大，注意控制范围 |
| `10011401` | 白名单权限控制 | 联系管理员开通 |
