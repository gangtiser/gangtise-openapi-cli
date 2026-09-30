# Fund 命令详细参数

**全部按次计费，0.4 积分/次**（与返回行数、基金只数无关）；空结果与报错不扣。

`--security` 收**基金交易代码**，后缀大写：场外 `005827.OF`；场内 `159967.SZ` / `510300.SH`。可重复，也接受逗号分隔；重复代码服务端自动去重。

- 🔴 **代码不存在、不带后缀（`005827`）、后缀小写（`.of`）、传成股票代码，都返回空结果、不报错**——拿到空先核对代码与后缀
- LOF / ETF 的场内代码（`161005.SZ`）与场外代码（`161005.OF`）都能查，返回的 `fundCode` 与 `fundName` 跟随传入的代码（场内简称 / 场外简称不同）；同一只基金别两种代码混着传，会重复
- A / C 等份额各有代码，要合并到同一只基金用 `basic-info` 的 `mainFundCode`
- 多只基金的结果**按 `fundCode` 字段对应**，别按请求顺序对位

⚠️ **超时 / 5xx 不自动重放**（避免重复扣费）。偶发 `999999` 系统错误，同参数重跑即可。

---

## 通用规则

**不分页**：一次返回全部行，**单次上限 10000 行**。超出时整批报 `100006`「查询/下载数量超出限制」、不返回部分结果——减少基金只数或缩短日期区间分批查。

**日期**：`--start-date` / `--end-date` 收年在前日期（`YYYY-MM-DD`，`YYYY/MM/DD` / `YYYYMMDD` 也收，CLI 统一成 `YYYY-MM-DD` 发出）。持仓 / 规模 / 持有人类命令筛的是**报告期**（季末日 `2026-06-30`），`nav` 与 `etf-share-change` 筛的是**交易日**。

| 命令 | 可回溯 |
|------|--------|
| `nav` / `asset-size` / `holder-structure` / `top10-holders` / `asset-allocation` / 持仓与分布六个 / `etf-share-change` | 正式账号前溯 **5 年**、试用账号 **3 年**；实际窗口随账号服务等级而定，以返回为准 |
| `basic-info` / `fee-rate` / `manager-info` / `manager-history` / `etf-pcf-header` / `etf-pcf-components` | 不限（返回当前资料或全部任职记录） |

- **两端都不传 = 取账号窗口内的全部**，不是只取最新一期。只要最新一期就把起止都设成那个报告期
- 只传 `--start-date` = 从该日到最新；只传 `--end-date` = 从账号窗口下界到该日
- 🔴 **`--start-date` 早于可回溯下界时整批返回 `110003`「超出时间范围限制」**，即使 `--end-date` 在窗口内也不会只返回窗口内那一段。把起点移进窗口再查
- 起 > 止报 `110002`；区间内没有报告期（如 `2026-05-01`～`2026-05-31`）返回空结果

**枚举参数**（`--position-type` / `--industry-standard` / `--fee-type` / `--asset-level`）写错时报 `100003` 并指明参数与取值，不会按默认值静默取数。

**单位各命令不同**，入库前逐列核对：`nav` 与 `asset-allocation` 的金额是**元**；`asset-size` 是**万份 / 万元**；`holder-structure` 与 `top10-holders` 的份额是**份**；`stock-portfolio` 是**万股 / 万元**；`bond-portfolio` 是**万张 / 万元**；`fund-portfolio` 是**万元**；`etf-share-change` 是**万份 / 万元**；`manager-info` 的在管规模是**亿元**。百分比字段都已是百分数（`5.72` = 5.72%）。

---

## `basic-info` 基金基本信息

```bash
gangtise fund basic-info --security <code> [--security <code>...] [--field <name>...]
```

分类（一级 / 二级）、管理人与托管人、成立与存续、运行状态与运作方式、申赎规则、业绩比较基准、风险等级、投资范围、跟踪指数。当前资料，**不提供历史快照**。

