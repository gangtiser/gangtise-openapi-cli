# Indicator 命令详细参数（数据指标 EDE：证券级指标截面 / 时序）

> 本组覆盖 `/application/open-indicator/EDE/*`：证券级**数据指标**的检索与取数（收盘价、成交量、总市值、财务指标等，按个股取值）。
> 与 `alternative edb-*`（EDB 行业/宏观指标，无证券维度）是两套接口，别混。
>
> **取数前先 `indicator search` 拿 `indicatorCode`**，绝不猜测指标编码。

## 指标搜索 `indicator search`

```bash
gangtise indicator search --keyword <text> [--limit <n>]
```

- `--keyword`（**必选**）：按指标名称模糊匹配。用具体词，如 `收盘价` / `成交量` / `营业收入` / `总市值`，**不能用整句白话**（"我想查茅台的收盘价" ✗）
- `--limit`：返回条数上限，默认 50，最大 100
- 默认 `--format table`（看 `indicatorCode` / `indicatorName` / `description` 即可）；要看每个指标支持哪些参数（`parameterList`），用 `--format json`
- 返回字段：`indicatorCode` / `indicatorName` / `description`（算法）/ `parameterList`（可传的 `--indicator-param` 参数及枚举）/ `score`（`scope` 适用市场/品种字段服务端当前多返 `null`）

```bash
gangtise indicator search --keyword 收盘价 --limit 5 --format json   # 看 parameterList
```

## 指标截面数据 `indicator cross-section`

```bash
gangtise indicator cross-section --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --date <yyyy-MM-dd> \
  [--currency <c>] [--scale <s>] [--indicator-param <spec>]
```

- `--indicator`（**至少 1 个**）：指标编码，来自 `search`，可重复传多个
- `--security`（**至少 1 个**）：证券代码，如 `600519.SH` / `09992.HK`，可重复传多个
- `--date`（**必选**）：数据日期 `yyyy-MM-dd`（须为交易日，非交易日/无数据日返回空）
- `--currency`：币种 `DFT`(原始,默认)/`CNY`/`HKD`/`USD`/`EUR`/`GBP`/`JPY`/`TWD`/`MOP`/`AUD`
- `--scale`：量纲 `0`(个,默认)/`3`(千)/`4`(万)/`6`(百万)/`8`(亿)/`9`(十亿)
- **支持多指标 × 多证券**（单日横截面）
- **输出（宽表）**：每行一只证券，列为 `date / security / name / <各指标名>…`

```bash
gangtise indicator cross-section \
  --indicator qte_close --indicator qte_vol --indicator qte_mkt_cptl \
  --security 600519.SH --security 09992.HK \
  --date 2026-05-18 --format table
# date        security   name   日收盘价  成交量      总市值
# 2026-05-18  600519.SH  贵州茅台  1323   4966097   1656753494445
# 2026-05-18  09992.HK   泡泡玛特  150.7  15301079  20209520.2705
```

## 指标时间序列 `indicator time-series`

```bash
gangtise indicator time-series --indicator <code> [--indicator <code2>] \
  --security <code> [--security <code2>] --start-date <date> --end-date <date> \
  [--calendar-type <ND|TD|WD>] [--currency <c>] [--scale <s>] [--indicator-param <spec>]
```

- `--indicator` / `--security`：同上，但**只允许「多指标 × 单证券」或「单指标 × 多证券」**，不能两边都多个（要多 × 多用 `cross-section`，否则报 `410001`）
- `--start-date` / `--end-date`（**均必选**）：区间端点 `yyyy-MM-dd`
- `--calendar-type`：日期类型 `ND`(自然日)/`TD`(交易日,默认)/`WD`(工作日)
- `--currency` / `--scale`：同 `cross-section`
- **输出（宽表）**：每行一个日期，列为 `date / <各序列名>…`；序列在「单证券」时是各**指标**，在「多证券」时是各**证券**

```bash
# 多指标 × 单证券：列 = 指标
gangtise indicator time-series --indicator qte_close --indicator qte_vol \
  --security 600519.SH --start-date 2026-05-18 --end-date 2026-05-22
# date        日收盘价    成交量
# 2026-05-18  1323     4966097 ...

# 单指标 × 多证券：列 = 证券
gangtise indicator time-series --indicator qte_close \
  --security 600519.SH --security 09992.HK --start-date 2026-05-18 --end-date 2026-05-22
# date        贵州茅台    泡泡玛特
# 2026-05-18  1323     150.7 ...
```

## 复权 / 指标专属参数 `--indicator-param`

通用的币种/量纲用 `--currency` / `--scale`；指标**专属**参数（如行情复权方式）用 `--indicator-param`，格式 `指标code:参数key=值`，可重复：

```bash
# 茅台收盘价后复权（adjustmentType=3）
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2026-05-18 --indicator-param "qte_close:adjustmentType=3"
#   不复权 1323 → 后复权 11487.0308
```

