# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序 / 条件选股）

> 本组覆盖 `/application/open-indicator/*`：证券级**数据指标**的检索与取数，主要用于多证券批量取已实现财务 / 估值指标。即使能搜到收盘价、成交量等行情指标，常规行情与 K 线仍走免费的 `quote`。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode` 和 `parameterList`**，绝不猜测指标编码或参数名——服务端调过参数名（`adjustmentType` → `adjustType`），传错名是**静默失效**不是报错。

## EDE 与专用接口的优先级

| 请求形态 | 优先接口 |
| :--- | :--- |
| 单证券的财务 / 股东 / 主营，或 A股单证券估值 | 对应 `fundamental` 专用命令；多数免费，且字段口径固定 |
| 多证券批量取一组**已实现**财务 / 估值指标 | 先 `indicator search`，通过下方三项校验后用 `cross-section` / `time-series` 一次拉取，避免逐只循环 |
| A股盈利预测 / 一致预期（含预测 EPS） | `fundamental earning-forecast`；EDE 搜到的基本 / 稀释 EPS 是已实现值，不能替代预测 |
| A股估值历史分位 | `fundamental valuation-analysis` |
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
- **`scopeList[].usageRestriction`**：该指标在具体接口上的限制，`null` = 无限制。⚠️ **它是提示不是硬约束**——标着「不支持指标时间序列接口」的 `qte_vol_intvl` 实测调时序照样返数据、服务端不拦（2026-08-02）。当成「口径可能不对、结果别当真」看，别指望它会报错
- ⚠️ **`scopeList` 是声明不是保证**：它可能**超前于数据**——`finc_pb_mrq` 声称覆盖 A股+港股，实测港股无数据（2026-08-03）。反过来也发生过：`qte_mkt_cptl`/`shr_tot` 在 08-02 时声称覆盖港/美股却无数据，08-03 数据补上了。缺数据的**表现形式由证券、指标两个维度共同决定**（详见下方「缺数据的四种形态」）：只有当这只证券在同批还有别的指标有数、**且**这个指标对同批还有别的证券有数时，才是 `null` 单元格；否则是整列 / 整行消失（退出码 3）或整表为空。所以「有 `null` 就说明覆盖了」是错的，批量前抽查一行
- 美股代码用交易所后缀 `.O`(NASDAQ) / `.N`(NYSE)，**不是 `.US`**——实测 `AAPL.US` 查不到数据，须用 `AAPL.O`（官方示例里的 `AAPL.US` 是笔误）

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
  - `--date` 必填是 CLI 的**护栏**，不是协议要求：`cross-section` 本身接受 `indicatorParamList: []`（无参指标如 `pty_op_scope` 照常返值，实测 2026-08-02）。但绝大多数指标吃 `tradeDate`，漏传就是一张空表且退出码 0，所以宁可多带一个无害参数。（`screener` 的 `--date` 也必填，同理；那边曾另有一个「空 `parameters` 被丢弃」的服务端缺陷，2026-08-03 已修复，见下方缺陷表）
  - ⚠️ **吃 `reportDate` 的指标必须显式传**：`--indicator-param "code:reportDate=2024-12-31"`。这类指标收到 `tradeDate` 会**静默返回空结果**（不报错，实测 `is_op_rev_mom`）。CLI 检测到你已为某指标传了 `tradeDate` 或 `reportDate` 就不再注入 `--date`
  - `sDate`（区间起始日）**不算**替代日期：它和 `tradeDate` 共存（`tradeDate` 是区间终点且 required），传了 `sDate` 后 `--date` 照常下发
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`（**大写**，2026-08-01 起服务端枚举已统一大写）
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
  - ⚠️ **根级 `--scale` 会污染不支持 scale 的指标**：`qte_close` 的 `parameterList` 里没有 `scale`，但根级 `--scale 8` 会把收盘价 1350.6 缩成 `0`（实测 2026-08-01，与文档「根级参数仅对支持的指标生效」不符）。价格类和金额类指标混查时，别用根级 `--scale`，改用 `--indicator-param "code:scale=8"` 只作用于该指标
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `security / name / <各指标名>…`。**没有 `date` 列**——查询日期现在挂在每个指标自己的参数上，各列可以是不同日期
- **`--key-by name|code`**（默认 `name`）：指标列头用显示名还是 `indicatorCode`。**批量按 code 回填必用 `--key-by code`**——指标名会碰撞（多个指标同显示名，如 `cf_finc_exp`/`_qtr` 都叫「财务费用」）、服务端还会重排返回列序（实测请求 `qte_close,qte_vol` 回来是 `qte_vol,qte_close`），唯有 code 唯一且与顺序无关（行轴 `security` 本就是 code，`code` 模式整表可按 code 寻址，免去 raw API 手工回填）

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
- `--calendar-type`：日期类型 `ND`(自然日)/`TD`(交易日,默认)/`WD`(工作日)。`TD` 且跨市场时，`date` 列是各市场交易日的**并集**
- `--currency` / `--scale`：同 `cross-section`（含根级 `--scale` 的污染坑）
- **输出（宽表）**：每行一个日期，列为 `date / <各序列名>…`；序列在「单指标」时是各**证券**，在「单证券多指标」时是各**指标**。**板块 ID 算多证券**——传 1 个 `sectorId` 服务端会展开成 N 只成分股，列就是这 N 只（实测中信白酒 → 19 列）
- **`--key-by name|code`**（默认 `name`）：同 `cross-section`；`code` 模式下单证券列=各 `indicatorCode`、多证券列=各 `securityCode`，批量按 code 回填用它
- ⚠️ 部分指标标注**不支持时序接口**：`search` 返回的 `scopeList[].usageRestriction` 会写明（如「不支持指标时间序列接口」），`null` 表示无限制。**但它不是硬约束**——实测 `qte_vol_intvl` 带着该标注调时序照样返回数据，服务端不拦。把它当"口径可能不对、结果别当真"的提示，而不是"会报错"的保证

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