- `--field` 可重复，不传返回全部；**`fundCode` 始终返回**。字段名写错**整批报 `100003`** 并指名，不会静默丢列
- `mainFundCode`：A / C 等份额共用的主代码，做份额合并时按它分组
- `investTypeCodeLevel1` / `investTypeCodeLevel2`：与 `reference constant-list --category fundType` 的常量 ID 一致（FOF 类一级分类的 ID 不是整百，如 `149051404` 混合型 FOF，按常量表的 `level` 判层级，别按 ID 尾数猜）
- `exchange`：场内基金为交易所名称（如 `上海证券交易所` / `深圳证券交易所`），场外基金为 `null`
- `isIndexFund` 是布尔值；非指数型基金的 `trackIndexCode` / `trackIndexName` 为 `null`
- `maturityDate` 为 `null` 表示无固定存续期；`largePurchaseLimit` 为 `null` 表示不限
- `investScope` 是长文本，批量导出时用 `--field` 去掉可显著缩小体积

## `nav` 基金净值

```bash
gangtise fund nav --security <code>... [--start-date <d>] [--end-date <d>]
```

逐交易日一行：`navUnit` 单位净值、`navAccumulated` 累计净值、`adjustFactor` 复权因子、`navAdjusted` 复权净值（元）。**算区间收益用 `navAdjusted`**，单位净值在分红 / 拆分时会跳变。货币基金另有 `mmfAnnualizedYield`（7 日年化，%）与 `mmfUnitYield`（每万份收益，元），其 `adjustFactor` 为 `null`；非货币基金这两列为 `null`。结果按日期倒序。

多只基金 × 长区间容易撞 10000 行上限（每只每年约 240～250 行），按只数分批。

## `fee-rate` 基金费率

```bash
gangtise fund fee-rate --security <code>... [--fee-type <type>...]
```

- `--fee-type`：`purchaseFee` 申购 / `redemptionFee` 赎回 / `managementFee` 管理 / `custodianFee` 托管 / `saleFee` 销售服务。可重复，不传返回全部
- 一只基金一个费率类型可能多行——申购费按金额分档、赎回费按持有期限分档，每档一行，`feeCondition` 是条件区间（如 `持有期限＜7日`）；无分档的为 `null`
- `feeRate` 是**字符串**（`"1.5%"` / `"0%"`），大额固定收费时是金额描述（`"每笔1000元"`），**不能直接当数字用**

## `manager-info` 基金经理基本信息

```bash
gangtise fund manager-info --manager <name> [--manager <name>...]
```

🔴 **查的是人名，不是基金代码**。按姓名**精确匹配**，查不到返回空结果；同名经理**全部返回**（常见名可能一次返回多位），用 `currentCompany` 区分（可能为 `null`）。返回学历、从业日期与年限、在管规模（亿元）与只数、历任基金数与公司数、简介。

- ⚠️ `workingYears`（从业年限）与由 `careerStartDate` 推算出的年限、简介里写的从业年数**可能对不上**，`currentCompanyYears` 同理。需要准确的从业年限时按 `careerStartDate` 自行计算
- `birthYear` 未披露时为 `null`

## `manager-history` 基金历任基金经理

```bash
gangtise fund manager-history --security <code>...
```

每位经理的每段任职各一行；同期共同管理的多位经理各占一行。`endDate` 为 `null` 的是**现任**。`managedDays` 任职天数，`managedReturn` 任职期间业绩表现（%）。

## `asset-size` 资产规模

```bash
gangtise fund asset-size --security <code>... [--start-date <d>] [--end-date <d>]
```

每个报告期一行：期初份额、期间申购 / 赎回 / 净申购份额（赎回大于申购时为负）、期末份额（**万份**），基金资产净值（**万元**）。

## `holder-structure` 持有人结构

```bash
gangtise fund holder-structure --security <code>... [--start-date <d>] [--end-date <d>]
```

持有人户数、户均份额，机构 / 个人 / 员工持有份额（份）与占比（%）。只有半年报与年报披露，季报期没有行。

