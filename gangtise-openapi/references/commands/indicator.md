# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序 / 条件选股）

> 本组覆盖 `/application/open-indicator/*`：证券级**数据指标**的检索与取数，主要用于多证券批量取已实现财务 / 估值指标。即使能搜到收盘价、成交量等行情指标，常规行情与 K 线仍走免费的 `quote`。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode` 和 `parameterList`**，绝不猜测指标编码或参数名——参数名写错不会报错，而是按该参数的默认值取数，结果看着正常但口径不对。

## EDE 与专用接口的优先级

| 请求形态 | 优先接口 |
| :--- | :--- |
| 单证券的财务 / 股东 / 主营，或 A股单证券估值 | 对应 `fundamental` 专用命令；多数免费，且字段口径固定 |
| 多证券批量取一组**已实现**财务 / 估值指标 | 先 `indicator search`，通过下方三项校验后用 `cross-section` / `time-series` 一次拉取，避免逐只循环 |
| A股盈利预测 / 一致预期（含预测 EPS） | `fundamental earning-forecast`；EDE 搜到的基本 / 稀释 EPS 是已实现值，不能替代预测 |
| A股估值历史分位 | `fundamental valuation-analysis` |
| **估值指标的历史序列**（分位 / 回测 / 择时） | 两个接口口径不同、都要交叉核——EDE 按正式财报披露日切换财报口径，`valuation-analysis` 按业绩快报切，见下方专门小节 |
| 开高低收 / 成交量等行情与 K 线 | `quote`；免费且支持多证券批量 |
| 单证券三大报表全部科目 | 对应 `fundamental` 利润表 / 资产负债表 / 现金流量表命令 |

EDE 不是“搜到就优先”。取数前必须核对：① `indicatorName` + `description` 与目标语义一致；② `scopeList` 覆盖**全部**目标市场和证券类型；③ `parameterList` 的必填参数与枚举可满足。`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退上表的专用接口；专用接口也不支持目标市场时，如实说明当前 CLI 无可用口径，不能用其他语义代替。实测 `valuation-analysis` / `earning-forecast` 仅支持 A 股，港 / 美股的**估值历史分位**与**盈利预测**当前无可用口径。但**估值指标本身别照抄旧结论**：`finc_pe_ttm`(PE TTM) 2026-08-03 起港股已有数（腾讯 16.15 / 泡泡玛特 14.93），`finc_pb_mrq`(PB MRQ) 仍只有 A 股。⚠️ **本文里所有「仅 A 股」「无数据」这类否定结论都只是某个时点的抽查**——服务端在持续补数据，正面结论过期会给错数，负面结论过期则会让你白白拒掉一个现在能跑的查询（不报错、不告警，只是少调一次）。**一律以当次 `scopeList` + 抽查为准，本段结论截至 2026-08-03。**`search` 免费，EDE 取数按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`。

## 指标搜索 `indicator search`

```bash
gangtise indicator search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：按指标名称模糊匹配。用具体词，如 `营业收入` / `基本每股收益` / `市盈率` / `总市值`，**不能用整句白话**（"我想查一批公司的财务估值" ✗）
- `--limit`：返回条数上限，默认 50，最大 100
- 默认 `--format table` 只适合浏览名称；正式路由 / 取数前必须加 `--format json`，才能完成语义、`scopeList`、`parameterList` 三项校验
- 返回字段：`indicatorCode` / `indicatorName` / `description`（算法与口径）/ `scopeList`（该指标适用的市场 + 证券类型 + `usageRestriction`）/ `parameterList`（可传的 `--indicator-param` 参数名及枚举）/ `score`
- **市场范围按指标判断**：`scopeList` 会返回实际覆盖范围，且指标之间不同；不能笼统写成每个指标都覆盖 A / 港 / 美股。覆盖面在持续扩，别把抽查结论当常量：截至 **2026-08-03** 实测 `qte_mkt_cptl`/`shr_tot` 已覆盖 A/港/美股，`finc_pe_ttm` 覆盖 A/港股，`finc_pb_mrq` 仍只有 A 股，`is_op_rev_ttm`/`is_shnp_ttm` 覆盖 A/港股。目标列表含任一 scope 外证券时，本批 EDE 校验不通过，应回退专用接口
- **`scopeList[].usageRestriction`**：该指标在具体接口上的限制，`null` = 无限制。⚠️ **它是提示不是硬约束**——标着「不支持指标时间序列接口」的 `qte_vol_intvl` 实测调时序照样返数据、不会被拦下（2026-08-02）。当成「口径可能不对、结果别当真」看，别指望它会报错
- ⚠️ **`scopeList` 是声明不是保证**：它可能**超前于数据**——`finc_pb_mrq` 声称覆盖 A股+港股，实测港股仍无数据（复测 2026-08-08）。反过来也发生过：`qte_mkt_cptl`/`shr_tot` 在 08-02 时声称覆盖港/美股却无数据，08-03 数据补上了。**2026-08-08 起判断成本降了**：无数据会保留行列、给一个占位单元格，不再因「同批还查了什么」变成整列/整行消失，所以抽查一行就能看出覆盖情况。⚠️ **但占位值不统一**——多数指标是 `null`，个别是 `0`（详见下方「缺数据 vs 代码写错」）
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
- `--date`（**必选**）：数据日期 `yyyy-MM-dd`。**CLI 把它下发为每个指标各自的 `tradeDate`**（2026-08-01 起服务端取消了根级 date）。日期语义按指标分两类——财务报表指标=报告期末（可为非交易日，实测 `2024-03-31` 可取数）、`finc_pe_ttm` / `finc_pb_mrq` 等日频估值=交易日（详见下方「日期路由」）
  - `--date` 必填是 CLI 的**护栏**，不是协议要求：`cross-section` 本身接受 `indicatorParamList: []`（无参指标如 `pty_op_scope` 照常返值，实测 2026-08-02）。但绝大多数指标吃 `tradeDate`，漏传就是一张空表且退出码 0，所以宁可多带一个无害参数。（`screener` 的 `--date` 也必填，同理）
  - 吃 `reportDate` 的指标可以显式传：`--indicator-param "code:reportDate=2024-12-31"`。这类指标**过去**收到 `tradeDate` 会静默返回空结果，**2026-08-08 复测已修复**——服务端会把 `tradeDate` 归一到所在报告期，`is_op_rev_mom` 两种传法都返 33.4903（@2026-03-31）。显式传 `reportDate` 仍是更稳的写法（语义明确、能扛回滚）。CLI 检测到你已为某指标传了 `tradeDate` 或 `reportDate` 就不再注入 `--date`
  - `sDate`（区间起始日）**不算**替代日期：它和 `tradeDate` 共存（`tradeDate` 是区间终点且 required），传了 `sDate` 后 `--date` 照常下发
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`（**大写**，2026-08-01 起服务端枚举已统一大写）
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
  - ✅ **根级 `--scale` 污染已修复**（2026-08-08 复测）：过去根级 `--scale 8` 会把不支持 scale 的 `qte_close` 收盘价缩成 `0`；现在只作用于支持该参数的指标——`qte_close` + `qte_mkt_cptl` 混查加 `--scale 8`，收盘价照旧 1309.22、总市值正确缩到 16366.3183（亿）。价格类和金额类可以放心混查了。要精确控制到单个指标仍可用 `--indicator-param "code:scale=8"`
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `security / name / <各指标名>…`。**没有 `date` 列**——查询日期现在挂在每个指标自己的参数上，各列可以是不同日期
- **`--key-by name|code`**（默认 `name`）：指标列头用显示名还是 `indicatorCode`。**批量按 code 回填必用 `--key-by code`**——指标名会碰撞（多个指标同显示名，如 `cf_finc_exp`/`_qtr` 都叫「财务费用」），唯有 code 唯一（行轴 `security` 本就是 code，`code` 模式整表可按 code 寻址，免去 raw API 手工回填）。顺序本身现在是稳的（服务端曾随机重排），但**两个轴的排法不一样**，2026-08-08 复测：`indicatorList` **= 请求顺序**（请求 `qte_vol,qte_close` 就回 `qte_vol,qte_close`）；`securityCodeList` **是按代码升序重排的，不是请求顺序**（请求 `000858,600519,000001` → 回 `000001,000858,600519`，连跑 3 次一致）。所以**行序绝不能按请求下标对位**，一律按 `security` 字段取值

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
- ⚠️ **同一 `indicatorCode` 挂多套参数：截面和时序都不支持，这是设计如此，要拆成两次调用**。只有 `screener` 支持（它把指标绑到不同变量 `F1`/`F2` 上，天然可区分）。CLI 也表达不了该请求——`--indicator-param` 按 code 建 Map，同 code 的多组参数会被合并成一组，与服务端设计一致。🔴 **但服务端的失败是静默的**：真发出去它会**取最后一组**、丢弃其余且不报错（raw 实测 `adjustType` `[2,3]` 返后复权 13609.6168、`[3,2]` 返前复权 1531.225，量级差 9 倍）。所以走 `raw call` 时务必自己保证同 code 不重复
- `--calendar-type`：日期类型 `ND`(自然日)/`TD`(交易日,默认)/`WD`(工作日)。`TD` 且跨市场时，`date` 列是各市场交易日的**并集**
- `--currency` / `--scale`：同 `cross-section`（含根级 `--scale` 的污染坑）
- **输出（宽表）**：每行一个日期，列为 `date / <各序列名>…`；序列在「单指标」时是各**证券**，在「单证券多指标」时是各**指标**。**板块 ID 算多证券**——传 1 个 `sectorId` 服务端会展开成 N 只成分股，列就是这 N 只（实测中信白酒 → 19 列）
- **`--key-by name|code`**（默认 `name`）：同 `cross-section`；`code` 模式下单证券列=各 `indicatorCode`、多证券列=各 `securityCode`，批量按 code 回填用它
- ⚠️ 部分指标标注**不支持时序接口**：`search` 返回的 `scopeList[].usageRestriction` 会写明（如「不支持指标时间序列接口」），`null` 表示无限制。**但它不是硬约束**——实测 `qte_vol_intvl` 带着该标注调时序照样返回数据，不会被拦下。把它当"口径可能不对、结果别当真"的提示，而不是"会报错"的保证

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
- `--date`（**必选**）：下发为**每个**指标的 `tradeDate`（已带 `tradeDate`/`reportDate` 的不覆盖）。绝大多数指标吃 `tradeDate`，漏传就是一张空表且退出码 0，所以必填。对无参指标（如 `pty_op_scope`）多挂一个 `tradeDate` 无害，因此不做例外
- `--indicator-param`：格式是 **`F1:key=value`（按变量，不是按 code）**。引用了没绑定的变量会直接报错，不会静默丢弃
- `--expression` 里引用未绑定的变量，CLI **本地就拦**（不发请求、不计费）；服务端也会报 `100003`
- **输出（宽表）**：同 `cross-section`，每行一只**命中**的证券，列为 `security / name / <各指标名>…`；无命中返回空表
- **积分**：与 `cross-section` 同价（按单元格计），但计费基数是**筛选前**的范围 × 指标数，别拿全市场板块随手试

### 同一指标绑多个变量：已可用（2026-08-08 修复）

把同一个 `indicatorCode` 绑到多个变量、各带不同参数，是**受支持的用法**——典型场景是「同一个价格的两个日期」做跨期比较：

```bash
# 茅台：08-07 收盘价 vs 08-06 收盘价，两列各自取到自己那天的值
gangtise indicator screener --indicator F1:qte_close --indicator F2:qte_close \
  --indicator-param "F1:tradeDate=2026-08-07" --indicator-param "F2:tradeDate=2026-08-06" \
  --security 600519.SH --expression "F1 > F2" --date 2026-08-07
