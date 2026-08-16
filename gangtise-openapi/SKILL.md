---
name: gangtise-openapi
version: "0.35.0"
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下 / 钢尼斯 / gtIC（Gangtise 语音误识别）

  **适用**：原始数据导出、批量 jsonl/csv、下载 PDF/MD、行情 K 线、财务报表、估值指标、证券级数据指标（EDE 截面/时序/条件选股）、财报日历（业绩预告/快报/公告）、PDF 解析为 Markdown、AI 能力（一页通/投资逻辑/同业对比/个股看点·投研总结/投研线索/业绩点评/观点PK·多空辩论/主题跟踪/热点话题/管理层讨论/调研提纲/知识库搜索）、云盘文件管理（Vault）

  **不适用**：不脱离 OpenAPI 自行撰写研报、编造投研结论或做自由问答——观点总结、多空 PK 等 AI 产物本 skill 只经由 Gangtise 平台 AI 接口获取，不自行生成

  **前置**：依赖 gangtise CLI，未安装时提示用户 `npm install -g gangtise-openapi-cli`
---

# Gangtise OpenAPI CLI

> **详细参数 → `references/commands/<group>.md`**（按需 Read）
> **响应字段 → `references/response-schema.md`** ｜ **典型示例 → `references/examples.md`**
> **高频 ID → `references/lookup-ids.md`** ｜ **K 线/财务字段 → `references/fields.md`**

## 必备规则

