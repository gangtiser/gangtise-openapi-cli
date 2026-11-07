# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序 / 条件选股）

> 本组覆盖 `/application/open-indicator/*`：证券级**数据指标**的检索与取数，主要用于多证券批量取已实现财务 / 估值指标。即使能搜到收盘价、成交量等行情指标，常规行情与 K 线仍走免费的 `quote`。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode` 和 `parameterList`**，绝不猜测指标编码或参数名——参数名与枚举会随版本调整，写错会直接报 `100003` 并指出是哪个指标的哪个参数，照报错改即可；照抄示例里的旧参数名则会白跑一次。

## EDE 与专用接口的优先级

| 请求形态 | 优先接口 |
| :--- | :--- |
| 单证券的财务 / 股东 / 主营，或 A股单证券估值 | 对应 `fundamental` 专用命令；多数免费，且字段口径固定。多证券批量取股东户数 / 户均持股 / 前十大与第 N 大股东走 EDE，见下方「股东结构指标」 |
| 多证券批量取一组**已实现**财务 / 估值指标 | 先 `indicator search`，通过下方三项校验后用 `cross-section` / `time-series` 一次拉取，避免逐只循环 |
| A股盈利预测 / 一致预期（含预测 EPS） | `fundamental earning-forecast`；EDE 搜到的基本 / 稀释 EPS 是已实现值，不能替代预测 |
| A股估值历史分位 | `fundamental valuation-analysis` |
| 港 / 美股估值历史分位 | EDE `finc_*_quantile`（`sDate` 至 `--date` 区间里的分位；各指标覆盖的市场不同，以 `scopeList` 为准，见下方「银行 / 保险 / 券商专项指标与估值分位数」） |
| **估值指标的历史序列**（分位 / 回测 / 择时） | 两个接口口径不同、都要交叉核——EDE 按正式财报披露日切换财报口径，`valuation-analysis` 按业绩快报切，见下方专门小节 |
| 开高低收 / 成交量等行情与 K 线 | `quote`；免费且支持多证券批量。**换接口不换口径**：`quote` 的 `volume` 与 EDE `qte_vol` 逐位相同（A股 / 港股 / 美股，单位均为股）。EDE 只在 `quote` 不提供的口径上才需要——周 / 月 / 季 / 年 / 区间成交量 |
| 单只基金的净值 / 持仓 / 规模 / 经理 | `fund` 命令组；多只基金批量取分类、复权净值与风险收益指标才用 EDE，见下方「基金指标」 |
| 单证券资金流向（要占比字段） | `quote fund-flow`；免费，且有 EDE 没有的 `*Ratio` 占比。多证券批量取某一两个档位才用 EDE 的 `flow_*` |
| 单证券三大报表全部科目 | 对应 `fundamental` 利润表 / 资产负债表 / 现金流量表命令 |

EDE 不是“搜到就优先”。取数前必须核对：① `indicatorName` + `description` 与目标语义一致；② `scopeList` 覆盖**全部**目标市场和证券类型；③ `parameterList` 的必填参数与枚举可满足。`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退上表的专用接口；专用接口也不支持目标市场时，如实说明当前 CLI 无可用口径，不能用其他语义代替。`valuation-analysis` / `earning-forecast` 仅支持 A 股：港 / 美股的**盈利预测**当前无可用口径；**估值历史分位**走 EDE 的 `finc_*_quantile`（逐指标核 `scopeList`，见上表）。估值指标本身港 / 美股也有数：`finc_pe_ttm`（PE TTM，`scopeList` 列 A / 港 / 美）与 `finc_pb_mrq`（PB MRQ，列 A / 港）。⚠️ **本文里所有「仅 A 股」「无数据」这类否定结论都只是某个时点的抽查**——服务端在持续补数据，正面结论过期会给错数，负面结论过期则会让你白白拒掉一个现在能跑的查询（不报错、不告警，只是少调一次）。**一律以当次 `scopeList` + 抽查一行为准。**`search` 免费，EDE 取数按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`。

## 指标搜索 `indicator search`

```bash
gangtise indicator search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：按指标名称模糊匹配。用具体词，如 `营业收入` / `基本每股收益` / `市盈率` / `总市值`，**不能用整句白话**（"我想查一批公司的财务估值" ✗）
- `--limit`：返回条数上限，默认 50，最大 100
- 默认 `--format table` 只适合浏览名称；正式路由 / 取数前必须加 `--format json`，才能完成语义、`scopeList`、`parameterList` 三项校验
- 返回字段：`indicatorCode` / `indicatorName` / `description`（算法与口径）/ `scopeList`（该指标适用的市场 + 证券类型 + `usageRestriction`）/ `parameterList`（可传的 `--indicator-param` 参数名及枚举）/ `score`
- **市场范围按指标判断**：`scopeList` 会返回实际覆盖范围，且指标之间不同；不能笼统写成每个指标都覆盖 A / 港 / 美股。覆盖面在持续扩，别把抽查结论当常量：例如 `qte_mkt_cptl` / `shr_tot` / `finc_pe_ttm` / `is_op_rev_ttm` / `is_shnp_ttm` 覆盖 A/港/美股，`finc_pb_mrq` 的 `scopeList` 只列 A/港股。目标列表含任一 scope 外证券时，本批 EDE 校验不通过，应回退专用接口
- **`scopeList[].usageRestriction`**：该指标在具体接口上的限制，`null` = 无限制。⚠️ **它是提示不是硬约束**——标着「不支持指标时间序列接口」的 `qte_vol_intvl` 调时序照样返数据、不会被拦下。当成「口径可能不对、结果别当真」看，别指望它会报错
- ⚠️ **`scopeList` 是声明不是保证**：它可能**超前于数据**（声明覆盖但该市场暂无数据），也可能**滞后于数据**（已有数据尚未声明）。**「某某仍无数据」这类否定结论过期得和正面结论一样快**，照着它走会白白拒掉一个现在能跑的查询，而且不报错。**判断成本很低**：无数据会保留行列、给一个占位单元格，抽查一行就能看出覆盖情况；code 写错则直接报 `100003`，两种情形不会混淆。占位值统一是 `null`（详见下方「缺数据 vs 代码写错」）
- 美股代码用交易所后缀 `.O`(NASDAQ) / `.N`(NYSE) / `.A`(NYSE American，原 AMEX)：用 `AAPL.O`，`AAPL.US` 取不到数据

```bash
gangtise indicator search --keyword 营业收入 --limit 10 --format json   # 做语义 + scopeList + parameterList 三项校验
```

## 指标截面数据 `indicator cross-section`

```bash
gangtise indicator cross-section --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --date <yyyy-MM-dd> \
  [--currency <c>] [--scale <s>] [--indicator-param <spec>] [--key-by name|code]
```

