# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序 / 条件选股）

> 本组覆盖 `/application/open-indicator/*`：证券级**数据指标**的检索与取数，主要用于多证券批量取已实现财务 / 估值指标。即使能搜到收盘价、成交量等行情指标，常规行情与 K 线仍走免费的 `quote`。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode` 和 `parameterList`**，绝不猜测指标编码或参数名——参数名与枚举会随版本调整，写错会直接报 `100003` 并指出是哪个指标的哪个参数，照报错改即可；照抄示例里的旧参数名则会白跑一次。

## EDE 与专用接口的优先级

| 请求形态 | 优先接口 |
| :--- | :--- |
| 单证券的财务 / 股东 / 主营，或 A股单证券估值 | 对应 `fundamental` 专用命令；多数免费，且字段口径固定 |
| 多证券批量取一组**已实现**财务 / 估值指标 | 先 `indicator search`，通过下方三项校验后用 `cross-section` / `time-series` 一次拉取，避免逐只循环 |
| A股盈利预测 / 一致预期（含预测 EPS） | `fundamental earning-forecast`；EDE 搜到的基本 / 稀释 EPS 是已实现值，不能替代预测 |
| A股估值历史分位 | `fundamental valuation-analysis` |
| **估值指标的历史序列**（分位 / 回测 / 择时） | 两个接口口径不同、都要交叉核——EDE 按正式财报披露日切换财报口径，`valuation-analysis` 按业绩快报切，见下方专门小节 |
| 开高低收 / 成交量等行情与 K 线 | `quote`；免费且支持多证券批量 |
| 单证券资金流向（要占比字段） | `quote fund-flow`；免费，且有 EDE 没有的 `*Ratio` 占比。多证券批量取某一两个档位才用 EDE 的 `flow_*` |
| 单证券三大报表全部科目 | 对应 `fundamental` 利润表 / 资产负债表 / 现金流量表命令 |

EDE 不是“搜到就优先”。取数前必须核对：① `indicatorName` + `description` 与目标语义一致；② `scopeList` 覆盖**全部**目标市场和证券类型；③ `parameterList` 的必填参数与枚举可满足。`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退上表的专用接口；专用接口也不支持目标市场时，如实说明当前 CLI 无可用口径，不能用其他语义代替。`valuation-analysis` / `earning-forecast` 仅支持 A 股，港 / 美股的**估值历史分位**与**盈利预测**当前无可用口径。但**估值指标本身别照抄旧结论**：`finc_pe_ttm`(PE TTM) 港股有数；`finc_pb_mrq`(PB MRQ) 的港股覆盖是**部分**的（部分大盘股有数，另一些为 `null`）。⚠️ **本文里所有「仅 A 股」「无数据」这类否定结论都只是某个时点的抽查**——服务端在持续补数据，正面结论过期会给错数，负面结论过期则会让你白白拒掉一个现在能跑的查询（不报错、不告警，只是少调一次）。**一律以当次 `scopeList` + 抽查一行为准。**`search` 免费，EDE 取数按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`。

## 指标搜索 `indicator search`

```bash
gangtise indicator search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：按指标名称模糊匹配。用具体词，如 `营业收入` / `基本每股收益` / `市盈率` / `总市值`，**不能用整句白话**（"我想查一批公司的财务估值" ✗）
- `--limit`：返回条数上限，默认 50，最大 100
- 默认 `--format table` 只适合浏览名称；正式路由 / 取数前必须加 `--format json`，才能完成语义、`scopeList`、`parameterList` 三项校验
- 返回字段：`indicatorCode` / `indicatorName` / `description`（算法与口径）/ `scopeList`（该指标适用的市场 + 证券类型 + `usageRestriction`）/ `parameterList`（可传的 `--indicator-param` 参数名及枚举）/ `score`
- **市场范围按指标判断**：`scopeList` 会返回实际覆盖范围，且指标之间不同；不能笼统写成每个指标都覆盖 A / 港 / 美股。覆盖面在持续扩，别把抽查结论当常量：例如 `qte_mkt_cptl`/`shr_tot` 覆盖 A/港/美股，`finc_pe_ttm` 覆盖 A/港股，`finc_pb_mrq` 覆盖 A 股 + **部分**港股，`is_op_rev_ttm`/`is_shnp_ttm` 覆盖 A/港股。目标列表含任一 scope 外证券时，本批 EDE 校验不通过，应回退专用接口
- **`scopeList[].usageRestriction`**：该指标在具体接口上的限制，`null` = 无限制。⚠️ **它是提示不是硬约束**——标着「不支持指标时间序列接口」的 `qte_vol_intvl` 调时序照样返数据、不会被拦下。当成「口径可能不对、结果别当真」看，别指望它会报错
- ⚠️ **`scopeList` 是声明不是保证**：它可能**超前于数据**，也可能**滞后于你上次的抽查**——`finc_pb_mrq` 声称覆盖 A股+港股，港股实际只有部分有数；`qte_mkt_cptl`/`shr_tot` 也曾一度声称覆盖港/美股却无数据、随后补上。**「某某仍无数据」这类否定结论过期得和正面结论一样快**，照着它走会白白拒掉一个现在能跑的查询，而且不报错。**判断成本很低**：无数据会保留行列、给一个占位单元格，抽查一行就能看出覆盖情况；code 写错则直接报 `100003`，两种情形不会混淆。占位值统一是 `null`（详见下方「缺数据 vs 代码写错」）
- 美股代码用交易所后缀 `.O`(NASDAQ) / `.N`(NYSE)：用 `AAPL.O`，`AAPL.US` 取不到数据

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
- `--security`（**至少 1 个**）：证券代码，如 `600519.SH`（A股）/ `09992.HK`（港股）/ `AAPL.O`（美股，用 `.O`/`.N` 后缀，非 `.US`），可重复传多个。**也接受板块 ID**（`reference sector-search` 返回的 10 位 `sectorId`，如 `1000000287` 中信白酒 → 19 只成分股），代码与板块可混传，服务端取并集去重。⚠️ 中信行业码那类 9 位 ID（`100800109`）**不是** `sectorId`，传进去返 0 只
- `--date`（**必选**）：数据日期 `yyyy-MM-dd`。**CLI 把它下发为每个指标各自的 `tradeDate`**（接口没有根级 date）。日期语义按指标分两类——财务报表指标=报告期末（可为非交易日；**⚠️ `_ttm` 后缀整族例外，走交易日，见下方「日期路由」**）、`finc_pe_ttm` / `finc_pb_mrq` 等日频估值=交易日（详见下方「日期路由」）
  - `--date` 必填是 CLI 的**护栏**，不是协议要求：`cross-section` 本身接受 `indicatorParamList: []`。但绝大多数指标吃 `tradeDate`，漏传就是一张空表且退出码 0，所以宁可多带一个。（`screener` 的 `--date` 也必填，同理）
  - 🔴 **判据一句话：该指标的 `parameterList` 里有 `tradeDate` 就不用管；没有，`--date` 下发的 `tradeDate` 就可能被拒。** 按这条走，四种情形四种写法（`parameterList` 从 `indicator search --keyword <code> --format json` 读，别按 code 前缀推断）：

    | `parameterList` | 怎么写 |
    | :--- | :--- |
    | 有 `tradeDate` | 什么都不用加，`--date` 即可 |
    | 无 `tradeDate`、有 `reportDate`（`is_*` 等报告期类） | 加 `--indicator-param "<code>:reportDate=2024-12-31"`；CLI 检测到就不再注入 `tradeDate` |
    | 无 `tradeDate`、有别的参数 | 传那些参数，**再加一条 `--indicator-param "<code>:"`**（冒号后留空 = 不要日期）。如 `div_cash_paid_ratio` / `div_cash_yr` 要 `fiscalYear`、`pty_shr_reg`(注册资本) 只有 `currency`/`scale` |
    | 无 `tradeDate`、`parameterList` 为空 | 只加 `--indicator-param "<code>:"` |

    - **空冒号那条与真实参数可以共存**：`"div_cash_yr:" "div_cash_yr:fiscalYear=2025"` 两条一起给，前者只关掉日期注入，不会把 `fiscalYear` 清掉
    - **哪些指标属于后两种**：已知是 `pty_*`（公司属性：注册地址 / 法定代表人 / 经营范围 / 公司简介…）与 `scr_*`（证券属性：证券简称 / ISIN / 上市市场 / 上市板块 / 上市日期…）两族，加上 `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg`。🔴 **这只是当前已知的快照，不是完整清单**——`indicator search` 必须给关键词、`--limit` 上限 100 且没有翻页，所以指标库无法整体枚举。**永远以 `parameterList` 为准**；要重新生成某一族用 `indicator search --keyword <前缀>_ --limit 100`，返回条数小于 100 即该族已列全
    - ⚠️ **别把「有 `fiscalYear`」当成「不要 `tradeDate`」**——`frcst_pe` / `frcst_shnp` / `frcst_op_rev` 等预测类指标 `parameterList` 里**两个都是必填**，照常用 `--date` 再加一条 `fiscalYear`，**不要**加空冒号那条
    - ⚠️ **也别把「有 `reportDate`」当成「不受影响」**——报告期类指标同样拒收注入的 `tradeDate`，只是解法（自己传 `reportDate`）刚好顺带关掉了注入
  - 🔴 **吃 `reportDate` 的指标必须显式传 `reportDate`**：`--indicator-param "code:reportDate=2024-12-31"`。服务端不接受 `tradeDate`——只给 `--date` 会报 `100003「指标 xxx 不支持参数 tradeDate; 指标 xxx 缺少必填参数 reportDate」`。哪些指标属于这一类看 `indicator search` 的 `parameterList`：`reportDate` 标 `required: true` 且列表里没有 `tradeDate` 的就是。利润表 / 资产负债表 / 现金流量表类（`is_*` 等）都在此列；行情与估值类（`qte_*` / `finc_*`）仍用 `--date` 即可。CLI 检测到你已为某指标传了 `tradeDate` 或 `reportDate` 就不再注入 `--date`，所以补上 `--indicator-param` 就能正常取数
  - `sDate`（区间起始日）**不算**替代日期：它和 `tradeDate` 共存（`tradeDate` 是区间终点且 required），传了 `sDate` 后 `--date` 照常下发
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`（**大写**）
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
  - 根级 `--scale` **只作用于支持该参数的指标**：`qte_close` + `qte_mkt_cptl` 混查加 `--scale 8`，收盘价保持原值、总市值按亿缩放，价格类与金额类可以放心混查。要精确控制到单个指标用 `--indicator-param "code:scale=8"`
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `security / name / <各指标名>…`。**没有 `date` 列**——查询日期挂在每个指标自己的参数上，各列可以是不同日期
- **`--key-by name|code`**（默认 `name`）：指标列头用显示名还是 `indicatorCode`。**批量按 code 回填必用 `--key-by code`**——指标名会碰撞（多个指标同显示名，如 `cf_finc_exp`/`_qtr` 都叫「财务费用」），唯有 code 唯一（行轴 `security` 本就是 code，`code` 模式整表可按 code 寻址，免去 raw API 手工回填）。顺序是稳定的，但**两个轴的排法不一样**：`indicatorList` **= 请求顺序**（请求 `qte_vol,qte_close` 就回 `qte_vol,qte_close`）；`securityCodeList` **是按代码升序重排的，不是请求顺序**（请求 `000858,600519,000001` → 回 `000001,000858,600519`）。所以**行序绝不能按请求下标对位**，一律按 `security` 字段取值

```bash
# 多证券 × 同一报告期的已实现财务指标
gangtise indicator cross-section \
  --indicator is_op_rev --indicator is_eps_bas \
  --security 600519.SH --security 000858.SZ --security 300750.SZ \
  --date 2025-12-31 --format table