### 已知服务端缺陷（2026-08-03 复测，已报后台）

| 现象 | 影响 | 现在怎么办 |
| :--- | :--- | :--- |
| **同一 `indicatorCode` 绑到多个变量** → 整份结果不可信 | 服务端把这些绑定**全部按其中最早的那个日期**取数，该值落到它们的第一列、其余列 `null`（实测 `F1@07-31 + F2@07-30` → F1 列返回 07-30 的 1361.76，F1 自己的 1350.6 根本没出现）。所以**活下来的数字未必属于它标注的变量**；命中的证券集合同样不可信（针对 null 变量的条件等于没筛）；同一请求还有约 1/3 概率返回空集 | CLI 标 `unreliable: true` + `duplicatedIndicators` + **退出码 3**，并在 stderr 警告。**这类结果不能直接用于结论**，拆成两次 `cross-section` 再本地比 |
| ~~`contains` / `notcontains` 需要指标带参数才生效~~ | 官方文档的招牌示例 `F3 contains '酒'`（`parameters: []`）曾 0 命中 | **✅ 2026-08-03 服务端已修复**，`parameters: []` 现可直接用。CLI 仍无条件下发 `--date`（对无参指标无害、能扛回滚），此行仅作记录 |

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
  - ⚠️ **参数名是 `adjustType`，不是 `adjustmentType`**（官方文档示例写的 `adjustmentType` 是错的）。传错名服务端**静默忽略并退回不复权**——实测 `adjustmentType=3` 返回 1685.01（= 不复权），看着正常其实是错数据
  - 前复权以最新交易日为基准，所以在**最新交易日上前复权价 == 不复权价**；验证复权是否生效要用历史日期
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- **参数名与取值一律以 `indicator search --format json` 的 `parameterList` 为准**，不要照抄本文档或官方文档的示例名——服务端会调整参数名（`adjustmentType` → `adjustType` 就是一例），且传错名是静默失效而非报错。币种枚举 2026-08-01 起**统一大写**（`DFT`/`CNY`/`HKD`…），历史文档里的小写 `dft`/`cny` 已过时
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

**缺数据的四种形态（务必分清）**：

| 缺的范围 | 服务端怎么返 | 后果 |
| :--- | :--- | :--- |
| **部分**缺（某证券的某指标） | 该单元格 `null`，行列都在 | 安全，一眼可见 |
| 某指标对 universe 内**所有**证券都无数据 | 该指标**整列**从 `indicatorList` 消失 | CLI 标 `partial` + `omittedIndicators` + **退出码 3**；`--key-by code` 回填时该 key 根本不存在。**`screener` 按表达式布尔结构判**：缺列的变量视为无法求值，整个表达式再无可成立分支时 → **退出码 1 且不输出**；仍有分支可求值（如 `F1 || F2` 只缺 F1）→ `partial` + 退出码 3（见 screener 小节） |
| 某证券对**所有**指标都无数据 | 该证券**整行**从 `securityCodeList` 消失 | CLI 标 `partial` + `omittedSecurities` + **退出码 3** |
| 整个查询无数据 | `securityCodeList`/`values` 皆 `[]`（`Total: 0`），不再报 `999999` | **退出码 0**、不标 partial（什么都没被丢）。但 🔴 **参数写错也长这样**，stderr 会提醒这一歧义 |