- `--indicator`（**至少 1 个**）：指标编码，来自 `search`，可重复传多个
- `--security`（**至少 1 个**）：证券代码，如 `600519.SH`（A股）/ `09992.HK`（港股）/ `AAPL.O`（美股，用 `.O`/`.N`/`.A` 后缀，非 `.US`），可重复传多个。**也接受板块 ID**（`reference sector-search` 返回的 10 位 `sectorId`，如 `1000000287` 中信白酒 → 展开成它的全部成分股），代码与板块可混传，服务端取并集去重。⚠️ 中信行业码那类 9 位 ID（`100800109`）**不是** `sectorId`，传进去返 0 只
- `--date`（**必选**）：数据日期 `yyyy-MM-dd`。**CLI 把它下发为每个指标各自的 `tradeDate`**（接口没有根级 date）。日期语义按指标分两类——财务报表指标=报告期末（可为非交易日；**⚠️ `_ttm` 后缀整族例外，走交易日，见下方「日期路由」**）、`finc_pe_ttm` / `finc_pb_mrq` 等日频估值=交易日（详见下方「日期路由」）
  - `--date` 必填：绝大多数指标必填 `tradeDate`，漏传服务端报 `100001` 并点名缺哪个参数，所以 CLI 要求带上、下发给每个指标。（`screener` 的 `--date` 也必填，同理）
  - 🔴 **判据一句话：该指标的 `parameterList` 里有 `tradeDate` 就不用管；没有，`--date` 下发的 `tradeDate` 就可能被拒。** 按这条走，四种情形四种写法（`parameterList` 从 `indicator search --keyword <code> --format json` 读，别按 code 前缀推断）：

    | `parameterList` | 怎么写 |
    | :--- | :--- |
    | 有 `tradeDate` | 什么都不用加，`--date` 即可 |
    | 无 `tradeDate`、有 `reportDate`（`is_*` 等报告期类） | 加 `--indicator-param "<code>:reportDate=2024-12-31"`；CLI 检测到就不再注入 `tradeDate` |
    | 无 `tradeDate`、有别的参数 | 传那些参数，**再加一条 `--indicator-param "<code>:"`**（冒号后留空 = 不要日期）。如 `div_cash_paid_ratio` / `div_cash_yr` 要 `fiscalYear`、`pty_shr_reg`(注册资本) 只有 `currency`/`scale` |
    | 无 `tradeDate`、`parameterList` 为空 | 只加 `--indicator-param "<code>:"` |

    - **空冒号那条与真实参数可以共存**：`"div_cash_yr:" "div_cash_yr:fiscalYear=2025"` 两条一起给，前者只关掉日期注入，不会把 `fiscalYear` 清掉
    - **哪些指标属于后两种**：已知是 `pty_*`（公司属性：注册地址 / 法定代表人 / 经营范围 / 公司简介…）与 `scr_*`（证券属性：证券简称 / ISIN / 上市市场 / 上市板块 / 上市日期…）两族，加上 `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg` 与基金的 `fund_main_code` / `fund_estb_dt`。🔴 **这只是当前已知的快照，不是完整清单**——`indicator search` 必须给关键词、`--limit` 上限 100 且没有翻页，所以指标库无法整体枚举。**永远以 `parameterList` 为准**；要重新生成某一族用 `indicator search --keyword <前缀>_ --limit 100`，返回条数小于 100 即该族已列全
    - ⚠️ **别把「有 `fiscalYear`」当成「不要 `tradeDate`」**——`frcst_pe` / `frcst_shnp` / `frcst_op_rev` 等预测类指标 `parameterList` 里**两个都是必填**，照常用 `--date` 再加一条 `fiscalYear`，**不要**加空冒号那条
    - ⚠️ **也别把「有 `reportDate`」当成「不受影响」**——报告期类指标同样拒收注入的 `tradeDate`，只是解法（自己传 `reportDate`）刚好顺带关掉了注入
  - 🔴 **吃 `reportDate` 的指标必须显式传 `reportDate`**：`--indicator-param "code:reportDate=2024-12-31"`。服务端不接受 `tradeDate`——只给 `--date` 会报 `100003「指标 xxx 不支持参数 tradeDate; 指标 xxx 缺少必填参数 reportDate」`。哪些指标属于这一类看 `indicator search` 的 `parameterList`：`reportDate` 标 `required: true` 且列表里没有 `tradeDate` 的就是。利润表 / 资产负债表 / 现金流量表类（`is_*` 等）都在此列；行情与估值类（`qte_*` / `finc_*`）仍用 `--date` 即可。CLI 检测到你已为某指标传了 `tradeDate` 或 `reportDate` 就不再注入 `--date`，所以补上 `--indicator-param` 就能正常取数
  - `sDate`（区间起始日）**不算**替代日期：它和 `tradeDate` 共存（`tradeDate` 是区间终点且 required），传了 `sDate` 后 `--date` 照常下发
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`（**大写**）
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
  - 根级 `--scale` **只作用于支持该参数的指标**：`qte_close` + `qte_mkt_cptl` 混查加 `--scale 8`，收盘价保持原值、总市值按亿缩放，价格类与金额类可以放心混查。要精确控制到单个指标用 `--indicator-param "code:scale=8"`
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `security / name / <各指标名>…`。**没有 `date` 列**——查询日期挂在每个指标自己的参数上，各列可以是不同日期
- **`--key-by name|code`**（默认 `name`）：指标列头用显示名还是 `indicatorCode`。**批量按 code 回填必用 `--key-by code`**——指标名会碰撞（多个指标同显示名，如 `cf_finc_exp`/`_qtr` 都叫「财务费用」），唯有 code 唯一（行轴 `security` 本就是 code，`code` 模式整表可按 code 寻址，免去 raw API 手工回填）。`indicatorList` 的返回顺序 = 请求顺序；`securityCodeList` 的返回顺序**不作保证**（可能与请求顺序不同）。所以**行序不能按请求下标对位**，一律按 `security` 字段取值

```bash
# 多证券 × 同一报告期的已实现财务指标（报告期类指标必须显式给 reportDate，只给 --date 会报 100003）
gangtise indicator cross-section \
  --indicator is_op_rev --indicator is_eps_bas \
  --indicator-param "is_op_rev:reportDate=2025-12-31" --indicator-param "is_eps_bas:reportDate=2025-12-31" \
  --security 600519.SH --security 000858.SZ --security 300750.SZ \
  --date 2025-12-31 --format table
# 列：security / name / 营业收入(利润表,累计) / 基本每股收益(利润表,累计)
# 省略 reportType 即取合并口径（茅台2025=1688亿）；口径映射见下方「reportType 口径」
```

## 指标时间序列 `indicator time-series`

```bash
gangtise indicator time-series --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --start-date <date> --end-date <date> \
  [--calendar-type <ND|TD|WD|RD>] [--currency <c>] [--scale <s>] [--indicator-param <spec>] [--key-by name|code]
```

- `--indicator` / `--security`：同上，但**只允许「多指标 × 单证券」或「单指标 × 多证券」**，不能两边都多个（要多 × 多用 `cross-section`，否则报 `100003`「仅支持多指标单证券或单指标多证券」）。**单指标时 `--security` 才能传板块 ID**；多指标时只能传一个证券代码、不得传板块 ID
- `--start-date` / `--end-date`（**均必选**）：区间端点 `yyyy-MM-dd`。时序的时间范围由这两个参数统管，**不要**再用 `--indicator-param` 传 `tradeDate` 这类单日期参数
- ⚠️ **同一 `indicatorCode` 挂多套参数：截面和时序都不支持，这是设计如此，要拆成两次调用**。只有 `screener` 支持（它把指标绑到不同变量 `F1`/`F2` 上，天然可区分）。CLI 也表达不了该请求——`--indicator-param` 按 code 建 Map，同 code 的多组参数会被合并成一组，与服务端设计一致。走 `raw call` 真发出去会报 `100003「指标 xxx 重复配置」`
- `--calendar-type`：日期类型 `ND`(自然日) / `TD`(交易日) / `WD`(工作日) / `RD`(报告期，固定为 `03-31` / `06-30` / `09-30` / `12-31`)。显式传了就按你给的发

  **不传时由服务端按指标定日期轴**（CLI 不另发请求、也不改写）：

  | 本次请求的指标 | 返回的日期 |
  | :-- | :-- |
  | 全部是交易日类（行情、日频估值，如 `qte_close` / `finc_pe_ttm`） | 交易日序列 |
  | 全部是报告期类（`is_*` 等财务指标） | 报告期序列（区间内的 `03-31` / `06-30` / `09-30` / `12-31`） |
  | 两类混查 | 两者日期的**并集**：报告期类指标只在报告期末那几行有值，其余行 `null`；报告期末不是交易日时，交易日类指标在那一行是 `null` |

  - 🔴 **一致预期类指标（`frcst_*`）不传时走交易日序列**，但它们在非交易日也有值、而且会变（节假日期间预测更新）。要逐日完整的序列就显式传 `--calendar-type ND`
  - 🔴 **报告期类指标别传 `TD`**：报告期末常落在非交易日（如 2024-03-31、2024-06-30 均为周日），`TD` 的日期轴里没有那一天，这几期报告期类指标于是**整期缺失、退出码 0、不报错**；落在交易日的报告期末照常有值（2024 年传 `TD` 只有 09-30、12-31 两期），看着像正常数据，很难发现少了期。不传或传 `RD` 即可
  - 混查时要所有指标按同一种日历取值，显式传 `ND` / `TD` / `RD`
  - `TD` 且跨市场时，日期是各市场交易日的**并集**；`RD` 跨市场用同一组报告期日期，不按市场取并集
  - **`ND` 与 `TD` 差多少**：A 股一年约 240~245 个交易日，同一区间 `ND` 的日期列大约是 `TD` 的 **1.5 倍**，多出来的全是非交易日。换算到 30000 上限就是「单指标拉一年，`TD` 能带的证券数比 `ND` 多约一半」。**要精确值就用自己的区间各跑一次比 `dates` 长度**，别套这里的比例——交易日数逐年不同
- `--currency` / `--scale`：同 `cross-section`（根级 `--scale` 只作用于支持它的指标，价格类与金额类可以混查）
- **输出（宽表）**：每行一个日期，**按日期倒序（最新在前）**，与接口返回的 `dates` 顺序一致——按相邻行算涨跌、收益率前先按 `date` 升序排好，否则符号全反；列为 `date / <各序列名>…`；序列在「单指标」时是各**证券**，在「单证券多指标」时是各**指标**。**板块 ID 算多证券**——传 1 个 `sectorId` 服务端会展开成 N 只成分股，列就是这 N 只（如中信白酒 → 每只成分股一列）
- **`--key-by name|code`**（默认 `name`）：同 `cross-section`；`code` 模式下单证券列=各 `indicatorCode`、多证券列=各 `securityCode`，批量按 code 回填用它
- ⚠️ 部分指标标注**不支持时序接口**：`search` 返回的 `scopeList[].usageRestriction` 会写明（如「不支持指标时间序列接口」），`null` 表示无限制。**但它不是硬约束**——`qte_vol_intvl` 带着该标注调时序照样返回数据，不会被拦下。把它当"口径可能不对、结果别当真"的提示，而不是"会报错"的保证

```bash
# 单个已实现估值指标 × 多证券：列 = 证券
gangtise indicator time-series --indicator finc_pe_ttm \
  --security 600519.SH --security 000858.SZ --security 300750.SZ \
  --start-date 2026-05-18 --end-date 2026-05-22