# 列：security / name / 营业收入(利润表,累计) / 基本每股收益(利润表,累计)
# 省略 reportType 即取合并口径（茅台2025=1688亿）；口径映射见下方「reportType 口径」
```

## 指标时间序列 `indicator time-series`

```bash
gangtise indicator time-series --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --start-date <date> --end-date <date> \
  [--calendar-type <ND|TD|WD>] [--currency <c>] [--scale <s>] [--indicator-param <spec>] [--key-by name|code]
```

- `--indicator` / `--security`：同上，但**只允许「多指标 × 单证券」或「单指标 × 多证券」**，不能两边都多个（要多 × 多用 `cross-section`，否则报 `100003`「仅支持多指标单证券或单指标多证券」）。**单指标时 `--security` 才能传板块 ID**；多指标时只能传一个证券代码、不得传板块 ID
- `--start-date` / `--end-date`（**均必选**）：区间端点 `yyyy-MM-dd`。时序的时间范围由这两个参数统管，**不要**再用 `--indicator-param` 传 `tradeDate` 这类单日期参数
- ⚠️ **同一 `indicatorCode` 挂多套参数：截面和时序都不支持，这是设计如此，要拆成两次调用**。只有 `screener` 支持（它把指标绑到不同变量 `F1`/`F2` 上，天然可区分）。CLI 也表达不了该请求——`--indicator-param` 按 code 建 Map，同 code 的多组参数会被合并成一组，与服务端设计一致。走 `raw call` 真发出去会报 `100003「指标 xxx 重复配置」`
- `--calendar-type`：日期类型 `ND`(自然日)/`TD`(交易日,默认)/`WD`(工作日)。`TD` 且跨市场时，`date` 列是各市场交易日的**并集**
- `--currency` / `--scale`：同 `cross-section`（含根级 `--scale` 的污染坑）
- **输出（宽表）**：每行一个日期，列为 `date / <各序列名>…`；序列在「单指标」时是各**证券**，在「单证券多指标」时是各**指标**。**板块 ID 算多证券**——传 1 个 `sectorId` 服务端会展开成 N 只成分股，列就是这 N 只（如中信白酒 → 19 列）
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
- `--date`（**必选**）：下发为**每个**指标的 `tradeDate`（已带 `tradeDate`/`reportDate` 的不覆盖）。绝大多数指标吃 `tradeDate`，漏传就是一张空表且退出码 0，所以必填
- 🔴 **`parameterList` 里一个日期参数都没有的指标（`pty_*` / `scr_*` 静态属性两族、`div_cash_paid_ratio` / `div_cash_yr`、`pty_shr_reg`）必须显式声明「不要日期」**：写 `--indicator-param "F1:"`（冒号后什么都不写）。不写的话 `--date` 会给它注入 `tradeDate`，而这些指标不接受该参数，**整条请求**报 `100003 指标 xxx 不支持参数 tradeDate`。`F1:` 与真参数可组合，`div_cash_*` 要同时给 `F1:` 和 `F1:fiscalYear=2025`。这与 `cross-section` 的 `"code:"` 是同一个写法。注意只有**没有任何日期参数**的指标需要，报告期类（`is_*` 等）给 `F1:reportDate=...` 即可
- `--indicator-param`：格式是 **`F1:key=value`（按变量，不是按 code）**。引用了没绑定的变量会直接报错，不会静默丢弃
- `--expression` 里引用未绑定的变量，CLI **本地就拦**（不发请求、不计费）；服务端也会报 `100003`
- **输出（宽表）**：同 `cross-section`，每行一只**命中**的证券，列为 `security / name / <各指标名>…`；无命中返回空表
- **积分**：与 `cross-section` 同价（按单元格计），但计费基数是**筛选前**的范围 × 指标数，别拿全市场板块随手试

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
# security / name / 总市值 / 市盈率(TTM) —— 19 只成分股筛出 5 只
```

