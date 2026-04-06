---
name: gangtise-openapi
description: 通过 gangtise CLI 直接调用 Gangtise OpenAPI 获取投研数据。当需要查询首席观点、纪要、路演、调研，策略会，线下论坛，研报、外资研报、公告、行情K线、财务报表、估值分析、AI知识库搜索、投研线索、个股一页通、投资逻辑、同业对比、AI云盘文件等原始数据时使用此skill。适用于需要从Gangtise平台拉取原始API数据的场景，包括但不限于：用户提到"调API"、"gangtise接口"、"gangtise cli"、"用gangtise命令"、"openapi"，或需要批量导出、下载文件、查询枚举值等操作

# Gangtise OpenAPI CLI

通过 `gangtise` 命令行工具直接调用 Gangtise OpenAPI。

## 前置条件

需要安装 CLI 并配置认证：

```bash
npm install -g gangtise-openapi-cli
```

环境变量（二选一）：
- **AK/SK 模式**：设置 `GANGTISE_ACCESS_KEY` + `GANGTISE_SECRET_KEY`，CLI 自动获取并缓存 token
- **Token 模式**：直接设置 `GANGTISE_TOKEN="Bearer xxx"`

验证：`gangtise auth status`

## 输出格式

所有查询命令支持 `--format` 参数：`table`（默认）、`json`、`jsonl`、`csv`、`markdown`

保存到文件：`--output <path>`

agent 调用建议用 `--format json` 或 `--format jsonl` 便于解析。

## 命令参考

### 认证

```bash
gangtise auth login          # 获取 token
gangtise auth status         # 查看认证状态
```

### 枚举查询（lookup）

查询前先获取 ID 映射：

```bash
gangtise lookup research-area list   # 研究方向枚举
gangtise lookup broker-org list      # 券商机构枚举
gangtise lookup meeting-org list     # 会议机构枚举
gangtise lookup industry list        # 行业枚举
```

### Insight（投研内容）

#### 首席观点

```bash
gangtise insight opinion list [options]
```

| 参数 | 说明 |
|------|------|
| `--keyword <text>` | 关键词搜索 |
| `--start-time/--end-time <datetime>` | 时间范围，格式 `"YYYY-MM-DD HH:mm:ss"` |
| `--from <n>` | 起始偏移（默认 0） |
| `--size <n>` | 最多返回条数（省略则自动翻页查全） |
| `--research-area <id>` | 研究方向 ID（可重复） |
| `--chief <id>` | 首席 ID（可重复） |
| `--security <code>` | 证券代码（可重复） |
| `--broker <id>` | 券商 ID（可重复） |
| `--industry <id>` | 行业 ID（可重复） |
| `--concept <id>` | 概念 ID（可重复） |
| `--llm-tag <tag>` | 语义标签（可重复） |
| `--source <source>` | 来源（可重复） |

#### 纪要

```bash
gangtise insight summary list [options]
gangtise insight summary download --summary-id <id> [--output <path>]
```

list 参数同 opinion，另有：`--search-type <n>`、`--rank-type <n>`、`--source <n>`（可重复）、`--institution <id>`（可重复）、`--category <name>`（可重复）、`--market <name>`（可重复）、`--participant-role <name>`（可重复）

#### 路演 / 实地调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list [options]
gangtise insight site-visit list [options]
gangtise insight strategy list [options]
gangtise insight forum list [options]
```

共用参数：`--keyword`、`--start-time/--end-time`、`--from`、`--size`、`--research-area`、`--institution`、`--security`、`--category`、`--market`、`--participant-role`、`--broker-type`、`--permission`

#### 研报

```bash
gangtise insight research list [options]
gangtise insight research download --report-id <id> [--output <path>]
```

list 特有参数：`--broker <id>`、`--security <code>`、`--industry <id>`

#### 外资研报

```bash
gangtise insight foreign-report list [options]
gangtise insight foreign-report download --report-id <id> [--output <path>]
```

list 特有参数：`--security <code>`

#### 公告

```bash
gangtise insight announcement list [options]
gangtise insight announcement download --announcement-id <id> [--output <path>]
```

list 特有参数：`--security <code>`、`--announcement-type <type>`

### Quote（行情/财务）

#### 日K线

```bash
gangtise quote day-kline --security <code> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> [--limit <n>] [--field <name>]
```

#### 利润表

```bash
gangtise quote income-statement --security-code <code> [--fiscal-year <year>] [--period <q1|q2|q3|latest>] [--report-type <consolidated|parent>] [--field <name>]
```

#### 主营业务

```bash
gangtise quote main-business --security-code <code> [--fiscal-year <year>] [--field <name>]
```

#### 估值分析

```bash
gangtise quote valuation-analysis --security-code <code> --indicator <name> [--start-date <date>] [--end-date <date>] [--limit <n>]
```

indicator 可选：`peTtm`、`pbMrq`、`peg`、`psTtm`、`pcfTtm`、`em`

### AI

#### 知识库批量搜索

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>]
```

#### 知识资源下载

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

注意：`resourceType + sourceId` 组合必须匹配，错误组合返回 `433007`。

#### 投研线索

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <bySecurity|byAll> [--gts-code <code>] [--source <name>] [--from <n>] [--size <n>]
```

#### 一页通

```bash
gangtise ai one-pager --security-code <code>           # 一页通
```

#### 投资逻辑

```bash
gangtise ai investment-logic --security-code <code>    # 投资逻辑
```

#### 同业对比

```bash
gangtise ai peer-comparison --security-code <code>     # 同业对比
```

#### AI云盘

```bash
gangtise ai cloud-disk-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--from <n>] [--size <n>]
gangtise ai cloud-disk-download --file-id <id> [--output <path>]
```

### Raw（原始调用）

对任意 endpoint key 发起调用，自动复用认证和翻页逻辑：

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

endpoint key 格式如 `insight.opinion.list`、`quote.day-kline`、`ai.knowledge-batch` 等。

## 自动翻页

以下 list 接口支持自动翻页（省略 `--size` 时自动查全）：

`insight.opinion.list`、`insight.summary.list`、`insight.roadshow.list`、`insight.site-visit.list`、`insight.strategy.list`、`insight.forum.list`、`insight.research.list`、`insight.foreign-report.list`、`insight.announcement.list`、`ai.security-clue.list`、`ai.cloud-disk.list`

## 常见错误码

| 错误码 | 含义 |
|--------|------|
| `8000014` | ACCESS_KEY 错误 |
| `8000015` | SECRET_KEY 错误 |
| `999997` | 未开通接口权限 |
| `999995` | 积分不足 |
| `903301` | 今日调用次数达上限 |
| `433007` | 不支持该数据源（资源下载参数不匹配） |

## 使用建议

1. 先用 `lookup` 查枚举 ID，再传入业务命令
2. 时间参数格式：`"YYYY-MM-DD HH:mm:ss"`，日期参数格式：`YYYY-MM-DD`
3. 可重复参数（如 `--security`）可多次传入实现多值过滤
4. 大量数据导出建议用 `--format jsonl --output data.jsonl`
5. 下载类命令用 `--output` 指定保存路径
