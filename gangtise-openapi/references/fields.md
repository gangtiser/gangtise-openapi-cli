# CLI 可选字段速查

> 按命令分组，`--field` 参数可重复传入。不传 `--field` 时返回全部字段。`quote` 系传了 `--field` 就只回点名的列、不自动附带身份列（`fund-flow` 除外，它自动带 `securityCode` / `tradeDate`）：日 K 要一起写进 `securityCode` / `tradeDate`，分钟 K 是 `securityCode` / `tradeTime`，实时行情是 `securityCode`。

## 🔴 字段名写错时，两族接口的表现完全不同

`--field` 里写了一个不存在的字段名（拼错、或该字段已下线），**没有任何接口会报错**，但丢的东西不一样——这决定了你能不能按位置拍平结果：

| 接口 | 响应里发生什么 | CLI 怎么处理 |
| :-- | :-- | :-- |
| `quote realtime` / `day-kline` / `minute-kline` / `fund-flow` | **字段名和值一起消失**，`fieldList` 里也没有它，列数与值数始终对得上 | 比对请求与返回的列名，缺列标 `partial` + `missingFields`、在 stderr 点名、**退出码 3** |
| `fundamental main-business` / `valuation-analysis` | **字段名照请求回显在 `fieldList` 里，行里却少一个值**，两者长度对不上 | 检测到长度不匹配**直接报错退出 1**，不输出任何可能错位的数据 |

**第二族才是危险的那个**：`fieldList` 比行长，按下标对位会让缺口之后的每一个值都贴到错误的字段名上——一列合理的数字配着错误的表头，肉眼看不出来。CLI 因此选择整条失败而不是给你一份错位的表。

**结论一样**：`--field` 的字段名以本文件为准，不确定就别传（不传即返回全部字段，永远安全）。

绕过 CLI 直连接口时**两族要查的东西不同，别只做一种**：

- `quote` 系：`fieldList` 与行**始终等长**，只比长度什么都查不出来——要拿**请求的字段名**去比**返回的 `fieldList`**，少了哪个就是那个名字没被认出来
- `fundamental` 两个：`fieldList` 会把你写的名字原样回显，所以对比请求没用——要比 **`fieldList` 长度与每行的值个数**，对不上就不能按下标取值

---

## Quote 行情

> ⚠️ **`volume` 的单位是「股」**（ETF 为「份」）。四个端点同一口径——`day-kline` / `realtime` / `minute-kline` / `index-day-kline`，A股 / 港股 / 美股一致，历史数据同口径。
>
> 🔴 **存量脚本里若对 `volume` 做过 `× 100` 还原股数，要撤掉**——会差 100 倍，而数字看着仍然「像个成交量」，不会报错。
>
> **一眼自检（仅适用于个股）**：`amount ÷ volume` 得到的均价应落在当日 `[low, high]` 区间内。
>
> ⚠️ **这个自检有三类必然失败，不要据此判定数据有问题**：
>
> 1. **指数不适用**。指数的 OHLC 是**点位**，而 `amount` / `volume` 是成分股合计，两者量纲不同——比值算出来是成分股均价（上证 / 深成 ≈ 20 元），永远落不进四千点的区间，**数据本身是对的**。
> 2. 🔴 **美股的 `quote realtime`**。它的 `amount` 是 **`null`**（接口不提供该字段，见下方 realtime 字段表），自检算不出来。**要美股的实时成交额，只能用别的口径**（收盘后用 `day-kline`，或 EDE `qte_amt`）。
> 3. **全球指数**（`SPX.SPI` 等 20 个）：realtime 与分钟 K 的 `volume` / `amount` 都是 `null`，日 K 只有 `amount` 是 `null`。
>
> 🔴 **分钟线加总不等于日线，别把它当校验条件**。正常交易日 241 根，多数证券多数日子里 Σ分钟 `volume` 与日线逐位相等、`amount` 只差末位舍入；但**个别历史交易日的分钟数据口径与日线不一致**，那几天怎么加都对不上，两条序列各自稳定、都不报错，历史数据也不会回改。
>
> **口径**：成交量 / 成交额的统计一律**以日线为准**，分钟线用于日内分布。撞到对不上时，那是那一天的数据，不是你的加总代码有问题——**更不要用分钟加总去反推或"修正"日线**。
>
> （`14:58` / `14:59` 恒为 0 是**正常的**：14:57 后进入收盘集合竞价，只申报不撮合，成交在 `15:00` 那一根一次性发生——**收盘那根在序列里**，241 根的末根就是它。）