1. **`--format json`**：列表/数据类必加。AI 内容生成（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `*-check`）也加 json，但呈现时**直接取 `content` 字段**，不要展示 JSON 包装层。
2. **opaque ID**：先读 `references/lookup-ids.md`；找不到再按类型查：行业/区域/公告分类/城市 → `reference constant-list --category <分类>`（分类代码用 `reference constant-category` 查）；题材 → `reference concept-search --keyword <名>`；板块 → `reference sector-search --keyword <名>`；申万 `--gts-code` 行业代码全量 → `sector-search --keyword 申万一级行业指数` 取指数数据板块层级的 sectorId 再 `sector-constituents`；券商/牵头/观点机构（按名称找 ID）→ `reference institution-search --keyword <名> [--category ...]`（服务端搜索，返回 `institutionId` + `usageScopes` 标明该 ID 用于哪个接口的哪个参数；覆盖 `--broker` / `--institution` 全部 5 类机构，含 `foreignOpinionInstitution`）——仅当要**全量枚举**时才用本地表 `gangtise lookup broker-org/meeting-org list`（institution-search 是搜索型：top≤10、非全量）。**绝不猜测**。
3. **公司名 → 证券代码**：先查下方速查表（5 只 mega-cap），其余一律 `gangtise reference securities-search --keyword <名> --category stock` 取 `list[0].gtsCode`。
4. **时间格式**：datetime `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date `YYYY-MM-DD`。
5. **多值参数**：优先重复传（最稳、最明确）：`--security 600519.SH --security 000858.SZ`。CLI 也支持半/全角逗号分隔（`args.ts` 为语音输入容错），但重复传不易被 shell 吞。
6. **K 线"最近 N 条"**：必须用 `--start-date`/`--end-date` 拉日期范围，从结果按 `tradeDate` 取尾部最近 N 条。**不要只用 `--limit N`**（截取的是窗口开头）。
6.1. **日 K 仅历史**：`day-kline` **不返回盘中实时数据**。当日数据入库时间：A 股 ~15:30 / 港股 ~16:30 / 美股 ~07:00（北京时间）。需要盘中快照请走 `quote realtime`。
6.1.1. 🔴 **`quote day-kline` 一个命令覆盖 A 股 / 港股 / 美股 / 指数**（2026-08-14 合并），可混着传代码。**全市场关键字是 `aShares` / `hkStocks` / `usStocks`，`--security all` 已废弃**（CLI 会报错并提示改用哪个），且关键字**必须单独传**，不能与代码或另一个关键字混填。指数（`.SH`/`.SZ`/`.BJ` 交易所指数、`.GT` 概念、`.CI`/`.SWI` 行业）不支持全市场关键字，须逐个传代码。`day-kline-hk` / `day-kline-us` / `index-day-kline` 已下线（接口仍可调、仍用 `all`），**新代码别用**——它们不校验证券代码，传错返 `total:0` 而不报错。
6.2. **多标的日 K 不自动分片**：只有全市场关键字才按日切片提额；显式传多个 `--security` 时走单请求（默认 `--limit 6000` / 上限 10000）。**v0.23.0 起：返回行数撞上 `--limit` 时结果会标 `partial`、退出码 3、stderr 警告**（不再静默截断；`--limit` 超 10000 本地直接报错）。仍建议先估 标的数 × 交易日数，接近/超 6000 → 逐只分开拉、或显式 `--limit 10000` 并按日期区间分批。
7. **CLI 已内置自动化，不要手动复刻**：
   - 翻页 → 首页拿 total 后剩余页并发拉取；🔴 **全量拉取结束会多探一行验证 `total` 是不是服务端封顶**（`opinion` / `foreign-opinion` / `independent-opinion` 的 `total` 恒为 10000 但实际远不止）——探到就标 `partial` + `totalCapped` + 退出 3，**这时导出的是截断结果，要缩小时间范围分片拉**
   - K 线全市场关键字（`aShares` / `hkStocks` / `usStocks`；旧命令 `all`）跨日期 → 自动按日切片并合并，粒度按各市场单日行数定（A 1 天 / 港 2 天 / 美 1 天）
   - 5xx / `429` / 网络错误 / `999999` → 自动指数退避重试（🔴 贵档端点例外：仅连接失败 / 429 / token 自愈重试，5xx/超时不重放防重复扣分，v0.26.0；`indicator` 端点对 `999999` 不重试，v0.27.0）
   - Token 失效（`0000001008` / `999002`，含已废弃的 `8000014`/`8000015`）→ 自动重新登录并重试一次；凭证错 `999011` → **不重试**（AK/SK 不对不会自己好），查环境变量
8. **参数命名差异**：Insight/Quote/Vault 用 `--security`，Fundamental/AI 用 `--security-code`（例外：`ai stock-summary` 用 `--security`，`ai security-clue` 用 `--gts-code`）。
9. **调试**：`--verbose` 或 `GANGTISE_VERBOSE=1` 打印每个请求的耗时/字节数到 stderr。
10. **`--field` 字段名必须核对，不确定就别传**（返回全量最稳）：`quote realtime` / `fundamental main-business` / `valuation-analysis` 遇到不存在的字段名时，上游只丢**值**、字段名照请求**回显**，按位置拍平会把值贴到错误的字段上（实测 realtime 传 `close`——它没有这个字段——换手率 28.5573 被贴成 `close`，茅台真实价 1297.41）。v0.28.3 起 CLI 检测到长度不匹配直接报错（退出码 1）：**带 `--field` 的命令看到这个报错，先去 `references/fields.md` 核对字段名**（没有 `--field` 的命令如 `alternative edb-data` 报此错则是上游响应结构异常，报障时若报错末尾附了 `（trace …）` 就一并带上）。另：realtime **无 `close`**（用 `latestPrice`）、**无市值**（总市值走 `indicator cross-section --indicator qte_mkt_cptl`，2026-08-03 起 A/港/美股均有数）。
11. 🔴 **EDE 取不到数时给的是占位值，而 `0` 和 `null` 都可能**（`indicator` 截面 / 时序 / 选股）：多数指标填 `null`，但个别——最常用的是 `is_dnrpnp` 扣非归母净利润——填 **`0`**，且这是**指标属性、与日期对不对无关**（日期落在报告期末时，覆盖不到的证券如美股同样返 `0`，行还在、无告警、退出码 0）。**`null` 通常被聚合跳过，`0` 会照常穿过比较与比率计算**：`screener` 的 `F1 > 0` 可能筛出空集（读起来像「没有盈利的股票」），时序整列求均值可能差几十倍。所以：报告期类指标的日期一律落**报告期末**；拿 `is_dnrpnp` 这类做筛选或聚合前先单查确认不是占位；**别对时序整列直接求均值 / 求和**。详见 `references/commands/indicator.md`。

## 工作流（3 步）

```
意图 → 命令（路由表）  →  执行（pre-flight + 拼参数）  →  呈现（按响应模式）
```

### Pre-flight（执行前必过）

🔴 **需用户确认**：
- `gangtise auth status` 未登录 → 提示配置 AK/SK 并中止
- 多个命令同时匹配 → 复述理解让用户挑（如"搜索研报" → research list 还是 knowledge-batch？）
- 用户说"全部 / 全量 / 全市场" → 确认量级再拉：省略 `--size` 就是拉全量（自动翻页，上限 1000 页）；先 `--size 1` 看 stderr 的 `Total: N` 再决定（探量这步别加 `--format json`——json 下不打 `Total` 行）；全市场/跨一年分片等大批量可 `GANGTISE_PAGE_CONCURRENCY=10` 提速（默认 5，同时管翻页与 K 线分片）
- **高积分操作先确认**：任何 50 积分/次及以上、或"按条 × 大批量"（如 `stock-summary` 全市场数千只、`opinion` 全量翻页、`concept-info` 500/次）→ 先估总积分告知用户再执行（单价见下「积分计费速查」）
- 下载**必选**格式未定才问：`independent-opinion --file-type`（必选）、`vault record/my-conference --content-type`（record 三种 original/asr/summary、my-conference 两种 asr/summary）；其余 download 有默认（多为 `1`=PDF/原始），用户没提格式就用默认、不必问
- list→download 用户没指定具体文件 → 展示前 10 条让用户挑

🟡 **自行判断**：
- 公司名 → 先速查表，否则 `reference securities-search`
- opaque ID → 先 `references/lookup-ids.md`
- 模糊时间词 → 查"时间词映射"
- 无时间范围且用户没要求全量 → 主动加 `--size 200` 兜底（不必问）；注意 CLI 省略 `--size` 会拉全量
- 预估结果 >200 行 → 别全量 `--format json` 引进上下文，改 `--format jsonl --output <file>` 落盘（CLI ≥1000 行自动流式、stdout 只回显文件路径），再 `wc -l` + `head` 采样呈现
- 路由到 AI 同步生成命令 → 7 个 agent 类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，无需前缀；`stock-summary` / `hot-topic` 仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。**贵档端点超时/5xx 已不再自动重试**（v0.26.0；重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调仍会**再扣一次**（实测无缓存豁免），所以一次调用给足超时比失败重跑省钱。`earnings-review` / `viewpoint-debate` 是异步（`--wait` 或 `*-check` 轮询），不吃这个超时
- "AI速记/智能摘要/会议纪要"→`summary`、"原始文件/原文件"→`original`、"语音识别/转写文本/ASR"→`asr` — 用户已明示时直接映射 content-type，不必问

### 积分计费速查

"免费"=0 积分；**只列单价**，数据范围见下一节。

- **免费**：所有 `quote` 行情、`fundamental` 报表/主营/估值/股东（**盈利预测除外**）、`reference`/`constant` 查询（含 `official-account-search`）、`alternative edb-search`、`vault`（record/wechat/股票池/drive/AI云盘）、`insight report-image list`
- **0.1/条 list**：research / foreign-report / official-account / announcement(A/港/美) / summary / qa / performance-calendar 的 list、`vault my-conference-list`；`insight report-image download` 0.1/张
- **按条（观点/含详情类 list）**：independent-opinion list 与 `ai security-clue` 5；roadshow/site-visit/strategy/forum list 20；opinion / foreign-opinion list 30；`fundamental earning-forecast` 0.5；`ai stock-summary` 3（无看点的证券不返回也不扣）；`alternative edb-data` 30
- **各 download（/篇）**：announcement / official-account / research 10；announcement-hk / announcement-us 20；independent-opinion 30；summary / foreign-report / my-conference 50；`performance-calendar download` A 股 10 / 港美股 20
- **按页**：`tool file-parse` 0.8/页，**提交（`--file`）时按实际页数一次性扣**，取结果（`file-parse-check`）免费——50 页 PDF = 40 积分，别重复提交同一文件
- 🔴 **按次贵**：`ai knowledge-batch` 10、`management-discuss-*` 10；AI Agent（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `earnings-review` / `viewpoint-debate` / `theme-tracking`）**50/次**；`ai hot-topic` 50/篇
- 🔴 **极贵**：`alternative concept-info` / `concept-securities` **500/次**
- ⚠️ **同参数重复调用不免费**：按次计费无缓存命中豁免（2026-07-11 实测 `one-pager` 重复调用每次扣分，即使秒回缓存内容）——生成类结果拿到后自行留存复用，别为"刷新"重调；CLI 已对上述 🔴 贵档端点关闭 5xx/超时自动重放，50/篇 的 `summary` / `foreign-report` / `my-conference` download、单价未公布但保守同档处理的 `pamirs-summary` download、以及 `tool file-parse` 的提交，同样不重放（共 18 个端点），正是为防重复扣分
- **按单元格**：`indicator cross-section` / `time-series` / `screener`（A股 0.05 / 港股 0.1 / 美股 0.2 积分每 100 单元格；screener 按**筛选前**范围计费，见 `indicator.md`）；`ai knowledge-resource-download` 按下游资源计费
- **单价未公布**：`insight pamirs-summary list` / `download`——spec 只写了「需购买专家纪要数据库」这个准入门槛，没给单次价格。**别据此假定免费**；大批量拉取前先小量试，或向平台确认

### 数据范围（能查多久）

正式账号口径（下表为官方公布值；实际可查范围随账号服务等级而定，以自己账号实测为准）：

| 命令组 | 可回溯 |
|--------|--------|
| `quote` 行情 / `fundamental` 财报、主营、估值、股东 / `indicator`（EDE） | 前溯 **5 年**（原 3 年） |
| `ai security-clue` 投研线索 | 前溯 **1 个月**（原 7 天） |
| 主题 / 热点 / QA / 日程（路演·调研·策略会·论坛）/ 纪要 / 观点 / 研报 / 公众号 | 前溯 **3 个月**（原 1 个月） |
| 管理层讨论 / A·港·美股公告 / `alternative edb-*` 行业指标 | 前溯 **3 年**（原 1 年） |
| `insight pamirs-summary` 帕米尔纪要 | **不限**（但需单独购买专家纪要库） |

⚠️ **这是官方口径，不是硬边界**：实际范围按账号等级而定，**同一账号下按接口还可能不同**（实测 `indicator screener` 仍卡 today−3 年，而同模块的 `cross-section`/`time-series` 已放宽）。超范围查询返回 `110003`，**不是空结果**——拿到 `110003` 就是撞了权限边界，缩窗口对「整段都在界外」的查询无效，要把日期移进范围或联系客户经理。

### 下载规则（`--file-type` / `--content-type`）

| 命令 | 参数 | 取值 |
|------|------|------|
| `insight research download` | `--file-type` | `1` PDF（默认）/ `2` Markdown |
| `insight foreign-report download` | `--file-type` | `1` PDF / `2` MD / `3` 中译 PDF / `4` 中译 MD |
| `insight announcement download` | `--file-type` | `1` PDF / `2` Markdown |
| `insight summary download` | `--file-type`（可选） | `1` 原始（默认）/ `2` HTML（仅会议平台来源） |
| `insight pamirs-summary download` | `--file-type`（可选） | `1` 原始（默认）/ `2` HTML（仅此两种） |
| `insight independent-opinion download` | `--file-type` **必选** | `1` 原文 HTML / `2` 翻译 HTML |
| `insight announcement-hk download` | `--file-type` | `1` 原始（默认）/ `2` Markdown |
| `insight announcement-us download` | `--file-type` | `1` 原始 PDF（默认）/ `2` Markdown |
| `insight official-account download` | `--file-type` | `1` txt（默认）/ `2` HTML |
| `vault record-download` | `--content-type` | `original` 原始文件 / `asr` 语音识别 / `summary` AI 速记 |
| `vault my-conference-download` | `--content-type` | `asr` 语音识别 / `summary` AI 速记 |

省略 `--output` 时 CLI 自动用真实标题做文件名（先读本地 title-cache，未命中则回查 list 接口）。**批量下载或下载旧文件**（跳过 list 直接按 ID 下）时 title-cache 大概率未命中、每个文件都回查一次 list，建议显式 `--output ./<名>.<ext>` 省掉回查。

## 意图路由表

| 用户意图 | 命令 |
|---------|------|
| 研报 / 券商报告 | `insight research list` |
| 外资研报 | `insight foreign-report list` |
| 首席观点 / 内资机构观点 / 分析师观点 | `insight opinion list` |
| 外资机构观点 / 外资券商观点 | `insight foreign-opinion list` |
| 外资独立观点 / 独立分析师观点 | `insight independent-opinion list` |
| 纪要 / 会议纪要（外部） | `insight summary list` |
| 帕米尔纪要 / 帕米尔专家纪要 / Pamirs | `insight pamirs-summary list`（专家纪要库，需单独购买；筛选项比 `summary` 少，无 `--source`/`--institution`/`--participant-role`） |
| 路演 / 调研 / 策略会 / 论坛 | `insight roadshow / site-visit / strategy / forum list` |
| 财报日历 / 业绩预告 / 业绩快报 / 财报披露排期 | `insight performance-calendar list`（**用 `--start-date`/`--end-date`，不是 `--start-time`**；全表体量很大且按条计费，CLI 强制要求日期范围 / `--security` / `--size` 三者至少其一；只给 `--security` 时另有 1000 行隐式上限，撞上限且 total 还有剩余=筛选可能没生效（标 `partial`、退出码 3），改用日期范围重查。下载原文 `performance-calendar download --performance-report-id`，仅 `hasAttachment: true` 可下） |
| A 股公告 / 公告 | `insight announcement list` |
| 港股公告 / HK 公告 | `insight announcement-hk list` |
| 美股公告 / US 公告 | `insight announcement-us list` |
| 公众号资讯 / 产业资讯 / 公众号文章 | `insight official-account list` |
| 投资者问答 / 互动平台 / 电话会议 / 调研纪要 QA | `insight qa list`（按证券，`--security-code` 必填；`--source`/`--question-category`/`--answer-important` 精筛） |
| 研报图表 / 研报图片搜索 | `insight report-image list`（`--keyword`；下载原图 `insight report-image download --chunk-id`） |
| 跨类型语义搜索（研报+纪要+...） | `ai knowledge-batch`（多个 `--resource-type`） |
| 知识库原文下载（搜到后取全文） | `ai knowledge-resource-download`（前置：`knowledge-batch` 拿 `resourceType`+`sourceId`；`250001`/旧 `433007`=组合不匹配） |
| 一页通 / 投资逻辑 / 同业对比 / 调研提纲 | `ai one-pager / investment-logic / peer-comparison / research-outline` |
| 个股看点 / 投研总结 / 公司速览 | `ai stock-summary`（`--security` **只收具体代码**，单次最多 6000 个；仅 A 股/港股。⚠️ 2026-08-14 起**不再支持** `aShares`/`hkStocks` 全市场批量） |
| 业绩点评（异步） | `ai earnings-review` |
| 观点 PK / 多空辩论（异步） | `ai viewpoint-debate` |
| 投研线索 | `ai security-clue`（前置：`reference securities-search` 拿 `gts-code`） |
| 主题跟踪 | `ai theme-tracking`（前置：`reference concept-search` 拿 `theme-id`） |
| 热点话题 / 早午晚报 | `ai hot-topic` |
| 管理层讨论（财报） | `ai management-discuss-announcement` |
| 管理层讨论（业绩会） | `ai management-discuss-earnings-call` |
| 日 K（历史，A 股 / 港股 / 美股 / 各类指数，可混查） | `quote day-kline` |
| 全部沪深京指数日 K / 要指数名称 | `quote index-day-kline`（**旧命令仍有两处 `day-kline` 做不到**：`--security all` 一次拿全部指数；返回 `securityName` 指数名称——`day-kline` 查指数只有代码没有名称） |
| ~~港股 / 美股日 K~~ | ⚠️ 已下线，用 `quote day-kline`（`day-kline-hk` / `day-kline-us` 仍可调但不校验代码） |
| 分钟 K（沪深 A 股 + 指数） | `quote minute-kline`（一次一只） |
| 实时行情（A / 港 / 美） | `quote realtime` |
| A股资金流向（主力/大单净流入，日频） | `quote fund-flow`（`--security` 或 `aShares` 全市场〔须带 `--start-date`/`--end-date`，按日自动分片〕；免费） |
| 单证券 A股完整利润表 / 资产负债 / 现金流（累计 / 单季） | `fundamental income-statement[-quarterly] / balance-sheet / cash-flow[-quarterly]` |
| 单证券 港股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-hk / balance-sheet-hk / cash-flow-hk` |
| 单证券 美股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-us / balance-sheet-us / cash-flow-us` |
| 单证券主营业务 / 收入结构 | `fundamental main-business` |
| A股单证券估值序列 / PE / PB / 历史分位 | `fundamental valuation-analysis` |
| A股盈利预测 / 一致预期 | `fundamental earning-forecast` |
| 前十大股东 | `fundamental top-holders` |
| 云盘文件 | `vault drive-list / drive-download` |
| 录音速记 | `vault record-list / record-download` |
| 我的会议（业绩会/策略会/路演内部记录） | `vault my-conference-list / my-conference-download` |
| 微信群消息 | `vault wechat-message-list`（先 `vault wechat-chatroom-list` 拿群 ID） |
| 自选股股票池 | `vault stock-pool-list / stock-pool-stocks` |
| 行业指标搜索（EDB） | `alternative edb-search` |
| 行业指标时序数据（EDB） | `alternative edb-data` |
| 题材画像 / 投资逻辑 / 行业空间 / 竞争格局 / 催化事件 | `alternative concept-info`（前置：`reference concept-search` 拿 `concept-id`） |
| 题材成分股 / 题材深度 F8 / 题材龙头 | `alternative concept-securities`（前置：`reference concept-search` 拿 `concept-id`） |
| 多证券已实现财务 / 估值指标搜索（含总市值） | `indicator search` |
| 多证券已实现指标截面（多指标 × 多证券，同一查询日期） | `indicator cross-section`（前置：`indicator search --format json` 通过三项校验） |
| 多证券已实现指标时序（单指标 × 多证券，按区间） | `indicator time-series`（前置：`indicator search --format json` 通过三项校验） |
| 条件选股 / 按指标筛股票（市值+PE+经营范围等多条件组合） | `indicator screener`（前置：`indicator search` 拿 code；范围可传板块 ID，见 `reference sector-search`） |
| 证券代码 / gtsCode 搜索 | `reference securities-search` |
| 首席 ID / 分析师 ID 搜索 | `reference chiefs-search`（按姓名/机构/团队，用于 `insight opinion --chief`） |
| 机构 ID 搜索（内资券商/外资/牵头/观点机构） | `reference institution-search`（按机构名，用于 `--institution` / `--broker`；免费） |
| 公众号 ID 搜索（按公众号名/机构/分类） | `reference official-account-search`（返回 `accountId`，喂 `insight official-account list --account-id`；免费） |
| 常量/枚举 ID（行业/城市/公告分类/区域） | `reference constant-list --category <code>`（分类代码用 `reference constant-category` 查） |
| 题材 ID 搜索 | `reference concept-search` |
| 板块 ID 搜索 | `reference sector-search` |
| 板块成分股 | `reference sector-constituents`（前置：`reference sector-search` 拿 `sector-id`） |
| PDF 转 Markdown / 解析文件 / 提取 PDF 正文 | `tool file-parse --file <x.pdf> --wait`（异步，0.8 积分/页，提交时扣；取结果 `tool file-parse-check --task-id`。**平台自有研报/公告优先用各 download 的 `--file-type 2` 直出 Markdown**，别花解析费） |

**易混淆消歧**：
- "纪要" → 外部信息走 `insight summary`；明确点名"帕米尔 / Pamirs"才走 `insight pamirs-summary`（另一个库，不是 `summary` 的子集）；公司内部录音/会议走 `vault my-conference`
- "搜索 X" → 数据维度精确（按行业/券商）走对应 `insight ... list`；跨类型语义搜索走 `ai knowledge-batch`
- 港股代码用在 `insight foreign-opinion --security` 还是 `quote day-kline-hk --security`？前者要"境外"格式（`UBER.N`），后者要 `.HK`
- "成分股" → 题材深度（分组/重点标记/纳入理由）走 `alternative concept-securities`；板块（行业/概念分类树，纯代码名单）走 `reference sector-constituents`
- **证券基本面 / 指标先按任务形态路由，不是搜到 EDE 就一律走 EDE**：
  - 单证券先优先对应 `fundamental` 专用命令（财务、估值、盈利预测、股东、主营或完整三大报表，多数免费 / 低价）。其中 `valuation-analysis` / `earning-forecast` 当前仅支持 A 股，港 / 美股的**估值历史分位**与**盈利预测**无可用口径。但**估值指标本身别照抄旧结论**：`finc_pe_ttm` 港股、`qte_mkt_cptl`/`shr_tot` 港美股都已有数。⚠️ **凡「仅 A 股」「无数据」这类否定结论都只是某时点抽查**，数据覆盖在持续扩展；负面结论过期不会报错、只会让你白白拒掉一个能跑的查询。**一律以当次 `scopeList` + 抽查为准**
  - 多证券批量取一组**已实现**财务 / 估值指标 → 优先 `indicator search` 后用 EDE 一次拉取，替代逐只循环；单日或同一报告期横向比较用 `cross-section`，区间走势用 `time-series`（后者不能多指标 × 多证券同时）。**批量按 code 回填加 `--key-by code`**（列头用 `indicatorCode`，防同名指标碰撞）。⚠️ **两个轴的顺序规则不同**：`indicatorList` = 请求顺序，但 **`securityCodeList` 是按代码升序重排的**（请求 `000858,600519,000001` → 回 `000001,000858,600519`）——**行绝不能按请求下标对位**，一律按 `security` 字段取值
  - ⚠️ **估值指标的历史序列：两个接口的财报口径切换时点不同**——`indicator time-series`（EDE）按**正式财报披露日**切，`fundamental valuation-analysis` 按**业绩快报**口径切、通常更早，所以同一天取到的估值指标可能不一样（已验证 `finc_pe_ttm`/`peTtm`；`finc_pb_mrq` 等非 TTM 口径同样在报告期节点变化，规则未单独验证）。做估值分位 / 回测时**两个接口都拉一遍交叉核**，尤其业绩大幅变动的标的（抽查中出现过个别标的在 `valuation-analysis` 侧长期未更新）。分叉时用「总市值 ÷ PE 反推隐含净利润」对照利润表滚动 TTM，即可判出哪侧是陈值。**判断某财报在某日是否已公开，用三大报表返回的 `earliestAnncDate`（首次公告日）**，不要用同一响应里的 `announcementDate`（它在部分证券上各期取值相同）；要交叉核实就查 `insight announcement list` 的公告披露日。
  - 始终排除 EDE：A股盈利预测 / 一致预期（含预测 EPS）→ `fundamental earning-forecast`；A股估值历史分位 → `fundamental valuation-analysis`；开高低收 / 成交量等行情与 K 线 → `quote`；单证券完整报表 → 对应三大报表命令。**例外：总市值只有 EDE 有**——`quote realtime` / `day-kline` 都不返回市值，走 `indicator cross-section --indicator qte_mkt_cptl`（2026-08-03 起 A/港/美股均有数，默认单位「元」，用 `--scale` 缩放）。EDE 搜到的基本 / 稀释 EPS 是已实现值，**不能冒充预测 EPS**；港 / 美股缺少上述专用能力时应如实说明不支持，不能用别的语义代替
  - EDE 取数前必须用 `search --format json` 同时核对：`indicatorName` + `description` 语义准确、`scopeList` 覆盖全部目标市场 / 证券类型、`parameterList` 必填参数与枚举可满足；`scopeList` 缺失 / `null` / 空或任一项不符，都视为无法证明覆盖并回退专用接口。专用接口也不覆盖目标市场时，说明当前不可用，不要硬调。`scopeList` 按指标各不相同，不能因 EDE 服务支持 A / 港 / 美股就假定某个指标三市场都覆盖
  - `indicator search` 免费，`cross-section` / `time-series` 按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`