# 日收盘价 (F1)=1309.22 / 日收盘价 (F2)=1308.55，与 time-series 对照一致
```

服务端**曾经**把这些绑定全部按其中最早的那个日期取数、值落到第一列其余置 `null`，还有约 1/3 概率返回空集，CLI 为此标过 `unreliable` + 退出码 3。**2026-08-08 复测已修复**（连跑 5 次值都正确且稳定），CLI 的 `unreliable` / `duplicatedIndicators` 标记与警告**已一并移除**——现在这类结果直接可用。列头会按变量加后缀区分（显示名相同）。

> 同期修复的还有：`contains` / `notcontains` 曾要求指标带参数才生效（官方招牌示例 `F3 contains '酒'` 因 `parameters: []` 0 命中，2026-08-03 修复），以及运算符大小写敏感（`CONTAINS` 曾报语法错，2026-08-08 复测大写/混合大小写均正常，19 只全部命中）。

```bash
# 文本筛选：白酒板块里经营范围含「酒」的公司
gangtise indicator screener --indicator F1:pty_op_scope \
  --security 1000000287 --expression "F1 contains '酒'" \
  --date 2026-07-31 --format table   # 19 只全部命中
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
  - ⚠️ **参数名是 `adjustType`**（不是 `adjustmentType`）。写错名不会报错，会按默认值 `1`（不复权）取数——实测错名返回 1685.01、正确的 `adjustType=3` 返回 13609.6168，前者看着正常其实口径不对
  - 前复权以最新交易日为基准，所以在**最新交易日上前复权价 == 不复权价**；验证复权是否生效要用历史日期
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- **参数名与取值一律以 `indicator search --format json` 的 `parameterList` 为准**，不要照抄任何文档里的示例名——参数名会随版本调整，且写错是按默认值取数而非报错。币种枚举**统一大写**（`DFT`/`CNY`/`HKD`…），小写形式不生效
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