### 日K线 `quote day-kline`（A股 / 港股 / 美股 / ETF / 各类指数含全球指数；旧的 `day-kline-hk` / `day-kline-us` 已下线，字段相同）

各市场字段相同（货币单位随市场：A股=元、港股=港元、美股=美元、ETF=元且 `volume` 为「份」；**指数为点位、无货币单位，且 `adjustFactor` 恒为 `null`**——ETF 有 `adjustFactor`；**全球指数 `amount` 恒为 `null`**，`volume` 正常）：

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `securityCode` | 证券代码 | `tradeDate` | 交易日期 |
| `open` | 开盘价 | `high` | 最高价 |
| `low` | 最低价 | `close` | 收盘价 |
| `preClose` | 昨收价 | `change` | 涨跌额 |
| `pctChange` | 涨跌幅(%) | `volume` | 成交量(股) |
| `amount` | 成交总额 | `adjustFactor` | 复权因子 |

### 实时行情（`quote realtime`，A股/港股/美股/ETF/各类指数含全球指数）

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `securityCode` | 证券代码 | `exchange` | 交易所 / 指数类型代码（SH/SZ/BJ/HK/NYSE/NASDAQ/AMEX/GT/CI/SWI；全球指数为数据源码，如 SPI/N/O/NKI/HI/FRA） |
| `tradeDate` | 交易日期 | `tradeTime` | 最新行情时间 HH:mm:ss（**美股与全球指数为交易所当地时间**） |
| `tradeStatus` | 交易状态（中文：未开市/连续竞价/收盘/停牌…）——**仅 A 股 / 港股个股有值**，其余 `null` | `latestPrice` | 最新价 |
| `open` | 开盘价 | `high` | 最高价 |
| `low` | 最低价 | `preClose` | 昨收价 |
| `change` | 涨跌额 | `pctChange` | 涨跌幅(%) |
| `volume` | 成交量(股，ETF 为份，当日累计)——全球指数 `null` | `amount` | 成交总额(当日累计)——**美股与全球指数 `null`** |
| `amplitude` | 振幅(%)——全球指数 `null` | | |

> ⚠️ **美股的 `amount` 是 `null`**（接口不提供该字段）。要美股成交额：收盘后用 `quote day-kline`，或用 EDE `indicator cross-section --indicator qte_amt`。全球指数的 `volume` / `amount` / `amplitude` 三个都是 `null`。

**以上 15 个就是全部**：**无 `close`**（用 `latestPrice`）、**无市值**（走 `indicator cross-section --indicator qte_mkt_cptl`）、**无 `turnoverRate` / `volumeRatio`**（传了会连字段名一起被静默丢掉，不报错、结果里就是没这两列；换手率走 EDE `qte_turn`，A 股）。realtime 对不存在的字段名是名和值一起丢：CLI 比对请求与返回的列名，**缺列标 `partial` + `missingFields`、退出码 3**（字段名写错或已下线）。

### 指数日K线（沪深京 `quote index-day-kline`）

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `securityCode` | 指数代码 | `tradeDate` | 交易日期 |
| `open` | 开盘价 | `high` | 最高价 |
| `low` | 最低价 | `close` | 收盘价 |
| `preClose` | 昨收价 | `change` | 涨跌额 |
| `pctChange` | 涨跌幅(%) | `volume` | 成交量(股) |
| `amount` | 成交总额(元) | `adjustFactor` | 复权因子（指数恒为 `null`） |