# date        贵州茅台    五粮液    宁德时代
```

## 条件选股 `indicator screener`

```bash
gangtise indicator screener --indicator <F1:code> [--indicator <F2:code2>] \
  --security <code|sectorId> [--security <code2>] --expression <expr> \
  --date <yyyy-MM-dd> [--indicator-param <F1:key=value>] [--key-by name|code]
```

按指标条件从一个证券范围里筛出符合条件的股票，一次调用完成「取数 + 过滤」，比 `cross-section` 拉全量再本地筛更省事。

- `--indicator`（**至少 1 个**）：把变量绑定到指标，格式 `F1:指标code`。变量必须是 `F` + 正整数、同一次请求内不重复；建议从 `F1` 开始连续编号
- `--security`（**至少 1 个**）：同 `cross-section`，证券代码与板块 ID 可混传取并集
- `--expression`（**必选**）：筛选表达式，引用上面绑定的变量
  - 比较：`==` `>` `<` `>=` `<=` `!=`
  - 文本：`contains` / `notcontains`（不区分大小写，**仅对 `dataType: string` 的指标有效**）
  - 逻辑：`&&` `||`，分组 `(` `)`
- `--date`（**必选**）：下发为**每个**指标的 `tradeDate`（已带 `tradeDate`/`reportDate` 的不覆盖）。绝大多数指标必填 `tradeDate`，漏传服务端报 `100001`，所以必填
- 🔴 **`parameterList` 里一个日期参数都没有的指标（`pty_*` / `scr_*` 静态属性两族、`div_cash_paid_ratio` / `div_cash_yr`、`pty_shr_reg`、`fund_main_code` / `fund_estb_dt`）必须显式声明「不要日期」**：写 `--indicator-param "F1:"`（冒号后什么都不写）。不写的话 `--date` 会给它注入 `tradeDate`，而这些指标不接受该参数，**整条请求**报 `100003 指标 xxx 不支持参数 tradeDate`。`F1:` 与真参数可组合，`div_cash_*` 要同时给 `F1:` 和 `F1:fiscalYear=2025`。这与 `cross-section` 的 `"code:"` 是同一个写法。注意只有**没有任何日期参数**的指标需要，报告期类（`is_*` 等）给 `F1:reportDate=...` 即可
- `--indicator-param`：格式是 **`F1:key=value`（按变量，不是按 code）**。引用了没绑定的变量会直接报错，不会静默丢弃
- `--expression` 里引用未绑定的变量，CLI **本地就拦**（不发请求、不计费）；服务端也会报 `100003`
- **输出（宽表）**：同 `cross-section`，每行一只**命中**的证券，列为 `security / name / <各指标名>…`；无命中返回空表
- **积分**：与 `cross-section` 同价（按单元格计）；计费基数按**筛选前**的范围 × 指标数保守估算（实际以平台账单为准），别拿全市场板块随手试

### 同一指标绑多个变量

把同一个 `indicatorCode` 绑到多个变量、各带不同参数，是**受支持的用法**——典型场景是「同一个价格的两个日期」做跨期比较，每列各自取到自己那天的值：

```bash
# 茅台：08-07 收盘价 vs 08-06 收盘价，两列各自取到自己那天的值
gangtise indicator screener --indicator F1:qte_close --indicator F2:qte_close \
  --indicator-param "F1:tradeDate=2026-08-07" --indicator-param "F2:tradeDate=2026-08-06" \
  --security 600519.SH --expression "F1 > F2" --date 2026-08-07
# 日收盘价 (F1)=1309.22 / 日收盘价 (F2)=1308.55，与 time-series 对照一致
```

列头会按变量加后缀区分（显示名相同）。

> `contains` / `notcontains` 对大小写不敏感（`CONTAINS` / `contains` / 混合写法等价）。

```bash
# 文本筛选：白酒板块里经营范围提到葡萄酒的公司
# ⚠️ pty_op_scope 的 parameterList 为空 → 必须带 "F1:" 声明它不吃日期，否则整条请求报 100003
gangtise indicator screener --indicator F1:pty_op_scope \
  --indicator-param "F1:" \
  --security 1000000287 --expression "F1 contains '葡萄酒'" \
  --date 2026-08-13 --format table
# 有日期参数的字符串指标不需要 "F1:"，直接筛：
gangtise indicator screener --indicator F1:mgn_flag \
  --security 1000000287 --expression "F1 contains '是'" \
  --date 2026-08-13 --format table   # 融资融券标的
```

```bash
# 中信白酒板块里，市值≥500亿 且 PE(TTM)≤30
gangtise indicator screener \
  --indicator F1:qte_mkt_cptl --indicator F2:finc_pe_ttm \
  --indicator-param "F1:scale=8" \
  --security 1000000287 \
  --expression "F1 >= 500 && F2 <= 30" \
  --date 2026-07-31 --format table
