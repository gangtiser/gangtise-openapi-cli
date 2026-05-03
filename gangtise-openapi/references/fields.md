# CLI 可选字段速查

> 按命令分组，`--field` 参数可重复传入。不传 `--field` 时返回全部字段。

---

## Quote 行情

### 日K线（A股 `quote day-kline` / 港股 `quote day-kline-hk`）

两者字段相同：

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `securityCode` | 证券代码 | `tradeDate` | 交易日期 |
| `open` | 开盘价 | `high` | 最高价 |
| `low` | 最低价 | `close` | 收盘价 |
| `preClose` | 昨收价 | `change` | 涨跌额 |
| `pctChange` | 涨跌幅(%) | `volume` | 成交量(手) |
| `amount` | 成交总额(元) | `adjustFactor` | 复权因子 |

### 指数日K线（沪深京 `quote index-day-kline`）

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `securityCode` | 指数代码 | `tradeDate` | 交易日期 |
| `open` | 开盘价 | `high` | 最高价 |
| `low` | 最低价 | `close` | 收盘价 |
| `preClose` | 昨收价 | `change` | 涨跌额 |
| `pctChange` | 涨跌幅(%) | `volume` | 成交量(手) |
| `amount` | 成交总额(元) | | |

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

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `opRevenue` | 营业收入 | `opRevenueYoy` | 营业收入同比增速 |
| `opRevenueRatio` | 营业收入占比 | `opCost` | 营业成本 |
| `opCostYoy` | 营业成本同比增速 | `opCostRatio` | 营业成本占比 |
| `grossProfit` | 毛利 | `grossProfitYoy` | 毛利同比增速 |
| `grossProfitRatio` | 毛利占比 | `grossMargin` | 毛利率 |
| `grossMarginYoy` | 毛利率同比变化 | `grossMarginRatio` | 毛利率占比 |

### 估值分析 (`fundamental valuation-analysis`)

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `value` | 原始值 | `percentileRank` | 分位点 |
| `average` | 平均值 | `median` | 中位数 |
| `p10` | 10分位 | `p25` | 25分位 |
| `p75` | 75分位 | `p90` | 90分位 |
| `upper1Std` | +1标准差 | `lower1Std` | -1标准差 |
