# Quote 命令详细参数

通用：`--field` 可重复（`--field open --field close`），可用字段见 `references/fields.md`。

**关键规则**：查"最近"K线必须显式 `--start-date`/`--end-date` 拉范围，再从 `tradeDate` 取尾部最近 N 条；不要只用 `--limit N`（会截取查询窗口开头）。

**自动分片**（v0.12.0；v0.14.2 修正分片粒度并注入 limit=10000）：`--security all` 跨日期范围 CLI 会自动按日切片并并发执行（A 股 1 天/片，美股 1 天/片，HK 2 天/片，指数 30 天/片），合并结果返回。CLI 在 `--security all` 路径会自动把 `limit` 抬到 10000（API 上限），避免默认 6000 行截断。无需手动按季度分批。

**日K线历史性**（v0.14.0 起 API 文档明确）：所有日K线接口仅返回**历史数据**，不提供实时行情。盘中实时数据请改用 `quote realtime`。当日数据入库时间：A 股约 15:30、港股约 16:30、美股约 07:00（北京时间）。

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

## 日 K 线（美股） `quote day-kline-us`

```bash
gangtise quote day-kline-us [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 美股代码格式：`AAPL.O`（纳斯达克 `.O`，纽交所 `.N`，AMEX `.A`），`--security all` 全市场
- 数据范围：NYSE / NASDAQ / AMEX
- `--limit` 默认 6000，上限 10000
- 字段与 A 股/港股相同，货币单位为美元

## 实时行情 `quote realtime`

```bash
gangtise quote realtime [--security <code>] [--field <name>]
```

- **覆盖三大市场**：支持 A 股 / 港股 / 美股代码混合传入（如 `--security 600519.SH --security 00700.HK --security AAPL.O`）
- **全市场关键字**：`--security aShares` 全部 A 股 / `--security hkStocks` 全部港股 / `--security usStocks` 全部美股；建议配合 `--field` 精简返回字段
- 返回**最新时刻**的行情快照（最新价/开高低/涨跌/成交量额/振幅）
- 非交易时间返回最近一个交易日的收盘快照；停牌证券返回停牌前最后一个有效快照
- 字段速查：见 `references/fields.md` 中的"实时行情"小节

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
