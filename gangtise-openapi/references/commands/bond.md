# Bond 命令详细参数

**全部计费，0.4 积分起**：多数按次（与返回行数无关）；`rating-overview` 按条、`rating-change` 按有数据的债券只数、`issuer-rating-change` 按发行人计，见各命令。

`--security` 收**标准债券代码**——`019742.SH` / `123456.SZ` / `220205.IB`（银行间）。**不接受简称或拼音**，传了按 `120001` 整批拒绝、不会退化成模糊匹配；只有简称时先 `reference securities-search --keyword <简称>` 换代码。可重复，也接受逗号分隔；有单次只数上限的命令按**去重后**的只数计。

⚠️ **超时 / 5xx 不自动重放**（避免重复扣费），偶发失败自行重跑。

---

返回是**列式**的（`fieldList` + 数组行），CLI 已自动拍平成对象，直接按字段名取值即可。

`--field` 可重复，不传返回全部字段。**传了不支持的字段名整批拒绝**（`100003` 并指名），不会静默丢列——与 `quote` 系「字段名和值一起消失」的行为不同。各命令的默认返回列（无需指定）见下。

## 日期与权限窗口

`bond daily-quote` / `bond valuation` / `bond issuance-plan` 的历史范围是**正式账号前溯 5 年、试用 3 年**，其余命令不限。

⚠️ **`--start-date` 早于可回溯下界时整批返回 `110003`「超出时间范围限制」**（这三个命令都是）——即使 `--end-date` 在窗口内，也不会只返回窗口内那一段。把 `--start-date` 移进窗口再查；实际下界随账号服务等级而定，以返回为准。

## `basic-info` 债券基本资料

```bash
gangtise bond basic-info --security <code> [--security <code>...] [--field <name>]
```

静态档案，**不提供历史快照**。默认返回 `securityCode`。单次最多 10000 只。格式合法但库中无资料的债券**不报错**，仍占一行、除 `securityCode` 外全为 `null`。

字段分组：基础标识 / 发行信息 / 期限与日期 / 利率与付息 / 评级 / 担保 / 特殊条款 / 质押回购 / ABS 专项（`abs*`，仅资产支持证券有值）/ 可转债专项（`conversion*`，仅可转债有值）。

- `parValue`、`issuePriceOrReferenceYield` 是 `/` 分隔的**复合展示值**（`"100.00/100.00"`），某侧无数据时以 `-` 占位。要数值用 `latestParValue`
- `actualMaturityDate` 含提前赎回 / 回售 / 全额转股，未提前终止时与 `maturityDate` 一致；算剩余期限用前者
- `remainingDays` 已到期返回 `0`

## `issuer-info` 发债主体基本信息

```bash
gangtise bond issuer-info (--security <code>... | --issuer <name>...) [--field <name>]
```

🔴 **`--security` 与 `--issuer` 二选一**，同时传报 `100003`（CLI 会先本地拦下）。`--issuer` 按公司全称或简称**模糊匹配**，一个名称只返回最匹配的一家，匹配不到不产生行。默认返回 `issuerName`。

- 行业有两套：`swIndustry` 是**申万**「一级/二级」（如 `"食品饮料/白酒Ⅱ"`），`nationalIndustry` 是**国民经济行业分类**「一级/二级」（如 `"制造业/酒、饮料和精制茶制造业"`）。某一级无数据时该侧以 `-` 占位；要申万一级按 `/` 切前半段
- `latestIssuerRating` 是复合值 `评级(展望,日期)`（如 `"AAA(维持,2026-08-11)"`），但**括号部分可能缺省**、只返回评级符号（如 `"AAA"`）——解析时别用硬套括号的正则
- ⚠️ **这一列混合了境内与境外评级口径**：既可能是境内机构（中诚信、大公等）的评级，也可能是惠誉等国际机构的评级，两套口径不可直接比较。做信用排序或筛选前，**一并取 `ratingAgency` 判断口径**
- `outstandingBondList` 是存续债券**简称**的中文逗号分隔串；要代码得拿简称去 `reference securities-search` 换

## `daily-quote` 债券日收盘行情

```bash
gangtise bond daily-quote --security <code>... --start-date <d> --end-date <d> [--field <name>]
```

**日期必填**。默认返回 `securityCode` + `tradeDate`。字段分组：全价（`dirty*`）/ 净价（`clean*`）/ 成交与收益率（`ytmClose` `volume` `turnover` `ytc` `ytp`）/ 风险指标（`duration` `modifiedDuration` `convexity`）/ 票息要素。不限传入只数。

## `valuation` 上清所估值

```bash
gangtise bond valuation --security <code>... --start-date <d> --end-date <d> [--confidence-level 推荐|不推荐] [--field <name>]
```

**日期必填**。默认返回 `securityCode` + `tradeDate` + `confidenceLevel`。**`--confidence-level` 不传默认只返回「推荐」的估值**——要看全部需显式传另一个值分别查。风险指标含 `pvbp`、利率与利差各自的久期凸性。

## `cash-flow` / `issuance-detail` / `rating-change` / `exercise-notice`