⚠️ 由 ②③ 与 ④ 的分界推出一个不直觉但自洽的结果：**同一个 scope 落空，单查是 0、混查是 3**——`finc_pb_mrq` 只查 `09992.HK` 时整体全空（退出 0），和 `600519.SH` 一起查时泡泡玛特整行被丢（退出 3 + `omittedSecurities`）。全空时没有任何证据能区分「无覆盖」和「无数据」，只有存在对照物时才有。**想确认某标的是否被某指标覆盖，就把它和一个已知有数的标的一起查。**

同一个覆盖缺口（`finc_pb_mrq` 无港股数据），会因**同批里还查了什么**而落进不同的档。2026-08-03 实测四种：

| 查法 | 服务端返回 | CLI |
| :--- | :--- | :--- |
| `--indicator finc_pb_mrq --security 09992.HK` | 四个数组全空 | **退出 0**，不标 partial（第 ④ 档：什么都没被丢，就是没数据） |
| 上面 + `--security 600519.SH` | 只回茅台 1 行，泡泡玛特整行消失 | **退出 3** + `partial` + `omittedSecurities: ["09992.HK"]`（第 ③ 档） |
| `finc_pb_mrq` + `qte_close`，只查 `09992.HK` | 回 1 行，`indicatorList` 里没有 `finc_pb_mrq` | **退出 3** + `partial` + `omittedIndicators: ["finc_pb_mrq"]`（第 ② 档：`qte_close` 保住了这只证券，但 PB 对同批**每一只**证券都无数） |
| `finc_pb_mrq` + `qte_close` × `600519.SH` + `09992.HK` | 回 2 行，泡泡玛特的 `市净率(MRQ)` 为 `null` | **退出 0**（第 ① 档：行由 `qte_close` 保住、列由茅台保住，缺口降级成单元格） |

**判据是两个维度各自独立的，别只看一维**：

- 单元格 `null` ⟺ 该**证券**在同批还有别的指标有数 **且** 该**指标**对同批还有别的证券有数
- 整列消失 ⟺ 该指标对同批**所有**证券都无数
- 整行消失 ⟺ 该证券对同批**所有**指标都无数
- 整表为空 ⟺ 两者同时成立，即请求矩阵里**没有任何有数单元格**（单指标单证券的缺口是最简形态，多证券 × 多指标全缺同样如此）

所以「和一只有数的标的一起查就会变成 `null`」是错的——上表第 2 行正是反例：加了茅台，泡泡玛特那行照样整行消失，因为批次里只有 PB 这一个指标。**要把「整行消失」降级成 `null` 单元格，得加的是有覆盖的指标，不是有数据的证券。**标 `partial` 的那档会在 stderr 打印被略过的 code（`--format json` 下 stdout 仍是干净 JSON）。脚本按 `!= 0` 判失败的要注意：3 表示「有数据但不完整」，不是硬失败。

取数报错主要是这几个码：

| 错误码 | 实际含义 | 怎么办 |
| :--- | :--- | :--- |
| `100001` | **缺少必填参数**：如 `universe` 没传 | 补齐 `--indicator`/`--security` |
| `100003`@400 | 入参/表达式错误：`time-series` 传了「多指标 × 多证券」、`expression` 引用未声明变量、`indicatorParamList` 的 code 不在 `indicatorCodeList` 里 | 按 msg 改；多 × 多改用 `cross-section`。CLI 已在本地拦截「表达式引用未绑定变量」，不会白发一次请求 |
| `140002`@500 | **终态参数错**：指标必填参数缺失、枚举越界（如「参数 adjustType 的值 99 不在有效范围内 [1,2,3,4]」）、表达式语法错误 | **不重试**（CLI 已把 140002 列为终态码）。读 `search --format json` 的 `parameterList` 改参数名/取值 |
| `999999` | 系统故障。2026-08-01 起「无数据」已改为返回空数组，所以这个码基本只剩真故障（2026-07-26 曾出现 EDE 取数端全线 999999，08-01 已恢复） | CLI 对 indicator 端点**不重试此码**（v0.27.0）；确认参数无误仍报错就是服务端问题 |
| `130001`（旧 `410004`） | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 必填参数（`140002` 的根因）