- 行业 / 宏观指标（空调销量、社融等，无证券维度）走 `alternative edb-*`（EDB），不要与证券级 EDE 混用
- **EDE「没数据」和「代码写错」是两回事**（2026-08-15 实测）：**①代码写错 → 直接报 `100003` 并指名是哪个**（指标写错报「指标 xxx 不存在」，证券写错报「xxx 不是有效证券或者板块ID」，美股用 `.US` 而非 `.O`/`.N` 同理），**无论同批有没有其它正确的 code 都会报**，所以拼写错误现在是一眼可见的、不用再靠对照推断；**②代码有效但无数据 / 无覆盖 / 未来日期 → 行列都保留**（含单指标 × 单证券的 1×1）并给一个占位单元格，**退出码 0**。🔴 **占位值不统一、由指标决定**：多数是 `null`，但个别（最常用的是 `is_dnrpnp` 扣非归母净利润）填 **`0`**，而 `0` 会照常穿过比较与聚合——`screener` 的 `F1 > 0` 因此可能筛出空集、整列求均值可能差几十倍（茅台时序实测差 52 倍）。**别把 `0` 当真值**，无覆盖时它与真值无法区分，**和已知有数的标的一起查做对照仍然必要**，详见 `references/commands/indicator.md`。日期语义按指标分两类：财务报表指标=报告期末（可为非交易日）、`finc_pe_ttm` / `finc_pb_mrq` 等日频估值=最新交易日（⚠️ `finc_pb_mrq` 是日频的，用报告期末日期会取到几个月前的陈值）；混合取数按各自有效日期分次 `cross-section` 再按证券合并，别塞进同一个 `--date`。详见 `references/commands/indicator.md`
- **EDE 指标参数名一律以 `indicator search --format json` 的 `parameterList` 为准**，不要凭记忆或照抄示例。参数名写错会报 `100003` 并指出是哪个指标的哪个参数（如复权参数是 `adjustType`，写成 `adjustmentType` 直接报错），按报错信息改即可。⚠️ **报告期类指标（`is_*` 利润表等）必填 `reportDate`，不吃 `tradeDate`**——只传 `--date` 会报「不支持参数 tradeDate; 缺少必填参数 reportDate」，要补 `--indicator-param "code:reportDate=YYYY-MM-DD"`；行情 / 估值类（`qte_*` / `finc_*`）用 `--date` 即可。`--security` 支持板块 ID（`reference sector-search` 的 10 位 `sectorId`；`--indicator` 只收指标编码）。根级 `--scale` 只作用于声明了 `scale` 的指标，价格与金额可以混查。
- **新增指标**：融资融券 21 个 `mgn_*`（`mgn_bal` 两融余额 / `mgn_fin_*` 融资 / `mgn_sl_*` 融券 / `mgn_flag` 是否标的，**仅 A 股有数**；区间类的 `changePeriod` 2026-08-14 起改为**可选**）；行业分类 `scr_indu`（一个指标覆盖申万/中信/恒生/GICS 四套，**必填** `industryType` 1-4 + `industryLevel` 0-4，A/港/美股均支持，返回字符串），2026-08-14 又加了三个**行业组合指标** `scr_indu_citic` / `scr_indu_sw` / `scr_indu_gics`（体系写进编码，只需可选的 `industryLevel`；单套体系用它们更省事，横比多套仍用 `scr_indu`）
- "业绩点评"双义消歧：**检索已有**（研报/纪要里的业绩点评内容）走 `insight ... list --llm-tag earningsReview`（0.1/条）；**AI 现生成**一份走 `ai earnings-review`（异步、50/次）。不确定问一句