# security / name / 总市值 / 市盈率(TTM) —— 板块成分股里满足条件的那几只
```

## 复权 / 指标专属参数 `--indicator-param`

通用的币种/量纲用 `--currency` / `--scale`；指标**专属**参数用 `--indicator-param`，格式 `指标code:参数key=值`，可重复（screener 例外，按变量索引：`F1:key=值`）。下面的行情复权仅演示底层参数语法；常规行情 / K 线仍优先 `quote`，不要照此例改走 EDE：

```bash
# 茅台收盘价后复权（adjustType=3）
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2024-01-02 --indicator-param "qte_close:adjustType=3"
#   1 不复权 / 2 前复权 / 3 后复权。前复权以最新交易日为基准，在最新交易日等于不复权、每次除权都会变，验证复权要用历史日
```

- `adjustType`（复权方式）：`1`=不复权(默认) `2`=前复权 `3`=后复权 `4`=定点复权（配 `baseDate` 基期）
  - ⚠️ **参数名是 `adjustType`**（不是 `adjustmentType`）。写错名会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可
  - 前复权以最新交易日为基准，所以在**最新交易日上前复权价 == 不复权价**；验证复权是否生效要用历史日期
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- 🔴 **冒号左边的 code 必须是 `--indicator` 列出过的**：写了别的（多为拼写错误）会在发请求前报 `--indicator-param references "xxx", which no --indicator names`。这条拦的是「参数没落到你要查的指标上」——按报错核对拼写即可。`screener` 上是同款检查，只是按变量：变量必须被 `--indicator` 绑定
- **参数名与取值一律以 `indicator search --format json` 的 `parameterList` 为准**，不要照抄任何文档里的示例名——参数名会随版本调整。写错会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可。币种枚举**统一大写**（`DFT`/`CNY`/`HKD`…），小写形式不生效
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

### 🔴 单次调用的单元格上限：30000

`cross-section` 与 `time-series` 各有一个**单次返回单元格总数不得超过 30000** 的硬上限，超出直接报 `100006 QUERY_LIMIT_EXCEEDED`（msg 写明限额），不返回部分结果、不截断。口径就是返回矩阵的元素个数：

| 接口 | 单元格数 | 例 |
| :-- | :-- | :-- |
| `cross-section` | **证券数 × 指标数** | 5000 只 × 6 指标 = 30000，可以；5001 只 × 6 指标 = 30006，被拒 |
| `time-series` | **序列数 × 日期数**（序列 = 单指标时的证券数，或单证券时的指标数） | 300 只 × 100 天 = 30000，可以；301 只 × 100 天 = 30100，被拒 |

**撞上限就按这个乘积拆批**：截面拆证券或拆指标，时序拆证券或缩日期区间，分批取回后自己合并。

⚠️ **两处最容易撞**：① `--security` 传板块 ID 时服务端会展开成全部成分股，实际证券数远大于写进命令的条数（全 A 股板块是数千只，配几个指标就到顶）；② 时序的日期轴由 `--calendar-type` 决定，`ND` 的日期列约是 `TD` 的 1.5 倍（周末与节假日各占一列），同一个查询在 `ND` 下更容易超限——纯行情序列走 `TD` 就省下这部分（不传 `--calendar-type` 时服务端对行情类指标就是按交易日给，见上文）。

**缺数据 vs 代码写错**：

**缺数据一律保留行列并给一个占位单元格**，连单指标 × 单证券的 1×1 缺口也有行有列、不是空表。判据是**代码认不认识**，跟有没有数据无关：

> 🔴 **报告期类指标（`is_*`）取不到数时返 `null`，而在逐日的日期轴上（混查，或显式传 `ND` / `TD` / `WD`）时序大部分行都是 `null`——这一条会直接影响聚合结果**
>
> 占位值统一是 `null`（截面与时序都一样，不会是 `0`）。`null` 在宽表里一眼可见，**Excel `AVERAGE` / pandas `mean()` / SQL `AVG` 会跳过它**，但**行数不会变**。🔴 **`jq` 不跳过**：`[1,null,2,null,null] | add/length` 得 **0.6**（正确值 1.5），`add` 把 `null` 当加法单位元而 `length` 照数——正是「整列求均值差几十倍」那个错法本身；全为 `null` 时 `add/length` 直接报错。用 jq 聚合前先 `map(select(. != null))`。
>
> **时序这一档最容易踩**：报告期类指标与交易日类指标混查、或显式传 `--calendar-type ND` / `TD` / `WD` 时，日期轴是逐日的，**只有报告期末那几行是真值**，其余全是 `null`——`ND` 下查 3 月到 7 月只有 03-31 和 06-30 两行有数（`TD` 下落在非交易日的那期连行都没有，见上文日期轴一节）。用「总和 ÷ 行数」手工求均值会偏低几十倍；用会跳过 `null` 的聚合（如多数 DataFrame 的 `mean()`）才是对的。只要报告期末那几行：单独查报告期类指标，不传 `--calendar-type` 或传 `RD`（时序不收 `tradeDate` / `reportDate` 参数，传了会被拒）。
>
> **截面这一档**：日期不落在报告期末（如 `2025-05-15`）时整批返 `null`，`screener` 的任何比较都不成立、筛出空集——**这不是「没有符合条件的标的」，是日期用错了**。
>
> **怎么办**：① 报告期类指标一律把日期落在**报告期末**（`2025-03-31` / `06-30` / `09-30` / `12-31`），截面用 `--indicator-param "<指标code>:reportDate=..."` 显式指定（`F1:` 是 `screener` 的变量写法）；② **别对时序整列直接求均值 / 求和**，先按报告期末取子集，或确认你的聚合会跳过 `null`。

| 情况 | 服务端怎么返 | CLI |
| :--- | :--- | :--- |
| 代码有效、但**无数据 / 无覆盖 / 非交易日 / 未来日期** | 占位单元格（统一 `null`），行列都在 | **退出 0**，不标 partial |
| **指标码无法解析**（拼错、不存在） | `100003「指标 xxx 不存在」` | **退出 1**，报错 |
| **证券码无法解析**（拼错、后缀错，如 `AAPL.US`） | `100003「xxx 不是有效证券或者板块ID」` | **退出 1**，报错 |
| **参数名写错 / 同 code 重复配置** | `100003` 并指名参数 / 「重复配置」 | **退出 1**，报错 |

示例：

| 查法 | 服务端返回 |
| :--- | :--- |
| `--indicator mgn_bal --security 00700.HK`（融资融券余额不覆盖港股） | 1 行，`mgn_bal: null`，**退出 0** |
| `--indicator qte_close --date 2027-01-04`（未来日期） | 1 行，`qte_close: null`，**退出 0** |
| `--indicator qte_close --indicator not_a_real_code`（有对照物） | `100003 指标 not_a_real_code 不存在` |
| `--indicator not_a_real_code`（**无对照物**） | `100003 指标 not_a_real_code 不存在` ← 同样报错 |
| `--indicator qte_close --security 999999.SH` | `100003 999999.SH 不是有效证券或者板块ID` |

**代码写错一律报错、且消息里带上那个代码**，无论同批有没有别的正确代码——不用靠「和一个已知有数的标的一起查」推断是哪个写错了。无数据是占位单元格（统一 `null`）；拿到整批 `null` 先查日期语义，见本文末尾「空结果排查顺序」。

**「和一个已知有数的标的一起查」这套对照法不必要**——缺数据一眼可见。仍要留意的是**日期语义**（见上方 🔴 段）：日期用错时整批返 `null`，形态与「真的没覆盖」一样。

> 服务端对写错的 code 直接报 `100003`（退出 1），所以 `partial` + `omittedIndicators` / `omittedSecurities` + 退出码 3 很少出现；出现时表示服务端没有返回请求里的某个指标或证券。

`screener` 上指标码写错同样直接报 `100003`。服务端少返回某些列时，CLI 按表达式的布尔结构判：整个表达式再无可成立分支 → 退出码 1 且不输出；仍有分支可求值（如 `F1 || F2` 只缺 F1）→ `partial` + 退出码 3。

⚠️ **`screener` 的空集仍要当心：三种成因产生逐字相同的输出（都是退出码 0 + 同一句 note）**

| # | 成因 | 怎么区分 |
| :-- | :-- | :-- |
| ① | 真的没有标的满足条件 | —— |
| ② | **日期没落在报告期末**（报告期类指标整批返 `null`，任何比较都不成立） | 改用报告期末日期重跑 |
| ③ | **该指标不覆盖这批证券**（如拿 A 股专属指标查港美股：`mgn_*` 融资融券系列仅 A 股，港/美股为 `null`） | 用 `cross-section` 单查一行看是不是 `null`。⚠️ **覆盖面是逐只的、且会变**，别按「某指标只有 A 股」这种整体结论排除 |

例如 `is_dnrpnp` + `F1 > 0`：「美股标的且日期完全正确」与「A 股标的但日期错」两种查法的输出**逐字相同**。**所以只改日期改不出来时，要怀疑覆盖面。** 指标码拼错不在其列（会直接报错）。

标 `partial` 的那档会在 stderr 打印被略过的 code（`--format json` 下 stdout 仍是干净 JSON）。脚本按 `!= 0` 判失败的要注意：3 表示「有数据但不完整」，不是硬失败。

取数报错主要是这几个码：

| 错误码 | 实际含义 | 怎么办 |
| :--- | :--- | :--- |
| `100001` | **缺少必填参数**：如 `universe` 没传，或指标 `parameterList` 里 `required` 的参数没给（msg 会点名是哪个指标的哪个参数） | 补齐 `--indicator` / `--security`，或用 `--indicator-param` 补上点名的参数 |
| `100003`@400 | 入参/表达式错误：`time-series` 传了「多指标 × 多证券」、`expression` 引用未声明变量、`indicatorParamList` 的 code 不在 `indicatorCodeList` 里 | 按 msg 改；多 × 多改用 `cross-section`。CLI 已在本地拦截「表达式引用未绑定变量」，不会白发一次请求 |
| `140002`@500 | **终态参数错**：枚举越界（如「参数 adjustType 的值 99 不在有效范围内 [1,2,3,4]」）、表达式语法错误 | **不重试**（CLI 已把 140002 列为终态码）。读 `search --format json` 的 `parameterList` 改参数名/取值 |
| `999999` | 系统故障。「无数据」不用此码，所以它基本只剩真故障。⚠️ 无数据是占位单元格（统一 `null`）；代码或参数名写错报 `100003`、缺必填参数报 `100001`，都会点名 | CLI 对 indicator 端点**不重试此码**；确认参数无误仍报错，稍后再试或联系平台支持 |
| `110003` | **超出账号数据权限的时间范围**。窗口按**账号**配、不按接口配——`cross-section` / `time-series` / `screener` 同界，区间**跨过**下界也整批报这个码；`quote day-kline` 在同一条界上，但跨界时从下界起返回、不报错 | 把起点移进范围；整段区间都早于下界时缩短窗口无用，**换接口绕不过去**，要更长历史联系客户经理开通 |
| `130001` | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 指标专属参数

缺必填参数报 `100001` 并点名是哪个指标的哪个参数（含 `fiscalYear`）。**先完成语义 + `scopeList` + `parameterList` 三项校验；其中凡 `required:true` 的参数都用 `--indicator-param "指标code:参数=值"` 补上。** 常见的几个：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"`；`finc_roe_avg_avg` 属报告期类，还要补 `--indicator-param "finc_roe_avg_avg:reportDate=2025-12-31"`（只给 `--date` 报 `100003`） |
| `sDate` | 区间类的**起始日**（如 `qte_vol_intvl` 区间成交量、`qte_avg_vol` 区间日均成交量），格式 `yyyy-MM-dd` | `--indicator-param "qte_vol_intvl:sDate=2024-01-02"`。⚠️ **`sDate` 不能替代 `tradeDate`**——它是区间起点，`tradeDate`（=区间终点）仍是 required，`--date` 会照常下发。区间起始日的参数名就是 `sDate`，写成 `startDate` 会报 `100003 不支持参数 startDate`。⚠️ **不传 `sDate` 不报错**——它是可选参数，缺了就按默认区间算，所以要的是特定区间就必须显式传。另：`qte_amp_mo`（月振幅）等周期变体只吃 `tradeDate`，没有起始日参数 |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红）、预测类（如 `frcst_pe`，与 `tradeDate` 同时必填） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |
| `industryType` + `industryLevel` | `scr_indu` 所属行业（两个都 required，缺任一报 `100001`；⚠️ 预计下线，改用下文的 `scr_indu_citic` / `scr_indu_sw` / `scr_indu_gics`） | `--indicator-param "scr_indu:industryType=1" --indicator-param "scr_indu:industryLevel=0"` |