相当一部分指标缺必填参数时会报 `140002`。**先完成语义 + `scopeList` + `parameterList` 三项校验；其中凡 `required:true` 的参数都用 `--indicator-param "指标code:参数=值"` 补上。** 三类高频必填参数：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"`；部分还需配**年报日期**才出数（实测 `finc_roe_avg_avg`@`2026-03-31` 空、@`2025-12-31` 有） |
| `sDate` | 区间类的**起始日**（如 `qte_vol_intvl` 区间成交量、`qte_avg_vol` 区间日均成交量），格式 `yyyy-MM-dd` | `--indicator-param "qte_vol_intvl:sDate=2024-01-02"`。⚠️ **`sDate` 不能替代 `tradeDate`**——它是区间起点，`tradeDate`（=区间终点）仍是 required，`--date` 会照常下发。历史文档写的 `startDate=YYYYMMDD` 已不存在，传它是静默失效（茅台实测：错名 296 万 vs 正确 4673 万）。另：`qte_amp_mo`（月振幅）等周期变体现在只吃 `tradeDate`，没有起始日参数 |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |

> `paramValue` 一律按**字符串**约定传（`periodNum=4` 内部即 `"4"`，CLI 已处理）。

## 取数最佳实践

- **先 search 做三项校验**：看 `indicatorName` + `description` 确认语义和口径，看 `scopeList` 确认覆盖全部目标市场 / 证券类型（并看 `usageRestriction` 有无接口限制），再看 `parameterList` 补齐必填参数（required）并核对专属参数**名称**与枚举（`adjustType`/`scale`/`currency` 等）；任一不符就回退专用接口。**参数名以 search 返回为准，不要照抄文档示例**——服务端调过参数名，传错名是静默失效不是报错。
- **`scopeList` 声称覆盖 ≠ 真有数**：截至 2026-08-03，`finc_pb_mrq` 的 `scopeList` 写着 A股+港股，实测港股无数据。它的表现按上面「缺数据的四种形态」走，由证券与指标**两个维度**共同决定：只查它 + 港股 → 整表为空（退出 0）；只加一只 A 股 → 港股仍整行消失（退出 3，批次里只有这一个指标）；只加一个有港股覆盖的指标 → PB 整列消失（退出 3）；两者都加 → 才降级成 `null` 单元格（退出 0）。跨市场批量取数后**逐市场抽查一行**，别默认 scopeList 就是事实——反过来也一样，`qte_mkt_cptl`/`shr_tot` 在 08-02 还是港/美无数据、08-03 就补上了，**否定结论同样会过期**。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务报表类（`bs_`/`is_`/`cf_`/`div_`/`shr_`，以及 description 明确按报告期统计的 `finc_`）→ 用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`，无需是交易日）
  - 日频估值类（如 `finc_pe_ttm` / `finc_pb_mrq`）→ 用最新已入库的**交易日**。⚠️ **MRQ 口径已改**：`finc_pb_mrq` 过去只在报告期末打值、交易日取 `null`，2026-08-02 复测**任意交易日都有数且逐日变动**（茅台 `07-31`=6.2325、`07-22`=6.0221、`06-30`=5.4706、`03-31`=7.0634；五粮液/宁德时代同样）。**别再照旧文档改用季度末日期**——那会拿到几个月前的陈值（茅台季末 7.0634 比当日 6.2325 高 13.5%，估值指标上就是错数）。别因 code 都以 `finc_` 开头就一律套报告期末，按 `description`/实测区分
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情类（`qte_` 等）→ 用**交易日**，但常规行情仍应改走 `quote`
- **混合日期语义要拆查询**：同时要“某报告期营收 / EPS”和“估值 PE / PB”时，按各自有效日期分别调用 `cross-section` 再按 `security` 合并（财务=报告期末、PE/PB=最新交易日）；不要把不同日期语义的指标塞进同一个 `--date`
- **探索性取数**：只有**部分**缺值才返回 `null` 且保留行列；整指标 / 整证券无数据是**整列 / 整行消失**，整个查询无数据是**空表**（不再报 `999999`）。看趋势用 `time-series` + 覆盖报告期的区间，但不能把缺值当成通过语义 / scope 校验。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询做失败拆分**：某指标**缺必填参数**或入参错误时会整批报 `140002`，逐指标单查能定位是哪个指标缺参/不可查。留意 stderr 的「整列/整行被略过」警告——那不是报错，但同样是这批数据不完整的信号。
- **市值量纲（复测 2026-08-03）**：`qte_mkt_cptl`（总市值）与 `shr_tot`（总股本）**A/港/美股均已有数**（08-02 时港美股还是空的，服务端已补：泡泡玛特 2165.47 亿 / 腾讯 43207.64 亿 / 苹果 45128.55 亿）；**默认返原始「元」**（茅台 ≈ `1.7e12`，即 1.7 万亿），别误当天文数字。用 `scale` 数字码缩放（`0`元 / `3`千 / `4`万 / `6`百万 / `8`亿 / `9`十亿——`scale=8` → `16883` 亿元）、`currency` 换币种（**大写** `DFT`本币 / `CNY` / `HKD` / `USD` …）。**跨证券比市值前先统一 `scale`+`currency`**。
- **币种与汇率（复测 2026-08-01，已修复）**：`DFT`（原始币种）识别正确——A股=CNY、港股行情=HKD、美股=USD；汇率换算自洽（互逆且三角一致，误差 <0.003%）。⚠️ 但**同一只港股，行情类的原始币种是 HKD、财务类可能是 CNY**（如泡泡玛特财报以人民币计），跨市场比财务数据时显式传 `--currency CNY` 别依赖 `DFT`。另：财务类指标的汇率按**报告期**折算、行情类按查询日折算，两者隐含汇率会有细微差异，属正常口径差别。
- **EDE 财务指标的 `reportType`（2026-08-01 裁决）**：`enumList` 的 label 已与实际取数**一致**，按 label 传即可。⚠️ 但同一份 `search` 响应里的 `paramDescription` 仍留着**相反的旧映射文字**——**以 `enumList` 和下方实测值为准，别读 `paramDescription`**：

  | value | 口径 | 说明 |
  |-------|---------|------|
  | `1`（默认，省略即此值） | **合并报表** | 绝大多数场景要的就是这个 |
  | `2` | **合并报表（调整）** | 该报告期无重述数时为空 |
  | `3` | **母公司报表** | |
  | `4` | **母公司报表（调整）** | 该报告期无重述数时为空 |

  实测闭环（`is_tot_op_rev` + 中信证券 `600030.SH` FY2024 营业总收入，2026-08-01）：`1`→637.8922亿、`2`→581.19亿、`3`→321.924亿、`4`→321.924亿；与 `fundamental income-statement --security-code 600030.SH --fiscal-year 2024 --period annual` 返回的「合并报表」`totalOpRev = 63,789,215,688.23`（637.892亿）在 `1` 上完全吻合。取数值与 2026-07-24 的历史实测一致——**变的只是服务端 label，取数从未变过**。历史文档里「label 与 value 错位、按 label 传会取反」的警告已作废。

  `2`/`4` 返回空值**不是枚举失效**，是该报告期尚无调整表（如最新年报 FY2025：`1`/`3` 有数、`2`/`4` 无值，与 `fundamental --report-type consolidatedRestated` 同期无数据一致）。港股默认口径同样是合并。

## 通用说明

- **发现流程**：`indicator search --format json` → 核对 `indicatorName` + `description`、`scopeList`（含 `usageRestriction`）、`parameterList`（**参数名以此为准**）→ 三项都通过才用 `cross-section` / `time-series` / `screener`
- **积分**：`search` 免费；`cross-section` / `time-series` / `screener` 按请求单元格数量计费，标价为每 100 单元格 A 股 0.05 / 港股 0.1 / 美股 0.2 积分，每次查询不足 100 单元格按 100 计
- **空结果排查顺序**：整查询无数据现在返回空表而非报错，所以空表既可能是真无数据、也可能是参数写错。按序排查：① 参数名对不对（`indicator search` 的 `parameterList`）② 日期语义对不对（`tradeDate` vs `reportDate`）③ `scopeList` 覆不覆盖该市场 ④ 才考虑确实没数据
- **数据权限**：试用账号默认可取近 3 年；正式账号按服务等级
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