## 公司名 → 证券代码

**速查表**（仅 mega-cap，命中率不高的一律走 securities-search）：

| 公司 | A 股 | 港股 | 美股 |
|------|------|------|------|
| 贵州茅台 | `600519.SH` | — | — |
| 宁德时代 | `300750.SZ` | — | — |
| 比亚迪 | `002594.SZ` | `01211.HK` | — |
| 中国平安 | `601318.SH` | `02318.HK` | — |
| 腾讯控股 | — | `00700.HK` | — |
| 苹果 Apple | — | — | `AAPL.O` |
| 微软 Microsoft | — | — | `MSFT.O` |

**其余一律**：
```bash
gangtise reference securities-search --keyword <公司名> --category stock --top 3 --format json
```
取 `data.list[0].gtsCode`。matchScore < 0.5 时让用户从前 3 条选。

**交易所后缀**：`.SH` 上交所（6 开头）｜ `.SZ` 深交所（0/3 开头）｜ `.BJ` 北交所 ｜ `.HK` 港股 ｜ `.O` 纳斯达克 ｜ `.N` 纽交所 ｜ `.A` AMEX。

**跨市场**：日 K 线需分别调对应命令（`day-kline` / `day-kline-hk` / `day-kline-us`）。**实时行情可一次混合**：`quote realtime --security 600519.SH --security 00700.HK --security AAPL.O` 单接口同时返回。

