# Alternative 命令详细参数（行业指标数据库 EDB / 题材指数）

> 本组覆盖 `/application/open-alternative/*`：行业指标数据库（EDB `edb-search` / `edb-data`）与题材指数画像（`concept-info` / `concept-securities`）。

## 行业指标搜索 `alternative edb-search`

```bash
gangtise alternative edb-search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：关键词模糊匹配指标名称，如 `空调` / `空调销量` / `海尔`
- `--limit`：返回条数上限，默认 100，最大 200
- 返回字段：`indicatorId` / `indicatorName` / `dataSource` / `frequency` / `unit`
- **用途**：在不知道 indicatorId 时先搜索，拿到 ID 后再调 `edb-data` 获取时序数据

**示例：**
```bash
gangtise alternative edb-search --keyword 空调 --limit 50 --format table
```

## 行业指标时序数据 `alternative edb-data`

```bash
gangtise alternative edb-data --indicator-id <id> [--indicator-id <id2>] --start-date <date> --end-date <date>
```

- `--indicator-id`（**至少 1 个**，最多 10 个）：指标 ID，来自 `edb-search` 返回的 `indicatorId`，可重复传
- `--start-date`（**必选**）：开始日期，格式 `yyyy-MM-dd`
- `--end-date`（**必选**）：结束日期，格式 `yyyy-MM-dd`
- 返回格式：列表，每行为 `{date, <indicatorId1>: value, <indicatorId2>: value, ...}`
- 日期列为字符串（如 `"2010-01-31"`），数值列为字符串数字（如 `"447184.41"`）

**典型流程：**
```bash
# Step 1: 找空调相关指标
gangtise alternative edb-search --keyword 空调 --format table

# Step 2: 拉 2024 年的时序数据
gangtise alternative edb-data \
  --indicator-id S14001618 \
  --indicator-id S14001620 \
  --start-date 2024-01-01 \
  --end-date 2024-12-31 \
  --format table
```

- `frequency` 决定数据的时间颗粒度（`日` / `周` / `月` / `季` / `年`）
- 空值用 `null` 表示（某日期某指标无数据时）

---

## 题材指数基本信息 `alternative concept-info`

```bash
gangtise alternative concept-info --concept-id <id>
```

- `--concept-id`（**必选**）：题材指数 ID，如 `121000130`（机器人）
- **如何拿 ID**：题材指数与主题（`ai theme-tracking --theme-id`）共用同一套 ID 体系，用 `gangtise lookup theme-id list` 按名称查（如 机器人 → `121000130`）。**绝不猜测**
- 仅返回**最新截面**画像，不支持历史回溯
- 默认 `--format json`（含大段文本，建议直接读字段）
- 返回字段（单对象，非列表）：
  - `conceptId` / `conceptName` — 题材 ID / 名称
  - `definition` — 题材定义（核心定位与覆盖范围）
  - `investmentLogic` — 投资逻辑（需求背景 / 技术临界点 / 产业链 / 风险点）
  - `industrySpace` — 行业空间测算（全球 / 中国各时点市场规模）
  - `competitiveLandscape` — 竞争格局（整机及核心细分头部玩家与份额）
  - `keyEvents` — 催化事件列表 `[{date, content}]`，过去 1 年已发生 + 未来预期，最多 10 条，按时间倒序
- **空值规范**：文本字段若题材未配置返回 `null`；`keyEvents` 无任何事件返回 `null`

**示例：**
```bash
# 先查 ID
gangtise lookup theme-id list | grep 机器人
# 再拉题材画像
gangtise alternative concept-info --concept-id 121000130 --format json
```

## 题材指数成分股 `alternative concept-securities`

```bash
gangtise alternative concept-securities --concept-id <id>
```

- `--concept-id`（**必选**）：题材指数 ID，同上（`lookup theme-id list` 查）
- 返回当前成分股，**按分组结构**组织（题材深度 F8）；仅最新截面，不支持历史回溯
- 默认 `--format json`：成分股是 `securityDetail[].securityList[]` 两层嵌套，`table` / `csv` / `markdown` / `jsonl` 不会展开成逐只成分股（会把整个 `securityDetail` 压成单格/单行）；要逐只数据请用 json 自行解析分组
- 返回字段（单对象）：
  - `conceptId` / `conceptName` — 题材 ID / 名称
  - `securityCount` — 成分股总数
  - `securityDetail` — 分组数组 `[{groupName, securityList}]`，按 `groupName` 字母序
    - `groupName` — 分组名（如 灵巧手 / 丝杠）
    - `securityList` — 该组成分股 `[{securityCode, securityName, isKey, inclusionReason}]`
      - `isKey` — 是否重点个股（`true` 排在组内前面）
      - `inclusionReason` — 纳入理由，未配置返回 `null`
- **排序**：组按 `groupName` 字母序；组内 `isKey=true` 优先，再按 `securityCode` 升序
- **空值规范**：题材无成分股时 `securityDetail` 返回 `null`，`securityCount` 为 0，接口仍返回成功（`000000`）

**示例：**
```bash
gangtise alternative concept-securities --concept-id 121000130 --format json
```
