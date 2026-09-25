# Quote 命令详细参数

通用：`--field` 可重复（`--field open --field close`），可用字段见 `references/fields.md`。

**`--field` 字段名必须核对**：上游对不存在的字段名有两套处理——day-kline / minute-kline / fund-flow / realtime 把字段名和值**一起丢掉**（不报错，结果里就是少一列）；`fundamental main-business` / `valuation-analysis` 则**只丢值、字段名照请求回显**，按位置拍平就把值贴到了错误的字段上。CLI 对后一种长度不匹配直接失败（退出码 1），不输出错位数据；对前一种比对请求与返回的列名，**缺列就标 `partial` + `missingFields`、退出码 3 并在 stderr 点名是哪几列**（字段名写错或已下线，按 `references/fields.md` 核对）。**不确定字段名就别传 `--field`**（返回全量最稳）。另外 `--field` 只返回点名的列，所以**多只证券或全市场关键字**时 CLI 会补上区分行所需的列并在 stderr 说明：日 K 补 `securityCode` / `tradeDate`、分钟 K 补 `securityCode` / `tradeTime`、实时行情补 `securityCode`（需要时点自己加 `tradeDate` / `tradeTime`）；单只证券按点名的列原样返回。`fund-flow` 由服务端自动附带 `securityCode` / `tradeDate`。

**关键规则**：查"最近"K线必须显式 `--start-date`/`--end-date` 拉范围，再从 `tradeDate` 取尾部最近 N 条；不要只用 `--limit N`（会截取查询窗口开头）。

🔴 **全市场关键字**：`quote day-kline` 不认 `--security all`，只认三个市场关键字之一——`aShares` / `hkStocks` / `usStocks`，且**必须单独传**（不能与证券代码或另一个关键字混填）。传 `all` 或混填 CLI 会直接报错并提示正确写法。已弃用的旧命令里，`day-kline-hk` / `day-kline-us` 仍认 `all`；`index-day-kline` 对 `all` 返回空结果，CLI 在发请求前直接拒绝——**全部沪深京指数没有一次拿全的写法**，要逐个传指数代码。

**自动分片**：全市场关键字跨日期范围时 CLI 自动按日切片并并发执行，合并结果返回，无需手动分批。**全市场关键字必须同时给 `--start-date` 与 `--end-date`**，缺一个 CLI 在发请求前拒绝（不分片的全市场请求会被接口以「查询规模过大」拒绝）。分片粒度按各市场单个交易日的行数规模定，保证单请求不撞 10000 行的 API 上限：

| 命令 | 全市场关键字 | 分片粒度 |
| :-- | :-- | :-- |
| `day-kline` | `aShares` | 1 个工作日/片 |
| `day-kline` | `hkStocks` | 2 个工作日/片 |
| `day-kline` | `usStocks` | 1 个工作日/片 |
| `fund-flow` | `aShares` | 1 个工作日/片 |
| `day-kline-hk` / `day-kline-us`（旧） | `all` | 2 / 1 个工作日/片 |

分片路径在没传 `--limit` 时自动把它抬到 10000（API 上限），避免默认 6000 行截断；传了 `--limit` 就按每片生效，低于单日行数时每片都会截断（标 `partial`）。分片只数工作日：周六日不单独发请求，跨周末的一片（如周五 + 周一）照常覆盖两边的交易日。

**日K线历史性**：所有日K线接口仅返回**历史数据**，不提供实时行情。盘中实时数据请改用 `quote realtime`。当日数据入库时间：A 股约 15:30、港股约 16:30、美股约 07:00（北京时间）。

---

## 日 K 线（统一，A 股 / 港股 / 美股 / ETF / 指数） `quote day-kline`