## 响应解析骨架（5 类通用模式）

| 模式 | 出现命令 | 结构 | 处理 |
|------|---------|------|------|
| **列表** | 大多数 `list` | `{list: [...], total: N}` | 遍历 list；CLI 已自动翻页 |
| **下载** | 各 `download` | stdout = 文件路径字符串 | 直接读 stdout 整行 |
| **AI 内容** | one-pager / investment-logic / peer-comparison / research-outline | `{content: "markdown文本"}` | 取 `content` 直接呈现 |
| **K 线** | quote * | `{list: [{tradeDate, ...}]}` | 按 tradeDate 排序，取需要的尾部 |
| **异步（含 *-check）** | earnings-review / viewpoint-debate / earnings-review-check / viewpoint-debate-check | 提交 `{dataId, status, hint}`；check 成功 `{date, content}` / pending `{status:"pending"}` 或抛 `140001`（旧 `410110`） | 见下方"异步任务流程" |
| **异步文件** | tool file-parse / file-parse-check | 提交 `{taskId, status, hint}`；就绪后 stdout = ZIP 路径，未就绪 `{status:"pending"}` | 解压取 `file.md`；重取用 `file-parse-check`（免费），别重跑 `file-parse`（按页重扣） |

完整字段对照见 `references/response-schema.md`。

### 异步任务流程

`earnings-review` / `viewpoint-debate` 异步生成，两条路径：

- **`--wait`（推荐）**：命令带 `--wait` 阻塞到出结果（CLI 内轮询最长 ≈316s）。**把工具/命令超时设到 ≥360s**，否则外层先超时。直接拿 `{date, content}` 呈现。
- **手动轮询**（不带 `--wait`）：① 提交 → 拿 `{dataId, status, hint}`；② 间隔 ~30s 调 `*-check --data-id <id>`（预算给足 ~2-3 分钟）；③ `{date, content}`=成功 / `{status:"pending"}`=继续等 / 终态失败=换参重试；④ 多次仍 pending → 把 `dataId` 交用户稍后再 check。

**别把原始码甩给用户**：`140001`/旧 `410110`=生成中（继续等）、`140002`/旧 `410111`=终态失败（换参），按 `status` + 退出码判断后用人话说明。

### 呈现规范

- 列表 ≤20 行表格 + 总数；>20 条仅展示前 20 条 + 询问是否导出全量
- 下载完成后告知文件路径
- AI content 直接 markdown 呈现
- K 线展示最近 10 个交易日表格

## 时间词映射

| 模糊词 | Insight / Vault / AI | Quote K 线 | Fundamental（财报/估值） |
|--------|---------------------|-----------|----------------------|
| 最近 / 近期 | 7 天 | 45 天 | 1 年 |
| 最近一周 | 7 天 | 7 天 | — |
| 最近一个月 | 30 天 | 30 天 | — |
| 过去一年 / 近一年 | 1 年 | 1 年 | 1 年 |
| 今年 | 1/1 至今 | 1/1 至今 | 1/1 至今 |
| 今天 / 今日 | 当天（`start=end=`今天） | 见下行「最新 / 今日 / 当前（K 线）」 | — |
| 最新 / 今日 / 当前（K 线） | — | **45 天范围 → 从尾部取最近交易日**，不要只用 `--limit` | — |
| 最新一期 / 最新报告期（财报） | — | — | 省略 `--fiscal-year`，传 `--period latest`（默认） |
| 最新观点 / 今日观点 | 1 天范围 + `--rank-type 2` | — | — |