- `adjustmentType`（复权方式）：`1`=不复权 `2`=前复权 `3`=后复权 `4`=定点复权
- 同一指标多个参数 → 重复 `--indicator-param "code:k1=v1" --indicator-param "code:k2=v2"`
- 某指标支持哪些 `paramKey` 及其枚举值，用 `indicator search --format json` 看该指标的 `parameterList`（**参数 key 与取值（含大小写）均以 search 返回为准**——如 `currency` 在 parameterList 中可能为小写 `dft`/`cny`）
- `--indicator-param` 与根级 `--currency`/`--scale` 冲突时，以 `--indicator-param` 为准

## 必填参数与错误码（取数前必读）

截面/时序**无数据现在统一返回 `null`**（不再报错、不丢行）；取数报错主要是这几个码：

| 错误码 | 实际含义 | 怎么办 |
| :--- | :--- | :--- |
| `410001` | 入参错误：没传指标/证券，或 `time-series` 传了「多指标 × 多证券」 | 补齐 `--indicator`/`--security`；多 × 多改用 `cross-section` |
| 缺参报错（曾为 `410106`） | **缺必填参数**：服务端现已直接指明缺哪个，如「指标 X 的必填参数 periodNum(期数) 不能为空」（仍以 HTTP 500 返回，CLI 重试 2 次后透出该消息） | 读 `search --format json` 的 `parameterList`，把 `required:true` 的参数用 `--indicator-param` 补上 |
| `999999` | 真系统故障才用此码。**无数据已不再报 `999999`**：截面遇无数据现在返回 `null` 单元格（证券行保留、不丢行、不再 500），与时序一致 | 无数据按 `null` 正常返回；真 `999999` 多为瞬时问题，CLI 自动重试 2 次 |
| `410004` | 数据未找到，或**该指标无权限**（内层信封失败会带具体 msg，如"指标无权限"；此码被服务端复用） | 检查查询条件与指标权限；换证券/日期仍失败多为无权限，联系管理员开通 |

### 必填参数（`410106` 的根因）

相当一部分指标默认调用就报 `410106`，因为有必填参数没传。**取数前先 `search --format json` 看 `parameterList`，凡 `required:true` 的都用 `--indicator-param "指标code:参数=值"` 补上。** 三类高频必填参数：

| 参数 | 适用指标 | 示例 |
| :--- | :--- | :--- |
| `periodNum` | N 期统计（N 期均值/最值，如 `finc_roe_avg_avg` 平均ROE N期均值） | `--indicator-param "finc_roe_avg_avg:periodNum=4"` |
| `startDate` | 区间/周期类，整数 `YYYYMMDD`（含全部 `qte` 周期变体，如 `qte_amp_mo` 月振幅、换手率） | `--indicator-param "qte_amp_mo:startDate=20260401"` |
| `fiscalYear` | 年度/报告期类（如 `div_cash_yr` 年度现金分红） | `--indicator-param "div_cash_yr:fiscalYear=2025"` |

> `paramValue` 一律按**字符串**约定传（`periodNum=4` 内部即 `"4"`，CLI 已处理）。

## 取数最佳实践

- **先 search 看 parameterList**：一步拿到 code、必填参数（required）、专属参数枚举（`adjustmentType`/`scale`/`currency` 等）。
- **公司类型决定有没有这个科目**：财务科目分公司类型——银行有「存放同业」、券商有「客户资金存款」、保险有「预收保费」，一般企业没有。某指标对茅台返回 `null`（无此科目），换到对应类型证券（招行/中信/平安）就有数。
- **日期路由**：
  - 财务类（`bs_`/`is_`/`cf_`/`finc_`/`div_`/`shr_` 等）→ 用**报告期末**（Q1 `2026-03-31`、年报 `2025-12-31`）
  - 现金流量表附注/间接法科目（多数 `cf_`）→ **只在年报/半年报披露**，季报日期取不到，改用年报日期 `2025-12-31`
  - 行情/基本资料（`qte_`/`pty_`/`scr_`/`frcst_`）→ 用**交易日**
- **探索性取数**：截面与时序现在对无数据都优雅处理（截面返 `null` 单元格、时序返空行），都适合"先看有没有数"；看趋势仍优先 `time-series` + 覆盖报告期的区间。
- **名称反查 code 要核对，别取首条**：存在同显示名的兄弟指标——单季 `cf_finc_exp_qtr` 与累计 `cf_finc_exp` 都叫「财务费用」，`bs_fmt`/`cf_fmt`/`is_fmt` 都叫「报表格式」。`search` 按名称模糊匹配，目标 code 高概率在 top1 但不绝对，要看 `indicatorCode` 确认。
- **批量查询做失败拆分**：某指标**缺必填参数**或入参错误时会整批报错（无数据不会——按 `null` 返回），逐指标单查能定位是哪个指标缺参/不可查。

## 通用说明

- **发现流程**：`indicator search`（拿 code + 看 parameterList）→ `cross-section` / `time-series` 取数
- **积分**：`search` 免费；`cross-section` / `time-series` 按单元格计费（A 股 0.05 / 港股 0.1 / 美股 0.2 积分每 100 单元格，不足 100 按 100）
- **空结果**：日期区间无数据时返回空表（不报错），换交易日/有效区间重试
- **数据权限**：试用账号默认可取近 3 年；正式账号按服务等级
- 所有格式（table/json/jsonl/csv/markdown）均可用；导出宽表给 Excel 直接用 `--format csv --output xxx.csv`
