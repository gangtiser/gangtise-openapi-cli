# Quote 命令详细参数

通用：`--field` 可重复（`--field open --field close`），可用字段见 `references/fields.md`。

**`--field` 字段名必须核对**（v0.28.3 起传错直接报错）：上游对不存在的字段名有两套处理——day-kline / minute-kline / fund-flow 把字段名和值一起丢掉（安全）；但 `quote realtime`（及 `fundamental main-business` / `valuation-analysis`）**只丢值、字段名照请求回显**，按位置拍平就把值贴到了错误的字段上。实测 `quote realtime --field securityCode --field close --field turnoverRate`：realtime 根本没有 `close`，返回的 2 个值被拍成 `close = 28.5573`（那是换手率，茅台真实价 1297.41）——不报错、数字看着合理、却完全是另一个指标。CLI 现在长度不匹配就直接失败（退出码 1），不输出错位数据。**不确定字段名就别传 `--field`**（返回全量最稳）。

**关键规则**：查"最近"K线必须显式 `--start-date`/`--end-date` 拉范围，再从 `tradeDate` 取尾部最近 N 条；不要只用 `--limit N`（会截取查询窗口开头）。

🔴 **全市场关键字换了（2026-08-14）**：`quote day-kline` 的 `--security all` **已不再支持**，改为三个市场关键字之一——`aShares` / `hkStocks` / `usStocks`，且**必须单独传**（不能与证券代码或另一个关键字混填）。传 `all` 或混填 CLI 会直接报错并提示正确写法。三个已下线的旧命令（`day-kline-hk` / `day-kline-us` / `index-day-kline`）仍认 `all`。

**自动分片**：全市场关键字跨日期范围时 CLI 自动按日切片并并发执行，合并结果返回，无需手动分批。分片粒度按各市场单个交易日的行数规模定，保证单请求不撞 10000 行的 API 上限：

| 命令 | 全市场关键字 | 分片粒度 |
| :-- | :-- | :-- |
| `day-kline` | `aShares` | 1 天/片 |
| `day-kline` | `hkStocks` | 2 天/片 |
| `day-kline` | `usStocks` | 1 天/片 |
| `fund-flow` | `aShares` | 1 天/片 |
| `day-kline-hk` / `day-kline-us` / `index-day-kline`（旧） | `all` | 2 / 1 / 15 天/片 |

分片路径会自动把 `limit` 抬到 10000（API 上限），避免默认 6000 行截断；按日分片自动跳过周六日。

**日K线历史性**（v0.14.0 起 API 文档明确）：所有日K线接口仅返回**历史数据**，不提供实时行情。盘中实时数据请改用 `quote realtime`。当日数据入库时间：A 股约 15:30、港股约 16:30、美股约 07:00（北京时间）。

---

## 日 K 线（统一，A 股 / 港股 / 美股 / 指数） `quote day-kline`