## 复权 / 指标专属参数 `--indicator-param`

通用的币种/量纲用 `--currency` / `--scale`；指标**专属**参数用 `--indicator-param`，格式 `指标code:参数key=值`，可重复（screener 例外，按变量索引：`F1:key=值`）。下面的行情复权仅演示底层参数语法；常规行情 / K 线仍优先 `quote`，不要照此例改走 EDE：

```bash
# 茅台收盘价后复权（adjustType=3）
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2024-01-02 --indicator-param "qte_close:adjustType=3"
#   不复权 1685.01 → 前复权 1531.225 → 后复权 13609.6168
```

- `adjustType`（复权方式）：`1`=不复权(默认) `2`=前复权 `3`=后复权 `4`=定点复权（配 `baseDate` 基期）
  - ⚠️ **参数名是 `adjustType`**（不是 `adjustmentType`）。写错名会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可
  - 前复权以最新交易日为基准，所以在**最新交易日上前复权价 == 不复权价**；验证复权是否生效要用历史日期
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- 🔴 **冒号左边的 code 必须是 `--indicator` 列出过的**：写了别的（多为拼写错误）会在发请求前报 `--indicator-param references "xxx", which no --indicator names`。这条拦的是「参数没落到你要查的指标上」——按报错核对拼写即可。`screener` 上是同款检查，只是按变量：变量必须被 `--indicator` 绑定
- **参数名与取值一律以 `indicator search --format json` 的 `parameterList` 为准**，不要照抄任何文档里的示例名——参数名会随版本调整。写错会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可。币种枚举**统一大写**（`DFT`/`CNY`/`HKD`…），小写形式不生效
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