> `paramValue` 一律按**字符串**约定传（`periodNum=4` 内部即 `"4"`，CLI 已处理）。

### 个股资金流向（17 个 `flow_*`）

`scopeList` 只有 **A 股**（港 / 美股返 `null`）。必填 `tradeDate`，可选 `currency` / `scale`；**单位是元**（`scale` 默认 0 不缩放）。

| 档位 | 流入额 | 流出额 | 净流入额 |
| :--- | :--- | :--- | :--- |
| 小单 | `flow_small_in_amt` | `flow_small_out_amt` | `flow_small_net_in_amt` |
| 中单 | `flow_med_in_amt` | `flow_med_out_amt` | `flow_med_net_in_amt` |
| 大单 | `flow_lrg_in_amt` | `flow_lrg_out_amt` | `flow_lrg_net_in_amt` |
| 超大单 | `flow_xl_in_amt` | `flow_xl_out_amt` | `flow_xl_net_in_amt` |
| **主力** = 大单 + 超大单 | `flow_main_in_amt` | `flow_main_out_amt` | `flow_main_net_in_amt` |
| **全单** = 四档合计 | `flow_all_in_amt` | `flow_all_out_amt` | — |

**为什么全单没有净额**：`flow_all_in_amt` 与 `flow_all_out_amt` **恒相等**（每笔成交都同时是一买一卖），净额恒为 0，所以只有 17 个而不是 18 个。这两个数就是当日成交额。

🔴 **与 `quote fund-flow` 是同一套数，逐位相同**（同一只票同一天两边各档位完全一致）。**选哪个**：

| 场景 | 用 |
| :--- | :--- |
| 单只或少量证券、要全部档位和占比 | `quote fund-flow` —— **免费**，且额外给 `*Ratio` 占比字段（EDE 没有） |
| 多证券批量、只要其中一两个档位 | `indicator cross-section` —— 一次请求取回，但**按单元格计费** |

⚠️ 档位名易混：`main`（主力）= 大单 + 超大单，**不是**中单；中单是 `med`。

### 融资融券与行业分类指标

**融资融券（`mgn_*`）**——`scopeList` 只有 **A 股**（港/美股返 `null`）：

| 维度 | 当日 | 区间 |
| :--- | :--- | :--- |
| 两融合计 | `mgn_bal` 融资融券余额 | `mgn_bal_avg_intvl` 区间均值 |
| 融资 | `mgn_fin_bal` 余额、`mgn_fin_buy` 买入额、`mgn_fin_repay` 偿还额 | `mgn_fin_bal_avg_intvl`、`mgn_fin_buy_intvl`、`mgn_fin_repay_intvl` |
| 融券 | `mgn_sl_bal` 余额、`mgn_sl_qty` 余量、`mgn_sl_sell` 卖出额、`mgn_sl_sell_qty` 卖出量、`mgn_sl_repay` 偿还额、`mgn_sl_repay_qty` 偿还量 | `mgn_sl_bal_avg_intvl`、`mgn_sl_qty_avg_intvl`、`mgn_sl_sell_intvl`、`mgn_sl_sell_qty_intvl`、`mgn_sl_repay_intvl`、`mgn_sl_repay_qty_intvl` |
| 标的资格 | `mgn_flag` 是否融资融券标的（字符串「是」/「否」，可用 `screener` 的 `contains` 筛） | — |

区间类的 `changePeriod` 为可选参数。

```bash
gangtise indicator cross-section --indicator mgn_bal --indicator mgn_fin_bal --indicator mgn_sl_bal \
  --security 600519.SH --date 2026-08-07 --format table
# 茅台 2026-08-07：两融 176.7 亿 / 融资 175.4 亿 / 融券 1.3 亿
```

**行业分类 `scr_indu`（所属行业）**——⚠️ **预计下线**：`indicator search` 已搜不到，取数暂时仍可用，新写的取数一律改用下文的**行业组合指标**。一个指标覆盖四套体系，A/港/美股均支持，返回**字符串**：

- `industryType`：`1`=申万 `2`=中信 `3`=恒生 `4`=GICS
- `industryLevel`：`0`=全路径（用 `-` 连接各级）`1`=一级 `2`=二级 `3`=三级 `4`=四级

```bash
gangtise indicator cross-section --indicator scr_indu \
  --indicator-param "scr_indu:industryType=1" --indicator-param "scr_indu:industryLevel=0" \
  --security 600519.SH --date 2026-08-07
# 申万全路径「食品饮料-白酒Ⅱ-白酒Ⅲ」；industryType=2 → 中信「食品饮料-酒类-白酒」
# 腾讯 + 恒生(3) → 「资讯科技业-软件服务-数码解决方案服务」；微软 + GICS(4) → 「信息技术-软件与服务-软件-系统软件」
```

体系与市场要配对：A 股查恒生 / GICS、美股查申万，都返 `null`（如茅台 `industryType=3/4` 均为 `null`）。

**行业组合指标（3 个）**——把体系写进指标编码，省掉 `industryType`；`scr_indu` 下线后行业分类走这三个：

| 指标 | 体系 | 参数 |
| :-- | :-- | :-- |
| `scr_indu_citic` | 中信行业 | `industryLevel`（**可选**，取值同上；不传为全路径）。`parameterList` 现列为空，但 `--date` 照常传、不会被拒 |
| `scr_indu_sw` | 申万行业 | 同上 |
| `scr_indu_gics` | GICS 行业 | 同上 |

```bash
gangtise indicator cross-section --indicator scr_indu_citic --indicator scr_indu_sw \
  --security 600519.SH --date 2026-08-13
```

多套体系横比就在同一次请求里列多个组合指标（如上例）。⚠️ **恒生体系没有组合指标**：目前只能走 `scr_indu:industryType=3`，`scr_indu` 下线后 EDE 不再提供恒生行业。

**`finc_pb_mrq`（市净率 MRQ）是日频指标**：每个交易日都有数且逐日变动，别按报告期末取（那会拿到几个月前的陈值）。

