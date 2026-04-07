---
name: gangtise-openapi
description: |-
  通过 gangtise CLI 调用 Gangtise OpenAPI，获取投研原始数据并执行批量操作。覆盖：首席观点、纪要、路演、调研、策略会、论坛、研报、外资研报、公告、日K线行情、基本面数据（利润表/主营/估值分析）、AI知识库搜索、投研线索、个股一页通、投资逻辑、同业对比、AI云盘文件管理。

  **务必在以下场景使用此 skill（即使用户没有明确提到 API 或 CLI）**：
  - 需要从 Gangtise 平台拉取**原始数据**（非经过其他 skill 加工的结果）
  - 用户提到"调接口"、"gangtise命令"、"openapi"、"用CLI查"、"导出数据"、"下载文件"
  - 需要批量导出观点/研报/纪要到文件（jsonl/csv）
  - 查询枚举值（研究方向、券商机构、行业 ID）
  - 下载研报/纪要/公告/云盘文件的 PDF 或原始文件
  - 查行情K线、财务数据、估值指标等结构化金融数据的原始值
  - 调用 AI 能力（知识库搜索、一页通、投资逻辑、同业对比、投研线索）
  - 用户说"帮我查一下XX的数据"、"导出最近的XX"、"下载这份研报"等

---

# Gangtise OpenAPI CLI

通过 `gangtise` 命令行工具直接调用 Gangtise OpenAPI，获取投研原始数据。

## 快速决策：用哪个命令？

根据用户需求快速定位：

| 用户想要 | 命令路径 |
|----------|----------|
| 首席/分析师观点 | `insight opinion list` |
| 纪要（会议纪要、调研纪要） | `insight summary list/download` |
| 路演信息 | `insight roadshow list` |
| 实地调研 | `insight site-visit list` |
| 策略会 | `insight strategy list` |
| 论坛活动 | `insight forum list` |
| 研报（券商研报） | `insight research list/download` |
| 外资研报 | `insight foreign-report list/download` |
| 公告 | `insight announcement list/download` |
| K线行情 | `quote day-kline` |
| 利润表/财务数据 | `fundamental income-statement` |
| 主营业务构成 | `fundamental main-business` |
| PE/PB/PEG 等估值 | `fundamental valuation-analysis` |
| 知识库语义搜索 | `ai knowledge-batch` |
| 投研线索 | `ai security-clue` |
| 个股一页通 | `ai one-pager` |
| 投资逻辑 | `ai investment-logic` |
| 同业对比 | `ai peer-comparison` |
| 云盘文件 | `ai cloud-disk-list/download` |
| 不确定参数 ID | `lookup` 先查枚举 |
| 直接调底层接口 | `raw call <endpoint.key>` |

## 前置条件

```bash
npm install -g gangtise-openapi-cli
```

环境变量（二选一）：
- **AK/SK 模式**：`GANGTISE_ACCESS_KEY` + `GANGTISE_SECRET_KEY`（自动获取并缓存 token）
- **Token 模式**：`GANGTISE_TOKEN="Bearer xxx"`

验证：`gangtise auth status`

## 输出格式

`--format` 参数：`table`（默认）| `json` | `jsonl` | `csv` | `markdown`

保存到文件：`--output <path>`

**agent 调用时务必使用 `--format json` 便于解析。**

## 工作流：先查枚举，再调业务

很多业务命令需要 ID 参数，先用 lookup 获取：

```bash
gangtise lookup research-area list   # 研究方向 ID
gangtise lookup broker-org list      # 券商机构 ID
gangtise lookup meeting-org list     # 会议机构 ID
gangtise lookup industry list        # 行业 ID
gangtise lookup industry-code list   # 申万行业代码（用于 security-clue --gts-code）
```

## Insight 命令（投研内容）

### 通用参数

以下参数在所有 insight list 命令中通用：

| 参数 | 说明 |
|------|------|
| `--keyword <text>` | 关键词搜索 |
| `--start-time <datetime>` | 开始时间，格式 `"YYYY-MM-DD HH:mm:ss"` |
| `--end-time <datetime>` | 结束时间，格式 `"YYYY-MM-DD HH:mm:ss"` |
| `--from <n>` | 起始偏移（默认 0） |
| `--size <n>` | 最多返回条数（省略则自动翻页查全） |

### 首席观点

```bash
gangtise insight opinion list [options]
```

