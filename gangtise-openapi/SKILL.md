---
name: gangtise-openapi
version: "0.38.0"
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
> **错误码全表 / 退出码 / 困境自救 → `references/errors.md`**

## 必备规则

1. **`--format json`**：列表/数据类必加。AI 内容生成（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `*-check`）也加 json，但呈现时**直接取 `content` 字段**，不要展示 JSON 包装层。
2. **opaque ID**：先读 `references/lookup-ids.md`；找不到再按类型查：行业/区域/公告分类/城市 → `reference constant-list --category <分类>`（分类代码用 `reference constant-category` 查）；题材 → `reference concept-search --keyword <名>`；板块 → `reference sector-search --keyword <名>`；申万 `--gts-code` 行业代码全量 → `sector-search --keyword 申万一级行业指数` 取指数数据板块层级的 sectorId 再 `sector-constituents`；券商/牵头/观点机构（按名称找 ID）→ `reference institution-search --keyword <名> [--category ...]`（服务端搜索，返回 `institutionId` + `usageScopes` 标明该 ID 用于哪个接口的哪个参数；覆盖 `--broker` / `--institution` 全部 5 类机构，含 `foreignOpinionInstitution`）——仅当要**全量枚举**时才用本地表 `gangtise lookup broker-org/meeting-org list`（institution-search 是搜索型：top≤10、非全量）。**绝不猜测**。
3. **公司名 → 证券代码**：先查下方速查表（5 只 mega-cap），其余一律 `gangtise reference securities-search --keyword <名> --category stock` 取 `list[0].gtsCode`。
4. **时间格式**：datetime `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date `YYYY-MM-DD`（`YYYY/MM/DD`、`YYYYMMDD` 也收，会归一；**年在后写法一律拒绝**）。
5. **多值参数**：优先重复传（最稳、最明确）：`--security 600519.SH --security 000858.SZ`。CLI 也支持半/全角逗号分隔（语音输入容错），但重复传不易被 shell 吞。
6. **K 线"最近 N 条"**：必须用 `--start-date`/`--end-date` 拉日期范围，从结果按 `tradeDate` 取尾部最近 N 条。**不要只用 `--limit N`**（截取的是窗口开头）。
6.1. **日 K 仅历史**：`day-kline` **不返回盘中实时数据**。当日数据入库时间：A 股 ~15:30 / 港股 ~16:30 / 美股 ~07:00（北京时间）。需要盘中快照请走 `quote realtime`。
6.1.1. 🔴 **`quote day-kline` 一个命令覆盖 A 股 / 港股 / 美股 / 沪深 ETF / 各类指数（含 20 个全球指数）**，可混着传代码。**全市场关键字是 `aShares` / `hkStocks` / `usStocks`，必须单独传**（不能与代码或另一个关键字混填；`--security all` 会被 CLI 拒并提示改用哪个）。**关键字只覆盖个股**：ETF 与各类指数（`.SH`/`.SZ`/`.BJ` 交易所指数、`.GT` 概念、`.CI`/`.SWI` 行业、`SPX.SPI` 等全球指数，清单见 `references/commands/quote.md`）须逐个传代码。全球指数 realtime 的 `volume` / `amount` / `amplitude` 与分钟 K 的 `volume` / `amount` 为 `null`，日 K 只有 `amount` 为 `null`；`tradeTime` 是交易所当地时间。`day-kline-hk` / `day-kline-us` / `index-day-kline` 已下线（接口仍可调、仍用 `all`），**新代码别用**——它们不校验证券代码，传错返空而不报错。
6.2. **多标的日 K**：显式传多个 `--security` 时，「证券数 × 交易日数」不超过 `--limit`（默认 6000 / 上限 10000）走单请求；超过则 CLI 自动逐只请求并按传入顺序合并，每只各自受 `--limit` 约束，撞上的标 `partial` + `truncatedSecurities`、退出码 3。单只超 10000 行仍要缩日期区间分批。
7. **CLI 已内置自动化，不要手动复刻**：
   - 翻页 → 首页拿 total 后剩余页并发拉取；🔴 **全量拉取结束会多探一行验证 `total` 是不是服务端封顶**（`opinion` / `foreign-opinion` / `independent-opinion` 的 `total` 恒为 10000 但实际远不止）——探到就标 `partial` + `totalCapped` + 退出 3，**这时导出的是截断结果，要缩小时间范围分片拉**
   - K 线全市场关键字（`aShares` / `hkStocks` / `usStocks`；旧命令 `all`）跨日期 → 自动按日切片并合并，粒度按各市场单日行数定（A 1 天 / 港 2 天 / 美 1 天）
   - 5xx / `429` / 网络错误 / `999999` → 自动指数退避重试（🔴 贵档端点例外：仅连接失败 / 429 / token 自愈重试，5xx/超时不重放防重复扣分；`indicator` 端点对 `999999` 不重试）
   - Token 失效（`0000001008` / `999002`，含已废弃的 `8000014`/`8000015`）→ 自动重新登录并重试一次；凭证错 `999011` → **不重试**（AK/SK 不对不会自己好），查环境变量
8. **参数命名差异**：Insight/Quote/Vault 用 `--security`，Fundamental/AI 用 `--security-code`（例外：`ai stock-summary` 用 `--security`，`ai security-clue` 用 `--gts-code`）。
9. **调试**：`--verbose` 或 `GANGTISE_VERBOSE=1` 打印每个请求的耗时/字节数到 stderr。
10. **`--field` 字段名必须核对，不确定就别传**（返回全量最稳）。上游对不存在的字段名有两种处理：`quote` 系（realtime / day-kline / minute-kline / fund-flow）名和值一起丢、不报错——CLI 比对请求与返回的列名，缺列标 `partial` + `missingFields` 并退出 3；`fundamental main-business` / `valuation-analysis` 只丢值、字段名照请求回显——CLI 检测到长度不匹配直接报错退出 1（没有 `--field` 的命令如 `alternative edb-data` 报此错则是上游响应结构异常，报障时带上报错末尾的 `（trace …）`）。`--field` 只回点名的列、不自动附带身份列（`fund-flow` 除外）：日 K 要一起写进 `securityCode` / `tradeDate`，分钟 K 是 `securityCode` / `tradeTime`，实时行情是 `securityCode`。realtime **无 `close`**（用 `latestPrice`）、**无市值**（总市值走 `indicator cross-section --indicator qte_mkt_cptl`，A/港/美股均有数）。
11. 🔴 **EDE 取不到数时返 `null` 占位，行列都保留**（`indicator` 截面 / 时序 / 选股），无告警、退出码 0。**报告期类指标（`is_*` 等）的时序尤其要当心**：按日返回，**只有报告期末那几行是真值**，其余全是 `null`，而时序没有任何参数能只返回报告期末——**别对整列直接求均值 / 求和**（`null` 会被 Excel / pandas / SQL 的聚合跳过但行数不变；`jq` 的 `add/length` 连跳都不跳，要先 `map(select(. != null))`）。截面上日期不落在报告期末时整批返 `null`，`screener` 会筛出空集——**那是日期用错了，不是「没有符合条件的标的」**。所以：报告期类指标的日期一律落**报告期末**（`03-31` / `06-30` / `09-30` / `12-31`），截面用 `--indicator-param "<指标code>:reportDate=YYYY-MM-DD"` 显式给（`screener` 用 `"F1:reportDate=..."`）。详见 `references/commands/indicator.md`。

## 工作流（3 步）

```
意图 → 命令（路由表）  →  执行（pre-flight + 拼参数）  →  呈现（按响应模式）
```

### Pre-flight（执行前必过）

🔴 **需用户确认**：
- `gangtise auth status` 未登录 → 提示配置 AK/SK 并中止
- 多个命令同时匹配 → 复述理解让用户挑（如"搜索研报" → research list 还是 knowledge-batch？）
- 用户说"全部 / 全量 / 全市场" → 确认量级再拉：省略 `--size` 就是拉全量（自动翻页，上限 1000 页）；先 `--size 1` 看 stderr 的 `Total: N` 再决定（探量这步别加 `--format json`——json 下不打 `Total` 行）；全市场/跨一年分片等大批量可 `GANGTISE_PAGE_CONCURRENCY=10` 提速（默认 5，同时管翻页与 K 线分片）
- **高积分操作先确认**：任何 50 积分/次及以上、或"按条 × 大批量"（如 `stock-summary` 按代码批量数千只、`opinion` 全量翻页、`concept-info` 500/次）→ 先估总积分告知用户再执行（单价见下「积分计费速查」）
- 下载**必选**格式未定才问：`independent-opinion --file-type`（必选）、`vault record/my-conference --content-type`（record 三种 original/asr/summary、my-conference 两种 asr/summary）；其余 download 有默认（多为 `1`=PDF/原始），用户没提格式就用默认、不必问
- list→download 用户没指定具体文件 → 展示前 10 条让用户挑

🟡 **自行判断**：
- 公司名 → 先速查表，否则 `reference securities-search`
- opaque ID → 先 `references/lookup-ids.md`
- 模糊时间词 → 查"时间词映射"
- 无时间范围且用户没要求全量 → 主动加 `--size 200` 兜底（不必问）；注意 CLI 省略 `--size` 会拉全量
- 预估结果 >200 行 → 别全量 `--format json` 引进上下文，改 `--format jsonl --output <file>` 落盘（行边取边写、内存不随行数增长，stdout 只回显文件路径），再 `wc -l` + `head` 采样呈现。落盘的 `csv` / `jsonl` 旁边会有 `<file>.meta.json`：`complete` / `rows` / `result.partial` 与缺失项标记都在里面，转交文件时一并给、核验完整性先看它；超大导出用 `jsonl`（`csv` 取数阶段仍在内存）
- 路由到 AI 同步生成命令 → 7 个 agent 类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，无需前缀；`stock-summary` / `hot-topic` 仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。**贵档端点超时/5xx 不自动重试**（重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调仍会**再扣一次**（无缓存豁免），所以一次调用给足超时比失败重跑省钱。`earnings-review` / `viewpoint-debate` 是异步（`--wait` 或 `*-check` 轮询），不吃这个超时
- "AI速记/智能摘要/会议纪要"→`summary`、"原始文件/原文件"→`original`、"语音识别/转写文本/ASR"→`asr` — 用户已明示时直接映射 content-type，不必问

### 积分计费速查

"免费"=0 积分；**只列单价**，数据范围见下一节。

- **免费**：所有 `quote` 行情、`fundamental` 报表/主营/估值/股东（**盈利预测除外**）、`reference`/`constant` 查询（含 `official-account-search`）、`alternative edb-search`、`vault`（record/wechat/股票池/drive/AI云盘）、`insight report-image list`
- **0.1/条 list**：research / foreign-report / official-account / announcement(A/港/美) / summary / qa / performance-calendar 的 list、`vault my-conference-list`；`insight report-image download` 0.1/张
- **按条（观点/含详情类 list）**：independent-opinion list 与 `ai security-clue` 5；roadshow/site-visit/strategy/forum list 20；opinion / foreign-opinion list 30；`fundamental earning-forecast` 0.5；`ai stock-summary` 3（无看点的证券不返回也不扣）；`alternative edb-data` 30
- **各 download（/篇）**：announcement / official-account / research 10；announcement-hk / announcement-us 20；independent-opinion 30；summary / foreign-report / my-conference 50；`performance-calendar download` A 股 10 / 港美股 20
- **按页**：`tool file-parse` 0.8/页，**提交（`--file`）时按实际页数一次性扣**，取结果（`file-parse-check`）免费——50 页 PDF = 40 积分，别重复提交同一文件
- 🔴 **按次贵**：`ai knowledge-batch` 10、`management-discuss-*` 10；AI Agent（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `earnings-review` / `viewpoint-debate` / `theme-tracking`）**50/次**
- 🔴 **`ai hot-topic` 50/篇，按返回条数计**（不是按调用次数）。📌 **一「篇」= 一整份报告**（一份早报 / 午报 / 盘中快报 / 晚报），**不是报告里的一条话题**——一份报告通常包含多条热点话题。所以 `--size 20` 的一页 = 最多 20 份报告 = 1000 积分，**先用 `--start-date`/`--end-date` + `--category` 收窄再拉**，别省略 `--size` 直接全量。**可查的历史范围跟账号权限走**（试用档是滚动的「当前 −1 个月」，正式/定制档更长）——超出范围的日期返回空结果而不是报错，拿到空先想想是不是撞了权限窗口
- 🔴 **极贵**：`alternative concept-info` / `concept-securities` **500/次**
- ✅ **按篇 / 按条计费的接口，没查到内容就不扣分**（空结果 = 0 积分）：各 download（`pamirs-summary` 除外，见 ②）、`ai hot-topic`（50/篇）、`ai stock-summary`（3/条，无看点总结的个股不进返回列表也不计费）。**所以「先小范围试探再放大」是安全的**——先用窄条件确认能查到东西，再扩范围。⚠️ **两类不适用**：① **按次计费的**——`ai knowledge-batch` / `management-discuss-*`、AI Agent 那批 50/次、`alternative concept-info` / `concept-securities` 500/次，不管有没有内容都扣，超时报错也可能已经扣过；② **单价未公布的**——`pamirs-summary`（见下），别据此假定
- ⚠️ **同参数重复调用不免费**：按次计费的那批无缓存命中豁免（`one-pager` 等生成类重复调用每次扣分，即使秒回缓存内容）；**按篇/按条的也一样**——重拉同一批 `hot-topic` 就是按条数再计一次费。生成类与列表结果拿到后自行留存复用，别为「刷新」重调
- ⚠️ **贵档端点超时/5xx 不自动重放**（共 18 个：AI Agent 那批 + `ai knowledge-batch` / `management-discuss-*` / `hot-topic`、`alternative concept-info`·`concept-securities`、50/篇 的 `summary`·`foreign-report`·`my-conference` download 与同档处理的 `pamirs-summary` download、`tool file-parse` 提交）。**理由是重放会重复扣分**——服务端可能已经执行并计费，重发按次计费的会再扣一次，重发按篇/按条计费的会把**已交付的行**再计一次；两种都亏。仅连接失败、429 与 token 自愈会重试

<!-- no-replay-endpoints
     上面那句点名的「不重放」端点，完整清单如下（endpoint key，与 `gangtise raw list` 一致）：
ai.earnings-review.get-id
ai.hot-topic
ai.investment-logic
ai.knowledge-batch
ai.management-discuss-announcement
ai.management-discuss-earnings-call
ai.one-pager
ai.peer-comparison
ai.research-outline
ai.theme-tracking
ai.viewpoint-debate.get-id
alternative.concept-info
alternative.concept-securities
insight.foreign-report.download
insight.pamirs-summary.download
insight.summary.download
tool.file-parse.submit
vault.my-conference.download
-->
- **按单元格**：`indicator cross-section` / `time-series` / `screener`（A股 0.05 / 港股 0.1 / 美股 0.2 积分每 100 单元格；screener 按**筛选前**范围计费，见 `indicator.md`）；`ai knowledge-resource-download` 按下游资源计费
- **单价未公布**：`insight pamirs-summary list` / `download`——spec 只写了「需购买专家纪要数据库」这个准入门槛，没给单次价格。**别据此假定免费**；大批量拉取前先小量试，或向平台确认

### 数据范围（能查多久）

正式账号口径（下表为官方公布值；实际可查范围随账号服务等级而定，以自己账号的实际返回为准）：

| 命令组 | 可回溯 |
|--------|--------|
| `quote` 行情 / `fundamental` 财报、主营、估值、股东 / `indicator`（EDE） | 前溯 **5 年** |
| `ai security-clue` 投研线索 | 前溯 **1 个月** |
| 主题 / 热点 / QA / 日程（路演·调研·策略会·论坛）/ 纪要 / 观点 / 研报 / 公众号 | 前溯 **3 个月** |
| 管理层讨论 / A·港·美股公告 / `alternative edb-*` 行业指标 | 前溯 **3 年** |
| `insight pamirs-summary` 帕米尔纪要 | **不限**（但需单独购买专家纪要库） |

⚠️ **这是官方口径，不是硬边界**：服务端按**账号**配这个时间窗口、不按接口配——**换接口绕不过去**（`indicator` 三接口与 `quote day-kline` 同界）。超范围查询返回 `110003`，**不是空结果**——拿到 `110003` 就是撞了权限边界，缩窗口对「整段都在界外」的查询无效，要把日期移进范围或联系客户经理。

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

省略 `--output` 时 CLI 用本地 title-cache 里的真实标题做文件名——**只读缓存**，命中就零额外调用。缓存由同端点的 `list` 写入，所以「先 `list` 再 `download`」这个正常工作流本来就免费拿到正确文件名。

🔴 **未命中时默认不回查**，退回服务端文件名或 `<type>-<id>.<ext>`。要回查得显式加 `--resolve-title`——它拉最近 200 条（4 次请求），而这些 list 多数按 **0.1 积分/条**计费，约 20 积分，只用于取一个更易读的文件名（下载本身 10–50）。**批量下载或按 ID 下旧文件**时：要么先跑一次 `list` 把标题灌进缓存，要么直接 `--output ./<名>.<ext>` 自己定名；`--resolve-title` 会把取回的 200 条一并写回缓存，同批后续下载不再重复消耗。

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
| 个股看点 / 投研总结 / 公司速览 | `ai stock-summary`（`--security` **只收具体代码**，单次最多 6000 个；仅 A 股/港股，不支持 `aShares`/`hkStocks` 全市场批量） |
| 业绩点评（异步） | `ai earnings-review` |
| 观点 PK / 多空辩论（异步） | `ai viewpoint-debate` |
| 投研线索 | `ai security-clue`（前置：`reference securities-search` 拿 `gts-code`） |
| 主题跟踪 | `ai theme-tracking`（前置：`reference concept-search` 拿 `theme-id`） |
| 热点话题 / 早午晚报 | `ai hot-topic` |
| 管理层讨论（财报） | `ai management-discuss-announcement` |
| 管理层讨论（业绩会） | `ai management-discuss-earnings-call` |
| 日 K（历史，A 股 / 港股 / 美股 / 沪深 ETF / 各类指数含 20 个全球指数，可混查） | `quote day-kline` |
| 全部沪深京指数日 K / 要指数名称 | `quote index-day-kline`（**旧命令仍有两处 `day-kline` 做不到**：`--security all` 一次拿全部指数；返回 `securityName` 指数名称——`day-kline` 查指数只有代码没有名称） |
| ~~港股 / 美股日 K~~ | ⚠️ 已下线，用 `quote day-kline`（`day-kline-hk` / `day-kline-us` 仍可调但不校验代码） |
| 分钟 K（沪深 A 股 / ETF + 各类指数含全球指数） | `quote minute-kline`（`--security` 可重复，逐只并发合并） |
| 实时行情（A / 港 / 美 / 沪深 ETF / 各类指数含全球指数） | `quote realtime` |
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
- 港股代码用在 `insight foreign-opinion --security` 还是 `quote day-kline --security`？前者要"境外"格式（`UBER.N`），后者要 `.HK`
- "成分股" → 题材深度（分组/重点标记/纳入理由）走 `alternative concept-securities`；板块（行业/概念分类树，纯代码名单）走 `reference sector-constituents`
- **证券基本面 / 指标先按任务形态路由，不是搜到 EDE 就一律走 EDE**：
  - 单证券先优先对应 `fundamental` 专用命令（财务、估值、盈利预测、股东、主营或完整三大报表，多数免费 / 低价）。`valuation-analysis` / `earning-forecast` 仅支持 A 股，港 / 美股的**估值历史分位**与**盈利预测**无可用口径。但**估值指标本身别照抄旧结论**：`finc_pe_ttm` 港股、`qte_mkt_cptl`/`shr_tot` 港美股都有数。⚠️ **凡「仅 A 股」「无数据」这类否定结论都只是某时点抽查**，数据覆盖在持续扩展；负面结论过期不会报错、只会让你白白拒掉一个能跑的查询。**一律以当次 `scopeList` + 抽查一行为准**
  - 多证券批量取一组**已实现**财务 / 估值指标 → 优先 `indicator search` 后用 EDE 一次拉取，替代逐只循环；单日或同一报告期横向比较用 `cross-section`，区间走势用 `time-series`（后者不能多指标 × 多证券同时）。**批量按 code 回填加 `--key-by code`**（列头用 `indicatorCode`，防同名指标碰撞）。⚠️ **两个轴的顺序规则不同**：`indicatorList` = 请求顺序，但 **`securityCodeList` 是按代码升序重排的**——**行绝不能按请求下标对位**，一律按 `security` 字段取值
  - ⚠️ **估值指标的历史序列：两个接口的财报口径切换时点不同**——`indicator time-series`（EDE）按**正式财报披露日**切，`fundamental valuation-analysis` 按**业绩快报**口径切、通常更早，同一天取到的估值指标可能不一样。做估值分位 / 回测时**两个接口都拉一遍交叉核**（个别标的在 `valuation-analysis` 侧可能长期未更新）；时点对齐用三大报表的 `earliestAnncDate`（首次公告日），不要用 `announcementDate`。详见 `indicator.md`
  - 始终排除 EDE：A股盈利预测 / 一致预期（含预测 EPS）→ `fundamental earning-forecast`；A股估值历史分位 → `fundamental valuation-analysis`；开高低收 / 成交量等行情与 K 线 → `quote`；单证券完整报表 → 对应三大报表命令。**例外：总市值只有 EDE 有**——`quote realtime` / `day-kline` 都不返回市值，走 `indicator cross-section --indicator qte_mkt_cptl`（默认单位「元」，用 `--scale` 缩放）。EDE 搜到的基本 / 稀释 EPS 是已实现值，**不能冒充预测 EPS**；港 / 美股缺少上述专用能力时应如实说明不支持，不能用别的语义代替
  - EDE 取数前必须用 `search --format json` 同时核对：`indicatorName` + `description` 语义准确、`scopeList` 覆盖全部目标市场 / 证券类型、`parameterList` 必填参数与枚举可满足；任一不符都视为无法证明覆盖并回退专用接口。`scopeList` 按指标各不相同，不能因 EDE 服务支持 A / 港 / 美股就假定某个指标三市场都覆盖。`search` 免费，取数按单元格计费；除多证券批量的效率收益外，仍优先免费 / 低价的 `quote` 或 `fundamental`
- 行业 / 宏观指标（空调销量、社融等，无证券维度）走 `alternative edb-*`（EDB），不要与证券级 EDE 混用
- **EDE「没数据」和「代码写错」是两回事**：**①代码写错 → 直接报 `100003` 并指名是哪个**（指标写错报「指标 xxx 不存在」，证券写错报「xxx 不是有效证券或者板块ID」，美股用 `.US` 而非 `.O`/`.N` 同理），无论同批有没有其它正确的 code 都会报；**②代码有效但无数据 / 无覆盖 / 未来日期 → 行列都保留**（含 1×1）并给占位单元格 `null`，**退出码 0**。日期语义按指标分两类：财务报表指标=报告期末（可为非交易日）、`finc_pe_ttm` / `finc_pb_mrq` 等日频估值=最新交易日（⚠️ `finc_pb_mrq` 是日频的，用报告期末日期会取到几个月前的陈值）
- **EDE 指标参数名一律以 `indicator search --format json` 的 `parameterList` 为准**，不要凭记忆或照抄示例；参数名写错会报 `100003` 并指出是哪个指标的哪个参数（如复权参数是 `adjustType`）。🔴 **日期参数不能按 code 前缀推**——**唯一判据是 `parameterList` 里必填的是哪个**：有 `tradeDate` 就用 `--date`，有 `reportDate` 就补 `--indicator-param "code:reportDate=YYYY-MM-DD"`。多数报告期类指标（`is_*` 利润表等）要 `reportDate`（只传 `--date` 会报「不支持参数 tradeDate; 缺少必填参数 reportDate」），**但 `_ttm` 后缀整族相反、必填 `tradeDate`**（跨 `is_`/`cf_`/`div_`/`finc_` 四族都有）。行情 / 估值类（`qte_*` / `finc_pe_ttm` 等）用 `--date` 即可。`--security` 支持板块 ID（`reference sector-search` 的 10 位 `sectorId`）；根级 `--scale` 只作用于声明了 `scale` 的指标，价格与金额可以混查
- 指标族速记：融资融券 21 个 `mgn_*`（`mgn_bal` 两融余额 / `mgn_fin_*` 融资 / `mgn_sl_*` 融券 / `mgn_flag` 是否标的，**仅 A 股有数**）；行业分类 `scr_indu`（一个指标覆盖申万/中信/恒生/GICS，**必填** `industryType` 1-4 + `industryLevel` 0-4，返回字符串）与三个行业组合指标 `scr_indu_citic` / `scr_indu_sw` / `scr_indu_gics`（体系写进编码，只需可选的 `industryLevel`；单套体系用它们更省事，横比多套仍用 `scr_indu`）。详见 `indicator.md`
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
取 `list[0].gtsCode`（CLI 已剥掉信封，输出顶层就是 `{returnedCount, list}`）。matchScore < 0.5 时让用户从前 3 条选。

**交易所后缀**：`.SH` 上交所（6 开头）｜ `.SZ` 深交所（0/3 开头）｜ `.BJ` 北交所 ｜ `.HK` 港股 ｜ `.O` 纳斯达克 ｜ `.N` 纽交所 ｜ `.A` AMEX ｜ 沪深 ETF 同 `.SH` / `.SZ` ｜ 全球指数用数据源后缀（`SPX.SPI` `N225.NKI` `HSI.HI` `GDAXI.FRA` …，20 个清单见 `references/commands/quote.md`，**别猜**）。

**跨市场**：`quote day-kline` 与 `quote realtime` 都可一次混合传入多市场代码（含 ETF 与全球指数）：`quote realtime --security 600519.SH --security 00700.HK --security AAPL.O --security SPX.SPI` 单接口同时返回。

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

日期参数**按参数名判断、不按命令组**（命令组会误导——AI 里既有 `--start-time` 又有 `--date`/`--report-date`；Insight 里 `performance-calendar` 是唯一用 `--start-date`/`--end-date` 的 list）：名字带 `-date` 的（`--start-date`/`--end-date`/`--date`/`--report-date`）一律年在前日期（`YYYY-MM-DD` 首选，`YYYY/MM/DD`/`YYYYMMDD` 也收），覆盖 Quote/Fundamental、`insight performance-calendar`、AI 的 `theme-tracking`(`--date`)/`hot-topic`/`management-discuss-*`(`--report-date`)、Alternative `edb-data`、Indicator `cross-section`(`--date`)/`time-series`；名字带 `-time` 的（`--start-time`/`--end-time`）用年在前日期 + `[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔）或 10/13 位时间戳，覆盖 Insight/Vault 各 list、`quote minute-kline`、`ai security-clue`、`ai knowledge-batch`。其中 **A 股公告（`insight announcement list`）与 `knowledge-batch` 会把输入转成 13 位毫秒**（10 位秒自动 ×1000），其余 `-time` 命令（含 `announcement-hk`/`announcement-us`）原样透传字符串；CLI 输入统一接受 10/13 位纯数字或 `YYYY-MM-DD[ HH:mm[:ss]]`（同上：秒可省、空格或 `T` 分隔）。

支持排序切换的命令：opinion / summary / pamirs-summary / research / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account。**要最新的加 `--rank-type 2`（严格按 `publishTime` 倒序）；要最相关的用默认 `--rank-type 1` + `--keyword`（综合排序按相关度挑条目）**——两者从同一结果集里取的是**不同的子集**，不是同一批内容换个排法。🔴 **`--search-type` 不改变 `--rank-type 1` 取回哪些条目**（同一关键词下，两档的 `--rank-type 1` 结果相同——即使 `--search-type 2` 让 `total` 大出一个数量级），**要相关度不必加 `--search-type 2`**；它扩大的是命中总数和 `--rank-type 2` 的候选池。🔴 **两档差别有多大取决于关键词，别拿一个词判断参数有没有用**：有些关键词下两档返回同一批，有些交集接近 0，判据见 `insight.md` 开头。⚠️ 综合排序**挑完之后仍按时间倒序排列**，所以别用「结果是不是时间倒序」判断它有没有生效，要比条目 ID。没有 `--keyword` 时两者无差异，属正常。其他 list 命令按 API 默认排序。

## 异常处理

**退出码**：`0` 完整成功（含合法空结果）／ `3` 有数据但不完整（`partial: true`；stderr 有 warning，`--format json` 才看得见标记，table/csv/jsonl 只有数据行、看不出问题——csv/jsonl 落盘时看旁边 `<file>.meta.json` 的 `complete` 与 `result`。定位字段：页失败 `failedPages`、分片失败 `failedShards`、分片撞行数上限 `truncatedShards`、`total` 撞服务端上限 `totalCapped`、`--field` 请求了但没回的列 `missingFields`、逐只请求里撞行数上限的证券 `truncatedSecurities`、EDE 整轴没回 `omittedIndicators` / `omittedSecurities`）／ `1` 硬失败。**拿到 3 就必须告知用户缺了哪段，不能当成功静默继续。** 报错行带 `[trace <id>]`，**报障给 Gangtise 时务必带上**。

最高频的几个码（全表、「不报错的坑」、`screener` 缺列判据与困境自救见 `references/errors.md`）：

| 错误码 | 含义 | Agent 怎么做 |
|--------|------|-------------|
| `100003` | 参数值非法（最宽的兜底码），msg 通常已指明字段 | 按 msg 改，不要重试同命令 |
| `100001` | 缺必填参数，msg 带字段名 | 按 msg 补上 |
| `120001` | 证券代码无效 | `reference securities-search` 确认代码与后缀 |
| `110003` | 超出账号数据权限的时间范围（按账号配、不按接口配） | 把日期移进范围；换接口绕不过去 |
| `130002` / `130001` | 资源不存在 / 数据未找到或无指标权限 | 确认 ID、权限、`--file-type` |
| `410110`（新码 `140001`） | 异步生成中 | 继续轮询 |
| `410111`（新码 `140002`） | 异步生成失败，或 EDE 终态参数错 | **不重试**，换参数 |
| `999999` | 系统错误（EDE 无数据不用此码） | 参数无误仍报即服务端故障 |
| `999011` | 凭证无效（旧码 `8000014`/`8000015`） | 查 AK/SK 环境变量，CLI 不重试 |
| `999004` | 无资源权限（整库未开通与单条不可见都走这个码） | 先确认该数据库是否已购买 |
| `0000001008` / `999002` | token 失效 | CLI 自动重登一次，无 AK/SK 时提示重新登录 |
| `100006` | 查询/下载数量超限 | 缩短日期范围或调小 `--size`/`--limit` |

其他场景：CLI 未安装 → `npm install -g gangtise-openapi-cli`；空结果 → 扩大时间范围 / 换关键词 / 去掉部分筛选；模糊公司名匹配多只 → 列出让用户选；下载路径冲突 → 询问覆盖。

## 详细参数

按需 Read 对应文件：

- 内资观点 / 纪要 / 路演 / 调研 / 策略 / 论坛 / 财报日历（performance-calendar）/ 研报 / 外资研报 / A 股公告 / 港股公告 / 美股公告 / 外资观点 / 独立观点 / 公众号（official-account）/ 投资者问答（qa）/ 研报图表（report-image）→ `references/commands/insight.md`
- 行情命令（A 股 / 港股 / 美股 / ETF / 指数日 K、分钟 K、实时行情、资金流向 fund-flow，含 20 个全球指数清单） → `references/commands/quote.md`
- 三大报表（A 股 / 港股 / 美股）/ 主营 / 估值 / 盈利预测 / 股东 → `references/commands/fundamental.md`
- knowledge-batch / security-clue / 个股看点（stock-summary）/ AI agent / 异步任务 / 主题跟踪 / 热点 / 管理层讨论 → `references/commands/ai.md`
- drive / record / my-conference / wechat / 股票池 → `references/commands/vault.md`
- 行业指标数据库（EDB）/ 题材指数画像与成分股（concept-info / concept-securities）→ `references/commands/alternative.md`
- 数据指标（EDE：search / cross-section / time-series / screener，证券级指标截面、时序与条件选股）→ `references/commands/indicator.md`
- PDF 解析（file-parse：上传 PDF → Markdown + 图片 ZIP）→ `references/commands/tool.md`
- securities-search / chiefs-search（首席 ID）/ institution-search（机构 ID）/ official-account-search（公众号 ID）/ 常量查询（constant-category / constant-list）/ 题材 ID（concept-search）/ 板块（sector-search / sector-constituents）/ lookup 本地表 / 行业别名 / raw call → `references/commands/reference-and-lookup.md`
- 错误码全表 / 不报错的坑 / 退出码 3 与 `screener` 缺列判据 / Troubleshooting → `references/errors.md`

跑通流程对照 → `references/examples.md`