**缺数据 vs 代码写错（2026-08-08 服务端改版，判据整个换了）**：

**缺数据一律保留行列并给一个占位单元格**，连单指标 × 单证券的 1×1 缺口也有行有列、不是空表。判据是**代码认不认识**，跟有没有数据无关：

> 🔴 **占位值不统一，而且由指标决定——这一条会直接毁掉筛选和聚合结果**
>
> 多数指标缺数据填 `null`，但**个别指标填 `0`**，其中最常用的是 `is_dnrpnp`（扣非归母净利润）。同一天同一只股票：`is_dnrpnp` 给 `0`、`is_op_rev` 给 `null`。**与日期对不对无关**——日期完全正确（报告期末）时，覆盖不到的证券（如美股）同样给 `0`：同一次请求里茅台、泡泡玛特返真值，苹果、微软的 `is_dnrpnp` 返 `0`、`is_op_rev` 返 `null`，四行都在、无告警、退出码 0。
>
> **`0` 会照常穿过比较与比率计算**，`null` 不会。实测 `screener`（`F1 = is_dnrpnp`，三只 A 股）：
>
> | 表达式 | 非报告期末日期 | 报告期末日期 |
> | :--- | :--- | :--- |
> | `F1 > 0` | **命中 0 只** | 命中 3 只 |
> | `F1 < 50亿` | **命中 3 只**（值全是 `0`） | 命中 1 只 |
>
> 只换了日期，两个条件的结果全部反转，全程不报错。「扣非净利 > 0 筛出空集」会被读成「没有盈利的股票」。
>
> **时序上更难躲**：报告期类指标按日返回，只有报告期末那几行是真值，其余是占位。`is_op_rev` 的 `null` 通常被聚合跳过、均值仍然对；`is_dnrpnp` 的 `0` 会被算进去——茅台 5 个月 104 行里 102 行是 `0`，整列求均值比正确值低 50 倍以上。而**时序没有任何参数能让它只返回报告期末**（传 `tradeDate`/`reportDate` 都会被拒）。
>
> **怎么办**：① 报告期类指标一律把日期落在**报告期末**（`2025-03-31` / `06-30` / `09-30` / `12-31`）；② 拿 `is_dnrpnp` 这类做筛选或聚合前，先单查一次确认不是占位；③ **别对时序整列直接求均值 / 求和**，先按报告期末取子集。