- 🔴 **`holderCount` 是带千分位逗号的字符串**（如 `"2,219,140"`），不是数字。做数值计算或排序前先去掉逗号再转数字，否则按字符串比较会排错
- 占比字段可能为 `null`

## `top10-holders` 前十大持有人

```bash
gangtise fund top10-holders --security <code>... [--start-date <d>] [--end-date <d>]
```

**仅上市基金**（LOF / ETF 等）。每个报告期按 `serialNumber` 排名各一行：持有人名称、持有份额（份）、占上市总份额比例（%）。半年报与年报披露。

- ETF 在前十名之外可能多一行 `serialNumber = 11`，是该 ETF 的**联接基金**（定期报告单列披露），它的占比可能高于前十中的多位。只要前十名就按 `serialNumber <= 10` 过滤
- 最新一期的更新可能晚于其他持仓类命令。按最新报告期查不到时，先不带日期查一次，看已有哪些报告期

## `asset-allocation` 资产配置

```bash
gangtise fund asset-allocation --security <code>... [--start-date <d>] [--end-date <d>] [--asset-level level1|level2]
```

「报告期末基金资产组合情况」口径，一只基金一个报告期按资产类型多行：`assetType`（代码）+ `assetTypeName`（中文）、`holdingValue`（**元**）、`pctToTotalAsset`（**占基金资产总值**，不是占净值）。

- `--asset-level`：`level1` 一级 / `level2` 二级，可重复，不传两级都返回。**一二级混在同一结果里时别直接加总**，二级是一级的拆分
- 一级 `assetType`：`equityInv` 权益 / `fundInv` 基金 / `fixedIncomeInv` 固定收益 / `preciousMetals` 贵金属 / `deriv` 金融衍生品 / `reverseRepo` 买入返售 / `moneyMarket` 货币市场工具 / `cash` 银行存款和结算备付金 / `otherAssets` 其他
- 二级 `assetType`：`stock` 股票 / `prefShares` 优先股 / `dr` 存托凭证 / `reits`（属权益）；`bond` / `abs`（属固定收益）；`forward` / `futures` / `option` / `warrant`（属衍生品）；`outrightReverseRepo`（属买入返售）
- 基金没有持有的资产类型可能不出现在结果里（而不是给一行 0），按「缺行 = 0」处理

## 持仓与分布（六个命令）

```bash
gangtise fund stock-portfolio       --security <code>... [--start-date <d>] [--end-date <d>] [--position-type top|all]
gangtise fund industry-allocation   --security <code>... [--start-date <d>] [--end-date <d>] [--industry-standard swIndustry|citicIndustry] [--position-type top|all]
gangtise fund bond-portfolio        --security <code>... [--start-date <d>] [--end-date <d>]
gangtise fund bond-type-allocation  --security <code>... [--start-date <d>] [--end-date <d>]
gangtise fund fund-portfolio        --security <code>... [--start-date <d>] [--end-date <d>]
gangtise fund fund-type-allocation  --security <code>... [--start-date <d>] [--end-date <d>]
```

**`--position-type`**（`stock-portfolio` / `industry-allocation`）：`top` 重仓股票，各季度都披露（不传时的默认）；`all` 全部持股，**仅半年报与年报披露**——用 `all` 查一季度 / 三季度得到空结果，不是故障。`all` 的行数通常远多于 `top`（重仓只有前十只）。