### 取数可靠性：`qte_vol` 等指标在某些日期上会随机返 `null`

🔴 **同一条请求多次调用，结果会在「有值」和 `null` 之间跳。** 这**与「是不是最新交易日」无关**——是**特定日期**的数据在部分副本上缺失。受影响的**只是部分标的**（同一批里其他证券稳定）；同一条请求内，受影响的证券**全有或全无**（不会一半有一半没有）。

**做法，按优先级**：

1. 🟢 **只要日成交量 / 成交额，别用 EDE，直接用 `quote day-kline`** —— 稳定，`amount` 与分钟线加总精确相等。**不用重试、不用换日期、不丢数据**；它的 `volume` 与 EDE `qte_vol` **逐位相同**（A股 / 港股 / 美股，单位同为股），**没有精度损失**
2. 确实需要 EDE 才有的口径时（周 / 月 / 季 / 年 / 区间成交量等 `quote` 不提供的），**重试，但不要设固定次数上限** —— 出现过连续多次全 `null`。**若必须设上限，超限时要显式报错退出，绝不能把最后一次的 `null` 当成「无数据」写进结果**

⚠️ **不要用「改取前一个交易日」当通用兜底**：它可能在某个个案上碰巧有效，但坏的是哪一天并无规律，而且会丢掉那一整天的数据。