| 情况 | 服务端怎么返 | CLI |
| :--- | :--- | :--- |
| 代码有效、但**无数据 / 无覆盖 / 非交易日 / 未来日期** | 占位单元格（多数 `null`，个别指标 `0`，见上），行列都在 | **退出 0**，不标 partial |
| **指标码无法解析**（拼错、不存在） | 该指标整列从 `indicatorList` 消失 | `partial` + `omittedIndicators` + **退出 3** |
| **证券码无法解析**（拼错、后缀错，如 `AAPL.US`） | 该证券整行从 `securityCodeList` 消失 | `partial` + `omittedSecurities` + **退出 3** |
| 请求里**没有任何**可解析的代码 | 四个数组全空（`Total: 0`） | **退出 0** + stderr 提示，因为无从判断是哪一轴写错了 |

2026-08-08 实测：

| 查法 | 服务端返回 | CLI |
| :--- | :--- | :--- |
| `--indicator finc_pb_mrq --security 09992.HK`（港股无 PB 数据） | 1 行，`finc_pb_mrq: null` | **退出 0** |
| `--indicator mgn_bal --security 00700.HK`（融资融券仅 A 股） | 1 行，`mgn_bal: null` | **退出 0** |
| `--indicator qte_close --date 2027-01-04`（未来日期） | 1 行，`qte_close: null` | **退出 0** |
| `--indicator qte_close --security AAPL.US --security AAPL.O` | 只回 `AAPL.O` | **退出 3** + `omittedSecurities: ["AAPL.US"]` |
| `--indicator qte_close --indicator not_a_real_code` | 只回 `qte_close` 一列 | **退出 3** + `omittedIndicators: ["not_a_real_code"]` |
| `--indicator not_a_real_code --security 999999.SH` | 全空 | **退出 0** + stderr 提示 |