```bash
gangtise quote day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

**这一个命令覆盖全部品种**——港股 / 美股 / ETF / 各类指数不用换命令，也可以在一次请求里混着传：

| 品种 | 代码格式 | 示例 |
| :-- | :-- | :-- |
| A 股 | `.SH` `.SZ` `.BJ` | `600519.SH` `835305.BJ` |
| 港股 | `.HK` | `00700.HK` |
| 美股 | `.O` 纳斯达克 / `.N` 纽交所 / `.A` AMEX | `AAPL.O` |
| 交易所指数 | `.SH` `.SZ` `.BJ` | `000001.SH` 上证指数、`399006.SZ` 创业板指 |
| 概念指数 | `.GT` | `880134.GT` 机器人 |
| 行业指数 | `.CI` 中信 / `.SWI` 申万（一二三级） | `821031.SWI` |
| ETF（沪深） | `.SH` `.SZ` | `512800.SH` 银行ETF、`159887.SZ` 银行ETF富国 |
| 全球指数 | 数据源后缀（`.SPI` `.N` `.O` `.NKI` `.HI` `.FRA` …），清单见下表 | `SPX.SPI` 标普500、`N225.NKI` 日经225、`HSI.HI` 恒生 |

**全球指数清单（`realtime` / `day-kline` / `minute-kline` 三接口通用）**——代码后缀是数据源码，不是交易所后缀，照抄即可：

| 代码 | 名称 | 代码 | 名称 |
| :-- | :-- | :-- | :-- |
| `SPX.SPI` | 标普500 | `DJI.SPI` | 道琼斯 |
| `IXIC.O` | 纳指综合 | `NYA.N` | 纽约综指 |
| `GSPTSE.SPI` | 加拿大 S&P/TSX | `MXX.SPI` | 墨西哥 IPC |
| `N225.NKI` | 日经225 | `HSI.HI` | 恒生指数 |
| `KS11.KRX` | 韩国 KOSPI | `AORD.AUS` | 澳洲综合 |
| `NZ50.SPI` | 新西兰50 | `FTSE.FI` | 英国富时100 |
| `GDAXI.FRA` | 德国 DAX | `MIB.FI` | 富时意大利 MIB |
| `IBEX.MAD` | 西班牙 IBEX35 | `AEX.AMS` | 荷兰 AEX |
| `SSMI.SWX` | 瑞士 SMI | `BFX.BRU` | 比利时 BEL20 |
| `ATX.WBO` | 奥地利 ATX | `OMXSPI.OME` | 瑞典斯德哥尔摩 |

全球指数三接口共同的口径：**成交量额类字段为 `null`**（realtime 的 `volume` / `amount` / `amplitude`；分钟 K 的 `volume` / `amount`；日 K 只有 `amount`，`volume` 正常返回），`adjustFactor` 为 `null`；**`tradeDate` / `tradeTime` 是交易所当地时间**（如标普500 的收盘快照 `tradeTime` 是 `16:01`），不是北京时间。

- **全市场**：`--security aShares` / `hkStocks` / `usStocks`，**必须单独传**（见文件开头）。⚠️ **关键字只覆盖个股**：指数不支持全市场关键字，**`aShares` 也不含 ETF**——ETF 与各类指数都要逐个传代码
- 混市场查询时各证券只返回其所属交易所的交易日：春节期间 A 股休市而美股正常，则当期只有美股行；美国独立日反之
- `--limit` 默认 6000，上限 10000。**显式多证券且「证券数 × 交易日数」达到 `--limit` 时，CLI 自动分批请求并按传入顺序合并**（每批按行数上限装入尽量多的证券，未传 `--limit` 时上限按 10000 算；单只行数超过 `--limit` 的标 `partial` + `truncatedSecurities`）；估算低于上限时仍是单请求，单请求的行按证券代码升序返回
- 常用字段：`open` `high` `low` `close` `pctChange` `volume` `amount` `adjustFactor`
- `adjustFactor` 复权因子：后复权价 = 不复权价 × `adjustFactor`；前复权价 = 不复权价 × `adjustFactor` ÷ 最新交易日的 `adjustFactor`。**指数无复权因子，该字段为 `null`**；ETF 有，EDE 的 `qte_adj_factor` 同样覆盖场内基金
- ETF 的 `volume` 单位是「份」（由「万份」× 10000 换算，可能有细微误差）

## ⚠️ 已弃用的三个旧命令（仍可调用）

`quote day-kline-hk` / `quote day-kline-us` / `quote index-day-kline` 的能力已并入上面的 `day-kline`，CLI 标为已弃用，接口仍可调用。**新代码一律用 `day-kline`**，理由不止是少记三个命令：

- 旧命令**不校验证券代码**——传错代码返回空结果（`{"total":0,"list":[]}`）而不是报错，与「该票该区间真无数据」无法区分；`day-kline` 会报 `120001`
- 参数与字段和 `day-kline` 完全一致（`--security` / `--start-date` / `--end-date` / `--limit` / `--field`），迁移只是换命令名
- `day-kline-hk` / `day-kline-us` 的全市场关键字仍是 `all`（不是 `aShares` 那套）；`index-day-kline` 没有全市场关键字，只收明确的指数代码

## 实时行情 `quote realtime`

```bash
gangtise quote realtime [--security <code>] [--field <name>]
```

- **覆盖三大市场 + ETF + 指数**：A 股 / 港股 / 美股个股、沪深 ETF（`512800.SH`）、交易所指数（`.SH`/`.SZ`/`.BJ`）、概念指数（`.GT`）、行业指数（`.CI`/`.SWI`）、全球指数（`SPX.SPI` / `N225.NKI` / `HSI.HI`…，清单见上方日 K 一节）可混合传入（如 `--security 600519.SH --security 00700.HK --security 512800.SH --security 880134.GT --security SPX.SPI`）
- **全市场关键字**：`--security aShares` 全部 A 股 / `hkStocks` 全部港股 / `usStocks` 全部美股，**必须单独传**（不能与代码或另一个关键字混填，CLI 会本地拦截）；建议配合 `--field` 精简返回字段。⚠️ 关键字只覆盖个股：指数不支持全市场关键字，`aShares` 也不含 ETF
- 指数返回的是点位，无货币单位；概念 / 行业指数交易时间与 A 股一致
- **`tradeDate` / `tradeTime` 的时区**：A 股 / 港股 / ETF / 沪深各类指数为北京时间；**美股与全球指数是交易所当地时间**（美股收盘快照的 `tradeTime` 是 `16:00`，不是北京时间的凌晨）
- `tradeStatus`（交易状态，中文：未开市 / 盘前集合竞价 / 连续竞价 / 收盘集合竞价 / 收盘 / 休市 / 停牌暂停交易 / 停牌）**仅 A 股 / 港股个股有值**，美股、ETF、各类指数为 `null`
- **`null` 的字段**：美股 `amount`（接口不提供，要美股成交额用 `day-kline` 或 EDE `qte_amt`）；全球指数 `volume` / `amount` / `amplitude` 三个都是 `null`
- 返回**最新时刻**的行情快照（最新价/开高低/涨跌/成交量额/振幅）
- 非交易时间返回最近一个交易日的收盘快照；停牌证券返回停牌前最后一个有效快照
- **全量字段（15 个）**：`securityCode` `exchange` `tradeDate` `tradeTime` `tradeStatus` `open` `high` `low` `latestPrice` `preClose` `change` `pctChange` `volume` `amount` `amplitude`
- ⚠️ **`turnoverRate` / `volumeRatio` 不是 realtime 的字段**：传了会连字段名一起被静默丢掉，不报错、结果里就是没这两列。换手率走 EDE `indicator cross-section --indicator qte_turn`（A 股）；量比在 EDE 里没有对应指标
- **没有 `close`**——收盘价语义用 `latestPrice`（非交易时间即为收盘价），或改用 `quote day-kline` 的 `close`；**也没有市值**，总市值走 `indicator cross-section --indicator qte_mkt_cptl`（A/港/美股均有数）
- 字段速查：见 `references/fields.md` 中的"实时行情"小节

## A股资金流向 `quote fund-flow`

```bash
gangtise quote fund-flow [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- A 股个股**日频**资金流向（沪深京 `.SH` / `.SZ` / `.BJ`），仅历史数据；交易日数据约 16:30 入库
- `--security`：证券代码（可重复），或 `aShares` 全市场 A 股（**须显式传 `--start-date`/`--end-date`**，CLI 按日自动分片并发合并；缺日期会本地报错）。⚠️ **多只代码不会逐只拆分**：一次请求、共用一个 `--limit`，证券数 × 交易日数超过 `--limit` 就会截断（标 `partial`、退出码 3）——按「证券数 × 交易日数 ≤ 10000」自己分批
- `--start-date` / `--end-date`：`yyyy-MM-dd`；省略时 `end-date` 默认最新交易日、`start-date` 默认往前 1 年
- `--limit`：默认 6000，**上限 10000**（超 10000 本地直接报错）
  - **单只证券**：接口无翻页，返回行数撞上 `--limit` 时结果标 `partial`、退出码 3、stderr 警告——缩小日期区间分批拉取
  - **`aShares` 全市场**（单日数千行）：**须显式传 `--start-date`/`--end-date`**，CLI 按日自动分片并发合并、无需手动分批（缺日期的全市场请求会被接口以 `100003`「查询规模过大」拒绝，CLI 在发请求前就报错）
- `--field`：指定返回字段（`securityCode` / `tradeDate` 默认返回，恒在最前）；不传返回全部
  - 小/中/大/特大单：`{small|medium|large|xlarge}{Inflow|Outflow|NetInflow|InflowRatio|OutflowRatio}`
  - 汇总与主力：`total{Inflow|Outflow|NetInflow}` / `main{Inflow|Outflow|NetInflow|InflowRatio|OutflowRatio}`（主力 = 大单 + 特大单）
- 金额单位：元；占比单位：%（各分类流入占比之和 = 100）
- 无积分消耗

## 指数日 K 线 `quote index-day-kline`（⚠️ 已弃用，改用 `day-kline`）

```bash
gangtise quote index-day-kline [--security <code>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--limit <n>] [--field <name>]
```

- 沪深京指数：如 `000001.SH` 上证综指、`399001.SZ` 深成指，可重复传；**没有全市场关键字**——`--security all` 在这个接口上返回空结果，CLI 直接拒绝
- `--limit` 默认 6000，上限 10000
- 返回字段与 `day-kline` 相同：`securityCode` `tradeDate` `open` `high` `low` `close` `preClose` `change` `pctChange` `volume` `amount` `adjustFactor`（指数恒为 `null`）。**不含指数名称**
- 没有 `day-kline` 做不到的能力，新代码直接用 `day-kline` 传同样的代码
- **要指数名称**：`gangtise reference securities-search --keyword 000001.SH --category index`，返回的 `gtsName` 即名称（如「上证指数」）

## 分钟 K 线 `quote minute-kline`

```bash
gangtise quote minute-kline --security <code> [--start-time <datetime>] [--end-time <datetime>] [--limit <n>] [--field <name>]
```

- 支持**沪深** A 股个股（`.SH` / `.SZ`，不含北交所）、沪深 ETF（`512800.SH`）、交易所指数（`.SH` / `.SZ`）、概念指数（`.GT`）、行业指数（`.CI` / `.SWI`）、全球指数（`SPX.SPI` / `N225.NKI` / `HSI.HI`…，清单见日 K 一节）；**必须传 `--security`**（缺了 CLI 在本地报错）
- `--security` 可重复传多只：接口一次只收一只，CLI 逐只并发请求后按传入顺序合并；任一只撞上 `--limit` 时结果标 `partial` + `truncatedSecurities`、退出码 3
- `--start-time` / `--end-time`：`yyyy-MM-dd HH:mm:ss`（兼容 `yyyy-MM-dd` 自动补全）
- `--limit` 默认 6000，上限 10000
- 常用字段：`securityCode` `tradeTime` `open` `high` `low` `close` `change` `pctChange` `volume` `amount`
- **全球指数**：`volume` / `amount` 为 `null`；`tradeTime` 与 `--start-time` / `--end-time` 都按**交易所当地时间**（如日经225 一天的分钟线是 `09:01`–`15:30`，德国 DAX 是 `09:01`–`17:30`）
- **ETF**：流动性低的 ETF 在无成交的分钟 `volume` 返 `0`、价格顺延上一分钟收盘
