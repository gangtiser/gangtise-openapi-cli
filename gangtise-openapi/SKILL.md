---
name: gangtise-openapi
version: "0.43.0"
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  **触发词**：Gangtise / 钢尼斯 / gtIC（Gangtise 语音误识别）/ 调接口 / CLI / openapi / 导出 / 下载研报 / 批量查 / 拉数据 / 跑一下 / 研报 / 纪要 / 公告 / K线 / 财报 / 估值 / 选股 / 债券

  **适用**：原始数据导出、批量 jsonl/csv、下载 PDF/MD、行情 K 线、财务报表、估值指标、证券级数据指标（EDE 截面/时序/条件选股）、财报日历（业绩预告/快报/公告）、会议线索、帕米尔专家纪要、资金流向、题材与板块、债券（资料/行情/估值/评级/公告）、联网搜索、PDF 解析为 Markdown、AI 能力（一页通/投资逻辑/同业对比/个股看点·投研总结/投研线索/业绩点评/观点PK·多空辩论/主题跟踪/热点话题/管理层讨论/调研提纲/知识库搜索）、云盘文件管理（Vault）

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
2. **opaque ID**：先读 `references/lookup-ids.md`；找不到再按类型查——行业 / 区域 / 公告分类 / 城市 → `reference constant-list --category <分类>`（分类代码用 `reference constant-category` 查）；题材 → `reference concept-search`；板块 → `reference sector-search`；券商 / 牵头 / 观点机构 → `reference institution-search`（按返回的 `usageScopes` 选能喂给目标参数的 ID）。**绝不猜测**。
3. **公司名 → 证券代码**：先查下方速查表（几只常用大盘股），其余一律 `gangtise reference securities-search --keyword <名> --category stock` 取 `list[0].gtsCode`。
4. **时间格式**：datetime `"YYYY-MM-DD HH:mm:ss"`（引号包裹），date `YYYY-MM-DD`（`YYYY/MM/DD`、`YYYYMMDD` 也收，会归一；**年在后写法一律拒绝**）。
5. **多值参数**：优先重复传（最稳、最明确）：`--security 600519.SH --security 000858.SZ`。CLI 也支持半/全角逗号分隔（语音输入容错），但重复传不易被 shell 吞。
6. **K 线"最近 N 条"**：必须用 `--start-date`/`--end-date` 拉日期范围，从结果按 `tradeDate` 取尾部最近 N 条。**不要只用 `--limit N`**（截取的是窗口开头）。
6.1. **日 K 仅历史**：`day-kline` **不返回盘中实时数据**。当日数据入库时间：A 股 ~15:30 / 港股 ~16:30 / 美股 ~07:00（北京时间）。需要盘中快照请走 `quote realtime`。
6.1.1. 🔴 **`quote day-kline` 一个命令覆盖 A / 港 / 美股、沪深 ETF 与各类指数（含全球指数），可混传代码**。全市场关键字 `aShares` / `hkStocks` / `usStocks` 必须单独传（不认 `--security all`），且**必须同时给 `--start-date` 与 `--end-date`**（「某天至今」把 `--end-date` 写成今天）。**关键字只覆盖个股**：ETF 与指数须逐个传代码（全球指数代码清单、`null` 列与当地时间口径见 `references/commands/quote.md`）。`day-kline-hk` / `day-kline-us` / `index-day-kline` 已弃用、别用——它们不校验代码，传错返空不报错。
6.2. **多标的日 K**：显式传多个 `--security` 时，「证券数 × 交易日数」小于 `--limit`（默认 6000 / 上限 10000）走单请求；达到或超过则 CLI 自动分批请求（每批按行数上限装入尽量多的证券，未传 `--limit` 时上限按 10000 算）并按传入顺序合并，单只行数超过 `--limit` 的标 `partial` + `truncatedSecurities`、退出码 3。单只超 10000 行仍要缩日期区间分批。
7. **CLI 已内置自动化，不要手动复刻**：
   - 翻页 → 首页拿 total 后剩余页并发拉取；🔴 **全量拉取结束会多探一行验证 `total` 是不是服务端封顶**（`total` 若只是服务端封顶值，按它翻完会停在上限、看起来却像全量）——探到就标 `partial` + `totalCapped` + 退出 3，**这时导出的是截断结果，要缩小时间范围分片拉**
   - K 线全市场关键字（`aShares` / `hkStocks` / `usStocks`；旧命令 `all`）跨日期 → 自动按日切片并合并，粒度按各市场单日行数定（A 1 个工作日 / 港 2 个工作日 / 美 1 个工作日）
   - 5xx / `429` / 网络错误 / `999999` → 自动指数退避重试（🔴 贵档端点例外：仅连接失败 / 429 / token 自愈重试，5xx/超时不重放防重复扣分；`indicator` 端点对 `999999` 不重试）
   - Token 失效 → 自动重新登录并重试一次；凭证错 `999011` → **不重试**（AK/SK 不对不会自己好），查环境变量