### 股东结构指标（`shr_*`）

`scopeList` 只有 **A 股**。两种日期口径，按 `parameterList` 区分：

| 维度 | 按交易日（`tradeDate`，取截至该日最新披露的值） | 按报告期（`reportDate`） |
| :--- | :--- | :--- |
| 股东户数 | `shr_hld` 股东户数、`shr_hld_tot` 股东总户数、`shr_hld_g_rti` / `shr_hld_tot_g_rti` 区间增长率（另需 `sDate`）、`shr_hld_chg_dt` 最新变更日期、`shr_hld_dcl_dt` 最新披露日期 | `shr_hld_rp`、`shr_hld_tot_rp` |
| 户均持股 | `shr_avg_qty` 数量、`shr_avg_pct` 比例、`shr_avg_qty_g_rti` / `shr_avg_pct_g_rti` 区间增长率（另需 `sDate`） | `shr_avg_qty_rp`、`shr_avg_pct_rp`；半年 / 季度增长率 `shr_avg_qty_hyrg_rp` / `shr_avg_qty_qtrg_rp` / `shr_avg_pct_hyrg_rp` / `shr_avg_pct_qtrg_rp`；`shr_avg_pct_chg_rp` 较上一报告期变化 |
| 前十大股东 | — | `shr_top10_hld_name` 名称、`shr_top10_hld_pct` 持股比例合计、`shr_top10_hld_qty` 持股数量合计 |
| 大股东（前十大里指定排名的一位） | — | `shr_top_hld_name` 名称、`shr_top_hld_pct` 持股比例、`shr_top_hld_qty` 持股数量、`shr_top_hld_cat` 类型、`shr_top_hld_typ` 性质、`shr_top_hld_ntr` 持股股本性质 |

- 🔴 **两个必填参数要显式传**，漏传报 `100001`：大股东系列的 `rank`（前十大股东里的排名，`1` = 第一大股东）；户均持股系列的 `shareType`（`1` 流通股 / `2` 总股本）——`parameterList` 给 `shareType` 列了默认值 `1`，但仍须显式传
- 单只证券要前十大股东逐个明细，用 `fundamental top-holders`（免费）；EDE 适合多证券批量取汇总值或第 N 大股东

```bash
gangtise indicator cross-section --indicator shr_top_hld_name --indicator shr_top_hld_pct \
  --indicator-param "shr_top_hld_name:reportDate=2025-12-31" --indicator-param "shr_top_hld_name:rank=1" \
  --indicator-param "shr_top_hld_pct:reportDate=2025-12-31" --indicator-param "shr_top_hld_pct:rank=1" \
  --security 600519.SH --security 000001.SZ --date 2025-12-31
# 茅台 2025 年报第一大股东「中国贵州茅台酒厂(集团)有限责任公司」54.4038%

gangtise indicator cross-section --indicator shr_hld --indicator shr_avg_qty \
  --indicator-param "shr_avg_qty:shareType=2" --security 600519.SH --date 2026-10-15
```

### 量比、自由流通、流通股本与市值、涨跌停、TTM 利润类指标

参数与覆盖市场以 `indicator search` 为准：

| 类别 | 指标 | 日期参数 / 覆盖 |
| :-- | :-- | :-- |
| 量比 | `qte_vol_ratio` 量比（可选 `periodNum` / `changePeriod`）；`qte_vol_ratio_max` / `qte_vol_ratio_min` 区间最大 / 最小量比 | `tradeDate`；区间两项另传 `sDate`，不传返回 `null`。A / 港 / 美 |
| 自由流通 | `qte_turn_free` 换手率（基于自由流通股，%）、`shr_free` 自由流通股本、`shr_free_rti` 自由流通股占总股本比例 | `tradeDate`。A / 港 |
| 流通股本与市值 | `shr_float` / `shr_float_2` 流通股本（不含 / 含限售）、`qte_float_mkt_cptl` / `qte_float_mkt_cptl_2` 流通市值（不含 / 含限售）、`shr_float_tot_rti` 流通股合计占总股本比例 | `tradeDate`。A / 港 / 美 |
| AH 溢价率 | `qte_prem_rate_ah`（%，用 A 股代码查） | `tradeDate`。A 股 |
| 涨跌停与涨跌幅极值 | `qte_limit_up_num` / `qte_limit_down_num` 涨停 / 跌停天数；`qte_inc_pct_max` / `qte_dec_pct_max` 区间日涨幅最大值 / 日跌幅最大值 | `tradeDate` + `sDate`（前三个 `sDate` 必填；`qte_dec_pct_max` 可选，不传时区间起点元数据未写明，显式传）。涨跌停天数只有 A 股，涨跌幅极值 A / 港 / 美 |
| 日均价与开盘价 | `qte_avg` 日均价、`qte_open` 开盘价（可选 `adjustType` / `currency`） | `tradeDate`。A / 港 / 美 |
| TTM 利润类 | `is_net_prft_ttm` 净利润、`is_tot_prft_ttm` 利润总额、`is_op_prft_ttm` 营业利润、`is_gr_prft_ttm` 毛利、`is_invst_incm_ttm` 投资净收益、`is_exchg_incm_ttm` 汇兑收益（均为 TTM） | **`tradeDate`（`--date`），不是 `reportDate`**。A / 港；银行等没有毛利口径的公司 `is_gr_prft_ttm` 为 `null` |

```bash
gangtise indicator cross-section --indicator qte_vol_ratio --indicator qte_turn_free --indicator qte_float_mkt_cptl \
  --indicator qte_limit_up_num --indicator-param "qte_limit_up_num:sDate=2026-01-01" --indicator is_net_prft_ttm \
  --security 600036.SH --security 600519.SH --date 2026-10-30
```

### 银行 / 保险 / 券商专项指标与估值分位数

**行业专项财务指标**——`scopeList` 只有 **A 股**，都是报告期类（`reportDate` 必填，`reportType` 可选、默认 `1` 合并报表）；**非本行业的公司返回 `null`**。比率类直接是百分数（`0.94` 即 0.94%）。

| 族 | 覆盖 | 例 |
| :-- | :-- | :-- |
| 银行 `bk_*` | 资本充足率（含 2013 口径 `_2`）与资本净额、存贷款余额与成本 / 收益率、不良贷款率与拨备覆盖率、净息差 / 净利差、流动性比率、非利息收入、客户集中度 | `bk_npl_rti` 不良贷款比率、`bk_npl_prvs_covrg` 拨备覆盖率、`bk_net_int_margin` 净息差 |
| 保险 `insu_*` | 寿险 / 产险分列（`_li` / `_pci`）的实际资本与偿付能力充足率、产险综合成本率 / 费用率 / 赔付率、退保率、净 / 总投资收益率 | `insu_solv_adeq_rti_li`、`insu_compr_cost_rti_pci` |
| 券商 `secu_*` | 净资本、净资本 / 净资产、净资本 / 各项风险准备之和 | `secu_net_captl`（另有可选 `currency` / `scale`） |

```bash
gangtise indicator cross-section --indicator bk_npl_rti --indicator bk_npl_prvs_covrg --indicator bk_captl_adeq_rti_2 \
  --indicator-param "bk_npl_rti:reportDate=2025-12-31" --indicator-param "bk_npl_prvs_covrg:reportDate=2025-12-31" \
  --indicator-param "bk_captl_adeq_rti_2:reportDate=2025-12-31" --security 600036.SH --date 2026-11-06
# 招商银行 2025 年报：不良贷款比率 0.94 / 拨备覆盖率 391.79 / 资本充足率(2013) 18.24
```

**估值分位数（5 个 `finc_*_quantile`）**——`finc_pe_ttm_quantile` 市盈率(TTM)、`finc_pb_mrq_quantile` 市净率(MRQ)、`finc_ps_ttm_quantile` 市销率(TTM)、`finc_pcf_ttm_quantile` / `finc_pcf_ncf_ttm_quantile` 市现率(TTM，经营 / 全部现金净流量)。`scopeList`：`finc_pb_mrq_quantile` 列 A / 港股，其余四个列 A / 港 / 美股——按目标市场逐个核，个别证券取不到时为 `null`。返回当前估值在 `sDate` 至 `tradeDate` 区间里的历史分位（%，0–100，越低越便宜）；负值估值不参与计算，取不到时为 `null`。