日期参数**按参数名判断、不按命令组**（命令组会误导——AI 里既有 `--start-time` 又有 `--date`/`--report-date`；Insight 里 `performance-calendar` 是唯一用 `--start-date`/`--end-date` 的 list）：名字带 `-date` 的（`--start-date`/`--end-date`/`--date`/`--report-date`）一律 `YYYY-MM-DD`，覆盖 Quote/Fundamental、`insight performance-calendar`、AI 的 `theme-tracking`(`--date`)/`hot-topic`/`management-discuss-*`(`--report-date`)、Alternative `edb-data`、Indicator `cross-section`(`--date`)/`time-series`；名字带 `-time` 的（`--start-time`/`--end-time`）用 `YYYY-MM-DD[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔）或 10/13 位时间戳，覆盖 Insight/Vault 各 list、`quote minute-kline`、`ai security-clue`、`ai knowledge-batch`。其中 **A 股公告（`insight announcement list`）与 `knowledge-batch` 会把输入转成 13 位毫秒**（10 位秒自动 ×1000），其余 `-time` 命令（含 `announcement-hk`/`announcement-us`）原样透传字符串；CLI 输入统一接受 10/13 位纯数字或 `YYYY-MM-DD[ HH:mm[:ss]]`（同上：秒可省、空格或 `T` 分隔）。

支持排序切换的命令：opinion / summary / pamirs-summary / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。**要最新的加 `--rank-type 2`（严格按 `publishTime` 倒序）；要最相关的用默认 `--rank-type 1` + `--keyword`（综合排序按相关度挑条目）**——两者从同一结果集里取的是**不同的子集**，不是同一批内容换个排法。🔴 **`--search-type` 不改变 `--rank-type 1` 取回哪些条目**（实测 19 组 0 反例，前 50 逐位相同，其中一组 `total` 从 1522 涨到 45257 仍逐位不变），**要相关度不必加 `--search-type 2`**；它扩大的是命中总数和 `--rank-type 2` 的候选池。🔴 **两档差别有多大取决于关键词，别拿一个词判断参数有没有用**：有些关键词下两档返回同一批，有些交集接近 0，判据见 `insight.md` 开头。⚠️ 综合排序**挑完之后仍按时间倒序排列**，所以别用「结果是不是时间倒序」判断它有没有生效，要比条目 ID。没有 `--keyword` 时两者无差异，属正常。详见 `insight.md` 开头。其他 list 命令按 API 默认排序。

## 异常处理

服务端 2026-07-17 重排了错误码（41 个公开码，三层：`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层），信封新增 `errorType` 和 `traceId`。

**2026-07-20 逐码实测的结论：迁移是按「错误处理层」而非按业务模块进行的，不能假定文档即现状。**
- 判别方式：**新码 `code` 是 JSON 数字且带 `errorType`；旧码是字符串且没有**。但这判断的是**这一条错误路径**切没切，不是整个接口——同一个 Insight 接口内，参数校验已发新码 `100003`、路由不存在发新码 `999010`，方法用错却仍发旧码 `900002`。（成功响应也没有 `errorType`，别拿它当判据。）
- **异步端点（`earnings-review` / `viewpoint-debate`）的生成状态没切**——实测仍是 `410110`/`410111`，HTTP 400，无 `errorType`
- **token 过滤器没切**——仍是 `0000001007`/`0000001008`；方法路由层的 `900002` 同理
- 参数校验层、路由层已切
- 更外层的未知路径（不属于任何已识别路由）**根本不返回统一信封**，是纯文本 `default backend - 404`
- CLI 对两代都认，报错行带 `[trace <id>]`，**报障给 Gangtise 时务必带上这个 traceId**

**实测确认在用的码**（按遇到概率排；✅=已实测复现）

| 错误码 | 含义 | CLI 行为 | Agent 是否介入 |
|--------|------|---------|--------------|
| ✅ `100003` | 参数值非法——**最宽的兜底码**：类型错、`limit` 越界都归这里。**msg 通常已指明字段**（如「请求体字段类型不匹配: size 期望类型 Integer」「limit 最小为 1，最大为 10000」），先读 msg 再猜 | — | 按 msg 指的字段改；msg 没指明才对照 `--help` 查枚举拼写，**不要重试同命令** |
| ✅ `999999` | 系统错误。**`indicator`（EDE）2026-08-01 前用此码表示查询无数据，之后改为返回数据体**，所以这个码基本只剩真故障。⚠️ 现在「无数据」是保留行列的占位单元格（多为 `null`，个别指标是 `0`，见 `indicator.md`），**不是空表**；空表另有含义（整轴 code 未识别） | 普通端点自动重试 ×2；🔴 贵档与 `indicator` 端点不重试 | 确认参数无误仍报此码即服务端故障 |
| ✅ `410110` | **异步生成中**（HTTP 400，旧码未切）。新码 `140001`，CLI 两码都认 | 轮询视为 pending | 继续等 |
| ✅ `410111` | **异步生成失败**（HTTP 400，旧码未切）。新码 `140002`，CLI 两码都认 | 终态 | **不重试**，换参数 |
| ✅ `130002` | 资源不存在——下载类的常见码：`reportId` 不存在 / 非数字多归此码。另有更具体的 `130003`（资源未生成 / 无附件）与 `130005`（`fileType` 非法） | — | 确认 ID 有效且本账号可见；换 `--file-type` 或换一篇验证 |
| ✅ `130001` | 数据未找到，或**该指标无权限**（`indicator` 内层失败会带具体 msg 如"指标无权限"） | — | 检查查询条件与指标权限 |
| ✅ `100001` | 缺必填参数——**msg 带字段名**（「缺少必填参数: reportId」） | — | 按 msg 指的字段补上 |
| ✅ `110001` / `110002` | 日期格式错（msg 带字段名）/ 起晚于止。⚠️ **服务端 2026-08-14 起对多种格式做宽松解析**（`2026/07/01`、`20260701`、`07/01/2026` 都能被接受），所以「没报 110001」不等于「格式被按你的意思理解了」 | — | 按参数名：`--*-date` 用 `YYYY-MM-DD`、`--*-time` 用 `YYYY-MM-DD HH:mm:ss`；`ai knowledge-batch` 的 --start-time/--end-time 收时间戳或 datetime，CLI 统一转 13 位毫秒 |
| ✅ `120001` | 证券代码无效——msg 带原因（「非有效A股」）。Fundamental 系与 `quote day-kline`/`realtime`/`minute-kline`/`fund-flow` 都会报；**旧版 `day-kline-hk`/`day-kline-us`/`index-day-kline` 仍静默返回空** | — | `reference securities-search` 确认代码与后缀（`600519.SH` / `00700.HK`） |
| ✅ `110003` | **超出账号数据权限的时间范围**。范围按账号等级而定、**不是平台常量**，且**同一账号下按接口还可能不一样**——出现过同日同指标同证券 `cross-section` 取得到、`indicator screener` 却报此码的情况 | — | 把日期移进权限范围内；整个区间都早于下界时缩短窗口无用（`--fiscal-year 2015` 无论怎么缩都报错）。`screener` 撞界改用 `cross-section` 拉数再本地筛，否则联系客户经理开通 |
| ✅ `100006` | 查询/下载数量超限——**取代旧 `430007`**；实测 `fund-flow` 全市场不传日期即此码 | — | 缩短日期范围或调小 `--size`/`--limit`；全市场场景应已自动分片 |
| ✅ `240001` | 财报期未披露或超出查询期（`earnings-review` 提交阶段就报，**不扣积分**） | — | 换更早的 `--period`（`2025q3` → `2025interim`） |
| ✅ `250001` | 不支持的数据源——**取代旧 `433007`** | — | 检查 `resourceType + sourceId` 组合 |
| ✅ `999011` | 开发账号凭证无效——**取代旧 `8000014`/`8000015`，已合并，不再区分 AK 错还是 SK 错** | 登录即失败，**不重试** | 检查 `GANGTISE_ACCESS_KEY`/`GANGTISE_SECRET_KEY` 是否写反或未 export |
| ✅ `999010` | 接口地址不存在 | — | `raw call` 的 key 可能已下线，用 `gangtise raw list` 核对 |
| ✅ `999004` | 无资源权限。**整库未开通与单条记录不可见都走这个码**——`insight pamirs-summary list`（专家纪要库需单独购买）未开通时即报此码 | — | `list` 撞上多为整库未开通，先确认该数据库是否已购买；`download` 撞上再考虑换一条本账号可见的记录 |
| ✅ `0000001008` | Token 服务端失效（他处登录挤掉）——**旧码未切，token 自愈依赖它** | **强制重新登录并重试一次** | 无 AK/SK 时无法自愈，提示重新登录 |
| ✅ `0000001007` | 请求未携带 Bearer token | — | 检查 `GANGTISE_TOKEN` / AK/SK 是否已 export |
| ✅ `900002` | **请求方法不正确**（msg「请求类型有误」，HTTP 405） | — | `raw call` 时确认该 endpoint 是 GET 还是 POST |
| ✅ `140002` | 终态参数错：AI 异步生成失败，或 `indicator` 的指标必填参数缺失 / 枚举越界 / 表达式语法错（实测 2026-08-02） | **不重试**（终态码） | 按 msg 改参数重提；EDE 的参数名与枚举读 `indicator search --format json` 的 `parameterList` |