8. **参数命名差异**：`--security-code` 只用于 **Fundamental 全组、AI 单证券生成类**（`one-pager` / `investment-logic` / `peer-comparison` / `earnings-review` / `research-outline` / `management-discuss-*`）**与 `insight qa list`**；`ai security-clue` 用 `--gts-code`；其余（Insight 其他命令、Quote、Vault、Bond、Indicator、`ai stock-summary`）一律用 `--security`。
9. **调试**：`--verbose` 或 `GANGTISE_VERBOSE=1` 打印每个请求的耗时/字节数到 stderr。
10. **`--field` 字段名必须核对，不确定就别传**（返回全量最稳）。上游对不存在的字段名有两种处理：`quote` 系（realtime / day-kline / minute-kline / fund-flow）名和值一起丢、不报错——CLI 比对请求与返回的列名，缺列标 `partial` + `missingFields` 并退出 3；`fundamental main-business` / `valuation-analysis` 只丢值、字段名照请求回显——CLI 检测到长度不匹配直接报错退出 1（没有 `--field` 的命令如 `alternative edb-data` 报此错则是上游响应结构异常，报障时带上报错末尾的 `（trace …）`）。多只证券或全市场时，缺的身份列 CLI 会补到最前（日 K 补 `securityCode` / `tradeDate`、分钟 K 补 `securityCode` / `tradeTime`、realtime 补 `securityCode`）；单只不补。realtime **无 `close`**（用 `latestPrice`）、**无市值**（总市值走 `indicator cross-section --indicator qte_mkt_cptl`，A/港/美股均有数）。
11. 🔴 **EDE（`indicator` 截面 / 时序 / 选股）取不到数返 `null` 占位、行列都保留、退出码 0**；代码写错才报 `100003` 并指名。报告期类指标（`is_*` 等）的日期一律落**报告期末**（`03-31` / `06-30` / `09-30` / `12-31`），截面用 `--indicator-param "<指标code>:reportDate=YYYY-MM-DD"`（`screener` 用 `"F1:reportDate=..."`）——日期不在报告期末时整批 `null`，`screener` 筛出空集是**日期用错，不是没有符合条件的标的**。时序按日返回、只有报告期末那几行是真值，**别对整列直接求均值 / 求和**。**`--calendar-type` 默认别传**（CLI 自动选日期轴；显式传 `TD` 会让报告期类指标整行 `null`）。详见 `references/commands/indicator.md`。

## 工作流（3 步）

```
意图 → 命令（路由表）  →  执行（pre-flight + 拼参数）  →  呈现（按响应模式）
```

### Pre-flight（执行前必过）

🔴 **需用户确认**：
- 凭证：`gangtise auth status` 只看本地（缓存的 token、`GANGTISE_TOKEN`），不联服务端。两项都没有、环境变量里也没配 `GANGTISE_ACCESS_KEY` / `GANGTISE_SECRET_KEY` → 提示配置 AK/SK 并中止；**只配了 AK/SK 时首次调用会自动登录，不算未登录**。要确认凭证有效或账号状态，用 `gangtise auth login`
- 多个命令同时匹配 → 复述理解让用户挑（如"搜索研报" → research list 还是 knowledge-batch？）
- 用户说"全部 / 全量 / 全市场" → 确认量级再拉：省略 `--size` 就是拉全量（自动翻页，上限 1000 页）；先 `--size 1` 看 stderr 的 `Total: N` 再决定（探量这步别加 `--format json`——json 下不打 `Total` 行）；全市场/跨一年分片等大批量可 `GANGTISE_PAGE_CONCURRENCY=10` 提速（默认 5，同时管翻页与 K 线分片）；预计很长的全市场导出按年或按季度分段拉，别让单条命令超过你的工具超时——被超时终止的导出不会留下结果文件
- **高积分操作先确认**：任何 50 积分/次及以上、或"按条 × 大批量"（如 `stock-summary` 按代码批量数千只、`opinion detail` / `--with-content` 批量取正文、`concept-info --full` 500/次）→ 先估总积分告知用户再执行（单价见下「积分计费速查」）
- 下载**必选**格式未定才问：`independent-opinion --file-type`（必选）、`vault record/my-conference --content-type`（record 三种 original/asr/summary、my-conference 两种 asr/summary）；其余 download 有默认（多为 `1`=PDF/原始），用户没提格式就用默认、不必问
- list→download 用户没指定具体文件 → 展示前 10 条让用户挑
- 🔴 **改动账号数据的命令**（其余命令都只读）：
  - **自选股股票池**：`vault stock-pool-create` / `stock-pool-rename` / `stock-pool-add-stock` / `stock-pool-remove-stock` / `stock-pool-delete`
  - **云盘**：`vault drive-upload` / `drive-create-folder` / `drive-rename` / `drive-move-file` / `drive-move-folder` / `drive-copy` / `drive-delete-file` / `drive-delete-folder`
  - 用户没有明确要求「建池 / 改名 / 加自选 / 删自选 / 删池」「上传 / 建文件夹 / 改名 / 移动 / 复制 / 删除」时**不要调用**；要调用时先复述「对哪个池或文件夹、做什么、涉及哪几项」再执行。**租户云盘（`--space-type 2`）对整个租户可见**，往里上传、复制，或在里面删除前要特别确认
  - `stock-pool-delete` / `drive-delete-file` / `drive-delete-folder` 不可恢复（删池连带清掉池内全部关注关系；删文件夹连同其中全部子文件夹与文件），CLI 因此要求显式 `--yes`——**这个 `--yes` 必须是用户点头之后才加，看到「加上 --yes」的报错不要自动补上重跑**