**单次 `null` 不能读成「该股当日无数据」** —— 它与真无数据无法区分，且退出码 0。判别法：**同一条请求再打几次**，只要出现过非 `null` 就说明数据是有的。

---

**缺数据 vs 代码写错**：

**缺数据一律保留行列并给一个占位单元格**，连单指标 × 单证券的 1×1 缺口也有行有列、不是空表。判据是**代码认不认识**，跟有没有数据无关：

> 🔴 **报告期类指标（`is_*`）取不到数时返 `null`，而时序上大部分行都是 `null`——这一条会直接影响聚合结果**
>
> 占位值统一是 `null`（截面与时序都一样，不会是 `0`）。`null` 在宽表里一眼可见，**Excel `AVERAGE` / pandas `mean()` / SQL `AVG` 会跳过它**，但**行数不会变**。🔴 **`jq` 不跳过**：`[1,null,2,null,null] | add/length` 得 **0.6**（正确值 1.5），`add` 把 `null` 当加法单位元而 `length` 照数——正是「整列求均值差几十倍」那个错法本身；全为 `null` 时 `add/length` 直接报错。用 jq 聚合前先 `map(select(. != null))`。
>
> **时序这一档最容易踩**：报告期类指标按日返回，**只有报告期末那几行是真值**，其余全是 `null`——例如茅台 `is_dnrpnp` 查 3 月到 7 月共 104 行，只有 03-31 和 06-30 两行有数。而**时序没有任何参数能让它只返回报告期末**（传 `tradeDate` / `reportDate` 都会被拒）。用「总和 ÷ 行数」手工求均值会得到偏低 50 倍的结果；用会跳过 `null` 的聚合（如多数 DataFrame 的 `mean()`）才是对的。
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
| `--indicator finc_pb_mrq --security 09992.HK`（这一只港股无 PB 数据；同指标下其他港股有数） | 1 行，`finc_pb_mrq: null`，**退出 0** |
| `--indicator qte_close --date 2027-01-04`（未来日期） | 1 行，`qte_close: null`，**退出 0** |
| `--indicator qte_close --indicator not_a_real_code`（有对照物） | `100003 指标 not_a_real_code 不存在` |
| `--indicator not_a_real_code`（**无对照物**） | `100003 指标 not_a_real_code 不存在` ← 同样报错 |
| `--indicator qte_close --security 999999.SH` | `100003 999999.SH 不是有效证券或者板块ID` |