**⚠️ 几类"不报错"的坑（最难发现，逐条都关系到拿没拿到对的数）**
- **日期只写 `YYYY-MM-DD`、时间只写 `YYYY-MM-DD HH:mm:ss`（或 10/13 位时间戳）**。CLI v0.28.0 起 date 与 datetime 两类（含所有 insight/vault 透传参数）都在发请求前校验，其余写法直接报 `ValidationError`。接口本身能接受多种格式，但**「年在后」写法（`01-07-2026`）存在月/日歧义**——会按月在前读作 1 月 7 日，本意写 7 月 1 日的就拿到差半年的数据且不报错。**CLI 只放行 `YYYY-MM-DD` 就是为了堵掉这个歧义，这是有意的**；绕过 CLI 直连接口时务必自己用标准格式
- **财报接口的日期按「报告期末」过滤**，不是公告日：`fundamental balance-sheet` 等的 `--start-date`/`--end-date` 匹配的是 `endDate` 字段（如 `20200630`）；公告日看 `earliestAnncDate`（首次公告日，做时点对齐用这个）而不是 `announcementDate`。**查某期财报要传季度末日期**（`2020-06-30` / `2020-03-31` / `2020-09-30` / `2020-12-31`）；传 `2020-07-01` 这类非报告期日期会返回 0 行，属正常行为，不是没数据
- **非法证券代码**：`quote day-kline` / `realtime` / `minute-kline` / `fund-flow` 与 Fundamental 系都会报 `120001`，按报错核对后缀即可。⚠️ **三个已下线的旧端点 `quote day-kline-hk` / `day-kline-us` / `index-day-kline` 则返回 `total:0`**，与"该票该区间真无数据"无法区分——**用这三个拿到空结果时先回头核对代码后缀**。它们的能力已并入统一 `day-kline`（支持 A 股 / 港股 / 美股 / 交易所指数 / 概念指数 `.GT` / 申万行业指数 `.SWI`），新代码直接用 `day-kline`
- **枚举值拼错的后果按端点不同，且部分端点不报错**：纪要 `summary`、三个公告 list、路演 `roadshow`、调研 `site-visit` 的 `--search-type` / `--rank-type` / `--category` / `--market` 等传非法值会报 `100005`；而 `insight research`（内资研报）、`foreign-report`（外资研报）、`official-account`、`opinion` 上非法值被**静默忽略**，该筛选按未传处理。🔴 **最坏的一种**：`research` / `foreign-report` 上非法的 `--search-type` 会**连带吞掉 `--keyword`**——`research list --keyword 茅台 --search-type 99` 拿到的是**未经筛选的全库**，与不传 `--keyword` 的结果一致，而不是搜索结果。**v0.32.0 起 CLI 本地拦截**：全部 `--search-type` / `--rank-type`（19 处）、全部 `--file-type`（9 处下载，`foreign-report` 为 1–4、其余 1–2）、`pamirs-summary` 的 `--category` / `--market`、`--top` 上限、以及 `reference securities-search` / `institution-search` / `official-account-search` 的 `--category`。**仍未覆盖**：`insight research/summary --category`、`--market`、`--source`、`--llm-tag` 等仍是自由字符串，拼错不报错也不生效——这些要自己核对。**拼错的筛选条件会伪装成"结果正常"，枚举拼写要自己保证**
- **`viewpoint-debate` 传敏感内容不会被提前拦截**——实测不返回 `240002`，而是照常受理、扣满 50 积分、生成阶段才以 `410111` 失败。**提交前自己把关措辞**
- **`ai one-pager` 的非法 `mode` 被静默忽略**，照常生成并扣 50 积分

**官方文档列出、但实测未触发的码**（遇到再查，多数被上面的兜底码接管）

| 错误码 | 含义 | 实测情况 |
|--------|------|---------|
| `999001` / `999002` | 缺 token / token 无效 | 实际返回旧码 `0000001007` / `0000001008` |
| `999007` / `999008` / `999009` | 方法/媒体类型/请求体不支持 | 实际返回 `900002` / `999999` / `100003` |
| `999003` / `999005` / `999006` | 无接口权限 / 积分不足 / 限流 | 未构造出（需特定账号状态） |
| `999012`–`999016` | 账号禁用/过期、租户失效、无长期 token、IP 不合规 | 未构造出 |
| `100002` / `100004` / `100005` | 类型错 / 分页非法 / 枚举非法 | 类型错归 `100003`。**`100005` 与 `100006` 2026-08-14 起在部分 list 上真会触发**（枚举非法、`size` 超 50）；未覆盖的端点（`research` / `foreign-report` / `opinion` / `official-account`）仍按未传处理，见上方「实测发现的坑」 |
| `130004` | 下载 ID 非数字 | 多归 `130002` |
| `140001` / `140002` | 结果生成中 / 处理失败 | 异步端点仍用 `410110` / `410111` |
| `210001` / `220001` / `230001` | 研报/观点/分享文件不支持下载 | 未构造出 |
| `230002` | 微信账号未绑定（私域，2026-08-07 新增）。⚠️ **`vault wechat-*` 就在该模块下、够得着**：要求先绑定并激活群消息助理且助理已入群 | 未构造出（本账号已绑定） |
| `240002` / `240003` | 敏感词 / 模式不支持 | 敏感词走 `410111`；`one-pager` 的非法 `mode` 被静默忽略 |
| `903301` / `10011401` | 今日调用上限 / 白名单未开通 | 历史遗留，**均未实测触发**。不臆断对应新码——`10011401` 按语义更接近 `999003`（未开通接口权限）而非 `999016`（IP 限制），别据此去查 IP |

**非错误码**

| 情形 | CLI 行为 | Agent 是否介入 |
|------|---------|--------------|
| HTTP 5xx / `ECONNRESET` / 超时 | **自动指数退避重试 ×2**（🔴 贵档端点不重放） | 仍失败提示用户 |
| `ValidationError` | 本地参数校验失败 | 检查 `--from` / `--size` / `--limit` 数值，**不要重试同命令** |