🟡 **自行判断**：
- 公司名 → 先速查表，否则 `reference securities-search`
- opaque ID → 先 `references/lookup-ids.md`
- 模糊时间词 → 查"时间词映射"
- 列表类命令用户没要求全量 → 按单价主动加 `--size` 兜底（不必问）：免费或 0.1 积分/条的列表用 `--size 200`；**≥1 积分/条的（观点、独立观点、路演四件套、会议线索、个股线索、热点话题等）用 `--size 20`**，要更多先 `--size 1` 看 stderr 的 `Total` 估总价再定。CLI 省略 `--size` 会拉全量；按条计费的列表估算全量超过 1000 积分时报错退出（报错里有估算积分），此时把估算积分告诉用户，确认后加 `--yes` 重跑或改传 `--size N`
- 预估结果 >200 行 → 别全量 `--format json` 引进上下文，改 `--format jsonl --output <file>` 落盘（行边取边写、内存不随行数增长，stdout 只回显文件路径），再 `wc -l` + `head` 采样呈现。落盘的 `csv` / `jsonl` 旁边会有 `<file>.meta.json`：`complete` / `rows` / `result.partial` 与缺失项标记都在里面，转交文件时一并给、核验完整性先看它（`complete: false` = 那次导出退出码 3）
- 路由到 AI 同步生成命令 → 同步生成类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，无需前缀；`stock-summary` 同样有 120s 下限；`hot-topic` 仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。**贵档端点超时/5xx 不自动重试**（重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调仍会**再扣一次**（无缓存豁免），所以一次调用给足超时比失败重跑省钱。`earnings-review` / `viewpoint-debate` 是异步（`--wait` 或 `*-check` 轮询），不吃这个超时
- "AI速记/智能摘要/会议纪要"→`summary`、"原始文件/原文件"→`original`、"语音识别/转写文本/ASR"→`asr` — 用户已明示时直接映射 content-type，不必问

### 积分计费速查

"免费"=0 积分；**只列单价**，数据范围见下一节。