**代码写错一律报错、且消息里带上那个代码**，无论同批有没有别的正确代码——不用靠「和一个已知有数的标的一起查」推断是哪个写错了。**空表不表示无数据**（无数据是占位单元格）：空表多半是参数名写错或日期语义用错，见本文末尾「空结果排查顺序」。

**「和一个已知有数的标的一起查」这套对照法不必要**——缺数据一眼可见。仍要留意的是**日期语义**（见上方 🔴 段）：日期用错时整批返 `null`，形态与「真的没覆盖」一样。

> CLI 侧仍保留 `partial` + `omittedIndicators` / `omittedSecurities` + 退出码 3 的差集检测，但在当前服务端行为下基本收不到样本（错代码在服务端就被拒了）。留着是为了万一服务端回退时还有兜底，不影响正常使用。

`screener` 上指标码写错同样直接报 `100003`，不会再走到「缺列」那条路。CLI 的缺列判据（按表达式布尔结构判，整个表达式再无可成立分支 → 退出码 1 且不输出；仍有分支可求值如 `F1 || F2` 只缺 F1 → `partial` + 退出码 3）保留作兜底。

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
| `100001` | **缺少必填参数**：如 `universe` 没传 | 补齐 `--indicator`/`--security` |
| `100003`@400 | 入参/表达式错误：`time-series` 传了「多指标 × 多证券」、`expression` 引用未声明变量、`indicatorParamList` 的 code 不在 `indicatorCodeList` 里 | 按 msg 改；多 × 多改用 `cross-section`。CLI 已在本地拦截「表达式引用未绑定变量」，不会白发一次请求 |
| `140002`@500 | **终态参数错**：指标必填参数缺失、枚举越界（如「参数 adjustType 的值 99 不在有效范围内 [1,2,3,4]」）、表达式语法错误 | **不重试**（CLI 已把 140002 列为终态码）。读 `search --format json` 的 `parameterList` 改参数名/取值 |
| `999999` | 系统故障。「无数据」不用此码，所以它基本只剩真故障。⚠️ 别把它和空表混为一谈：无数据是占位单元格（统一 `null`），空表表示整轴 code 未识别或参数名写错 | CLI 对 indicator 端点**不重试此码**；确认参数无误仍报错就是服务端问题 |
| `110003` | **超出账号数据权限的时间范围**。窗口按**账号**配、不按接口配——`cross-section` / `time-series` / `screener` 同界，`quote day-kline` 也在同一条界上 | 把日期移进范围；整段区间都早于下界时缩短窗口无用，**换接口绕不过去**，要更长历史联系客户经理开通 |
| `130001`（旧 `410004`） | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 必填参数（`140002` 的根因）

相当一部分指标缺必填参数时会报 `140002`。**先完成语义 + `scopeList` + `parameterList` 三项校验；其中凡 `required:true` 的参数都用 `--indicator-param "指标code:参数=值"` 补上。** 三类高频必填参数：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"`；部分还需配**年报日期**才出数（如 `finc_roe_avg_avg` 用季末日期为空、用年报日期有数） |
| `sDate` | 区间类的**起始日**（如 `qte_vol_intvl` 区间成交量、`qte_avg_vol` 区间日均成交量），格式 `yyyy-MM-dd` | `--indicator-param "qte_vol_intvl:sDate=2024-01-02"`。⚠️ **`sDate` 不能替代 `tradeDate`**——它是区间起点，`tradeDate`（=区间终点）仍是 required，`--date` 会照常下发。区间起始日的参数名就是 `sDate`，写成 `startDate` 会报 `100003 不支持参数 startDate`。⚠️ **不传 `sDate` 不报错**——它是可选参数，缺了就按默认区间算，所以要的是特定区间就必须显式传。另：`qte_amp_mo`（月振幅）等周期变体只吃 `tradeDate`，没有起始日参数 |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |
| `industryType` + `industryLevel` | `scr_indu` 所属行业（两个都 required，缺任一报 `140002`） | `--indicator-param "scr_indu:industryType=1" --indicator-param "scr_indu:industryLevel=0"` |

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