**其他场景**：
- CLI 未安装 → `npm install -g gangtise-openapi-cli`
- **退出码 3 = `partial: true`，结果少了数据**（保留已取到的部分；stderr 有 warning，`--format json` 才看得见标记，table/csv/jsonl 只有数据行、看不出问题）：
  - 触发场景：翻页/K线分片有页失败、服务端返回行数与 `total` 矛盾（提前短页）、`total` 撞服务端上限（`totalCapped`，见 opinion 家族）。附带定位字段：页失败 `failedPages`；分片失败 `failedShards`、分片撞行数上限 `truncatedShards`（均带日期区间可缩窗补拉）。⚠️ EDE 的 `omittedIndicators` / `omittedSecurities` 仍在代码里，但 2026-08-15 起写错的 code 在服务端就被 `100003` 拒了（退出 1），这条路基本收不到样本
  - **EDE 代码写错现在是退出码 1 + `100003`，msg 里直接点名是哪个 code**（美股后缀用 `.O`/`.N`，不是 `.US`），不用再从退出码 3 反推。真的没覆盖仍是占位单元格（多数 `null`、个别指标 `0`）+ 退出码 0
  - **`screener` 的缺列按表达式的布尔结构判**：把缺列的变量当作「无法求值」，看整个表达式**是否还有一条能成立的分支**——`A && B` 要两边都可求值，`A || B` 只要一边。**一条分支都不剩 → 退出码 1、不输出任何结果**（返回的行以「通过了该条件」的名义呈现，而条件根本无法证明被执行过）；**还有分支可求值，或缺的只是未参与表达式的辅助变量 → `partial` + 退出码 3**。所以 `F1 || F2` 缺 F1 是降级（行可能靠 F2 正当命中），缺两个则是致命；`F1 && (F2 || F3)` 缺 F1 仍是致命（F1 是必选合取项）。⚠️ **前提是服务端返回了命中行**——零命中时走「nothing matched」+ **退出码 0**。**空集别急着当成「条件成立但无标的符合」**：指标码写错现在会直接报 `100003`（退出 1），所以剩下的头号嫌疑是**占位值 `0`** —— `F1 > 0` 在 `is_dnrpnp` 这类填 `0` 的指标上必然筛出空集
  - 拿到 3 就必须告知用户缺了哪段，不能当成功静默继续
- 空结果（list 为空数组） → 建议扩大时间范围、换关键词、去掉部分筛选
- 模糊公司名匹配多只（"平安" → 中国平安 / 平安银行 / ...） → 列出让用户选
- 下载文件路径冲突 → 询问覆盖

## Troubleshooting（常见困境自救）

按问题→诊断顺序依次尝试，第一条解决就停。

**`securities-search` 找不到公司**
1. 试拼音 / 首字母（如"贵州茅台"试 `gzmt`）
2. 去掉"股份/有限公司/集团"等后缀重试
3. 不传 `--category` 查所有分类（可能是 fund / DR）
4. 还不行 → 请用户提供精确代码

**`list` 全空但参数看着对**
1. 时间窗太窄 → 扩到 30 天试
2. `--security` 后缀拼错（如 `300750` 漏了 `.SZ`）
3. 行业 ID 用错体系：`--industry`（用 `citicIndustry` 码 `1008001xx`）/ `--research-area`（行业同样用 `citicIndustry` 码 `1008001xx`，方向才用 `gangtiseIndustry` 码 `122000xxx`——`gangtiseIndustry` 里**只有 6 条方向码、没有行业**）/ `--gts-code`（申万 `821xxx.SWI`）。申万数字码 `104xx0000` 用于 `--research-area` 时多数端点返 0，详见 `references/commands/reference-and-lookup.md`
4. `--rating` / `--category` 等枚举值拼错（参考对应命令的 references 文件）

**`999011` 凭证无效**（旧码 `8000014`/`8000015`；不区分是 AK 错还是 SK 错，**登录直接失败、CLI 不重试**）
1. `echo $GANGTISE_ACCESS_KEY` 验环境变量是否 export
2. AK 和 SK 是否写反
3. 账号是否到期 / 异常（`gangtise auth status`；对应 `999012`/`999013`）

**异步任务 `410111` 反复**（生成失败，终态）
1. `viewpoint-debate`：先检查观点措辞——实测敏感内容不会被提前拦截，会扣满 50 积分再以 `410111` 失败
2. `earnings-review`：换更早的 `--period`（如 `2025q3` → `2025interim`）
3. `report-date` 用已发布的标准期：`xxxx-06-30` / `xxxx-12-31`
4. 若提交阶段就返回 `240001`（财报期未披露），说明该期不可查且**未扣积分**，别再换参数试
5. 直接告知用户该期数据暂不可用

**K 线返回的不是"最近"几条** → 只用 `--limit` 截的是窗口开头。必须改用 `--start-date`/`--end-date` 拉范围，再从结果尾部按 `tradeDate` 取最近 N 条。

**翻页很慢 / 卡住** → `--verbose` 看哪一页慢；可 `GANGTISE_PAGE_CONCURRENCY=10` 提速，或缩小时间范围。

**全市场 K 线报 `100006`**（旧码 `430007`）→ 单日数据仍超 10K 行（极端情况）→ 临时改用更窄的 `--start-date`/`--end-date`，或改为单只 `--security` 单独拉。

**`quote day-kline --security all` 被 CLI 拒**（`'all' is not a whole-market keyword`）→ 服务端 2026-08-14 停止支持该写法 → 换成 `aShares` / `hkStocks` / `usStocks` 之一，单独传。

**AI agent 命令（one-pager 等）超时** → 服务端生成耗时长，CLI 默认 30s → `GANGTISE_TIMEOUT_MS=120000` 后重试。

**估值结果出现大量 `null`** → 最新交易日数据未入库 → 加 `--skip-null` 过滤掉 `value` / `percentileRank` 为 null 的行。

**下载文件名乱码 / 截断** → terminal locale 或 shell quoting 问题 → 显式 `--output ./<title>.<ext>` 避开。

**同一公司既是股票又是 DR** → `securities-search` 默认返回所有分类 → 加 `--category stock` 收敛。

**`sector-constituents` 返回 0 条** → sectorId 不对（题材 conceptId 与板块 sectorId 是两套 ID，不通用）→ 先 `reference sector-search --keyword <名>` 拿 `sectorId` 重试。

## 详细参数

按需 Read 对应文件：

- 内资观点 / 纪要 / 路演 / 调研 / 策略 / 论坛 / 财报日历（performance-calendar）/ 研报 / 外资研报 / A 股公告 / 港股公告 / 美股公告 / 外资观点 / 独立观点 / 公众号（official-account）/ 投资者问答（qa）/ 研报图表（report-image）→ `references/commands/insight.md`
- 行情命令（A 股 / 港股 / 美股日 K / 指数日 K / 分钟 K / 实时行情 / 资金流向 fund-flow） → `references/commands/quote.md`
- 三大报表（A 股 / 港股 / 美股）/ 主营 / 估值 / 盈利预测 / 股东 → `references/commands/fundamental.md`
- knowledge-batch / security-clue / 个股看点（stock-summary）/ AI agent / 异步任务 / 主题跟踪 / 热点 / 管理层讨论 → `references/commands/ai.md`
- drive / record / my-conference / wechat / 股票池 → `references/commands/vault.md`
- 行业指标数据库（EDB）/ 题材指数画像与成分股（concept-info / concept-securities）→ `references/commands/alternative.md`
- 数据指标（EDE：search / cross-section / time-series / screener，证券级指标截面、时序与条件选股）→ `references/commands/indicator.md`
- PDF 解析（file-parse：上传 PDF → Markdown + 图片 ZIP）→ `references/commands/tool.md`
- securities-search / chiefs-search（首席 ID）/ institution-search（机构 ID）/ official-account-search（公众号 ID）/ 常量查询（constant-category / constant-list）/ 题材 ID（concept-search）/ 板块（sector-search / sector-constituents）/ lookup 本地表 / 行业别名 / raw call → `references/commands/reference-and-lookup.md`

跑通流程对照 → `references/examples.md`
