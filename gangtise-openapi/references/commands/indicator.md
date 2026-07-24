# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序）

> 本组覆盖 `/application/open-indicator/EDE/*`：证券级**数据指标**的检索与取数，主要用于多证券批量取已实现财务 / 估值指标。即使能搜到收盘价、成交量等行情指标，常规行情与 K 线仍走免费的 `quote`。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode`**，绝不猜测指标编码。

## EDE 与专用接口的优先级

| 请求形态 | 优先接口 |
| :--- | :--- |
| 单证券的财务 / 股东 / 主营，或 A股单证券估值 | 对应 `fundamental` 专用命令；多数免费，且字段口径固定 |
| 多证券批量取一组**已实现**财务 / 估值指标 | 先 `indicator search`，通过下方三项校验后用 `cross-section` / `time-series` 一次拉取，避免逐只循环 |
| A股盈利预测 / 一致预期（含预测 EPS） | `fundamental earning-forecast`；EDE 搜到的基本 / 稀释 EPS 是已实现值，不能替代预测 |
| A股估值历史分位 | `fundamental valuation-analysis` |
| 开高低收 / 成交量等行情与 K 线 | `quote`；免费且支持多证券批量 |
| 单证券三大报表全部科目 | 对应 `fundamental` 利润表 / 资产负债表 / 现金流量表命令 |

EDE 不是“搜到就优先”。取数前必须核对：① `indicatorName` + `description` 与目标语义一致；② `scopeList` 覆盖**全部**目标市场和证券类型；③ `parameterList` 的必填参数与枚举可满足。`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退上表的专用接口；专用接口也不支持目标市场时，如实说明当前 CLI 无可用口径，不能用其他语义代替。实测 `valuation-analysis` / `earning-forecast` 仅支持 A 股，港 / 美股估值历史分位与盈利预测当前无可用口径；PE/PB 等核心估值指标 EDE 也只有 A 股（`finc_pe_ttm`/`finc_pb_mrq` 均 `[A股]`），别假定港 / 美股估值能从 EDE 取，一律以 `scopeList` 为准。`search` 免费，EDE 取数按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`。

## 指标搜索 `indicator search`

```bash
gangtise indicator search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：按指标名称模糊匹配。用具体词，如 `营业收入` / `基本每股收益` / `市盈率` / `总市值`，**不能用整句白话**（"我想查一批公司的财务估值" ✗）
- `--limit`：返回条数上限，默认 50，最大 100
- 默认 `--format table` 只适合浏览名称；正式路由 / 取数前必须加 `--format json`，才能完成语义、`scopeList`、`parameterList` 三项校验
- 返回字段：`indicatorCode` / `indicatorName` / `description`（算法与口径）/ `scopeList`（该指标适用的市场 + 证券类型）/ `parameterList`（可传的 `--indicator-param` 参数及枚举）/ `score`
- **市场范围按指标判断**：`scopeList` 现在会返回实际覆盖范围，且指标之间不同；不能笼统写成每个指标都覆盖 A / 港 / 美股。实测 `finc_pe_ttm` / `finc_pb_mrq` 仅 A 股，`is_op_rev` 覆盖 A 股 + 港股，这些财务 / 估值指标均不含美股。目标列表含任一 scope 外证券时，本批 EDE 校验不通过，应回退专用接口
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
- `--security`（**至少 1 个**）：证券代码，如 `600519.SH`（A股）/ `09992.HK`（港股）/ `AAPL.O`（美股，用 `.O`/`.N` 后缀，非 `.US`），可重复传多个
- `--date`（**必选**）：数据日期 `yyyy-MM-dd`；日期语义按指标分三类——财务报表指标=报告期末（可为非交易日，实测 `2024-03-31` 可取数）、`finc_pe_ttm` 等日频估值=交易日、`finc_pb_mrq`(MRQ) 等=最近报告期末（交易日取 `null`，详见下方「日期路由」）。单元格级缺值返回 `null`，整个查询无数据可能报 `999999`
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `date / security / name / <各指标名>…`
- **`--key-by name|code`**（默认 `name`）：指标列头用显示名还是 `indicatorCode`。**批量按 code 回填必用 `--key-by code`**——指标名会碰撞（多个指标同显示名，如 `cf_finc_exp`/`_qtr` 都叫「财务费用」）、服务端还会重排返回列序，唯有 code 唯一且与顺序无关（行轴 `security` 本就是 code，`code` 模式整表可按 code 寻址，免去 raw API 手工回填）