与 `day-kline` 查指数的返回完全相同，**不含指数名称**；要名称用 `reference securities-search --keyword <指数代码> --category index` 的 `gtsName`。

---

## Fundamental 基本面

### 利润表 (`fundamental income-statement`)

**一级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `totalOpRev` | 一、营业总收入 | `totalOpCost` | 二、营业总成本 |
| `nonOpNetIncome` | 三、非经营性净收益 | `opProfit` | 四、营业利润 |
| `totalProfit` | 五、利润总额 | `netProfit` | 六、净利润 |
| `otherCompIncome` | 七、其他综合收益税后净额 | `totalCompIncome` | 八、综合收益总额 |
| `basicEPS` | 基本每股收益 | `dilutedEPS` | 稀释每股收益 |

**二三级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `opRev` | 营业收入 | `salesRev` | ↳主营业务收入 |
| `otherOpRev` | ↳其他业务收入 | `opCost` | 营业成本 |
| `salesCost` | ↳主营业务成本 | `opTaxSurcharges` | 营业税金及附加 |
| `salesExp` | 销售费用 | `totalAdminExp` | 管理费用合计 |
| `adminExp` | ↳管理费用 | `rdExp` | 研发费用 |
| `finExp` | 财务费用 | `invIncome` | 投资净收益 |
| `fvChangeGain` | 公允价值变动净收益 | `creditImpairLossProfit` | 信用减值损失 |
| `assetImpairLossProfit` | 资产减值损失 | `gainAssetDisposal` | 资产处置收益 |
| `addNonopIncome` | 加：营业外收入 | `lessNonopExp` | 减：营业外支出 |
| `lessIncTaxExp` | 减：所得税费用 | `profitContOps` | 持续经营净利润 |
| `profitDiscOps` | 终止经营净利润 | `netProfitAttrParent` | 归母净利润 |
| `netProfitAttrOrdShare` | ↳归母普通股净利润 | `netProfitAttrNoncontrol` | 少数股东损益 |
| `netIntIncome` | 利息净收入 | `premEarned` | 已赚保费 |
| `netCommIncome` | 手续费及佣金净收入 | `guaranteeIncome` | 担保业务收入 |
| `OCIParentOwners` | 归母其他综合收益 | `OCIAttrNoncontrol` | 少数股东其他综合收益 |
| `compIncomeAttrParent` | 归母综合收益总额 | `compIncomeAttrNoncontrol` | 少数股东综合收益总额 |

### 资产负债表 (`fundamental balance-sheet`)

**一级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `currAssets` | 流动资产 | `nonCurrAssets` | 非流动资产 |
| `otherAssets` | 其他资产 | `totalAssets` | 资产总计 |
| `currLiab` | 流动负债 | `nonCurrLiab` | 非流动负债 |
| `otherLiab` | 其他负债 | `totalLiab` | 负债合计 |
| `equity` | 所有者权益 | `totalEquity` | 所有者权益合计 |
| `liabAndEquity` | 负债和所有者权益 | `totalLAndE` | 负债和所有者权益总计 |

**二三级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `monetaryAssets` | 货币资金 | `cash` | ↳货币资金 |
| `notesAcctsRecv` | 应收票据及应收账款 | `notesReceivable` | ↳应收票据 |
| `acctsReceivable` | ↳应收账款 | `advPay` | 预付款项 |
| `inventory` | 存货 | `totalCurrAssets` | 流动资产合计 |
| `ltEquityInvest` | 长期股权投资 | `totalPPE` | 固定资产合计 |
| `totalCIP` | 在建工程合计 | `intangAssets` | 无形资产 |
| `goodwill` | 商誉 | `deferredTaxAssets` | 递延所得税资产 |
| `totalNonCurrAssets` | 非流动资产合计 | `stBorrowings` | 短期借款 |
| `notesAcctsPay` | 应付票据及应付账款 | `contractLiab` | 合同负债 |
| `empBenefitsPay` | 应付职工薪酬 | `taxPayable` | 应交税费 |
| `totalCurrLiab` | 流动负债合计 | `ltBorrowings` | 长期借款 |
| `bondsPay` | 应付债券 | `leaseLiab` | 租赁负债 |
| `deferredTaxLiab` | 递延所得税负债 | `totalNonCurrLiab` | 非流动负债合计 |
| `shareCapital` | 股本 | `capReserve` | 资本公积 |
| `lessTreasuryShares` | 减：库存股 | `surplusReserve` | 盈余公积 |
| `retainedEarn` | 未分配利润 | `totalParentEq` | 归母所有者权益 |
| `nonControllingInterests` | 少数股东权益 | | |