- `tradeDate`（即 `--date`）与 **`sDate`（统计区间起点）都必填**，缺 `sDate` 报 `100001`；`quantile` 可选

```bash
gangtise indicator cross-section --indicator finc_pe_ttm_quantile --indicator-param "finc_pe_ttm_quantile:sDate=2021-11-05" \
  --security 600519.SH --security 00700.HK --date 2026-11-06
```

**其他新增的常用指标**（参数以 `parameterList` 为准）：

- **N 年增长率 `*_yoy_n`**（营业收入、净利润、归母净利润、扣非归母净利润、营业利润、利润总额、总资产、股东权益、经营现金流、ROE 等）与 `is_tot_op_rev_cagr` 营业总收入复合增长率：报告期类，`reportDate` + `periodNum`（N 年）都必填
- **相对年初增长率 `*_yoy_ytd`**（总资产、每股净资产、归母权益）：报告期类
- **单季度**：`is_gr_prft_qtr` 毛利、`is_oth_bus_incm_qtr` 其他业务净收益、`cf_op_cf_indir_qtr` 间接法经营现金流、`cf_exchg_eff_qtr` 汇率变动影响
- **TTM 与交易日类**：`finc_fcff_ttm` 企业自由现金流、`finc_roic_ttm` 投入资本回报率——用 `tradeDate`（`--date`）
- **`div_cash_paid_ratio_cum` 累计股利支付率**：`tradeDate` + `periodNum` 都必填

### 预计下线的指标

共 23 个，`indicator search` 已搜不到，取数暂时仍可用，**存量取数尽快迁走**：

| 预计下线 | 改用 |
| :-- | :-- |
| `scr_indu` 所属行业 | `scr_indu_citic` / `scr_indu_sw` / `scr_indu_gics`（恒生行业暂无替代） |
| `cdr_conv_ratio` CDR 转换比例 | — |
| 半年期行情 `qte_*_halfyr`：振幅、涨跌幅、收盘价、最高 / 最低价、前收盘价、换手率与最高 / 最低换手率、成交额、成交量 | 带 `sDate` 的区间指标，`sDate` 取半年前：`qte_amp_intvl` / `qte_chg_pct_intvl` / `qte_high_intvl` / `qte_low_intvl` / `qte_turn_intvl` / `qte_amt_intvl` / `qte_vol_intvl`；收盘价、前收盘价直接用 `quote day-kline` 取对应日 |
| 周 / 月 / 季 / 半年 / 年均成交额与均成交量 `qte_avg_amt_{wk,mo,qtr,halfyr,yr}` / `qte_avg_vol_{…}` | `qte_avg_amt` 区间日均成交额 / `qte_avg_vol` 区间日均成交量，`sDate` 取对应周期的起点 |

区间指标的 `sDate` 是可选参数，**不传不报错、按默认区间算**——要的是特定区间就必须显式传。

### 基金指标

`--security` 传基金代码（场外 `.OF`，场内 `.SH` / `.SZ`，如 `005827.OF` / `510300.SH`）。

| 类别 | 指标 | 日期参数 |
| :-- | :-- | :-- |
| 基础属性与分类（`scopeList` 只有基金） | `fund_main_code` 基金主代码（A / C 等份额归到主份额，如 `000004.OF` → `000003.OF`）、`fund_estb_dt` 成立日期 | 没有日期参数，带 `--indicator-param "<code>:"` |
| | `fund_opr_st` 运行状态、`fund_cls1_typ` / `fund_cls2_typ` Gangtise 基金一级 / 二级分类、`fund_adj_nav` 复权单位净值 | `tradeDate`（`--date`） |
| 业绩与风险（区间指标，`sDate` 到 `tradeDate`） | 只有基金：`fund_calmar` 卡玛比率、`fund_ret_rank` 收益率同类排名（文本，如 `"5/120"`）/ `fund_ret_rank_pct` 排名百分位。股票与基金通用（部分也覆盖指数，看 `scopeList`）：`finc_ann_ret` 年化收益率、`finc_avg_ret` / `finc_avg_ret_ann` 平均收益率、`finc_vol` / `finc_vol_ann` 波动率、`finc_intvl_max_dd` 区间最大回撤、`finc_sharpe` / `finc_sharpe_ann`、`finc_treynor` / `finc_treynor_ann`、`finc_jensen` / `finc_jensen_ann`、`finc_alpha`、`finc_beta`、`finc_corr` 相关系数、`finc_unsys_risk` 非系统风险 | `sDate`（`--indicator-param "<code>:sDate=..."`）+ `tradeDate`（`--date`） |

- 🔴 **区间指标的其余参数一律显式传**，漏传报 `100001`（`parameterList` 列了默认值也一样）：`changePeriod` 变化周期、`yieldType`（`0` 普通 / `1` 对数收益率）、`riskFreeRate`（`0` = 常数 0）、`benchmarkCode` 基准代码（Alpha / Beta / 相关系数 / Jensen / Treynor / 非系统风险要）、`industryLevel`（同类排名按哪一级分类）。每个指标要哪几个以 `parameterList` 为准
- ⚠️ **`changePeriod` 列出的默认值 `6`（区间）不是每个指标都收**：Sharpe 等的 `description` 写明只支持日 / 周 / 月 / 年（`0` / `1` / `2` / `5`），传 `6` 报 `100003`
- `fund_ret_rank` / `fund_ret_rank_pct` 的「同类」是 `industryLevel` 指定那一级的 Gangtise 分类：`1` 按 `fund_cls1_typ`、`2` 按 `fund_cls2_typ`，同分类的基金分母相同（如两只偏股混合型基金在 `industryLevel=2` 下同为 `/3098`）
- `finc_intvl_max_dd` 返回负的百分数（`-19.23` 即 -19.23%），无回撤为 `0`；`fund_estb_dt` 返回 `yyyyMMdd` 整数（如 `20180905`），不是日期字符串
- 这批区间指标的 `scopeList` 标着「不支持指标时间序列接口」，用 `cross-section` 取
- 单只基金的净值序列、持仓、规模走 `fund` 命令组；EDE 适合多只基金横向比

```bash
gangtise indicator cross-section --indicator fund_cls2_typ --indicator fund_adj_nav \
  --indicator finc_intvl_max_dd --indicator-param "finc_intvl_max_dd:sDate=2025-10-24" \
  --security 005827.OF --security 510300.SH --date 2026-10-23

gangtise indicator cross-section --indicator finc_sharpe_ann \
  --indicator-param "finc_sharpe_ann:sDate=2025-10-24" --indicator-param "finc_sharpe_ann:changePeriod=0" \
  --indicator-param "finc_sharpe_ann:yieldType=0" --indicator-param "finc_sharpe_ann:riskFreeRate=0" \
  --security 005827.OF --security 510300.SH --date 2026-10-23
```

## 取数最佳实践