**融资融券（21 个 `mgn_*`）**——`scopeList` 只有 **A 股**（港/美股返 `null`）：

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

**行业分类 `scr_indu`（所属行业）**——一个指标覆盖四套体系，A/港/美股均支持，返回**字符串**：

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

**行业组合指标（3 个）**——把体系写进指标编码，省掉 `industryType`：

| 指标 | 体系 | 参数 |
| :-- | :-- | :-- |
| `scr_indu_citic` | 中信行业 | `tradeDate`（必填）+ `industryLevel`（**可选**） |
| `scr_indu_sw` | 申万行业 | 同上 |
| `scr_indu_gics` | GICS 行业 | 同上 |

```bash
gangtise indicator cross-section --indicator scr_indu_citic --indicator scr_indu_sw \
  --security 600519.SH --date 2026-08-13
```

与 `scr_indu` 的取舍：**只要一套体系就用组合指标**（少一个必填参数，且 `industryLevel` 可省），**要在同一次请求里横比多套体系**才用 `scr_indu`（换 `industryType` 即可，不必记三个编码）。恒生体系没有组合指标，仍走 `scr_indu:industryType=3`。

**`finc_pb_mrq`（市净率 MRQ）是日频指标**：每个交易日都有数且逐日变动，别按报告期末取（那会拿到几个月前的陈值）。

## 取数最佳实践