```bash
gangtise bond cash-flow              --security <code>... [--start-date <d>] [--end-date <d>] [--field <name>]   # 日期筛兑付日
gangtise bond issuance-detail        --security <code>... [--start-date <d>] [--end-date <d>] [--field <name>]   # 日期筛发行公告日
gangtise bond rating-change          --security <code>... [--start-date <d>] [--end-date <d>] [--field <name>]   # 日期筛评级变动公告日，最多 10 只
gangtise bond exercise-notice        --security <code>... [--start-date <d>] [--end-date <d>] [--field <name>]   # 日期筛行权日
```

日期可省略，省略则返回全部历史。默认返回列各不相同：`cash-flow` 是 `securityCode`+`paymentDate`，`issuance-detail` 是 `securityCode`+`issueBatchNo`，`rating-change` 是 `securityCode`+`announcementDate`，`exercise-notice` 是 `securityCode`+`exerciseDate`。

🔴 **`rating-change`（债项评级变动）单次最多 10 只**（按去重后计，CLI 本地拦截并提示分批），计费按**有数据的债券只数**。一只债券每次评级变动一行，返回本次 / 上次评级（`currentRating` / `previousRating`）、变动方向、评级展望、评级类型与评级机构；首次评级的 `previousRating` 为 `null`。

## `rating-overview` 债券评级一览

```bash
gangtise bond rating-overview --security <code>... [--field <name>]
```

债项 / 发行人 / 担保人三套评级并列，一只债券一行。🔴 **单次最多 10 只**（按去重后计），计费按**条**。

⚠️ **评级值可能带小写后缀**：`sf`（结构化融资产品评级，如 `AA+sf`）、`pi`（中债资信主动评级，如 `AAApi`），紧跟评级符号、无分隔符。按档位匹配、排序或分档统计前先识别处理，否则 `AAA` 与 `AAApi` 会被当成两档。`rating-change` / `issuer-rating-change` 同样适用。

## `issuer-rating-change` 发债主体评级变动

```bash
gangtise bond issuer-rating-change (--security <code>... | --issuer <name>...) [--start-date <d>] [--end-date <d>] [--field <name>]
```

**二选一**，同 `issuer-info`。默认返回 `issuerName`+`announcementDate`。命中的发行人总数超过 10 个触发 `100006`。计费按**发行人**。

## `issuance-plan` 利率债发行计划

```bash
gangtise bond issuance-plan --start-date <d> --end-date <d> [--field <name>]
```

🔴 **只按日期区间查，不收债券码**，日期必填。默认返回 `issueDate`。返回计划年份、发行人、债券性质与类型、期限、计划发行量、利率类型、付息频率、是否跨市场。

## `announcement` 债券公告

```bash
gangtise bond announcement (--security <code>... | --start-date <d> --end-date <d>) [--page-no N] [--page-size N] [--field <name>]
```

🔴 **`--security` 与 `--start-date`/`--end-date` 二选一**，同传报 `100003`（CLI 先本地拦下）。默认返回 `announcementDate`+`securityCode`。

🔴 **本命令需要手动翻页**：它是本族唯一分页的接口，且响应里**没有 `total`**，因此不走 CLI 的自动翻页。`--page-no` 从 1 开始逐页递增，`--page-size` 取值 1–200、**默认 50**（超出 200 在本地就被拒绝）。本族按次计费（0.4/次）且不自动重发，每翻一页扣一次——**批量翻页显式传 `--page-size 200`**，调用次数只有默认的四分之一。终止条件：

- 翻过末页返回**空数组**（`--format json` 输出 `[]`，退出码 0）——到这一页就停
- 条件下**一条公告都没有**时，任何页码都返回 `404` / `130001`（退出码 1）——第 1 页收到它就是没有数据，不用再翻

⚠️ **按日期区间查询时，返回的 `securityCode` 不带市场后缀**（如 `012682337`）；按 `--security` 查询时带后缀。要把结果接着传给其他 `bond` 命令（它们只收带后缀的代码，否则 `120001`），用该行的 `securityName` 走 `reference securities-search --keyword <简称>` 换回带后缀的 `gtsCode`，并核对它去掉后缀后与原代码一致。**别拿不带后缀的代码本身去搜**——检索按相似度返回，可能给出相邻的其他代码；部分资产支持证券按简称也检索不到。

其余债券命令一次返回全部匹配行。

## 空结果

查询条件合法但全部没有数据时（如区间内全是非交易日、区间内无发行计划），返回 `404` / `130001 数据未找到`，表示没有数据、不是故障。只有部分代码有数据时不报错：

- `basic-info`、`rating-overview`、按 `--security` 查的 `issuer-info`：**每个代码固定占一行**（按去重后的请求顺序），没数据的行除代码外全为 `null`
- 其余命令（以及按 `--issuer` 查的两个命令）：没数据的代码**不产生行**，用「请求的代码 − 返回里出现的代码」判断哪些没数据

另外国债这类品种本身没有评级与行权数据，查 `rating-overview` / `rating-change` / `exercise-notice` 返回 `130001` 属正常。

## 相关常量

债券字段里的枚举 ID 可通过 `reference constant-list --category <code>` 查全量：
`bondType` 债券类型 | `interestRateType` 利率类型 | `interestFrequency` 付息频率 | `absUnderlyingAssetType` ABS 基础资产类型 | `ratingType` 评级类型 | `exchange` 交易市场。