- **先 search 做三项校验**：看 `indicatorName` + `description` 确认语义和口径，看 `scopeList` 确认覆盖全部目标市场 / 证券类型（并看 `usageRestriction` 有无接口限制），再看 `parameterList` 补齐必填参数（required）并核对专属参数**名称**与枚举（`adjustType`/`scale`/`currency` 等）；任一不符就回退专用接口。**参数名一律以 search 返回的 `parameterList` 为准，不要照抄任何示例里的参数名**——参数名会随版本调整，写错会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可。
- **`scopeList` 声称覆盖 ≠ 每只都有数**：声明可能超前于数据，同一指标下也可能只有部分证券有数，既不能当「全覆盖」也不能当「无覆盖」。**判断成本很低**：无覆盖会留下占位单元格（行列都在，跟同批查了什么无关），抽查一行即可判定，不用再靠对照组反推。跨市场批量取数后仍建议**逐市场抽查一行**，别默认 scopeList 就是事实——反过来也一样，**否定结论同样会过期**。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务报表类（`bs_`/`is_`/`cf_`/`div_`/`shr_`，以及 description 明确按报告期统计的 `finc_`）→ 多数用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`，无需是交易日）。🔴 **但 `_ttm` 后缀是整族例外，必填 `tradeDate`**——`is_*_ttm` / `cf_*_ttm` / `div_cash_ttm` / `finc_*_ttm` 一律走交易日。**一眼验证**：在一个**非报告期末的普通交易日**直接 `--date` 取 `is_op_rev_ttm`，照样返真值；反过来给它传 `reportDate` 会报 `100003 不支持参数 reportDate; 缺少必填参数 tradeDate`。同族对照：普通 `is_op_rev` 只传 `--date` 则报「不支持参数 tradeDate; 缺少必填参数 reportDate」——**两者恰好相反**。**所以前缀只是提示，判据仍是上面 `--date` 那条：读 `parameterList` 里必填的是哪个，别按 code 前缀推断**
  - **`tradeDate` 与 `reportDate` 都必填的**（如 `div_cash_yld` 股息率(报告期)）→ 两个都用 `--indicator-param` 显式给：`"div_cash_yld:reportDate=YYYY-MM-DD"` 加 `"div_cash_yld:tradeDate=YYYY-MM-DD"`。只给 `reportDate` 时 CLI 不再把 `--date` 作为 `tradeDate` 注入，会报 `100001 缺少必填参数 tradeDate`
  - 日频估值类（如 `finc_pe_ttm` / `finc_pb_mrq`）→ 用最新已入库的**交易日**。⚠️ `finc_pb_mrq` 是**日频**的：任意交易日都有数且逐日变动。**别用季度末日期**——那会拿到几个月前的陈值（季末值与当日值可能差得很远，估值指标上就是错数）。别因 code 都以 `finc_` 开头就一律套报告期末，按 `description` 与抽查区分
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情类（`qte_` 等）→ 用**交易日**，但常规行情仍应改走 `quote`
- **混合日期语义要拆查询**：同时要“某报告期营收 / EPS”和“估值 PE / PB”时，按各自有效日期分别调用 `cross-section` 再按 `security` 合并（财务=报告期末、PE/PB=最新交易日）；不要把不同日期语义的指标塞进同一个 `--date`
- **探索性取数**：缺值会保留行列并给占位单元格（含 1×1 的最简形态），占位值统一为 `null`；code 写错会直接报 `100003`，不会伪装成缺值。看趋势用 `time-series` + 覆盖报告期的区间，但不能把缺值当成通过语义 / scope 校验。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询出错先读 msg**：缺必填参数报 `100001`、代码或参数名写错报 `100003`，msg 都会点名是哪个指标或证券，照 msg 改即可。
- **市值量纲**：`qte_mkt_cptl`（总市值）与 `shr_tot`（总股本）**A/港/美股均有数**；**默认返原始「元」**（大市值公司是 `1e12` 量级，即万亿级），别误当天文数字。用 `scale` 数字码缩放（`0`元 / `3`千 / `4`万 / `6`百万 / `8`亿 / `9`十亿——`scale=8` 即以亿元为单位）、`currency` 换币种（**大写** `DFT`本币 / `CNY` / `HKD` / `USD` …）。**跨证券比市值前先统一 `scale`+`currency`**。
- **币种与汇率**：`DFT`（原始币种）按市场识别——A股=CNY、港股行情=HKD、美股=USD；汇率换算自洽（互逆且三角一致）。⚠️ 但**同一只港股，行情类的原始币种是 HKD、财务类可能是 CNY**（如泡泡玛特财报以人民币计），跨市场比财务数据时显式传 `--currency CNY` 别依赖 `DFT`。另：财务类指标的汇率按**报告期**折算、行情类按查询日折算，两者隐含汇率会有细微差异，属正常口径差别。
- **EDE 财务指标的 `reportType`**：`enumList` 的 label 与实际取数**一致**，按 label 传即可（取值以 `enumList` 为准）：

  | value | 口径 | 说明 |
  |-------|---------|------|
  | `1`（默认，省略即此值） | **合并报表** | 绝大多数场景要的就是这个 |
  | `2` | **合并报表（调整）** | 该报告期无重述数时为空 |
  | `3` | **母公司报表** | |
  | `4` | **母公司报表（调整）** | 该报告期无重述数时为空 |

  对照：`is_tot_op_rev` + 中信证券 `600030.SH` FY2024 营业总收入，`1`→637.8922亿、`2`→581.19亿、`3`→321.924亿、`4`→321.924亿；与 `fundamental income-statement --security-code 600030.SH --fiscal-year 2024 --period annual` 返回的「合并报表」`totalOpRev`（637.892亿）在 `1` 上完全吻合。

  `2`/`4` 返回空值**不是枚举失效**，是该报告期尚无调整表（如最新年报：`1`/`3` 有数、`2`/`4` 无值，与 `fundamental --report-type consolidatedRestated` 同期无数据一致）。港股默认口径同样是合并。

## 估值指标的历史序列：两个接口口径不同，要交叉核

> 🔴 **对照前先避开这个陷阱：两个接口在非交易日的行为不一样。** EDE `finc_pe_ttm` 在非交易日返回 `null`；`fundamental valuation-analysis` 在非交易日顺延上一交易日的值。拿非交易日做对照，会看到「EDE 全是 null、对照组搭不起来」，很容易误判成 EDE 没有这些数据——**其实只是它不给非交易日补值，而 `valuation-analysis` 补**。做交叉核对时**日期一律落在交易日上**；已经撞上的，换一个交易日重跑再下结论。

| 接口 | 财报口径切换时点 | 历史期用的财报版本 |
| :--- | :--- | :--- |
| `indicator time-series`（EDE） | **正式财报披露日** | 按**最新（含重述后）**的财务数据回算 |
| `fundamental valuation-analysis` | **业绩快报**口径，通常更早 | 保留**当时披露**的原始数据 |

两者都是点时序列，但切换时机和历史期所用的财报版本都可能不同：发生过财报重述的标的，两条序列会从被重述的第一期起持续分叉，直到重述覆盖的期数过完。**做估值分位 / 回测先想清楚要哪个版本**——要「当时能看到的」用 `valuation-analysis`，要「按现在的口径回看」用 EDE；**两个都拉一遍交叉核**能定位分叉来源。

判别方法（以 `finc_pe_ttm` / `peTtm` 为例）：用**总市值 ÷ PE 反推隐含净利润**，再分别对照利润表原披露与重述后的滚动 TTM（= 上年全年 − 上年同期累计 + 本年累计），能精确复现哪一版就是哪一版。`finc_pb_mrq` 等非 TTM 口径的指标同样会在报告期节点变化，但分母是净资产（MRQ）不是 TTM，切换规则未单独核对——分叉时按同法反推净资产对照资产负债表。

⚠️ **时点对齐用三大报表的 `earliestAnncDate`（首次公告日），不要用 `announcementDate`**——后者是返回数值所属公告的日期，被重述过的报告期显示的是重述公告日。`--report-type consolidated` 对重述过的期返回的也是重述后数值（与 `consolidatedRestated` 相同），要「当时披露的原始数」需以 `earliestAnncDate` 为时点自行核对公告；交叉核实披露日查 `insight announcement list`。

## 通用说明

- **发现流程**：`indicator search --format json` → 核对 `indicatorName` + `description`、`scopeList`（含 `usageRestriction`）、`parameterList`（**参数名以此为准**）→ 三项都通过才用 `cross-section` / `time-series` / `screener`
- **积分**：`search` 免费；`cross-section` / `time-series` / `screener` 按请求单元格数量计费，标价为每 100 单元格 A 股 0.05 / 港股 0.1 / 美股 0.2 积分，每次查询不足 100 单元格按 100 计
- **空结果排查顺序**：代码、参数名写错与缺必填参数会直接报错并点名（`100003` / `100001`），不会以空结果出现。时序整批空结果（`total: 0`、没有任何行）先看区间里有没有该日期轴上的日期：报告期类指标不传 `--calendar-type`（或传 `RD`）时区间要含 `03-31` / `06-30` / `09-30` / `12-31`，交易日类指标区间要含交易日（只查长假会空）——放宽区间，或传 `--calendar-type ND` 拿逐日行。拿到整批 `null` 或 `screener` 空集时按序排查：① 日期语义对不对（`tradeDate` vs `reportDate`——报告期类指标日期用错会整批返 `null`，看着像「没数据」）② 该指标覆不覆盖这批证券（`scopeList`，单查一行确认）③ 真的没有数据
- **数据权限**：正式账号行情 / 财务 / 指标类可回溯的年限按服务等级而定，试用账号更短。这个时间窗口按**账号**配、不按接口配——三个 EDE 接口同界，区间跨过下界也整批返 `110003`（`quote day-kline` 在同一条界上，但跨界时从下界起返回、不报错），**换接口绕不过去**；整段区间都早于下界时缩短窗口无用，要更长历史联系客户经理开通
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