- **先 search 做三项校验**：看 `indicatorName` + `description` 确认语义和口径，看 `scopeList` 确认覆盖全部目标市场 / 证券类型（并看 `usageRestriction` 有无接口限制），再看 `parameterList` 补齐必填参数（required）并核对专属参数**名称**与枚举（`adjustType`/`scale`/`currency` 等）；任一不符就回退专用接口。**参数名一律以 search 返回的 `parameterList` 为准，不要照抄任何示例里的参数名**——参数名会随版本调整，写错会报 `100003` 并指出是哪个指标的哪个参数，按报错改即可。
- **`scopeList` 声称覆盖 ≠ 每只都有数**：`finc_pb_mrq` 的 `scopeList` 写着 A股+港股，港股只有部分有数——它是**部分覆盖**，既不能当「全覆盖」也不能当「无覆盖」。**判断成本很低**：无覆盖会留下占位单元格（行列都在，跟同批查了什么无关），抽查一行即可判定，不用再靠对照组反推。跨市场批量取数后仍建议**逐市场抽查一行**，别默认 scopeList 就是事实——反过来也一样，**否定结论同样会过期**。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务报表类（`bs_`/`is_`/`cf_`/`div_`/`shr_`，以及 description 明确按报告期统计的 `finc_`）→ 多数用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`，无需是交易日）。🔴 **但 `_ttm` 后缀是整族例外，必填 `tradeDate`**——`is_*_ttm` / `cf_*_ttm` / `div_cash_ttm` / `finc_*_ttm` 一律走交易日。**一眼验证**：在一个**非报告期末的普通交易日**直接 `--date` 取 `is_op_rev_ttm`，照样返真值；反过来给它传 `reportDate` 会报 `100003 不支持参数 reportDate; 缺少必填参数 tradeDate`。同族对照：普通 `is_op_rev` 只传 `--date` 则报「不支持参数 tradeDate; 缺少必填参数 reportDate」——**两者恰好相反**。**所以前缀只是提示，判据仍是上面 `--date` 那条：读 `parameterList` 里必填的是哪个，别按 code 前缀推断**
  - 日频估值类（如 `finc_pe_ttm` / `finc_pb_mrq`）→ 用最新已入库的**交易日**。⚠️ `finc_pb_mrq` 是**日频**的：任意交易日都有数且逐日变动。**别用季度末日期**——那会拿到几个月前的陈值（季末值与当日值可差 10% 以上，估值指标上就是错数）。别因 code 都以 `finc_` 开头就一律套报告期末，按 `description` 与抽查区分
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情类（`qte_` 等）→ 用**交易日**，但常规行情仍应改走 `quote`
- **混合日期语义要拆查询**：同时要“某报告期营收 / EPS”和“估值 PE / PB”时，按各自有效日期分别调用 `cross-section` 再按 `security` 合并（财务=报告期末、PE/PB=最新交易日）；不要把不同日期语义的指标塞进同一个 `--date`
- **探索性取数**：缺值会保留行列并给占位单元格（含 1×1 的最简形态），占位值统一为 `null`；code 写错会直接报 `100003`，不会伪装成缺值。看趋势用 `time-series` + 覆盖报告期的区间，但不能把缺值当成通过语义 / scope 校验。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询做失败拆分**：某指标**缺必填参数**或入参错误时会整批报 `140002`，逐指标单查能定位是哪个指标缺参/不可查。留意 stderr 的「整列/整行被略过」警告——那不是报错，而是**有 code 没被服务端认出来**，先查拼写和证券后缀。
- **市值量纲**：`qte_mkt_cptl`（总市值）与 `shr_tot`（总股本）**A/港/美股均有数**；**默认返原始「元」**（茅台 ≈ `1.7e12`，即 1.7 万亿），别误当天文数字。用 `scale` 数字码缩放（`0`元 / `3`千 / `4`万 / `6`百万 / `8`亿 / `9`十亿——`scale=8` → `16883` 亿元）、`currency` 换币种（**大写** `DFT`本币 / `CNY` / `HKD` / `USD` …）。**跨证券比市值前先统一 `scale`+`currency`**。
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

判别方法（**已核对的是 `finc_pe_ttm` / `peTtm`**）：用**总市值 ÷ PE 反推隐含净利润**，再分别对照利润表原披露与重述后的滚动 TTM（= 上年全年 − 上年同期累计 + 本年累计），能精确复现哪一版就是哪一版。`finc_pb_mrq` 等非 TTM 口径的指标同样会在报告期节点变化，但分母是净资产（MRQ）不是 TTM，切换规则未单独核对——分叉时按同法反推净资产对照资产负债表。

⚠️ **时点对齐用三大报表的 `earliestAnncDate`（首次公告日），不要用 `announcementDate`**——后者是返回数值所属公告的日期，被重述过的报告期显示的是重述公告日。`--report-type consolidated` 对重述过的期返回的也是重述后数值（与 `consolidatedRestated` 相同），要「当时披露的原始数」需以 `earliestAnncDate` 为时点自行核对公告；交叉核实披露日查 `insight announcement list`。

## 通用说明

- **发现流程**：`indicator search --format json` → 核对 `indicatorName` + `description`、`scopeList`（含 `usageRestriction`）、`parameterList`（**参数名以此为准**）→ 三项都通过才用 `cross-section` / `time-series` / `screener`
- **积分**：`search` 免费；`cross-section` / `time-series` / `screener` 按请求单元格数量计费，标价为每 100 单元格 A 股 0.05 / 港股 0.1 / 美股 0.2 积分，每次查询不足 100 单元格按 100 计
- **空结果排查顺序**：真无数据会返回占位单元格（统一 `null`）而不是空表，所以**空表基本等于「没有任何 code 被认出来」或参数名写错**。按序排查：① 证券代码与后缀对不对（美股 `.O`/`.N`，不是 `.US`）② 指标 code 拼写对不对 ③ 参数名对不对（`indicator search` 的 `parameterList`）④ 日期语义对不对（`tradeDate` vs `reportDate`——报告期类指标日期用错会整批返 `null`，看着像「没数据」）
- **数据权限**：正式账号行情 / 财务 / 指标类可回溯的年限按服务等级而定，试用账号更短。这个时间窗口按**账号**配、不按接口配——三个 EDE 接口同界（`quote day-kline` 也在同一条界上），撞界统一返 `110003`，**换接口绕不过去**；整段区间都早于下界时缩短窗口无用，要更长历史联系客户经理开通
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