### 现金流量表 (`fundamental cash-flow`)

**一级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `opCashFlows` | 一、经营活动现金流量 | `invCashFlows` | 二、投资活动现金流量 |
| `finCashFlows` | 三、筹资活动现金流量 | `cashEquivalents` | 四、现金及现金等价物 |
| `cashEquivalentsIncrease` | 五、现金等价物净增加额 | | |

**二三级科目：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `cashFromSales` | 销售商品收到的现金 | `subtotalOpInflows` | 经营活动现金流入小计 |
| `cashPaidForGoodsServices` | 购买商品支付的现金 | `cashPaidEmployees` | 支付给职工的现金 |
| `cashPaidTaxes` | 支付的各项税费 | `subtotalOpOutflows` | 经营活动现金流出小计 |
| `netOpCashFlows` | 经营活动现金流量净额 | `cashRecoveredInvestments` | 收回投资收到的现金 |
| `cashPaidAcqConstructAssets` | 购建固定资产等支付的现金 | `cashPaidInvestments` | 投资支付的现金 |
| `netInvCashFlows` | 投资活动现金流量净额 | `cashFromBorrowings` | 取得借款收到的现金 |
| `cashPaidDebtRepayment` | 偿还债务支付的现金 | `cashPaidDividendsInterest` | 分配股利或偿付利息支付的现金 |
| `netFinCashFlows` | 筹资活动现金流量净额 | `fxEffectOnCash` | 汇率变动对现金的影响 |
| `netIncCashEquivalents` | 现金等价物净增加额 | `addOpeningCashBalance` | 期初现金余额 |
| `closingCashBalance` | 期末现金余额 | | |

**补充资料（将净利润调节为经营现金流）：**

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `netProfit` | 净利润 | `depAmortFixedAssets` | 固定资产折旧等 |
| `decreaseOpReceivables` | 经营性应收项目的减少 | `increaseOpPayables` | 经营性应付项目的增加 |

### 主营业务 (`fundamental main-business`)

> ⚠️ `--field` 写错字段名时**只丢值、字段名照回显**，CLI 会因长度不匹配报错退出 1——见本文顶部「字段名写错时，两族接口的表现完全不同」。

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `opRevenue` | 营业收入 | `opRevenueYoy` | 营业收入同比增速 |
| `opRevenueRatio` | 营业收入占比 | `opCost` | 营业成本 |
| `opCostYoy` | 营业成本同比增速 | `opCostRatio` | 营业成本占比 |
| `grossProfit` | 毛利 | `grossProfitYoy` | 毛利同比增速 |
| `grossProfitRatio` | 毛利占比 | `grossMargin` | 毛利率 |
| `grossMarginYoy` | 毛利率同比变化 | `grossMarginRatio` | 毛利率占比 |

### 估值分析 (`fundamental valuation-analysis`)

> ⚠️ `--field` 写错字段名时**只丢值、字段名照回显**，CLI 会因长度不匹配报错退出 1——见本文顶部「字段名写错时，两族接口的表现完全不同」。🔴 例外：`--field` 里一个数值列都没有时（只传 `tradeDate`、或只有不存在的名字），接口返回 0 行、不报错。 `tradeDate` 总在第一列返回，不用写进 `--field`（写了 CLI 会自动去掉）。

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `value` | 原始值 | `percentileRank` | 分位点 |
| `average` | 平均值 | `median` | 中位数 |
| `upper1Std` | +1标准差 | `lower1Std` | -1标准差 |