**这是个净收益的变化**：`partial` / 退出码 3 从「这批数据不完整」变成了**「你有代码写错了」**——后者原本是完全静默的（退出 0、表看着正常、`--key-by code` 回填时 key 直接不存在）。反过来，真实的覆盖缺口现在也留在表里（就是那个占位单元格），不再需要「和一个已知有数的标的一起查」这种对照法。⚠️ 但**占位值多数是 `null`、个别是 `0`**（见上方 🔴 段），`0` 那一档并不「一眼可见」——它长得和真值一样。

⚠️ **但这个检测需要同批里有对照物**：拼错的 code 必须和至少一个能解析的 code 同批，差集才算得出来。**整个轴都写错时（最常见的就是只查一个指标、而它拼错了）响应是空表、退出码 0**，只有 stderr 提示。所以「空表」现在的第一嫌疑就是拼写和后缀，不是没数据。

`screener` 的缺列判据同理：变量绑的指标码认不出来 → 该列不返回 → 按表达式布尔结构判，整个表达式再无可成立分支 → **退出码 1 且不输出**；仍有分支可求值（如 `F1 || F2` 只缺 F1）→ `partial` + 退出码 3。

⚠️ **退出码 1 那一档有个前提：服务端得先返回了命中行**。零命中时没有任何行需要被质疑，走的是「nothing matched」提示 + **退出码 0**——即使表达式里的变量整个求不了值也一样（实测 `F1:not_a_real_code` 单绑、以及 `F1 > 0 && F2 > 0` 其中 F2 无效，都是空集 + 退出 0）。所以**空集不能当成「条件成立但没标的符合」**，先核对指标码拼写。

标 `partial` 的那档会在 stderr 打印被略过的 code（`--format json` 下 stdout 仍是干净 JSON）。脚本按 `!= 0` 判失败的要注意：3 表示「有数据但不完整」，不是硬失败。

取数报错主要是这几个码：

| 错误码 | 实际含义 | 怎么办 |
| :--- | :--- | :--- |
| `100001` | **缺少必填参数**：如 `universe` 没传 | 补齐 `--indicator`/`--security` |
| `100003`@400 | 入参/表达式错误：`time-series` 传了「多指标 × 多证券」、`expression` 引用未声明变量、`indicatorParamList` 的 code 不在 `indicatorCodeList` 里 | 按 msg 改；多 × 多改用 `cross-section`。CLI 已在本地拦截「表达式引用未绑定变量」，不会白发一次请求 |
| `140002`@500 | **终态参数错**：指标必填参数缺失、枚举越界（如「参数 adjustType 的值 99 不在有效范围内 [1,2,3,4]」）、表达式语法错误 | **不重试**（CLI 已把 140002 列为终态码）。读 `search --format json` 的 `parameterList` 改参数名/取值 |
| `999999` | 系统故障。2026-08-01 起「无数据」不再用此码，所以它基本只剩真故障（2026-07-26 曾出现 EDE 取数端全线 999999，08-01 已恢复）。⚠️ 别把它和空表混为一谈：无数据现在是占位单元格（多数 `null`、个别指标 `0`），空表表示整轴 code 未识别 | CLI 对 indicator 端点**不重试此码**（v0.27.0）；确认参数无误仍报错就是服务端问题 |
| `110003` | **超出账号数据权限的时间范围**。⚠️ EDE 三个接口不一致：截面 / 时序已放宽（本机到 2016-01-01），**`screener` 仍卡 today−3 年滚动**（实测 2023-08-07 报错、2023-08-08 通过；同日同指标同证券 `cross-section` 正常出数） | 把日期移进范围；`screener` 撞界时改用 `cross-section` 拉数再本地筛 |
| `130001`（旧 `410004`） | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 必填参数（`140002` 的根因）