- **`stock-portfolio`**：持股数量（万股）、占流通股比例、持仓市值（万元）、占净值比，以及 `pctToNavChg`（较上一报告期的占净值比变化）。🔴 **只返回股票简称 `stockName`，不返回代码**——要代码用 `reference securities-search --keyword <简称>` 换，注意 A / H 同名与改名
- **`industry-allocation`**：`--industry-standard` 选 `swIndustry` 申万一级（不传时的默认）/ `citicIndustry` 中信一级。`industryCode` 与 `reference constant-list --category swIndustry` / `citicIndustry` 的常量 ID 一致。两套分类划分不同，跨基金比较时统一用一套。占比为 0 的行业也可能出现
- **`bond-portfolio`**：债券简称 `bondName`（**无代码**）、持仓量（万张）、持仓市值（万元）、占净值比
- **`bond-type-allocation`**：按券种汇总的占净值比。`bondTypeCode` 与 `reference constant-list --category fundBondType` 一致。**`金融债券` 与 `政策性金融债券` 是两行、前者包含后者**，按券种加总会重复计算
- **`fund-portfolio`**（FOF）：持仓基金简称 `holdingFundName`（**无代码**）、持仓市值（万元）、占净值比
- **`fund-type-allocation`**（FOF）：持仓基金按基金分类（一级）汇总的占净值比，`investTypeCodeLevel1` 与 `fundType` 常量一致。**没有 `--position-type` 参数**，口径随报告期而定、看返回的 `positionType` 列：季报期为 `top`（只含重仓基金），半年报 / 年报为 `all`（全部持基）——同一只基金不同报告期的合计口径不同，做时序对比前先按 `positionType` 分开

## ETF 申赎与份额（三个命令）

```bash
gangtise fund etf-pcf-header      --security <code>...
gangtise fund etf-pcf-components  --security <code>...
gangtise fund etf-share-change    --security <code>... [--start-date <d>] [--end-date <d>]
```

- **`etf-pcf-header` / `etf-pcf-components` 只返回最新一份申购赎回清单**，无日期参数，查不了历史清单。`tradeDate` 是清单对应的交易日（清单盘前发布，可能就是当天）
- **`etf-pcf-header`**：申赎允许情况（`允许申购·允许赎回` 这种 `·` 分隔的组合）、最小申赎单位（份）及其净值（元）、单日申购 / 赎回上限（份，无上限为 `null`）、现金差额与预估现金（元，可为负）、现金替代比例上限（%）、`componentCount` 成分记录数
- **`etf-pcf-components`**：每个成分一行，按 `serialNumber` 排序：成分代码 `componentCode` 与名称、收盘价、涨跌幅、市值占比（%）、申购数量（股）、`cashSubstituteFlag`（`允许` / `必须`，中文）、申购 / 赎回现金替代溢价比例（%）、固定替代金额与申购 / 赎回替代金额（元）。宽基 ETF 动辄数百行，多只一起查注意 10000 行上限。`componentCode` **不带市场后缀**（如 `600519`），要接着查行情先补上后缀
- **`etf-share-change`**：逐交易日一行，份额（万份）、规模（万元）及较上期变动，`sharesChangeRate` 为份额变化率（%）。按日期倒序

---

## 常见任务

```bash
# 基金画像：基本信息 + 现任经理 + 费率
gangtise fund basic-info --security 005827.OF --field fundName --field investTypeNameLevel2 --field mgrComp --field setupDate --field riskLevel
gangtise fund manager-history --security 005827.OF
gangtise fund fee-rate --security 005827.OF --fee-type managementFee --fee-type custodianFee

# 最新一期重仓股（季报）/ 全部持股（中报、年报）
gangtise fund stock-portfolio --security 005827.OF --start-date 2026-06-30 --end-date 2026-06-30
gangtise fund stock-portfolio --security 005827.OF --start-date 2026-06-30 --end-date 2026-06-30 --position-type all --format csv --output ./005827-2026H1.csv

# 近一年复权净值，算区间收益
gangtise fund nav --security 005827.OF --security 159967.SZ --start-date 2025-09-30 --end-date 2026-09-29 --format jsonl --output ./nav.jsonl

# ETF 申赎清单与份额变动
gangtise fund etf-pcf-components --security 510300.SH --format csv --output ./510300-pcf.csv
gangtise fund etf-share-change --security 510300.SH --start-date 2026-09-01 --end-date 2026-09-30

# 基金经理（按姓名）
gangtise fund manager-info --manager 张坤
```
