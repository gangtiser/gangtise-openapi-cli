# Alternative 命令详细参数（行业指标数据库 EDB）

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