- **免费**：所有 `quote` 行情、`fundamental` 报表/主营/估值/股东（**盈利预测除外**）、`reference`/`constant` 查询（含 `official-account-search`）、`alternative edb-search`、`vault`（record/wechat/股票池/drive/AI云盘，含云盘上传与目录管理）、`insight report-image list`
- **0.1/条 list**：research / foreign-report / official-account / announcement(A/港/美) / summary / qa / performance-calendar 的 list、`vault my-conference-list`；`insight report-image download` 0.1/张
- **按条（观点/含详情类 list）**：independent-opinion list 与 `ai security-clue` 5；roadshow/site-visit/strategy/forum list 20；**opinion / foreign-opinion list 1（只含摘要 `brief`）**，要正文用 `detail` 30/条或 `list --with-content` 30/条；`fundamental earning-forecast` 0.5；`ai stock-summary` 3（无看点的证券不返回也不扣）；`alternative edb-data` 30
- **各 download（/篇）**：announcement / official-account / research 10；announcement-hk / announcement-us 20；independent-opinion 30；summary / foreign-report / my-conference 50；`performance-calendar download` A 股 10 / 港美股 20
- **0.4 的 `bond` 系**：`bond` 全部命令 **0.4/次**（按次，与返回行数无关），三个例外按量计：`rating-overview` 0.4/**条**、`rating-change` 0.4/**只有数据的债券**、`issuer-rating-change` 0.4/**个发行人**
- **`tool web-search` 1/次**（按次，与返回条数、是否带 `--include-content` 无关；零结果与报错不扣）
- 🔴 **`insight highlight list` 5/条**——**按返回条数计**，`--size 20` 的一页 = 100 积分。省略 `--size` 时 CLI 先估算，超过 1000 积分（约 200 条）报错退出，要全量须加 `--yes`
- **按页**：`tool file-parse` 0.8/页，**提交（`--file`）时按实际页数一次性扣**，取结果（`file-parse-check`）免费——50 页 PDF = 40 积分，别重复提交同一文件
- 🔴 **按次贵**：`ai knowledge-batch` 10、`management-discuss-*` 10；AI Agent（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `earnings-review` / `viewpoint-debate` / `theme-tracking`）**50/次**
- 🔴 **`ai hot-topic` 50/篇，按返回条数计**（不是按调用次数）。📌 **一「篇」= 一整份报告**（一份早报 / 午报 / 盘中快报 / 晚报），**不是报告里的一条话题**——一份报告通常包含多条热点话题。所以 `--size 20` 的一页 = 最多 20 份报告 = 1000 积分，**先用 `--start-date`/`--end-date` + `--category` 收窄再拉**，别省略 `--size` 直接全量。**可查的历史范围跟账号权限走**（试用档是滚动的「当前 −1 个月」，正式/定制档更长）——超出范围的日期返回空结果而不是报错，拿到空先想想是不是撞了权限窗口
- **题材**：`alternative concept-info` / `concept-securities` **50/次**；🔴 加 `--full`（催化事件 / 重点个股标识 / 纳入理由）走旧版 **500/次**，不需要这几列就别加
- ✅ **扣费发生在接口成功返回数据之后**（平台计费规则）：没查到内容（空结果）、报错都不扣分——各 download、`ai hot-topic`（50/篇）、`ai stock-summary`（3/条，无看点总结的个股不进返回列表也不计费）、AI 生成类（`one-pager` 等 50/次），以及按次计费的 `ai knowledge-batch`、题材、`tool web-search` 都是这样。**所以「先小范围试探再放大」是安全的**——先用窄条件确认能查到东西，再扩范围。⚠️ **「成功返回」按服务端算**：超时报错时服务端可能已经生成并返回了内容（只是客户端没收到），这次已经扣过，同参数重调会再扣一次；异步的 `earnings-review` / `viewpoint-debate` 在提交成功（拿到任务 ID）时就扣，之后生成失败不退。**单价未公布的** `pamirs-summary`（见下）别据此假定
- ⚠️ **同参数重复调用不免费**：按次计费的那批无缓存命中豁免（`one-pager` 等生成类重复调用每次扣分，即使秒回缓存内容）；**按篇/按条的也一样**——重拉同一批 `hot-topic` 就是按条数再计一次费。生成类与列表结果拿到后自行留存复用，别为「刷新」重调
- ⚠️ **这些端点超时 / 5xx 不自动重放**（共 46 个，完整清单见下方注释块：按次计费的 AI Agent 那批、`ai knowledge-batch` / `management-discuss-*` / `hot-topic`、题材两接口（含 `--full`）、`bond` 全部命令、`tool web-search`、`tool file-parse` 提交；50/篇 的几个 download；按条计费的 `insight highlight list`、观点 `detail` / `list --with-content`、`ai stock-summary` 与 `fundamental earning-forecast`；以及不计分但重放有副作用的 `vault stock-pool-create` 与云盘上传 / 新建文件夹 / 复制 / 删除）。仅连接失败、429 与 token 自愈会重试。服务端可能已经执行并计费，重放会重复扣分、多建一份或把成功报成失败——**一次调用给足超时比失败重跑省钱**

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
ai.stock-summary.list
ai.theme-tracking
ai.viewpoint-debate.get-id
alternative.concept-info
alternative.concept-info-full
alternative.concept-securities
alternative.concept-securities-full
bond.announcement
bond.basic-info
bond.cash-flow
bond.daily-quote
bond.exercise-notice
bond.issuance-detail
bond.issuance-plan
bond.issuer-info
bond.issuer-rating-change
bond.rating-change
bond.rating-overview
bond.valuation
fundamental.earning-forecast
insight.foreign-opinion.detail
insight.foreign-opinion.list-with-content
insight.foreign-report.download
insight.highlight.list
insight.opinion.detail
insight.opinion.list-with-content
insight.pamirs-summary.download
insight.summary.download
tool.file-parse.submit
tool.web-search
vault.drive.copy
vault.drive.create-folder
vault.drive.delete-file
vault.drive.delete-folder
vault.drive.upload
vault.my-conference.download
vault.stock-pool.create
-->
- **按单元格**：`indicator cross-section` / `time-series` / `screener`（A股 0.05 / 港股 0.1 / 美股 0.2 积分每 100 单元格；screener 按**筛选前**范围计费，见 `indicator.md`）；`ai knowledge-resource-download` 按下游资源计费
  - 🔴 截面 / 时序另有**单次 30000 单元格硬上限**（截面 = 证券数 × 指标数，时序 = 序列数 × 日期数），超出报 `100006`、不返回部分结果——按这个乘积拆批。板块 ID 会展开成全部成分股，实际证券数常远超写进命令的条数
- **单价未公布**：`insight pamirs-summary list` / `download`——spec 只写了「需购买专家纪要数据库」这个准入门槛，没给单次价格。**别据此假定免费**；大批量拉取前先小量试，或向平台确认

### 数据范围（能查多久）

正式账号口径（下表为官方公布值；实际可查范围随账号服务等级而定，以自己账号的实际返回为准）：

| 命令组 | 可回溯 |
|--------|--------|
| `quote` 行情 / `fundamental` 财报、主营、估值、股东 / `indicator`（EDE） | 前溯 **5 年** |
| `bond daily-quote` / `bond valuation` / `bond issuance-plan` | 前溯 **5 年**（试用账号 3 年） |
| `bond` 其余命令 | **不限**（返回最新静态资料或全部历史记录） |
| `insight highlight list` 会议线索 | 前溯 **3 个月**（试用账号 1 个月） |
| `ai security-clue` 投研线索 | 前溯 **1 个月** |
| 主题 / 热点 / QA / 日程（路演·调研·策略会·论坛）/ 纪要 / 观点 / 研报 / 公众号 | 前溯 **3 个月** |
| 管理层讨论 / A·港·美股公告 / `alternative edb-*` 行业指标 | 前溯 **3 年** |
| `insight pamirs-summary` 帕米尔纪要 | **不限**（但需单独购买专家纪要库） |

⚠️ **实际窗口按账号配**，换接口绕不过去（`indicator` 与 `quote day-kline` 同界）。整段在界外返回 `110003`（不是空结果），把日期移进范围或联系客户经理。🔴 **区间跨过下界时各接口不同**：`quote` 日 K / 分钟 K / 资金流向与 `fundamental valuation-analysis` 从下界起返回、**不报错**（首行明显晚于起始日时 CLI 在 stderr 提示）；`indicator` 与 `bond` 整批报 `110003`。**例外**：`quote minute-kline` 窗口短得多，整段在窗外返回空结果、不报错（CLI 在 stderr 提示）；`ai hot-topic` 超出账号可查范围时也返回空结果、不报错。

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

省略 `--output` 时 CLI 用本地 title-cache 里的真实标题做文件名（`independent-opinion` 与 `report-image` 的下载不在此列，也没有 `--resolve-title`）——**只读缓存**，命中就零额外调用。缓存由同端点的 `list` 写入，所以「先 `list` 再 `download`」这个正常工作流本来就免费拿到正确文件名。

🔴 **未命中时默认不回查**，退回服务端文件名或 `<type>-<id>.<ext>`。要回查得显式加 `--resolve-title`——它拉最近 200 条（4 次请求），而这些 list 多数按 **0.1 积分/条**计费，约 20 积分，只用于取一个更易读的文件名（下载本身 10–50）。**批量下载或按 ID 下旧文件**时：要么先跑一次 `list` 把标题灌进缓存，要么直接 `--output ./<名>.<ext>` 自己定名；`--resolve-title` 会把取回的 200 条一并写回缓存，同批后续下载不再重复消耗。

## 意图路由表

| 用户意图 | 命令 |
|---------|------|
| 研报 / 券商报告 | `insight research list` |
| 外资研报 | `insight foreign-report list` |
| 首席观点 / 内资机构观点 / 分析师观点 | `insight opinion list`（只含摘要 `brief`，1/条）；要正文 → `insight opinion detail --chief-opinion-id`（30/条） |
| 外资机构观点 / 外资券商观点 | `insight foreign-opinion list`（摘要 + 中文摘要）；要原文与译文 → `insight foreign-opinion detail --foreign-opinion-id`（30/条） |
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
| 知识库原文下载（搜到后取全文） | `ai knowledge-resource-download`（前置：`knowledge-batch` 拿 `resourceType`+`sourceId`；`250001`=组合不匹配） |
| 一页通 / 投资逻辑 / 同业对比 / 调研提纲 | `ai one-pager / investment-logic / peer-comparison / research-outline` |
| 个股看点 / 投研总结 / 公司速览 | `ai stock-summary`（`--security` **只收具体代码**，单次最多 6000 个、超过时 CLI 报错并提示分批；仅 A 股/港股，不支持 `aShares`/`hkStocks` 全市场批量） |
| 业绩点评（异步） | `ai earnings-review` |
| 观点 PK / 多空辩论（异步） | `ai viewpoint-debate` |
| 投研线索 | `ai security-clue`（前置：`reference securities-search` 拿 `gts-code`） |
| 主题跟踪 | `ai theme-tracking`（前置：`reference concept-search` 拿 `theme-id`） |
| 热点话题 / 早午晚报 | `ai hot-topic` |
| 管理层讨论（财报） | `ai management-discuss-announcement` |
| 管理层讨论（业绩会） | `ai management-discuss-earnings-call` |
| 日 K（历史，A 股 / 港股 / 美股 / 沪深 ETF / 各类指数含全球指数，可混查） | `quote day-kline` |
| 沪深京指数日 K / 要指数名称 | `quote day-kline` 逐个传指数代码（**没有一次拿全部指数的写法**，`index-day-kline --security all` 会被 CLI 拒绝）；指数名称用 `reference securities-search --keyword <指数代码> --category index`（返回 `gtsName`） |
| ~~港股 / 美股日 K~~ | ⚠️ 已弃用，用 `quote day-kline`（`day-kline-hk` / `day-kline-us` 仍可调但不校验代码） |
| 分钟 K（沪深 A 股 / ETF + 各类指数含全球指数） | `quote minute-kline`（`--security` 可重复，逐只并发合并） |
| 实时行情（A / 港 / 美 / 沪深 ETF / 各类指数含全球指数） | `quote realtime` |
| A股资金流向（主力/大单净流入，日频） | `quote fund-flow`（`--security` 或 `aShares` 全市场〔须带 `--start-date`/`--end-date`，按日自动分片〕；免费） |
| 单证券 A股完整利润表 / 资产负债 / 现金流（累计 / 单季） | `fundamental income-statement[-quarterly] / balance-sheet / cash-flow[-quarterly]` |
| 单证券 港股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-hk / balance-sheet-hk / cash-flow-hk` |
| 单证券 美股完整利润表 / 资产负债 / 现金流 | `fundamental income-statement-us / balance-sheet-us / cash-flow-us` |
| 单证券主营业务 / 收入结构 | `fundamental main-business` |
| A股单证券估值序列 / PE / PB / 历史分位 | `fundamental valuation-analysis`（逐自然日一行，默认只取最近 2000 行；长区间要把 `--limit` 设到不小于区间天数，撞满会退出 3；起点早于账号回溯下界时从下界起返回、不报错） |
| A股盈利预测 / 一致预期 | `fundamental earning-forecast` |
| 前十大股东 | `fundamental top-holders` |
| 债券基本资料 / 票面利率 / 到期日 / 债券条款 | `bond basic-info`（`--field` 写错**整批拒绝** `100003`，不会静默丢列） |
| 发债主体 / 发行人画像 / 存续债券 | `bond issuer-info`（`--security` 按债券码 或 `--issuer` 按主体名模糊匹配，**二选一**，同传或都不传 CLI 在本地拒绝） |
| 债券行情 / 净价 / 全价 / YTM / 久期 | `bond daily-quote`（`--start-date`/`--end-date` **必填**） |
| 上清所估值 / 债券估值 | `bond valuation`（日期必填；默认只返回可信度「推荐」的估值） |
| 付息兑付 / 现金流 / 还本付息计划 | `bond cash-flow` |
| 债券公告 | `bond announcement`（`--security` 或 `--start-date`/`--end-date` **二选一**；**手动翻页**，见下） |
| 债券发行 / 增发 / 招标结果 / 认购倍数 | `bond issuance-detail` |
| 债券评级 / 主体评级 / 担保人评级 | `bond rating-overview`（三方评级并列，**单次最多 10 只**） |
| 评级调整 / 评级变动历史 | `bond rating-change`（债项评级，最多 10 只）、`bond issuer-rating-change`（主体评级，`--security` 或 `--issuer` 二选一） |
| 利率债发行计划 / 国债发行安排 | `bond issuance-plan`（**只按日期区间查，不收债券码**） |
| 含权债行权 / 回售 / 赎回提示 | `bond exercise-notice` |
| 会议线索 / 会议要点 / 核心结论信息流 / 今天有什么会 | `insight highlight list`（🔴 **5 积分/条**，必须带 `--size`；`content` 是 HTML 片段） |
| 联网搜索 / 查公开信息 / 政策原文 / 传闻核实 | `tool web-search`（1 积分/次；`--site` 定向站点、`--min-tier` 收信源、`--include-content` 取正文〔此时 `--size` ≤5〕） |
| 云盘文件 | `vault drive-list / drive-download` |
| 云盘目录 / 文件夹里有什么 | `vault drive-folder-list`（`--space-type 1` 我的云盘〔默认〕/ `2` 租户云盘，`--parent-id` 不传即根目录） |
| 云盘上传 / 新建文件夹 / 重命名 / 移动 / 跨空间复制文件 / 删除（会改动账号数据） | `vault drive-upload / drive-create-folder / drive-rename / drive-move-file / drive-move-folder / drive-copy / drive-delete-file / drive-delete-folder`（删除须加 `--yes`；详见 `references/commands/vault.md`） |
| 录音速记 | `vault record-list / record-download` |
| 我的会议（业绩会/策略会/路演内部记录） | `vault my-conference-list / my-conference-download` |
| 微信群消息 | `vault wechat-message-list`（先 `vault wechat-chatroom-list` 拿群 ID） |
| 自选股股票池（查询） | `vault stock-pool-list / stock-pool-stocks` |
| 自选股股票池（增删改，会改动账号数据） | `vault stock-pool-create / stock-pool-rename / stock-pool-add-stock / stock-pool-remove-stock / stock-pool-delete`（删池须加 `--yes`；详见 `references/commands/vault.md`） |
| 行业指标搜索（EDB） | `alternative edb-search` |
| 行业指标时序数据（EDB） | `alternative edb-data` |
| 题材画像 / 投资逻辑 / 行业空间 / 竞争格局 | `alternative concept-info`（前置：`reference concept-search` 拿 `concept-id`；50/次）；**要催化事件**加 `--full`（500/次） |
| 题材成分股 / 题材深度 F8 | `alternative concept-securities`（前置同上；50/次）；**要重点个股标识 / 纳入理由**加 `--full`（500/次） |
| 多证券已实现财务 / 估值指标搜索（含总市值） | `indicator search` |
| 多证券已实现指标截面（多指标 × 多证券，同一查询日期） | `indicator cross-section`（前置：`indicator search --format json` 通过三项校验） |
| 多证券已实现指标时序（单指标 × 多证券，按区间） | `indicator time-series`（前置：`indicator search --format json` 通过三项校验） |
| 条件选股 / 按指标筛股票（市值+PE+经营范围等多条件组合） | `indicator screener`（前置：`indicator search` 拿 code；范围可传板块 ID，见 `reference sector-search`） |
| 证券代码 / gtsCode 搜索 | `reference securities-search` |
| 首席 ID / 分析师 ID 搜索 | `reference chiefs-search`（按姓名/机构/团队，用于 `insight opinion list --chief`） |
| 机构 ID 搜索（内资券商/外资/牵头/观点机构） | `reference institution-search`（按机构名，用于 `--institution` / `--broker`；免费） |
| 公众号 ID 搜索（按公众号名/机构/分类） | `reference official-account-search`（返回 `accountId`，喂 `insight official-account list --account-id`；免费） |
| 常量/枚举 ID（行业/城市/公告分类/区域/债券类型/评级类型/交易市场等，分类以 `reference constant-category` 的返回为准） | `reference constant-list --category <code>`（分类代码用 `reference constant-category` 查；该接口会列出每个分类适用于哪些接口的哪个参数） |
| 题材 ID 搜索 | `reference concept-search` |
| 板块 ID 搜索 | `reference sector-search` |
| 板块成分股 | `reference sector-constituents`（前置：`reference sector-search` 拿 `sector-id`） |
| PDF 转 Markdown / 解析文件 / 提取 PDF 正文 | `tool file-parse --file <x.pdf> --wait`（异步，0.8 积分/页，提交时扣；取结果 `tool file-parse-check --task-id`。**平台自有研报/公告优先用各 download 的 `--file-type 2` 直出 Markdown**，别花解析费） |

**易混淆消歧**：
- "纪要" → 外部信息走 `insight summary`；明确点名"帕米尔 / Pamirs"才走 `insight pamirs-summary`（另一个库，不是 `summary` 的子集）；公司内部录音/会议走 `vault my-conference`
- "搜索 X" → 数据维度精确（按行业/券商）走对应 `insight ... list`；跨类型语义搜索走 `ai knowledge-batch`
- 港股代码用在 `insight foreign-opinion --security` 还是 `quote day-kline --security`？前者要"境外"格式（`UBER.N`），后者要 `.HK`
- "成分股" → 题材深度（分组；重点标记/纳入理由需 `--full`）走 `alternative concept-securities`；板块（行业/概念分类树，纯代码名单）走 `reference sector-constituents`
- **证券指标按任务形态路由，不是搜到 EDE 就一律走 EDE**（细节见 `references/commands/indicator.md`）：
  - 单证券 → 优先 `fundamental` 专用命令（多数免费 / 低价）；多证券批量取**已实现**指标 → `indicator`（EDE）一次拉取：同一日期 / 报告期横比用 `cross-section`，区间走势用 `time-series`（不能多指标 × 多证券同时）
  - 始终不走 EDE：盈利预测 / 一致预期 → `fundamental earning-forecast`（EDE 的 EPS 是已实现值，**不能冒充预测**）；A 股估值历史分位 → `valuation-analysis`；行情与 K 线 → `quote`；行业 / 宏观指标（无证券维度）→ `alternative edb-*`。**例外：总市值只有 EDE 有**——`indicator cross-section --indicator qte_mkt_cptl`（单位「元」，用 `--scale` 缩放）
  - 取数前 `indicator search --format json` 核三项：`indicatorName` + `description` 语义对、`scopeList` 覆盖全部目标市场、`parameterList` 必填参数可满足；任一不符就回退专用接口，港 / 美股缺专用能力时如实说不支持。「某市场无数据」这类否定结论以当次 `scopeList` + 抽查一行为准
  - 日期参数**只看 `parameterList` 必填哪个**：`tradeDate` → `--date`，`reportDate` → `--indicator-param "code:reportDate=..."`（多数报告期类要后者，但 `_ttm` 整族要 `tradeDate`）；两个都必填（如 `div_cash_yld`）就两个都用 `--indicator-param` 显式给，只给 `reportDate` 时 `--date` 不再注入、会报 `100001`。日频估值（`finc_pe_ttm` / `finc_pb_mrq`）用最新交易日，用报告期末日期会取到陈值；参数名同样以 `parameterList` 为准（复权是 `adjustType`）
  - 结果**按 `security` 字段取值**，别按请求下标对位（证券会按代码升序重排）；批量回填加 `--key-by code`
  - 估值历史：EDE 与 `valuation-analysis` 的财报口径切换时点与财报版本都不同，做分位 / 回测两边都拉交叉核
- "业绩点评"双义消歧：**检索已有**的业绩点评：研报走 `insight research list --llm-tag earningsReview`（0.1/条；`--llm-tag` 只有 `opinion` / `research` / `foreign-report` 三个列表有），业绩会纪要走 `insight summary list --category earningsCall`；**AI 现生成**一份走 `ai earnings-review`（异步、50/次）。不确定问一句

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

**交易所后缀**：`.SH` 上交所（6 开头）｜ `.SZ` 深交所（0/3 开头）｜ `.BJ` 北交所 ｜ `.HK` 港股 ｜ `.O` 纳斯达克 ｜ `.N` 纽交所 ｜ `.A` AMEX ｜ 沪深 ETF 同 `.SH` / `.SZ` ｜ 全球指数用数据源后缀（`SPX.SPI` `N225.NKI` `HSI.HI` `GDAXI.FRA` …，清单见 `references/commands/quote.md`，**别猜**）。

**跨市场**：`quote day-kline` 与 `quote realtime` 都可一次混合传入多市场代码（含 ETF 与全球指数）：`quote realtime --security 600519.SH --security 00700.HK --security AAPL.O --security SPX.SPI` 单接口同时返回。

## 响应解析骨架（通用模式）

| 模式 | 出现命令 | 结构 | 处理 |
|------|---------|------|------|
| **列表** | 大多数 `list` | `{list: [...], total: N}` | 遍历 list；CLI 已自动翻页 |
| **下载** | 各 `download` | stdout = 文件路径字符串 | 直接读 stdout 整行 |
| **AI 内容** | one-pager / investment-logic / peer-comparison / research-outline | `{content: "markdown文本"}`（one-pager 另带 `date`，即生成日期） | 取 `content` 直接呈现 |
| **K 线** | quote * | `{list: [{tradeDate, ...}]}` | 按 tradeDate 排序，取需要的尾部 |
| **异步（含 *-check）** | earnings-review / viewpoint-debate / earnings-review-check / viewpoint-debate-check | 提交 `{dataId, status, hint}`；check 成功 `{date, content}`；仍在生成 `{dataId, status:"pending", hint}`（退出 0）；终态失败 stderr 报错、退出 1 | 见下方"异步任务流程" |
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
| 今天 / 今日 | 当天：`--start-time "<今天> 00:00:00" --end-time "<今天> 23:59:59"` | 见下行「最新 / 当前（K 线）」 | — |
| 最新 / 当前（K 线） | — | **45 天范围 → 从尾部取最近交易日**，不要只用 `--limit` | — |
| 最新一期 / 最新报告期（财报） | — | — | 省略 `--fiscal-year`，传 `--period latest`（默认） |
| 最新观点 / 今日观点 | 1 天范围 + `--rank-type 2` | — | — |

🔴 **`--end-time` 一律写到当天末尾 `23:59:59`**：只写日期时，A 股公告与 `knowledge-batch` 按当日 00:00:00 处理，「今天」就成了零宽窗口、取不到当天任何数据。

日期参数**按参数名判断、不按命令组**：名字带 `-date` 的（`--start-date` / `--end-date` / `--date` / `--report-date`）收年在前日期（`YYYY-MM-DD` 首选，`YYYY/MM/DD` / `YYYYMMDD` 也收）；名字带 `-time` 的（`--start-time` / `--end-time`）收年在前日期 + 可选 ` HH:mm[:ss]`（空格或 `T` 分隔）或 10 / 13 位时间戳。易错：Insight / Vault 各 list 用 `-time`，**唯独 `insight performance-calendar` 用 `-date`**；AI 组两种都有（`theme-tracking --date`、`hot-topic` / `management-discuss-*` 用 `-date`，`security-clue` / `knowledge-batch` 用 `-time`）；`quote minute-kline` 用 `-time`，其余 Quote / Fundamental / Indicator / `bond` / `edb-data` 用 `-date`。拿不准看该命令 `--help`。

支持排序切换的 list：opinion / summary / pamirs-summary / research / foreign-report / 三个公告 / foreign-opinion / independent-opinion / official-account。**要最新加 `--rank-type 2`（按 `publishTime` 倒序）；要最相关用默认 `--rank-type 1` + `--keyword`**——两者从同一结果集取的是**不同子集**，没有 `--keyword` 时无差异。`--search-type 2`（只有 summary / pamirs-summary / research / foreign-report / 三个公告 / official-account 有）扩大命中总数与 `--rank-type 2` 的候选池，**不改变 `--rank-type 1` 取回的条目**，要相关度不必加。判断这两个参数是否生效的方法见 `references/commands/insight.md` 开头。

## 异常处理

**退出码**：`0` 完整成功（含合法空结果）／ `3` 有数据但不完整（`partial: true`，stderr 有 warning；标记只在 `--format json` 里看得见，csv / jsonl 落盘看旁边 `<file>.meta.json` 的 `complete` 与 `result`）／ `4` 数据写全了，但 `--output` 文件在收尾时被另一次写向同一路径的导出替换（给并发导出各自的 `--output` 即可）／ `1` 硬失败／ `130` / `143` / `129` 被 Ctrl-C / `kill` / 终端断开中断（本次的暂存文件已删除）。**拿到 3 就必须告知用户缺了哪段，不能当成功静默继续**。按标记处理：`failedPages` / `failedShards` 重拉失败段；`truncatedShards` / `truncatedSecurities` / `totalCapped` / `duplicateRows` 缩小日期范围分批重拉；`changedRows` 直接重拉；`missingFields` 核对字段名；其余标记见 `references/errors.md`。报错行带 `[trace <id>]`，**报障给 Gangtise 时务必带上**。

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
| `999011` | 凭证无效 | 查 AK/SK 环境变量，CLI 不重试 |
| `999004` | 无资源权限（整库未开通与单条不可见都走这个码） | 先确认该数据库是否已购买 |
| `0000001008` / `999002` | token 失效 | CLI 自动重登一次，无 AK/SK 时提示重新登录 |
| `100006` | 查询/下载数量超限 | 缩短日期范围或调小 `--size`/`--limit` |

其他场景：CLI 未安装 → `npm install -g gangtise-openapi-cli`；空结果 → 扩大时间范围 / 换关键词 / 去掉部分筛选；模糊公司名匹配多只 → 列出让用户选；下载路径冲突 → 询问覆盖。

## 详细参数

按需 Read 对应文件：

- 内资观点 / 纪要 / 路演 / 调研 / 策略 / 论坛 / 财报日历（performance-calendar）/ 研报 / 外资研报 / A 股公告 / 港股公告 / 美股公告 / 外资观点 / 独立观点 / 公众号（official-account）/ 投资者问答（qa）/ 研报图表（report-image）→ `references/commands/insight.md`
- 行情命令（A 股 / 港股 / 美股 / ETF / 指数日 K、分钟 K、实时行情、资金流向 fund-flow，含全球指数清单） → `references/commands/quote.md`
- 三大报表（A 股 / 港股 / 美股）/ 主营 / 估值 / 盈利预测 / 股东 → `references/commands/fundamental.md`
- knowledge-batch / security-clue / 个股看点（stock-summary）/ AI agent / 异步任务 / 主题跟踪 / 热点 / 管理层讨论 → `references/commands/ai.md`
- drive / record / my-conference / wechat / 股票池 → `references/commands/vault.md`
- 行业指标数据库（EDB）/ 题材指数画像与成分股（concept-info / concept-securities）→ `references/commands/alternative.md`
- 数据指标（EDE：search / cross-section / time-series / screener，证券级指标截面、时序与条件选股）→ `references/commands/indicator.md`
- 债券（basic-info / issuer-info / daily-quote / valuation / cash-flow / announcement / issuance-* / rating-overview / rating-change / issuer-rating-change / exercise-notice）→ `references/commands/bond.md`
- PDF 解析（file-parse）/ 联网搜索（web-search）→ `references/commands/tool.md`
- securities-search / chiefs-search（首席 ID）/ institution-search（机构 ID）/ official-account-search（公众号 ID）/ 常量查询（constant-category / constant-list）/ 题材 ID（concept-search）/ 板块（sector-search / sector-constituents）/ lookup 本地表 / 行业别名 / raw call → `references/commands/reference-and-lookup.md`
- 错误码全表 / 不报错的坑 / 退出码 3 与 `screener` 缺列判据 / Troubleshooting → `references/errors.md`

跑通流程对照 → `references/examples.md`
