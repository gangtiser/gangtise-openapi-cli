# Fundamental 命令详细参数

通用：所有命令都需 `--security-code`（如 `600519.SH`，注意是 `--security-code` 不是 `--security`）。`--field` 可重复，可用字段见 `references/fields.md`。

---

## A股三大报表（累计） `income-statement` / `balance-sheet` / `cash-flow`

```bash
gangtise fundamental <income-statement|balance-sheet|cash-flow> --security-code <code> [--start-date <date>] [--end-date <date>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- `--period`：`q1` | `interim` 中报 | `q3` | `annual` | `latest`（默认）
- `--report-type`：`consolidated`（默认）| `consolidatedRestated` | `standalone` | `standaloneRestated`
- `--fiscal-year` 可重复：`--fiscal-year 2023 --fiscal-year 2024`
- `--start-date`/`--end-date` 有值时覆盖 `--fiscal-year`
- **固定返回字段**（无需 `--field` 指定）：`securityCode` `companyName` `category` `announcementDate` `endDate` `fiscalYear` `period` `reportType` `companyType` `currency` `unit`

**常用字段速查：**
- 利润表：`totalOpRev` 营收 | `netProfit` 净利润 | `netProfitAttrParent` 归母 | `basicEPS` EPS | `rdExp` 研发
- 资产负债表：`totalAssets` 总资产 | `totalLiab` 总负债 | `totalParentEq` 归母权益 | `monetaryAssets` 货币资金
- 现金流：`netOpCashFlows` 经营 | `netInvCashFlows` 投资 | `netFinCashFlows` 筹资

## A股三大报表（单季度） `income-statement-quarterly` / `cash-flow-quarterly`

参数同累计，区别在返回单季度数据。`--period`：`q1` | `q2` | `q3` | `q4` | `latest`（默认）

## 港股三大报表（中国会计准则） `income-statement-hk` / `balance-sheet-hk` / `cash-flow-hk`

```bash
gangtise fundamental <income-statement-hk|balance-sheet-hk|cash-flow-hk> --security-code <code> [--start-date <date>] [--end-date <date>] [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- **股票代码**：港股格式，如 `09992.HK`（5 位代码 + `.HK`）
- `--period`：`q1` | `h1` 中报 | `q3` | `h2` 下半年报 | `nsd` 不规则跨度 | `annual` | `latest`（默认）
- 其余参数与 A 股三大报表相同
- **固定返回字段**：与 A 股相同，其中利润表/现金流增加 `startDate` 字段
- 报表类型说明：
  - `consolidated` 合并报表（首次发布原始值，默认）
  - `consolidatedRestated` 合并报表（调整）：最新报告中对上年同期的修订
  - `standalone` / `standaloneRestated` 母公司报表（及调整）

**常用字段速查（港股利润表）：**
- `totalOpRev` 营业总收入 | `opRev` 营业收入 | `netProfit` 净利润 | `netProfitAttrParent` 归母净利润 | `basicEPS` 基本每股收益 | `rdExp` 研发费用

**常用字段速查（港股资产负债表）：**
- `totalCurrAssets` 流动资产合计 | `totalNonCurrAssets` 非流动资产合计 | `totalAssets` 资产总计
- `totalCurrLiab` 流动负债合计 | `totalNonCurrLiab` 非流动负债合计 | `totalLiab` 负债合计
- `totalParentEq` 归母权益合计 | `totalEquity` 所有者权益合计 | `totalLAndE` 负债和权益总计

**常用字段速查（港股现金流）：**
- `netOpCashFlows` 经营活动现金流量净额 | `netInvCashFlows` 投资活动现金流量净额 | `netFinCashFlows` 筹资活动现金流量净额

## 主营业务 `fundamental main-business`

```bash
gangtise fundamental main-business --security-code <code> --breakdown <type> [--start-date <date>] [--end-date <date>] [--period <type>] [--field <name>]
```

- `--breakdown`（**必选**）：`product` 按产品 | `industry` 按行业 | `region` 按地区
- `--period`：`interim` 中报 | `annual` 年报（可重复）
- 默认时间窗：`endDate` 当前日期、`startDate` 三年前
- **不支持 `--fiscal-year`**（误传触发 900001）；按年份筛选用 `--start-date`/`--end-date`

## 估值分析 `fundamental valuation-analysis`

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <date>] [--end-date <date>] [--limit <n>] [--field <name>] [--skip-null]
```

- `--indicator`（**必选**）：`peTtm` 滚动PE | `pbMrq` PB | `peg` PEG | `psTtm` 滚动PS | `pcfTtm` 滚动PCF | `em` 企业倍数
- `--limit` 默认 2000，省略 `--start-date` 时自动查近一年
- `--skip-null`：丢弃 `value`/`percentileRank` 为 null 的行（最新交易日可能未入库）

## 盈利预测 `fundamental earning-forecast`

```bash
gangtise fundamental earning-forecast --security-code <code> [--start-date <date>] [--end-date <date>] [--consensus <name>]
```

- `--start-date` / `--end-date`：默认近一年
- `--consensus` 可重复：`netIncome` 归母净利润 | `netIncomeYoy` 同比增速 | `eps` 每股收益 | `pe` 市盈率 | `bps` 每股净资产 | `pb` 市净率 | `peg` PEG | `roe` 净资产收益率 | `ps` 市销率
- 返回结构：`{securityCode, securityName, updateList: [{date, fieldList: [{forecastYear, ...consensus}]}]}` — 每个日期固定返回 3 年预测（如 `2026E` / `2027E` / `2028E`）

## 前十大股东 `fundamental top-holders`

```bash
gangtise fundamental top-holders --security-code <code> --holder-type <type> [--start-date <date>] [--end-date <date>] [--fiscal-year <year>] [--period <p>]
```

- `--holder-type`（**必选**）：`top10` 前十大股东 | `top10Float` 前十大流通股东
- `--period`：`q1` | `interim` | `q3` | `annual` | `latest`（默认），可重复
- 返回字段：`reportPeriod` / `rank` / `shareholderName` / `shareholderType` / `holdingNum` / `holdingPct` / `chgNum` / `chgPct` / `shareCategory`