```bash
# 多证券 × 同一报告期的已实现财务指标
gangtise indicator cross-section \
  --indicator is_op_rev --indicator is_eps_bas \
  --security 600519.SH --security 000858.SZ --security 300750.SZ \
  --date 2025-12-31 --format table
# 列：date / security / name / 营业收入(利润表,累计) / 基本每股收益(利润表,累计)
# 省略 reportType 即取到合并口径数（茅台2025=1688亿）。⚠️ 该枚举 label 与实测不符：label 标 1母公司/2合并/3母公司调整/4合并调整，实测 value=2/4 直接 999999、value=1 反返合并值——要指定报表口径改用 `fundamental income-statement --report-type`，勿在 EDE 按 label 传 reportType
```

## 指标时间序列 `indicator time-series`

```bash
gangtise indicator time-series --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --start-date <date> --end-date <date> \
  [--calendar-type <ND|TD|WD>] [--currency <c>] [--scale <s>] [--indicator-param <spec>] [--key-by name|code]
```

- `--indicator` / `--security`：同上，但**只允许「多指标 × 单证券」或「单指标 × 多证券」**，不能两边都多个（要多 × 多用 `cross-section`，否则报 `410001`）
- `--start-date` / `--end-date`（**均必选**）：区间端点 `yyyy-MM-dd`
- `--calendar-type`：日期类型 `ND`(自然日)/`TD`(交易日,默认)/`WD`(工作日)
- `--currency` / `--scale`：同 `cross-section`
- **输出（宽表）**：每行一个日期，列为 `date / <各序列名>…`；序列在「单证券」时是各**指标**，在「多证券」时是各**证券**
- **`--key-by name|code`**（默认 `name`）：同 `cross-section`；`code` 模式下单证券列=各 `indicatorCode`、多证券列=各 `securityCode`，批量按 code 回填用它

```bash
# 单个已实现估值指标 × 多证券：列 = 证券
gangtise indicator time-series --indicator finc_pe_ttm \
  --security 600519.SH --security 000858.SZ --security 300750.SZ \
  --start-date 2026-05-18 --end-date 2026-05-22
# date        贵州茅台    五粮液    宁德时代
```

## 复权 / 指标专属参数 `--indicator-param`

通用的币种/量纲用 `--currency` / `--scale`；指标**专属**参数用 `--indicator-param`，格式 `指标code:参数key=值`，可重复。下面的行情复权仅演示底层参数语法；常规行情 / K 线仍优先 `quote`，不要照此例改走 EDE：

```bash
# 茅台收盘价后复权（adjustmentType=3）
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2026-05-18 --indicator-param "qte_close:adjustmentType=3"
#   不复权 1323 → 后复权 11487.0308
```

- `adjustmentType`（复权方式）：`1`=不复权 `2`=前复权 `3`=后复权 `4`=定点复权
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- 三项校验通过后，再从 `indicator search --format json` 的 `parameterList` 读取该指标支持的 `paramKey` 及枚举值（**参数 key 与取值（含大小写）均以 search 返回为准**——如 `currency` 在 parameterList 中可能为小写 `dft`/`cny`）
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

截面/时序**单元格级缺值返回 `null`**（证券行保留、不丢行）；但**整个查询无数据时仍会报 `999999` + HTTP 500**（节假日 / 未来日期 / 未覆盖标的，2026-07-11 实测）。取数报错主要是这几个码：

| 错误码 | 实际含义 | 怎么办 |
| :--- | :--- | :--- |
| `410001` | 入参错误：没传指标/证券，或 `time-series` 传了「多指标 × 多证券」 | 补齐 `--indicator`/`--security`；多 × 多改用 `cross-section` |
| 缺参报错（曾为 `410106`） | **缺必填参数**：服务端现已直接指明缺哪个，如「指标 X 的必填参数 periodNum(期数) 不能为空」（仍以 HTTP 500 返回，CLI 重试 2 次后透出该消息） | 读 `search --format json` 的 `parameterList`，把 `required:true` 的参数用 `--indicator-param` 补上 |
| `999999` | **多为整查询无数据**（日期语义不符 / 未来日期 / 未覆盖标的；单元格级缺值才是 `null`），也可能是真系统故障——服务端不区分两者 | CLI 对 indicator 端点**不重试此码**（v0.27.0）并在 hint 中提示；先核对日期符合指标语义、标的在覆盖范围，确认应有数据仍报错才按系统故障处理 |
| `130001`（旧 `410004`） | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 必填参数（`410106` 的根因）