专有参数：`--research-area <id>`、`--chief <id>`、`--security <code>`、`--broker <id>`、`--industry <id>`、`--concept <id>`、`--llm-tag <tag>`、`--source <source>`（均可重复）

### 纪要

```bash
gangtise insight summary list [options]
gangtise insight summary download --summary-id <id> [--output <path>]
```

专有参数：`--search-type <n>`、`--rank-type <n>`、`--source <n>`、`--institution <id>`、`--category <name>`、`--market <name>`、`--participant-role <name>`（均可重复）

### 路演 / 实地调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list [options]
gangtise insight site-visit list [options]
gangtise insight strategy list [options]
gangtise insight forum list [options]
```

共用专有参数：`--research-area <id>`、`--institution <id>`、`--security <code>`、`--category <name>`、`--market <name>`、`--participant-role <name>`、`--broker-type <type>`、`--permission <n>`（均可重复）

### 研报

```bash
gangtise insight research list [options]
gangtise insight research download --report-id <id> [--output <path>]
```

专有参数：`--broker <id>`、`--security <code>`、`--industry <id>`

### 外资研报

```bash
gangtise insight foreign-report list [options]
gangtise insight foreign-report download --report-id <id> [--output <path>]
```

专有参数：`--security <code>`

### 公告

```bash
gangtise insight announcement list [options]
gangtise insight announcement download --announcement-id <id> [--output <path>]
```

专有参数：`--security <code>`、`--announcement-type <type>`

## Quote 命令（行情）

### 日K线

```bash
gangtise quote day-kline --security <code> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> [--limit <n>] [--field <name>]
```

## Fundamental 命令（基本面）

### 利润表

```bash
gangtise fundamental income-statement --security-code <code> [--fiscal-year <year>] [--period <q1|q2|q3|latest>] [--report-type <consolidated|parent>] [--field <name>]
```

### 主营业务

```bash
gangtise fundamental main-business --security-code <code> [--fiscal-year <year>] [--field <name>]
```

### 估值分析

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <date>] [--end-date <date>] [--limit <n>]
```

indicator 可选值：`peTtm` | `pbMrq` | `peg` | `psTtm` | `pcfTtm` | `em`

## AI 命令

### 知识库批量搜索

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>]
```

### 知识资源下载

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配，错误组合返回 `433007`。

### 投研线索

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <bySecurity|byIndustry> [--gts-code <code>] [--source <name>] [--from <n>] [--size <n>]
```

`--gts-code` 支持个股代码或申万行业代码（如 `821035.SWI`），行业代码可通过 `gangtise lookup industry-code list` 查询。

### 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager --security-code <code>
gangtise ai investment-logic --security-code <code>
gangtise ai peer-comparison --security-code <code>
```

### AI 云盘

```bash
gangtise ai cloud-disk-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--from <n>] [--size <n>]
gangtise ai cloud-disk-download --file-id <id> [--output <path>]
```

## Raw 调用

对任意 endpoint key 发起调用，自动复用认证和翻页逻辑：

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

endpoint key 格式如 `insight.opinion.list`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch` 等。

## 自动翻页

省略 `--size` 时自动查全所有记录。支持自动翻页的接口：

`insight.opinion.list`、`insight.summary.list`、`insight.roadshow.list`、`insight.site-visit.list`、`insight.strategy.list`、`insight.forum.list`、`insight.research.list`、`insight.foreign-report.list`、`insight.announcement.list`、`ai.security-clue.list`、`ai.cloud-disk.list`

## 常见错误码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `8000014` | ACCESS_KEY 错误 | 检查环境变量 |
| `8000015` | SECRET_KEY 错误 | 检查环境变量 |
| `999997` | 未开通接口权限 | 联系管理员开通 |
| `999995` | 积分不足 | 联系管理员充值 |
| `903301` | 今日调用次数达上限 | 等待次日或升级配额 |
| `433007` | 数据源不匹配 | 检查 resourceType + sourceId 组合 |

## 实用技巧

1. **查枚举优先** — 不确定 ID 时先 `lookup`，避免无效调用
2. **时间格式** — 时间参数 `"YYYY-MM-DD HH:mm:ss"`（带引号），日期参数 `YYYY-MM-DD`
3. **多值过滤** — 可重复参数（如 `--security`）多次传入：`--security 600519.SH --security 000858.SZ`
4. **批量导出** — `--format jsonl --output data.jsonl` 适合大量数据
5. **下载文件** — download 命令用 `--output` 指定保存路径，不指定则输出到 stdout
