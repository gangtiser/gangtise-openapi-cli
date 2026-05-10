---
name: gangtise-openapi
version: "0.12.0"
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下

  **适用**：原始数据导出、批量 jsonl/csv、下载 PDF/MD、行情 K 线、财务报表、估值指标、AI 能力（一页通/投资逻辑/同业对比/线索/业绩点评/主题跟踪/调研提纲/知识库搜索）、云盘文件管理（Vault）

  **不适用**：个股研究→gangtise-stock-research；观点总结/PK→gangtise-opinion-*；证券详情/板块/股东元数据→gangtise-data-client

  **协作**：本 skill 是底层数据通道。其他 gangtise skill 需要 CLI 数据时也通过本 skill 调用。CLI 不可用时不要替代为 gangtise-data-client / gangtise-file-client，应提示用户安装 CLI（`npm install -g gangtise-openapi-cli`）。
---

# Gangtise OpenAPI CLI

> **详细参数 → `references/commands/<group>.md`**（按需 Read）
> **响应字段 → `references/response-schema.md`** ｜ **典型示例 → `references/examples.md`**
> **高频 ID → `references/lookup-ids.md`** ｜ **K 线/财务字段 → `references/fields.md`**

## 必备规则

1. **`--format json`**：列表/数据类必加。AI 内容生成（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `*-check`）也加 json，但呈现时**直接取 `content` 字段**，不要展示 JSON 包装层。
2. **opaque ID**：先读 `references/lookup-ids.md`；找不到再调 `gangtise lookup <type> list`。**绝不猜测**。
3. **公司名 → 证券代码**：先查下方速查表（5 只 mega-cap），其余一律 `gangtise reference securities-search --keyword <名> --category stock` 取 `list[0].gtsCode`。
4. **时间格式**：datetime `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date `YYYY-MM-DD`。
5. **多值参数**：重复传，不要逗号分隔。`--security 600519.SH --security 000858.SZ`。
6. **K 线"最近 N 条"**：必须用 `--start-date`/`--end-date` 拉日期范围，从结果按 `tradeDate` 取尾部最近 N 条。**不要只用 `--limit N`**（截取的是窗口开头）。
7. **CLI 已内置自动化，不要手动复刻**：
   - 翻页 → 首页拿 total 后剩余页并发拉取
   - K 线 `--security all` 跨日期 → 自动按日切片并合并
   - 5xx / 网络错误 / `999999` → 自动指数退避重试
   - Token 失效（`8000014` / `8000015`）→ 自动重新登录并重试
8. **参数命名差异**：Insight/Quote/Vault 用 `--security`，Fundamental/AI 用 `--security-code`。
9. **调试**：`--verbose` 或 `GANGTISE_VERBOSE=1` 打印每个请求的耗时/字节数到 stderr。

## 工作流（3 步）

```
意图 → 命令（路由表）  →  执行（pre-flight + 拼参数）  →  呈现（按响应模式）
```

### Pre-flight（执行前必过）

🔴 **需用户确认**：
- `gangtise auth status` 未登录 → 提示配置 AK/SK 并中止
- 多个命令同时匹配 → 复述理解让用户挑（如"搜索研报" → research list 还是 knowledge-batch？）
- 用户说"全部 / 全量 / 全市场" → 确认是否真要拉全（默认 `--size 200`）
- 下载格式或 `--content-type` 未确定 → 询问（详见下方"下载规则"）
- list→download 用户没指定具体文件 → 展示前 10 条让用户挑

🟡 **自行判断**：
- 公司名 → 先速查表，否则 `reference securities-search`
- opaque ID → 先 `references/lookup-ids.md`
- 模糊时间词 → 查"时间词映射"
- 无时间范围 → 默认拉前 200 条（不必问）
- "AI速记/智能摘要/会议纪要"→`summary`、"原始文件/原文件"→`original`、"语音识别/转写文本/ASR"→`asr` — 用户已明示时直接映射 content-type，不必问

### 下载规则（`--file-type` / `--content-type`）

| 命令 | 参数 | 取值 |
|------|------|------|
| `insight research download` | `--file-type` | `1` PDF（默认）/ `2` Markdown |
| `insight foreign-report download` | `--file-type` | `1` PDF / `2` MD / `3` 中译 PDF / `4` 中译 MD |
| `insight announcement download` | `--file-type` | `1` PDF / `2` Markdown |
| `insight summary download` | `--file-type`（可选） | `1` 原始（默认）/ `2` HTML（仅会议平台来源） |
| `insight independent-opinion download` | `--file-type` **必选** | `1` 原文 HTML / `2` 翻译 HTML |
| `insight announcement-hk download` | — | 无格式选项 |
| `vault record-download` | `--content-type` | `original` 原始文件 / `asr` 语音识别 / `summary` AI 速记 |
| `vault my-conference-download` | `--content-type` | `asr` 语音识别 / `summary` AI 速记 |

省略 `--output` 时 CLI 自动用真实标题做文件名（先读本地 title-cache，未命中则回查 list 接口）。

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
| 跨类型语义搜索（研报+纪要+...） | `ai knowledge-batch`（多个 `--resource-type`） |
| 一页通 / 投资逻辑 / 同业对比 / 调研提纲 | `ai one-pager / investment-logic / peer-comparison / research-outline` |
| 业绩点评（异步） | `ai earnings-review` |
| 观点 PK / 多空辩论（异步） | `ai viewpoint-debate` |
| 投研线索 | `ai security-clue`（前置：`reference securities-search` 拿 `gts-code`） |
| 主题跟踪 | `ai theme-tracking` |
| 热点话题 / 早午晚报 | `ai hot-topic` |
| 管理层讨论（财报） | `ai management-discuss-announcement` |
| 管理层讨论（业绩会） | `ai management-discuss-earnings-call` |
| A 股日 K | `quote day-kline` |
| 港股日 K | `quote day-kline-hk` |
| 指数日 K（沪深京） | `quote index-day-kline` |
| 分钟 K | `quote minute-kline` |
| 利润表 / 资产负债 / 现金流（累计 / 单季） | `fundamental income-statement[-quarterly] / balance-sheet / cash-flow[-quarterly]` |
| 主营业务 / 收入结构 | `fundamental main-business` |
| 估值 / PE / PB | `fundamental valuation-analysis` |
| 盈利预测 / 一致预期 | `fundamental earning-forecast` |
| 前十大股东 | `fundamental top-holders` |
| 云盘文件 | `vault drive-list / drive-download` |
| 录音速记 | `vault record-list / record-download` |
| 我的会议（业绩会/策略会/路演内部记录） | `vault my-conference-list / my-conference-download` |
| 微信群消息 | `vault wechat-message-list`（先 `vault wechat-chatroom-list` 拿群 ID） |
| 证券代码 / gtsCode 搜索 | `reference securities-search` |

**易混淆消歧**：
- "纪要" → 外部信息走 `insight summary`；公司内部录音/会议走 `vault my-conference`
- "搜索 X" → 数据维度精确（按行业/券商）走对应 `insight ... list`；跨类型语义搜索走 `ai knowledge-batch`
- 港股代码用在 `insight foreign-opinion --security` 还是 `quote day-kline-hk --security`？前者要"境外"格式（`UBER.N`），后者要 `.HK`

## 公司名 → 证券代码

**速查表**（仅 mega-cap，命中率不高的一律走 securities-search）：

| 公司 | A 股 | 港股 |
|------|------|------|
| 贵州茅台 | `600519.SH` | — |
| 宁德时代 | `300750.SZ` | — |
| 比亚迪 | `002594.SZ` | `01211.HK` |
| 中国平安 | `601318.SH` | `02318.HK` |
| 腾讯控股 | — | `00700.HK` |

**其余一律**：
```bash
gangtise reference securities-search --keyword <公司名> --category stock --top 3 --format json
```
取 `data.list[0].gtsCode`。matchScore < 0.5 时让用户从前 3 条选。

**交易所后缀**：`.SH` 上交所（6 开头）｜ `.SZ` 深交所（0/3 开头）｜ `.BJ` 北交所 ｜ `.HK` 港股 ｜ `.N`/`.O` 等境外。

**跨市场**：A 股+港股需分别调对应命令（`quote day-kline` + `quote day-kline-hk`），不能合并。

## 响应解析骨架（5 类通用模式）

| 模式 | 出现命令 | 结构 | 处理 |
|------|---------|------|------|
| **列表** | 大多数 `list` | `{list: [...], total: N}` | 遍历 list；CLI 已自动翻页 |
| **下载** | 各 `download` | stdout = 文件路径字符串 | 直接读 stdout 整行 |
| **AI 内容** | one-pager / investment-logic / peer-comparison / research-outline | `{content: "markdown文本"}` | 取 `content` 直接呈现 |
| **K 线** | quote * | `{list: [{tradeDate, ...}]}` | 按 tradeDate 排序，取需要的尾部 |
| **异步（含 *-check）** | earnings-review / viewpoint-debate / earnings-review-check / viewpoint-debate-check | 提交 `{dataId}`；check 成功 `{date, content}` / pending `{status:"pending"}` 或抛 `410110` | 见下方"异步任务流程" |

完整字段对照见 `references/response-schema.md`。

### 异步任务流程

1. 提交命令（不带 `--wait`）→ 拿到 `dataId`
2. 间隔 30s-1min 调 `*-check --data-id <id>`
3. 返回 `{date, content}` → 成功，呈现 content
4. 返回 `{status: "pending"}` 或错误码 `410110` → 继续等
5. 错误码 `410111` → 终态失败，告知用户重试或换参数
6. 累计 3 次仍 pending → 把 `dataId` 给用户让其稍后手动 check

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
| 最新 / 今日 / 当前（K 线） | — | **45 天范围 → 从尾部取最近交易日**，不要只用 `--limit` | — |
| 最新一期 / 最新报告期（财报） | — | — | 省略 `--fiscal-year`，传 `--period latest`（默认） |
| 最新观点 / 今日观点 | 1 天范围 + `--rank-type 2` | — | — |

参数命名：Insight/Vault/AI 用 `--start-time` / `--end-time`（datetime）；Quote/Fundamental 用 `--start-date` / `--end-date`（date）。

支持时间倒序的命令加 `--rank-type 2`：opinion / summary / research / foreign-report / announcement / announcement-hk / foreign-opinion / independent-opinion。其他 list 命令按 API 默认排序。

## 异常处理

| 错误码 | 含义 | CLI 行为 | Agent 是否介入 |
|--------|------|---------|--------------|
| `999999` | 系统错误 | **自动重试 ×2** | 仍失败再告知用户 |
| `410110` | 异步生成中 | 异步轮询逻辑视为 pending | 继续等 |
| `410111` | 异步生成失败 | 终态 | **不重试**，建议换参数 |
| `8000014` / `8000015` | AK/SK 错误 | **自动刷新 token 并重试一次** | 再失败提示检查 env |
| `8000016` / `8000018` | 账号异常 / 到期 | — | 提示联系管理员 |
| `999997` | 未开通权限 | — | 联系管理员 |
| `999995` | 积分不足 | — | 联系管理员 |
| `903301` | 今日调用上限 | **不重试** | 告知用户次日重试或升级配额 |
| `433007` | 数据源不匹配 | — | 检查 `resourceType + sourceId` 组合 |
| `410004` | 数据未找到 | — | 检查查询条件 |
| `430007` | 行情查询超出限制 | — | 缩短日期范围；全市场场景应已自动分片 |
| `900001` | 请求参数缺失 | — | 检查必填项（如 `--breakdown` / `--indicator`） |
| `10011401` | 白名单未开通 | — | 联系管理员 |
| HTTP 5xx / `ECONNRESET` / 超时 | 网络/服务端 | **自动指数退避重试 ×2** | 仍失败提示用户 |
| `ValidationError` | 本地参数校验失败 | — | 检查 `--from` / `--size` / `--limit` 数值，**不要重试同命令** |

**其他场景**：
- CLI 未安装 → `npm install -g gangtise-openapi-cli`
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
3. 行业 ID 用错体系：`--industry`（数字 ID）/ `--research-area`（同 industry ID 复用）/ `--gts-code`（申万 `821xxx.SWI`）三套互不通用，详见 `references/commands/reference-and-lookup.md`
4. `--rating` / `--category` 等枚举值拼错（参考对应命令的 references 文件）

**`8000014` / `8000015` 反复**（CLI 已自动重试一次仍失败）
1. `echo $GANGTISE_ACCESS_KEY` 验环境变量是否 export
2. AK 和 SK 是否写反
3. 账号是否到期 / 异常（`gangtise auth status`）

**异步任务 `410111` 反复**（该报告期数据未生成）
1. 换更早的 `--period`（如 `2025q3` → `2025interim`）
2. `report-date` 用已发布的标准期：`xxxx-06-30` / `xxxx-12-31`
3. 直接告知用户该期数据暂不可用

**K 线返回的不是"最近"几条** → 只用 `--limit` 截的是窗口开头。必须改用 `--start-date`/`--end-date` 拉范围，再从结果尾部按 `tradeDate` 取最近 N 条。

**翻页很慢 / 卡住** → `--verbose` 看哪一页慢；可 `GANGTISE_PAGE_CONCURRENCY=10` 提速，或缩小时间范围。

**`--security all` 报 `430007`** → 单日数据仍超 10K 行（极端情况）→ 临时改用更窄的 `--start-date`/`--end-date`，或改为单只 `--security` 单独拉。

**AI agent 命令（one-pager 等）超时** → 服务端生成耗时长，CLI 默认 30s → `GANGTISE_TIMEOUT_MS=120000` 后重试。

**估值结果出现大量 `null`** → 最新交易日数据未入库 → 加 `--skip-null` 过滤掉 `value` / `percentileRank` 为 null 的行。

**下载文件名乱码 / 截断** → terminal locale 或 shell quoting 问题 → 显式 `--output ./<title>.<ext>` 避开。

**同一公司既是股票又是 DR** → `securities-search` 默认返回所有分类 → 加 `--category stock` 收敛。

## 详细参数

按需 Read 对应文件：

- 内资观点 / 纪要 / 路演 / 调研 / 策略 / 论坛 / 研报 / 外资研报 / A 股公告 / 港股公告 / 外资观点 / 独立观点 → `references/commands/insight.md`
- 4 个 K 线（A 股 / 港股 / 指数 / 分钟） → `references/commands/quote.md`
- 三大报表 / 主营 / 估值 / 盈利预测 / 股东 → `references/commands/fundamental.md`
- knowledge-batch / security-clue / AI agent / 异步任务 / 主题跟踪 / 热点 / 管理层讨论 → `references/commands/ai.md`
- drive / record / my-conference / wechat → `references/commands/vault.md`
- securities-search / lookup / 行业别名 / raw call → `references/commands/reference-and-lookup.md`

跑通流程对照 → `references/examples.md`