相当一部分指标默认调用就报 `410106`，因为有必填参数没传。**先完成语义 + `scopeList` + `parameterList` 三项校验；其中凡 `required:true` 的参数都用 `--indicator-param "指标code:参数=值"` 补上。** 三类高频必填参数：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"`；部分还需配**年报日期**才出数（实测 `finc_roe_avg_avg`@`2026-03-31` 空、@`2025-12-31` 有） |
| `startDate` | 区间/周期类，整数 `YYYYMMDD`（含全部 `qte` 周期变体，如 `qte_amp_mo` 月振幅、换手率） | `--indicator-param "qte_amp_mo:startDate=20260401"`；取值须匹配该指标**周期**（月/季/周/年窗口不同，`20260101` 未必命中，空则按变体周期调 `startDate`） |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |

> `paramValue` 一律按**字符串**约定传（`periodNum=4` 内部即 `"4"`，CLI 已处理）。

## 取数最佳实践

- **先 search 做三项校验**：看 `indicatorName` + `description` 确认语义和口径，看 `scopeList` 确认覆盖全部目标市场 / 证券类型，再看 `parameterList` 补齐必填参数（required）并核对专属参数枚举（`adjustmentType`/`scale`/`currency` 等）；任一不符就回退专用接口。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务报表类（`bs_`/`is_`/`cf_`/`div_`/`shr_`，以及 description 明确按报告期统计的 `finc_`）→ 用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`，无需是交易日）
  - 日频估值类（如 `finc_pe_ttm`）→ 用最新已入库的交易日；但 `finc_pb_mrq`(市净率 MRQ) 等 MRQ 口径**只在报告期末打值**，交易日会取到 `null`，要用季度末日期（实测 `2026-07-22` PB 空、`2026-03-31` 有）。别因 code 都以 `finc_` 开头就一律套报告期末、也别一律套交易日——按 `description`/实测区分
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情类（`qte_` 等）→ 用**交易日**，但常规行情仍应改走 `quote`
- **混合日期语义要拆查询**：同时要“某报告期营收 / EPS”和“估值 PE / PB”时，按各自有效日期分别调用 `cross-section` 再按 `security` 合并（财务=报告期末、PE=最新交易日、PB(MRQ)=最近报告期末）；不要把不同日期语义的指标塞进同一个 `--date`
- **探索性取数**：单元格级缺值返回 `null` 且保留证券行，时序局部无值可为空行；**整个查询无数据仍可能报 `999999`**。看趋势用 `time-series` + 覆盖报告期的区间，但不能把缺值当成通过语义 / scope 校验。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询做失败拆分**：某指标**缺必填参数**或入参错误时会整批报错（单元格级无数据按 `null` 返回；整个查询无数据的 `999999` 例外见上），逐指标单查能定位是哪个指标缺参/不可查。
- **市值量纲（实测 2026-07）**：`qte_mkt_cptl`（总市值）**仅 A 股**——港股/美股返 `null`（换 `currency` 也没用，是 scope 外 ≠ 无数据）；**默认返原始「元」**（茅台 ≈ `1.5e12`，即 1.5 万亿），别误当天文数字。用 `scale` 数字码缩放（`0`元 / `3`千 / `4`万 / `6`百万 / `8`亿 / `9`十亿——`scale=8` → `15038` 亿元）、`currency` 换币种（`dft`本币 / `cny` / `hkd` / `usd` …）。**跨证券比市值前先统一 `scale`+`currency`**。
- **EDE 财务指标的 `reportType` 枚举不可信（实测 2026-07-23）**：服务端 label（`1`母公司/`2`合并/`3`母公司调整/`4`合并调整）与实际取数不符——`value=2/4` 常直接 `999999`、`value=1` 反而返合并数（茅台2025营收 `value=1`→1688亿、`=3`→983亿、`=2/4`→999999）。**省略即用默认（合并口径，已实测有数）**；要明确指定合并/母公司口径请改用 `fundamental` 三大报表的 `--report-type`（口径语义可靠）。

## 通用说明

- **发现流程**：`indicator search --format json` → 核对 `indicatorName` + `description`、`scopeList`、`parameterList` → 三项都通过才用 `cross-section` / `time-series`
- **积分**：`search` 免费；`cross-section` / `time-series` 按请求单元格数量计费，标价为每 100 单元格 A 股 0.05 / 港股 0.1 / 美股 0.2 积分，每次查询不足 100 单元格按 100 计
- **空结果 / 整查询无数据**：时序可能返回空表，截面或整批无数据也可能报 `999999`；先改用符合指标语义的日期 / 有效区间并核对 `scopeList`
- **数据权限**：试用账号默认可取近 3 年；正式账号按服务等级
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