相当一部分指标缺必填参数时会报 `140002`。**先完成语义 + `scopeList` + `parameterList` 三项校验；其中凡 `required:true` 的参数都用 `--indicator-param "指标code:参数=值"` 补上。** 三类高频必填参数：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"`；部分还需配**年报日期**才出数（实测 `finc_roe_avg_avg`@`2026-03-31` 空、@`2025-12-31` 有） |
| `sDate` | 区间类的**起始日**（如 `qte_vol_intvl` 区间成交量、`qte_avg_vol` 区间日均成交量），格式 `yyyy-MM-dd` | `--indicator-param "qte_vol_intvl:sDate=2024-01-02"`。⚠️ **`sDate` 不能替代 `tradeDate`**——它是区间起点，`tradeDate`（=区间终点）仍是 required，`--date` 会照常下发。区间起始日的参数名是 `sDate`；写成 `startDate` 不存在、会被忽略（茅台实测：296 万 vs 正确 4673 万）。另：`qte_amp_mo`（月振幅）等周期变体现在只吃 `tradeDate`，没有起始日参数 |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |
| `industryType` + `industryLevel` | `scr_indu` 所属行业（两个都 required，缺任一报 `140002`） | `--indicator-param "scr_indu:industryType=1" --indicator-param "scr_indu:industryLevel=0"` |

> `paramValue` 一律按**字符串**约定传（`periodNum=4` 内部即 `"4"`，CLI 已处理）。

### 2026-08-07 新增指标

**融资融券（21 个 `mgn_*`）**——`scopeList` 与实测都只有 **A 股**（港/美股返 `null`）：

| 维度 | 当日 | 区间 |
| :--- | :--- | :--- |
| 两融合计 | `mgn_bal` 融资融券余额 | `mgn_bal_avg_intvl` 区间均值 |
| 融资 | `mgn_fin_bal` 余额、`mgn_fin_buy` 买入额、`mgn_fin_repay` 偿还额 | `mgn_fin_bal_avg_intvl`、`mgn_fin_buy_intvl`、`mgn_fin_repay_intvl` |
| 融券 | `mgn_sl_bal` 余额、`mgn_sl_qty` 余量、`mgn_sl_sell` 卖出额、`mgn_sl_sell_qty` 卖出量、`mgn_sl_repay` 偿还额、`mgn_sl_repay_qty` 偿还量 | `mgn_sl_bal_avg_intvl`、`mgn_sl_qty_avg_intvl`、`mgn_sl_sell_intvl`、`mgn_sl_sell_qty_intvl`、`mgn_sl_repay_intvl`、`mgn_sl_repay_qty_intvl` |
| 标的资格 | `mgn_flag` 是否融资融券标的（字符串「是」/「否」，可用 `screener` 的 `contains` 筛） | — |

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

体系与市场要配对：A 股查恒生 / GICS、美股查申万，都返 `null`（实测茅台 `industryType=3/4` 均为 `null`）。

**`finc_pb_mrq`（市净率 MRQ）修复**：过去只在报告期末打值，现在每个交易日都返数据（2026-08-02 起复测逐日变动，08-08 仍然如此）。

## 取数最佳实践

