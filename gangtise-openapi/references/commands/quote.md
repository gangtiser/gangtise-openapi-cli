# Quote 命令详细参数

通用：`--field` 可重复（`--field open --field close`），可用字段见 `references/fields.md`。

**关键规则**：查"最近"K线必须显式 `--start-date`/`--end-date` 拉范围，再从 `tradeDate` 取尾部最近 N 条；不要只用 `--limit N`（会截取查询窗口开头）。

**自动分片**（v0.12.0）：`--security all` 跨日期范围 CLI 会自动按日切片并并发执行（A 股 2 天/片，HK 3 天/片，指数 30 天/片），合并结果返回。无需手动按季度分批。

---

## 日 K 线（A 股） `quote day-kline`

```bash
gangtise quote day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 支持 `.SH` `.SZ` `.BJ`，`--security all` 全市场
- `--limit` 默认 6000，上限 10000
- 常用字段：`open` `high` `low` `close` `pctChange` `volume` `amount`

## 日 K 线（港股） `quote day-kline-hk`

```bash
gangtise quote day-kline-hk [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 支持 `.HK`，`--security all` 全市场
- `--limit` 默认 6000，上限 10000

## 指数日 K 线 `quote index-day-kline`

```bash
gangtise quote index-day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 沪深京指数：如 `000001.SH` 上证综指、`399001.SZ` 深成指；`--security all` 全市场指数
- `--limit` 默认 6000，上限 10000
- 常用字段：`securityCode` `tradeDate` `open` `high` `low` `close` `preClose` `change` `pctChange` `volume` `amount`

## 分钟 K 线（A 股） `quote minute-kline`

```bash
gangtise quote minute-kline --security <code> [--start-time <datetime>] [--end-time <datetime>] [--limit <n>] [--field <name>]
```

- 仅支持 A 股，**必须传 `--security`**（否则返回 430007）
- `--start-time` / `--end-time`：`yyyy-MM-dd HH:mm:ss`（兼容 `yyyy-MM-dd` 自动补全）
- `--limit` 默认 5000，上限 10000
- 常用字段：`securityCode` `tradeTime` `open` `high` `low` `close` `change` `pctChange` `volume` `amount`