```bash
gangtise quote day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

**2026-08-14 起这一个命令覆盖全部品种**，港股 / 美股 / 指数不用再换命令，也可以在一次请求里混着传：

| 品种 | 代码格式 | 示例 |
| :-- | :-- | :-- |
| A 股 | `.SH` `.SZ` `.BJ` | `600519.SH` `835305.BJ` |
| 港股 | `.HK` | `00700.HK` |
| 美股 | `.O` 纳斯达克 / `.N` 纽交所 / `.A` AMEX | `AAPL.O` |
| 交易所指数 | `.SH` `.SZ` `.BJ` | `000001.SH` 上证指数、`399006.SZ` 创业板指 |
| 概念指数 | `.GT` | `880134.GT` 机器人 |
| 行业指数 | `.CI` 中信 / `.SWI` 申万（一二三级） | `821031.SWI` |

- **全市场**：`--security aShares` / `hkStocks` / `usStocks`，**必须单独传**（见文件开头）。⚠️ 指数**不支持**全市场关键字，必须逐个传代码
- 混市场查询时各证券只返回其所属交易所的交易日：春节期间 A 股休市而美股正常，则当期只有美股行；美国独立日反之
- `--limit` 默认 6000，上限 10000
- 常用字段：`open` `high` `low` `close` `pctChange` `volume` `amount` `adjustFactor`
- `adjustFactor` 复权因子：后复权价 = 不复权价 × `adjustFactor`；前复权价 = 不复权价 × `adjustFactor` ÷ 最新交易日的 `adjustFactor`。**指数无复权因子，该字段为 `null`**

## ⚠️ 已下线的三个旧命令（仍可调用）

`quote day-kline-hk` / `quote day-kline-us` / `quote index-day-kline` 的能力已并入上面的 `day-kline`，官方于 2026-08-14 把它们从菜单下线，接口仍可调用。**新代码一律用 `day-kline`**，理由不止是少记三个命令：

- 旧命令**不校验证券代码**——传错代码返回 `{"total":0}` 而不是报错，与「该票该区间真无数据」无法区分；`day-kline` 会报 `120001`
- 参数与字段和 `day-kline` 完全一致（`--security` / `--start-date` / `--end-date` / `--limit` / `--field`），迁移只是换命令名
- 三者的全市场关键字仍是 `all`（不是 `aShares` 那套）

## 实时行情 `quote realtime`

```bash
gangtise quote realtime [--security <code>] [--field <name>]
```

- **覆盖三大市场 + 指数**：A 股 / 港股 / 美股个股与交易所指数（`.SH`/`.SZ`/`.BJ`）、概念指数（`.GT`）、行业指数（`.CI`/`.SWI`）可混合传入（如 `--security 600519.SH --security 00700.HK --security 000001.SH --security 880134.GT`）
- **全市场关键字**：`--security aShares` 全部 A 股 / `hkStocks` 全部港股 / `usStocks` 全部美股，**必须单独传**（不能与代码或另一个关键字混填，CLI 会本地拦截）；建议配合 `--field` 精简返回字段。⚠️ 指数不支持全市场关键字
- 指数返回的是点位，无货币单位；概念 / 行业指数交易时间与 A 股一致
- 返回**最新时刻**的行情快照（最新价/开高低/涨跌/成交量额/振幅）
- 非交易时间返回最近一个交易日的收盘快照；停牌证券返回停牌前最后一个有效快照
- **实测全量字段（16 个，2026-07-24）**：`securityCode` `exchange` `tradeDate` `tradeTime` `open` `high` `low` `latestPrice` `preClose` `change` `pctChange` `volume` `amount` `turnoverRate` `amplitude` `volumeRatio`
- **没有 `close`**——收盘价语义用 `latestPrice`（非交易时间即为收盘价），或改用 `quote day-kline` 的 `close`；**也没有市值**，总市值走 `indicator cross-section --indicator qte_mkt_cptl`（2026-08-03 起 A/港/美股均有数）
- 字段速查：见 `references/fields.md` 中的"实时行情"小节

## A股资金流向 `quote fund-flow`

```bash
gangtise quote fund-flow [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- A 股个股**日频**资金流向（沪深京 `.SH` / `.SZ` / `.BJ`），仅历史数据；交易日数据约 16:30 入库
- `--security`：证券代码（可重复），或 `aShares` 全市场 A 股（**须显式传 `--start-date`/`--end-date`**，CLI 按日自动分片并发合并；缺日期会本地报错）
- `--start-date` / `--end-date`：`yyyy-MM-dd`；省略时 `end-date` 默认最新交易日、`start-date` 默认往前 1 年
- `--limit`：默认 6000，**上限 10000**（超 10000 本地直接报错）
  - **单只证券**：接口无翻页，返回行数撞上 `--limit` 时结果标 `partial`、退出码 3、stderr 警告——缩小日期区间分批拉取
  - **`aShares` 全市场**（单日约 5000+ 行）：**须显式传 `--start-date`/`--end-date`**，CLI 按日自动分片并发合并、无需手动分批（缺日期或单请求多日全市场会触发服务端 `430012/430013`，分片规避了它）
- `--field`：指定返回字段（`securityCode` / `tradeDate` 默认返回，恒在最前）；不传返回全部
  - 小/中/大/特大单：`{small|medium|large|xlarge}{Inflow|Outflow|NetInflow|InflowRatio|OutflowRatio}`
  - 汇总与主力：`total{Inflow|Outflow|NetInflow}` / `main{Inflow|Outflow|NetInflow|InflowRatio|OutflowRatio}`（主力 = 大单 + 特大单）
- 金额单位：元；占比单位：%（各分类流入占比之和 = 100）
- 无积分消耗

## 指数日 K 线 `quote index-day-kline`（⚠️ 已下线，改用 `day-kline`）

```bash
gangtise quote index-day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 沪深京指数：如 `000001.SH` 上证综指、`399001.SZ` 深成指；`--security all` 全市场指数（**仍是 `all`，不是 `aShares` 那套**）
- `--limit` 默认 6000，上限 10000
- 常用字段：`securityCode` `securityName` `tradeDate` `open` `high` `low` `close` `preClose` `change` `pctChange` `volume` `amount`
- `securityName` 为指数名称（如 `上证指数`），v0.15.0 起返回
- **还值得用它的两个场景**（都是 `day-kline` 做不到的，实测 2026-08-13）：
  1. **一次拿全部沪深京指数**（`--security all`）——`day-kline` 的指数必须逐个传代码
  2. **要指数名称**——`index-day-kline` 返回 `securityName`（如「上证指数」），`day-kline` **没有这个字段**，查指数只拿得到代码
- 反过来 `day-kline` 独有 `adjustFactor`（复权因子），但指数本来就没有复权，该字段查指数时恒为 `null`

## 分钟 K 线 `quote minute-kline`

```bash
gangtise quote minute-kline --security <code> [--start-time <datetime>] [--end-time <datetime>] [--limit <n>] [--field <name>]
```

- 支持**沪深** A 股个股（`.SH` / `.SZ`，不含北交所）、交易所指数（`.SH` / `.SZ`）、概念指数（`.GT`）、行业指数（`.CI` / `.SWI`），2026-08-14 起扩展；**必须传 `--security`**（否则返回 `100003`，msg 为「securityCode不可为空」；2026-07-20 实测）
- **一次只能查一只**（参数是 `securityCode` 单值，不是列表），要多只就循环调用
- `--start-time` / `--end-time`：`yyyy-MM-dd HH:mm:ss`（兼容 `yyyy-MM-dd` 自动补全）
- `--limit` 默认 6000，上限 10000
- 常用字段：`securityCode` `tradeTime` `open` `high` `low` `close` `change` `pctChange` `volume` `amount`