- **先 search 做三项校验**：看 `indicatorName` + `description` 确认语义和口径，看 `scopeList` 确认覆盖全部目标市场 / 证券类型（并看 `usageRestriction` 有无接口限制），再看 `parameterList` 补齐必填参数（required）并核对专属参数**名称**与枚举（`adjustType`/`scale`/`currency` 等）；任一不符就回退专用接口。**参数名以 search 返回为准，不要照抄文档示例**——服务端调过参数名，传错名是静默失效不是报错。
- **`scopeList` 声称覆盖 ≠ 真有数**：截至 2026-08-08，`finc_pb_mrq` 的 `scopeList` 写着 A股+港股，实测港股仍无数据。**2026-08-08 起这件事好查了一半**：无覆盖会留下占位单元格（行列都在，跟同批查了什么无关），抽查一行即可判定，不用再靠对照组反推。🔴 **但只有 `null` 那一档真的「一眼可见」**——`is_dnrpnp` 这类填 `0` 的指标，无覆盖和真值长得一模一样（美股实测：日期正确、行都在，`is_dnrpnp` 返 `0`、`is_op_rev` 返 `null`）。对填 `0` 的指标，抽查一行判不出覆盖，要拿一个已知有数的市场做对照。跨市场批量取数后**逐市场抽查一行**，别默认 scopeList 就是事实——反过来也一样，`qte_mkt_cptl`/`shr_tot` 在 08-02 还是港/美无数据、08-03 就补上了，**否定结论同样会过期**。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务报表类（`bs_`/`is_`/`cf_`/`div_`/`shr_`，以及 description 明确按报告期统计的 `finc_`）→ 用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`，无需是交易日）
  - 日频估值类（如 `finc_pe_ttm` / `finc_pb_mrq`）→ 用最新已入库的**交易日**。⚠️ `finc_pb_mrq` 是**日频**的：任意交易日都有数且逐日变动（茅台 `07-31`=6.2325、`07-22`=6.0221、`06-30`=5.4706、`03-31`=7.0634；五粮液/宁德时代同样）。**别用季度末日期**——那会拿到几个月前的陈值（茅台季末 7.0634 比当日 6.2325 高 13.5%，估值指标上就是错数）。别因 code 都以 `finc_` 开头就一律套报告期末，按 `description`/实测区分
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情类（`qte_` 等）→ 用**交易日**，但常规行情仍应改走 `quote`
- **混合日期语义要拆查询**：同时要“某报告期营收 / EPS”和“估值 PE / PB”时，按各自有效日期分别调用 `cross-section` 再按 `security` 合并（财务=报告期末、PE/PB=最新交易日）；不要把不同日期语义的指标塞进同一个 `--date`
- **探索性取数**：缺值会保留行列并给占位单元格（2026-08-08 起，含 1×1 的最简形态），但**占位值不统一**（多数 `null`、个别 `0`，见上）；整列 / 整行消失现在只意味着**那个 code 服务端不认识**。看趋势用 `time-series` + 覆盖报告期的区间，但不能把缺值当成通过语义 / scope 校验。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询做失败拆分**：某指标**缺必填参数**或入参错误时会整批报 `140002`，逐指标单查能定位是哪个指标缺参/不可查。留意 stderr 的「整列/整行被略过」警告——那不是报错，而是**有 code 没被服务端认出来**，先查拼写和证券后缀。
- **市值量纲（复测 2026-08-03）**：`qte_mkt_cptl`（总市值）与 `shr_tot`（总股本）**A/港/美股均已有数**（08-02 时港美股还是空的，服务端已补：泡泡玛特 2165.47 亿 / 腾讯 43207.64 亿 / 苹果 45128.55 亿）；**默认返原始「元」**（茅台 ≈ `1.7e12`，即 1.7 万亿），别误当天文数字。用 `scale` 数字码缩放（`0`元 / `3`千 / `4`万 / `6`百万 / `8`亿 / `9`十亿——`scale=8` → `16883` 亿元）、`currency` 换币种（**大写** `DFT`本币 / `CNY` / `HKD` / `USD` …）。**跨证券比市值前先统一 `scale`+`currency`**。
- **币种与汇率（复测 2026-08-01，已修复）**：`DFT`（原始币种）识别正确——A股=CNY、港股行情=HKD、美股=USD；汇率换算自洽（互逆且三角一致，误差 <0.003%）。⚠️ 但**同一只港股，行情类的原始币种是 HKD、财务类可能是 CNY**（如泡泡玛特财报以人民币计），跨市场比财务数据时显式传 `--currency CNY` 别依赖 `DFT`。另：财务类指标的汇率按**报告期**折算、行情类按查询日折算，两者隐含汇率会有细微差异，属正常口径差别。
- **EDE 财务指标的 `reportType`（2026-08-01 裁决）**：`enumList` 的 label 已与实际取数**一致**，按 label 传即可。⚠️ 但同一份 `search` 响应里的 `paramDescription` 仍留着**相反的旧映射文字**——**以 `enumList` 和下方实测值为准，别读 `paramDescription`**：

  | value | 口径 | 说明 |
  |-------|---------|------|
  | `1`（默认，省略即此值） | **合并报表** | 绝大多数场景要的就是这个 |
  | `2` | **合并报表（调整）** | 该报告期无重述数时为空 |
  | `3` | **母公司报表** | |
  | `4` | **母公司报表（调整）** | 该报告期无重述数时为空 |

  实测闭环（`is_tot_op_rev` + 中信证券 `600030.SH` FY2024 营业总收入，2026-08-01）：`1`→637.8922亿、`2`→581.19亿、`3`→321.924亿、`4`→321.924亿；与 `fundamental income-statement --security-code 600030.SH --fiscal-year 2024 --period annual` 返回的「合并报表」`totalOpRev = 63,789,215,688.23`（637.892亿）在 `1` 上完全吻合。取数值与 2026-07-24 的历史实测一致——**变的只是服务端 label，取数从未变过**。

  `2`/`4` 返回空值**不是枚举失效**，是该报告期尚无调整表（如最新年报 FY2025：`1`/`3` 有数、`2`/`4` 无值，与 `fundamental --report-type consolidatedRestated` 同期无数据一致）。港股默认口径同样是合并。

## 估值指标的历史序列：两个接口口径不同，要交叉核

> 🔴 **对照前先避开这个陷阱：两个接口在非交易日的行为不一样。**
>
> | 日期 | EDE `finc_pe_ttm` | `fundamental valuation-analysis` |
> | :-- | :-- | :-- |
> | 2026-08-07（周五） | 23.1374 | 23.1374 |
> | **2026-08-08（周六）** | **`null`** | **23.1374**（顺延上一交易日） |
>
> 拿非交易日做对照，会看到「EDE 全是 null、对照组搭不起来」，很容易误判成 EDE 没有这些数据——**其实只是它不给非交易日补值，而 `valuation-analysis` 补**。做交叉核对时**日期一律落在交易日上**；已经撞上的，换一个交易日重跑再下结论。


| 接口 | 财报口径切换时点 |
| :--- | :--- |
| `indicator time-series`（EDE） | **正式财报披露日** |
| `fundamental valuation-analysis` | **业绩快报**口径，通常更早 |

两者都是点时口径，只是切换时机不同，同一天取到的估值指标可能不一样。**做估值分位 / 回测时两个接口都拉一遍交叉核**，尤其业绩大幅变动的标的——抽查中出现过个别标的在 `valuation-analysis` 侧长期未更新、估值明显偏低的情况。

判别方法（**已验证的是 `finc_pe_ttm` / `peTtm`**）：用**总市值 ÷ PE 反推隐含净利润**，再对照利润表的滚动 TTM（= 上年全年 − 上年同期累计 + 本年累计），就能判出哪一侧用的是陈值。`finc_pb_mrq` 等非 TTM 口径的指标同样会在报告期节点变化，但分母是净资产（MRQ）不是 TTM，切换规则未单独验证——分叉时按同法反推净资产对照资产负债表。

⚠️ **不要用 `fundamental income-statement` 的 `announcementDate` 做时点对齐**——实测该字段会把季报的披露日填成年报披露日。要真实披露日请查 `insight announcement list`。


## 通用说明

- **发现流程**：`indicator search --format json` → 核对 `indicatorName` + `description`、`scopeList`（含 `usageRestriction`）、`parameterList`（**参数名以此为准**）→ 三项都通过才用 `cross-section` / `time-series` / `screener`
- **积分**：`search` 免费；`cross-section` / `time-series` / `screener` 按请求单元格数量计费，标价为每 100 单元格 A 股 0.05 / 港股 0.1 / 美股 0.2 积分，每次查询不足 100 单元格按 100 计
- **空结果排查顺序**：2026-08-08 起真无数据会返回占位单元格（多数 `null`、个别指标 `0`）而不是空表，所以**空表基本等于「没有任何 code 被认出来」或参数名写错**。按序排查：① 证券代码与后缀对不对（美股 `.O`/`.N`，不是 `.US`）② 指标 code 拼写对不对 ③ 参数名对不对（`indicator search` 的 `parameterList`）④ 日期语义对不对（`tradeDate` vs `reportDate`）
- **数据权限**：2026-08-07 起正式账号行情 / 财务 / 指标类由前溯 3 年放宽到**前溯 5 年**；试用账号按服务等级。⚠️ **同一账号下三个 EDE 接口的范围可能不一致**：本机实测扩展权限只落到 `cross-section` / `time-series`，**`screener` 仍是 today−3 年滚动**（2026-08-08 实测边界 2023-08-08；同日同指标同证券截面取得到、选股报 `110003`）。选股撞界时改用 `cross-section` 拉数再本地筛
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
