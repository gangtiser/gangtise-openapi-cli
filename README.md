# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 获取全量金融信息的命令行工具，同时提供Agent Skill。

## Changelog

### v0.28.2 — 2026-07-24

EDE 指标批量取数优化（基于对上游 990 个指标的实测）。

**新增**
- `indicator cross-section` / `time-series` 加 `--key-by name|code`（默认 `name`）：`code` 模式列头用 `indicatorCode`（时序多证券侧用 `securityCode`），唯一且与服务端返回列序无关。**多证券批量按 code 回填必用**——此前拍平只按指标显示名，而多个指标同名（如 `cf_finc_exp`/`_qtr` 都叫「财务费用」）+ 服务端会重排返回列序，导致按名/按位置都错位、只能绕道 raw API 手工回填

**修复**
- EDE `999999` 无数据提示只对取数端点（`cross-section`/`time-series`）套用，`indicator.search`（同为 no-999999 策略、仅关键词入参）回落通用提示；文案改为「日期匹配指标周期（财务/MRQ 用报告期末、日频估值用交易日）、`scopeList`、`parameterList` 中 required 参数」——修正此前「行情/估值用交易日」与 `finc_pb_mrq` 仅报告期末的矛盾

**文档（随包 skill）**
- `indicator.md`：`--key-by` 文档 + 两处 synopsis；`periodNum` 补「部分需配年报日期」、`startDate` 补「取值须匹配指标周期」
- `examples.md` 例15：批量三截面示例改用 `--key-by code`

### v0.28.1 — 2026-07-23

Agent Skill 文档取数路由对齐（对齐 gangtise-mcp 0.1.46）：多证券取一批**已实现**财务/估值指标优先走 EDE `indicator cross-section`/`time-series` 一次拉取，替代逐只 `fundamental` 循环。**本版仅改随包分发的 skill 文档（`gangtise-openapi/`），无 CLI 代码/命令/参数变更。**

**路由规则**
- 单票财务/估值/盈利预测/股东/主营、单票完整三大报表 → 仍走 `fundamental` 专用命令；行情/K 线 → `quote`（免费批量）
- 多证券已实现财务/估值指标 → 优先 EDE（`cross-section` 单日快照 / `time-series` 单指标×多证券区间）
- 始终排除 EDE：盈利预测·一致预期、估值历史分位（实测 EDE 无此两类）、OHLCV/K 线、单票完整报表
- EDE 取数前三项校验：`indicatorName`+`description` 语义 / `scopeList` 覆盖全部目标市场 / `parameterList` 必填参数，任一不符即回退专用接口

**实测校正（2026-07-23）**
- `scope` 字段更正为 `scopeList[].market/.securityType`（服务端已返回实际覆盖），覆盖按指标而异：`finc_pe_ttm`/`finc_pb_mrq` 仅 A 股、`is_op_rev` A 股+港股，均不含美股；`valuation-analysis`/`earning-forecast` 仅 A 股
- `finc_pb_mrq`(市净率 MRQ) 只在报告期末打值（交易日取 `null`），非日频；EDE 财务指标 `reportType` 枚举 label 与实测取数不符（`value=2/4` 直接 `999999`），要指定报表口径改用 `fundamental` 三大报表 `--report-type`

### v0.28.0 — 2026-07-21

对齐服务端 2026-07-17 更新（内资研报下载调价 + 41 个公开错误码重排）。**41 个码逐个打了线上探针**，结论是迁移按「错误处理层」而非按业务模块进行、文档并不等于现状：同一个接口内，参数校验层与路由层已发新码，方法路由层和 token 过滤器仍发旧码，异步生成状态也仍是旧码。CLI 对两代都识别。

**错误码体系**
- `errors.ts` 错误码表按新三层结构（`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层）重写，覆盖 41 个公开码 + 实测仍在线的旧码
- 异步轮询同时识别 `410110`/`140001`（生成中）与 `410111`/`140002`（终态失败）。实测服务端**仍在用旧码**（HTTP 400、无 `errorType`），新码为预置——服务端切换那天 `--wait` 不会在首次轮询就抛错中止，把已扣的 50 积分作废
- `140002`（异步 PROCESSING_FAILED，`410111` 的新码）纳入 transport 终态码集合、任何 HTTP 状态都不重试——异步 `*-check`（get-content）端点无 retry 声明、走默认策略，`140002@500` 会被白重试 2 次才轮到 `asyncContent` 的 `FAILED_CODES` 识别（后者在 `client.call` 的 `withRetry` 之上、拦不到重试）；`140002` 语义即「生成失败·终态」、只有那些异步端点会返回它，故全局终态化既安全又省掉白重试。实测服务端仍用 `410111`，此为预置
- token 自愈补上 `999002`（`0000001008` 的新码）；`999011`（AK/SK 不匹配）加入**终态码集合**，任何 HTTP 状态下都不重试——凭证错不会自己好。注意它只来自 `auth.login`，而 login 走 `useAuth=false` 压根不经过自愈码表，所以「不列进自愈表」并拦不住 `auth.login` 在 5xx 上按默认策略重放两次，必须落在终态码上
- 修正 `900002` 的错误释义：实测服务端用它表示「请求方法不正确」（HTTP 405），旧文档写作「请求缺少 uid」，据此排查会走错方向
- 错误提示改为只给下一步动作，不再复述服务端 msg（此前输出形如 `资源不存在 资源不存在，确认 ID 有效`）——新旧两代都过了一遍：留用的 `903301` / `8000016` / `8000018` / `999995` / `999997` / `900001` / `130001` / `410004` / `410110` / `410111` 原本是逐字重复 msg
- 补上 `410001` / `410106` 两个 EDE 专有旧码的提示——它们没被 2026-07-17 重排收编，却是 `indicator` 取数最常见的两个报错（漏传 `--indicator`/`--security`、漏传 `periodNum` 等必填参数），`indicator.md` 早已把它们列为首要排查项
- `110002`（日期区间非法）提示改为同时覆盖 `--start-date/--end-date` 与 `--start-time/--end-time`——此前只提 date 参数，而 `insight` 系 list 按 `--start-time` 排序，旧提示指向的是命令根本没有的参数
- `999006`（限流）提示不再断言「CLI 已退避重试」——仅限流以 429 返回时才全局按 `Retry-After` 退避重试；5xx 形态只有默认策略端点会重试、贵档 no-replay 端点不会，200 错误信封则不重试
- `130001` 提示改为先给通用「未找到数据/核对查询条件」再限定 EDE 指标权限（此前把通用 DATA_NOT_FOUND 一律导向「未开通指标」）；`130002` 提示补上「非法 `--file-type` 也归此码」（下载类兜底）

**行为变更（本地校验）**
- 所有 date 参数（`--start-date`/`--end-date`/`--date`/`--report-date`，覆盖 Quote/Fundamental、AI `theme-tracking`/`hot-topic`/`management-discuss-*`、Alternative `edb-data`、Indicator）只接受 `YYYY-MM-DD`，其余格式在发请求前报 `ValidationError`——**服务端额外接受的两种「年在后」格式日月顺序相反**：实测 `07/01/2026`（斜杠）读成 `2026-01-07`、`07-01-2026`（横杠）读成 `2026-07-01`，同样三个数字差半年且都返回 HTTP 200，响应里不回显服务端实际采用的日期（用 `25/12` 与 `12/25` 的互补接受结果交叉验证）。CLI 无从判断用户想要哪个读法，故只转发无歧义写法。`20260701` / `2026/07/01` 这类服务端同样能正确处理的写法也一并拒掉——统一成一种入参形态，好过按端点逐一探针维护白名单；报错文案说明该用哪种写法，不再断言输入本身有歧义
- **datetime 参数（`--start-time`/`--end-time`）本地拦截覆盖全部透传命令**（insight research/summary/announcement-hk/us、vault 各 list、`quote minute-kline`、`ai security-clue` 等原样透传的 18 处，外加转时间戳的 A 股 `announcement` / `knowledge-batch`）。**服务端对透传的年在后格式静默误解析、并不报 `110001`**：实测 `insight research list` 对 `07/01/2026` 返回 1562 条（=`2026-01-07`）、`07-01-2026` 返回 210 条（=`2026-07-01`），差半年、都 HTTP 200、响应不回显实际日期。新增 `parseDatetimeOption` 做**时区无关**的字段校验（算术闰年、不构造本地 `Date`，故 DST 缺口时刻等对服务端合法的字符串不被客户端时区误伤）后**原样透传**
- 本地时间校验只认 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm[:ss]`（空格或 `T` 分隔、秒可省）或 10/13 位时间戳；此前 `parseTimestamp13` 用 `new Date()` 兜底还能吞 `.SSS` 毫秒尾、`+08:00` 时区尾、以及 `Infinity`/`1e309`/非整数（数字分支只查 `NaN`，这类会序列化成 null 静默取消过滤），现一律拒绝（时间戳分支改用严格 `^\d{10}$`/`^\d{13}$` 位数正则——这也是科学计数法 / 16 进制 / 空白 / 非标准位数被拒、且 13 位 `1000000000000` 不再落进秒分支的原因）

**修复**
- EDE 内层信封的报错（`indicator` 取数失败的 `999999` / `130001` 等）此前**永远拿不到 traceId**：实测 `traceId` 只挂在外层信封上，而外层在解包时即被丢弃，内层抛错又没传 details。现在外层 id 以不可枚举属性随 payload 带下去（不进 JSON/CSV 输出），`ApiError.traceId` 兜底读它——这类错误恰恰最需要报障，此前与 README「报错行会带 trace」的表述对不上
- HTTP 200 包裹的错误信封（Gangtise 也用这种形态）此前会丢掉服务端的 `Retry-After`：主 JSON 路径与下载 JSON 路径两处 `unwrapEnvelope` 都补上（此前只有 4xx/5xx 的 `throwHttpError` 保留），限流响应的退避窗口不再被丢弃
- `toTimestamp13` 的日历校验补年份与时间 round-trip：`0050-06-15` 曾被 `Date(50,…)` 构造器映射成 1950、DST 缺失时刻（如 America/New_York 的 `02:30`）曾被静默移到 `03:30`——均改为拒绝
- 异步终态失败（`410111`/`140002`）的报错行补上 code / msg / `traceId` 并提示重提会再次计费——此前只打印一句 "Content generation failed"，把本版新增的 trace 信息吞掉了，与 README「报错行会带 trace」的表述矛盾

**可观测性**
- 响应信封新增的 `traceId` 透出到 CLI 报错行：`API error (130002) [trace 830965044897325056]: 资源不存在 确认 ID 有效…`——这是 Gangtise 侧唯一能回溯一次失败的抓手，报障时请带上

**计费**
- `insight research download`（内资研报）**20 → 10 积分/篇**，SKILL.md 积分速查表与 `insight.md` 同步

**文档（实测结论沉淀）**
- SKILL.md 异常处理表重写为「实测确认在用」与「文档列出但未触发」两组，标注每个码的实测状态与兜底关系（`100003` 是参数类兜底、`130002` 是下载类兜底，`130003`/`130004`/`130005` 均未启用）
- 记录两个实测坑：**枚举值拼错与分页越界服务端不报错**（静默忽略该筛选条件，拼错会伪装成"结果正常"）；**`viewpoint-debate` 敏感内容不被提前拦截**，扣满 50 积分后才以 `410111` 失败
- 纠正 SKILL 异常表 `110001`/`110002` 行的日期分类：此前按命令组（「Quote/Fundamental 用 date、Insight/AI 用 datetime」「110001 只有 Insight 系报」）与 AI `management-discuss --report-date`（date 型）及实测都冲突——实测 `fundamental` 对 `2020/01/01` 报 110001、`insight research list` 对 `30/06/2025` 反而宽松解析返回数据，改为按参数名分类、不按命令组预判
- 新增判别法：新码信封 `code` 是 JSON 数字且带 `errorType`，旧码是字符串且没有——但它判断的是**单条错误路径**切没切，不是整个接口（成功响应也没有 `errorType`，别拿它当判据）
- README 常见错误表同步重写；Troubleshooting 的 `8000014/8000015` → `999011`、`430007` → `100006`

### v0.27.0 — 2026-07-11

**EDE 指标（体验修复）**
- `indicator` 三端点对 `999999` 不再自动重试——实测服务端用 `999999` + HTTP 500 表示「查询无数据」（节假日 / 未来日期 / 未覆盖标的），此前每次空查询白烧 3 个请求 + ~4 秒；错误提示改为指向检查查询条件而非「稍后重试」

**资金与下载加固（承接 v0.26.0）**
- 下载路径同样接入重试策略：50/篇 的 `summary` / `foreign-report` / `my-conference` download 改为 no-replay（与 AI Agent 同价档；下载中断重试可能重复计费），10-30/篇 的下载维持默认重试
- 签名 URL 下载增加整体硬截止（10× 单请求超时）——headers/body 超时是空闲型，慢滴速传输可无限续命；最终 rename 失败时清理 `.part`
- `GANGTISE_PAGE_CONCURRENCY` 防御性解析：非法/非正数回退默认 5、上限 32——负值此前被底层钳制成**单 worker 串行**（静默变慢），过大值可能造成过度并发触发限流
- `--version` 更新提示改为数值分段版本比较（不处理预发布号；本项目只发 x.y.z）——刚发版的 registry 滞后窗口不再把旧版本提示成"可更新"

**体验与正确性小修**
- `--wait` 异步轮询容忍瞬态错误：5xx/网络抖动只消耗一次尝试并继续等待，不再作废整段等待（积分不足等终态错误仍立即中止）
- table 输出单元格显示宽度上限 120（超长截断加 `…`）——一个超长字段不再把整列所有行 pad 成同宽（行数 × 宽度的空格放大）
- markdown 输出先转义反斜杠再转义竖线，字面 `\|` 单元格不再错位列；table/markdown 过滤 C1 控制符（U+009B 单字节 CSI 注入面）
- 自动文件名按码点截断，emoji 不再被截成 `�`；EDE 矩阵中与 `date`/`security`/`name` 同名的指标列自动加后缀，不再覆盖元数据列
- 全市场分片截断时输出 `truncatedShards`（具体日期区间，与 `failedShards` 对称），脚本/AI 消费者可定向缩窗补拉
- 分页端点首页形状漂移（如 `total` 变字符串）时 `--verbose` 下告警，不再完全静默退化单页

**Skill 分发**
- `gangtise-openapi/` 目录纳入 npm 包；README 安装命令改为从 `$(npm root -g)` 复制——此前的相对路径命令对 npm 用户不可执行

**防漂移门禁（工程，不影响 CLI 行为）**
- 新增 README↔ENDPOINTS 一致性测试：「自动翻页」清单与注册表 pagination 标记双向比对（此类手抄清单漂移已发生两次）；insight/reference 子命令的 `--help` 覆盖改为从端点注册表派生，新命令漏接线直接测试失败
- `npm run prepare` 前置断言 README/CHANGELOG 含当前版本条目（写盘前检查，失败零残留）；`npm run typecheck` 纳入 tests/（tsconfig.test.json）
- CI：`npm pack` 装包冒烟（`--help` + skill 文件存在校验）、测试矩阵 Node 下限改精确 20.18.1、CI typecheck；publish 的 `workflow_dispatch` 必须指向 `v*` tag（关闭无护栏发布通道）

### v0.26.0 — 2026-07-11

**资金安全（重要）**
- 13 个贵档端点（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`×2 / `hot-topic` / `knowledge-batch` / `earnings-review get-id` / `viewpoint-debate get-id` / `concept-info` / `concept-securities`）改为 **no-replay 重试策略**：5xx / 超时 / `999999` 不再自动重放——实测（2026-07-11）平台按次计费且**缓存命中不豁免**，同参数重放每次都扣分；仅连接期错误（`ECONNREFUSED`/DNS，请求未发出）、429 限流和 token 自愈仍重试。便宜按条计费的 list 类维持原全量重试（失败响应没有数据行、不计费）
- 连接失败 `ECONNREFUSED` / `UND_ERR_CONNECT_TIMEOUT` 纳入默认重试范围（此前这两类不重试）

**文件安全**
- 所有 `--output` 落盘（导出、流式下载主路径、签名 URL 跟随下载）改为原子写：先写同目录 `.part` 成功后 rename——重跑失败不再毁掉已有旧文件；顺带修掉中止路径上 `.part` 因流懒打开竞态残留的问题
- 签名 URL 跟随下载改走 transport 层：遵守 `GANGTISE_TIMEOUT_MS`（此前裸 `fetch` 无超时，慢滴速 CDN 可无限挂起）、网络错误自动重试、跟随最多 3 跳重定向（undici 不自动跟随，超限/缺 `Location` 报错而非把跳转页存成文件）、`--verbose` 日志剥离签名 query 只留 origin+path
- 自动命名去重后缀试尽 `-1`…`-99` 仍冲突时报错，不再静默覆盖最早的文件

**修复 / 加固**
- 下载重定向超过 3 跳或缺 `Location` 时报错，不再把跳转页 HTML 当文件内容保存
- 损坏的 gzip 响应包装为带请求上下文的 `ApiError`（此前抛裸 zlib `Z_DATA_ERROR`，与请求无关联且不可定位）
- `alternative edb-search --limit` ≤200、`indicator search --limit` ≤100 本地上限校验——实测服务端对超限值静默截断（201→200、101→100），与 v0.25.0 的 `--top` 同类同修法

### v0.25.0 — 2026-07-10

**新增接口（4）**
- `insight qa list` — 投资者问答 QA：按证券提取互动平台 / 电话会议 / 调研纪要的提问与回答；`--security-code`（必填）、`--source`（`conference`/`interactive`/`survey`）、`--question-category`（11 类，见 `insight.md`）、`--answer-important`（`1` 是 / `0` 否）、`--start-time`/`--end-time`（字符串直传）；自动翻页（单页上限 500）；0.1 积分/条
- `insight report-image list` / `download` — 研报图表：按关键词搜索研报图片，返回 `chunkId` + 元数据（`--keyword` 必填、`--top` 默认 10 上限 20、`--source-id`、时间过滤；**免费**），再 `download --chunk-id` 下二进制原图（JPEG，0.1 积分/张）
- `reference official-account-search` — 公众号 ID 搜索：输入公众号名 / 机构 / 关键字返回 `accountId`（喂 `insight official-account list --account-id`）；`--keyword`（必填）、`--category`（`listedCompany`/`broker`/`government`/`media`，可重复；未分类公众号 `category` 为 `null`，传 `--category` 会漏掉）、`--top`（默认 10 上限 10）；免费

**变更**
- `indicator search` / `cross-section` / `time-series` 市场范围从仅 A 股扩展至 A 股 / 港股 / 美股（服务端变更；CLI 早已支持 `--currency` 与多市场证券代码，无需改动）。⚠️ 美股代码用交易所后缀 `.O`(NASDAQ) / `.N`(NYSE)，**非 `.US`**——官方示例的 `AAPL.US` 查不到数据，实测须 `AAPL.O`

**修复 / 加固**（承接上一批未单独发版的改动）
- 分页 / 分片 `partial` 检测补全：`requestPaginated` 的短后续页、`MAX_PAGES` 上限、`total` 漂移、失败页四种场景统一触发 `partial`（退出码 3）——失败页独立成判定条件，避免超额返回的兄弟页把行数补满、掩盖失败页空洞；`quote` 全市场分片硬错后熔断、破损形状分片计入 `failedShards`
- `--top` 本地上限校验（`report-image` / `knowledge-batch` ≤20，reference 六个搜索命令 ≤10）——实测服务端对超限值**静默截断**不报错，现在发请求前本地报错；`securities-search` / `institution-search` / `official-account-search` 的 `--category` 加本地白名单——实测服务端对拼错的分类**不报错**（securities-search 静默忽略过滤返回全类别、另两个静默返回空），拼写错误不再伪装成"无结果"（`insight qa` 的枚举服务端会报 `100003`，故不做本地白名单）
- 错误码 `100003`（参数值非法）补充中文提示——服务端不指明是哪个参数，提示对照命令 `--help` 检查枚举参数拼写
- undici `^7.16.0` → `^7.28.0`（修 keep-alive 队列污染 GHSA-35p6-xmwp-9g52），`engines.node` `>=20` → `>=20.18.1` 对齐 undici 实际最低要求

### v0.24.0 — 2026-07-07

**新增**
- `raw list` — 列出所有已注册的 endpoint key（含 method / path / description），配合 `raw call <key>` 使用，不必再翻文档记 key；支持 `--format`（默认 table）/ `--output`
- AI 同步生成端点内置 120s 超时下限（`one-pager` / `investment-logic` / `peer-comparison` / `theme-tracking` / `research-outline` / `management-discuss-announcement` / `management-discuss-earnings-call`）——生成耗时长不再撞 30s 默认超时触发重试，**不必再手动前缀 `GANGTISE_TIMEOUT_MS`**；显式设更大值仍生效（取 max）
- 429 响应尊重 `Retry-After`（秒或 HTTP-date；覆盖 JSON、非 JSON、下载三类错误路径），优先于默认指数退避，封顶 60s 防挂死
- 超大结果（≥5 万行且走非流式渲染：table/json/markdown，或 jsonl/csv 未带 `--output`）在 stderr 提示改用 `--format jsonl --output <path>` 流式落盘

**性能**
- JSON 请求启用 gzip（`accept-encoding: gzip` + 本地解压）——实测 `reference constant-list` 2110B→586B（3.6x），K 线类高重复大 JSON 收益更高；下载二进制路径不变
- 全市场按日分片（`quote fund-flow` / `day-kline` / `day-kline-us`，均 1 天/片）自动跳过周六日（A/港/美股周末闭市必空），省 ~28% 请求与每日调用配额；多日分片（`day-kline-hk` 2 天、`index-day-kline` 30 天）不受影响

**修复**
- 表格（table/markdown）显示宽度纳入 emoji 码位区（0x1F000–0x1FAFF），含 emoji 的微信群名/消息不再错位
- `fundamental earning-forecast` 默认 `--end-date`（"today"）改用运行机器本地日期；此前用 UTC 日期，CST 凌晨 0–8 点会算成"昨天"

**文档 / 工程**（不影响已发布 CLI 行为）
- `insight announcement`（A 股公告）时间过滤时区说明：`--start-time`/`--end-time` 按运行机器时区换算，跨机器精确边界改传 13 位毫秒时间戳
- CI 测试矩阵增加 Node 24（此前仅 20；发布用 24）

### v0.23.0 — 2026-07-05

**行为变更（注意）**
- ⚠️ 默认 API 域名迁移：`https://open.gangtise.com` → `https://openapi.gangtise.com`。旧域名仍可用，CLI 只是切换了默认值（新旧域名多接口实测等价）；如需固定旧域名设 `GANGTISE_BASE_URL=https://open.gangtise.com`
- `vault wechat-chatroom-list`：服务端接口改版为返回 `{ total, list }`（此前无 `total`、列名 `chatRoomList`）。CLI 相应改为按 `total` 并发翻页（不再串行翻页）；省略 `--size` 仍拉全量、传 `--size N` 取前 N 条，`Total:` 提示恢复
- 无翻页的行情端点（`quote fund-flow` / `minute-kline` / 显式多标的的日 K：`day-kline`·`-hk`·`-us`·`index-day-kline`）返回行数撞上单次 `--limit` 时标 `partial`（退出码 3）+ stderr 警告，避免被静默截断；`--limit` 现本地校验 ≤ 10000（撞服务端上限也不漏标）。K 线 `--security all` 仍走日期分片自动补全，不受影响

**新增**
- `quote fund-flow` — A股个股日资金流向（沪深京），含小/中/大/特大单流入流出金额及占比、主力净流入等字段；`--security`（或 `aShares` 全市场）、`--start-date` / `--end-date`、`--limit`（默认 6000，上限 10000）、`--field` 指定返回字段；无积分消耗（单只证券无翻页，撞 `--limit` 时的截断处理见上「行为变更」；**`aShares` 全市场须显式传 `--start-date`/`--end-date`，CLI 按日自动分片并发合并——缺日期会本地报错**）
- `reference institution-search` — 机构 ID 搜索，输入机构名/简称返回 `institutionId` 及适用接口参数（`usageScopes`）；`--keyword`（必填）、`--category`（`domesticBroker`/`foreignInstitution`/`leadInstitution`/`opinionInstitution`/`foreignOpinionInstitution`，可重复）、`--top`（默认 10，上限 10）；免费。覆盖既有 `--broker`/`--institution` 全部机构类（research/foreign-report/opinion/foreign-opinion/summary/roadshow/site-visit/strategy/my-conference）
- `vault my-conference-list` 新增 `--source` — 按录制来源筛选（`1`=企微会议助理 `2`=会议服务微信群，可重复；不传返回全部）

> 更早版本及完整更新历史见 [CHANGELOG.md](CHANGELOG.md)。

## 首次安装

```bash
npm install -g gangtise-openapi-cli
```

验证安装：

```bash
gangtise --help
```

更新到最新版（`gangtise --version` 会自动与线上版本比对）：

```bash
npm update -g gangtise-openapi-cli
```

> 更新后若使用 Agent Skill：包内 skill 已随包更新，但复制到 `~/.claude/skills/` 等目录的副本是快照，**需重新执行下方「安装」段的复制命令**才能让 AI 助手拿到新版 skill。

本地开发：

```bash
git clone git@github.com:gangtiser/gangtise-openapi-cli.git
cd gangtise-openapi-cli
npm install
npm run dev -- --help
```

## 环境配置

优先读取以下环境变量：

```bash
export GANGTISE_ACCESS_KEY="your-ak"
export GANGTISE_SECRET_KEY="your-sk"
export GANGTISE_BASE_URL="https://openapi.gangtise.com"
export GANGTISE_TOKEN="Bearer xxx"

# 性能/调试可选项
export GANGTISE_PAGE_CONCURRENCY=5     # 翻页/分片并发数（默认 5，上限 32；非法值回退默认）
export GANGTISE_VERBOSE=1              # 打印每个请求的耗时与字节数
export GANGTISE_TIMEOUT_MS=30000       # 请求超时（默认 30s）
export GANGTISE_TOKEN_CACHE_PATH=...   # 覆盖 token 缓存路径（默认 ~/.config/gangtise/token.json）
```

如果没有 `GANGTISE_TOKEN`，CLI 会自动调用 token 接口并缓存到本地（`~/.config/gangtise/token.json`，权限 0600）。Token 失效（`0000001008` / `999002`）时会自动重新登录并重试一次；凭证本身错（`999011`）不重试，直接报错让你查环境变量。


## AI Agent Skill

本项目包含 Skill 定义（`gangtise-openapi/SKILL.md`），可让 AI agent 自动调用 `gangtise` CLI 完成投研数据查询。支持以下 AI 编程助手：

- [Claude Code](https://claude.ai/claude-code) — `~/.claude/skills/`
- [Codex](https://github.com/openai/codex) — `~/.codex/skills/`
- [OpenClaw](https://github.com/openclaw/openclaw) — `~/.openclaw/skills/`
- [Hermes](https://github.com/nicepkg/hermes) — `~/.hermes/skills/`

Skill 目录结构：

```
gangtise-openapi/
├── SKILL.md                          # 主 skill 文件（必备规则、速查表、按需引用 references）
└── references/
    ├── commands/                     # 按命令组拆分的详细参数文档（agent 按需 Read）
    │   ├── ai.md                     #   AI 能力命令（one-pager / earnings-review / viewpoint-debate 等）
    │   ├── alternative.md            #   行业指标数据库（EDB search / EDB data）
    │   ├── fundamental.md            #   财务数据命令（A股/港股三大报表 / 估值 / 盈利预测 / 股东）
    │   ├── indicator.md              #   证券级数据指标 EDE（search / 截面 / 时序）
    │   ├── insight.md                #   投研内容命令（研报 / 观点 / 纪要 / 公告 / 外资）
    │   ├── quote.md                  #   行情命令（A股/港股/指数 K 线）
    │   ├── reference-and-lookup.md   #   GTS Code 搜索与枚举速查
    │   └── vault.md                  #   云盘/录音/会议/群消息/股票池
    ├── examples.md                   # 典型场景的端到端示例
    ├── fields.md                     # K线/财务字段中英文对照速查表
    ├── lookup-ids.md                 # 常用 ID 速查表（行业/券商/机构/公告分类等）
    └── response-schema.md            # 各接口响应字段说明
```

安装（skill 目录随 npm 包分发，`npm install -g` 之后即可从全局安装位置复制）：

```bash
SKILL_SRC="$(npm root -g)/gangtise-openapi-cli/gangtise-openapi"

# Claude Code
cp -r "$SKILL_SRC" ~/.claude/skills/gangtise-openapi

# Codex
cp -r "$SKILL_SRC" ~/.codex/skills/gangtise-openapi

# OpenClaw
cp -r "$SKILL_SRC" ~/.openclaw/skills/gangtise-openapi

# Hermes
cp -r "$SKILL_SRC" ~/.hermes/skills/gangtise-openapi
```

> 从仓库 clone 开发时，把 `$SKILL_SRC` 换成仓库内的 `gangtise-openapi` 目录即可。

> **版本更新**：每次 CLI 发版时，`gangtise-openapi/SKILL.md` 的 `version` 字段会自动同步。更新 CLI 后，请将项目中的 `gangtise-openapi/` 目录重新复制到对应的 skills 目录覆盖更新：
>
> ```bash
> # 示例：更新 Claude Code 的 skill
> cp -r gangtise-openapi ~/.claude/skills/gangtise-openapi
> ```
>
> 可通过查看 SKILL.md 头部的 `version` 字段确认当前版本。

安装后，可以用自然语言触发，例如：
- "帮我查今天所有的研报"
- "用 gangtise 命令查一下贵州茅台的日K线"
- "导出最近一周的首席观点到 jsonl"

## 数据接口覆盖

| 模块 | 子命令 | 说明 |
|------|--------|------|
| **Auth** | `login` / `status` | 认证登录、状态查询 |
| **Lookup** | `broker-org list` / `meeting-org list` | 券商/会议机构本地全量枚举表（按名称找 ID 优先 `reference institution-search`；行业/区域/公告分类/题材/申万码已改用 Reference 接口） |
| **Insight** | `opinion list` | 内资机构观点 |
| | `summary list` / `download` | 纪要（含下载，支持 `--file-type` 选原始/HTML） |
| | `roadshow list` | 路演 |
| | `site-visit list` | 调研 |
| | `strategy list` | 策略 |
| | `forum list` | 论坛 |
| | `research list` / `download` | 研报（含 Markdown 下载） |
| | `foreign-report list` / `download` | 外资研报（含中文翻译下载） |
| | `announcement list` / `download` | A股公告（含 Markdown 下载） |
| | `announcement-hk list` / `download` | 港股公告（含 PDF/Markdown 下载） |
| | `announcement-us list` / `download` | 美股公告（含 PDF/Markdown 下载） |
| | `foreign-opinion list` | 外资机构观点 |
| | `independent-opinion list` / `download` | 外资独立分析师观点（含原文/翻译HTML下载） |
| | `official-account list` / `download` | 产业公众号资讯（含 txt/HTML 下载） |
| | `qa list` | 投资者问答 QA（互动平台/电话会议/调研纪要，按证券） |
| | `report-image list` / `download` | 研报图表搜索（按关键词，含原图 JPEG 下载） |
| **Reference** | `securities-search` | GTS Code 搜索（按名称/代码/拼音匹配） |
| | `chiefs-search` | 首席分析师 ID 搜索（按姓名/机构/团队匹配） |
| | `institution-search` | 机构 ID 搜索（内资券商/外资/牵头/观点机构，按名称匹配） |
| | `official-account-search` | 公众号 ID 搜索（按公众号名/机构/分类匹配，返回 accountId） |
| | `constant-category` | 常量分类列表（含各分类适用的接口与参数） |
| | `constant-list` | 按分类导出常量值全量列表（行业/城市/公告分类/区域等） |
| | `concept-search` | 题材 ID 搜索（名称/拼音/分组名匹配） |
| | `sector-search` | 板块 ID 搜索（返回层级路径） |
| | `sector-constituents` | 板块成分股查询 |
| **Quote** | `day-kline` / `day-kline-hk` / `day-kline-us` | A股/港股/美股历史日K线 |
| | `index-day-kline` | 沪深京指数日K线 |
| | `minute-kline` | A股分钟K线 |
| | `realtime` | 个股实时行情快照（A股/港股/美股） |
| | `fund-flow` | A股个股日资金流向（沪深京；小/中/大/特大单 + 主力净流入） |
| **Fundamental** | `income-statement` / `balance-sheet` / `cash-flow` | A股三大财务报表（累计） |
| | `income-statement-quarterly` / `cash-flow-quarterly` | A股利润表/现金流量表（单季度） |
| | `income-statement-hk` / `balance-sheet-hk` / `cash-flow-hk` | 港股三大财务报表（中国会计准则） |
| | `income-statement-us` / `balance-sheet-us` / `cash-flow-us` | 美股三大财务报表 |
| | `main-business` | 主营构成（按地区/产品拆分） |
| | `valuation-analysis` | 估值分析 |
| | `earning-forecast` | 盈利预测（一致预期） |
| | `top-holders` | 前十大股东/前十大流通股东 |
| **AI** | `knowledge-batch` | 知识库批量检索 |
| | `knowledge-resource-download` | 知识资源下载 |
| | `security-clue` | 个股线索 |
| | `stock-summary` | 个股看点（精炼投研总结，按代码或全市场；仅 A 股/港股） |
| | `one-pager` | 一页通 |
| | `investment-logic` | 投资逻辑 |
| | `peer-comparison` | 同业对比 |
| | `earnings-review` / `earnings-review-check` | 业绩回顾 |
| | `theme-tracking` | 主题跟踪 |
| | `hot-topic` | 热点话题 |
| | `research-outline` | 研究提纲 |
| | `management-discuss-announcement` | 管理层讨论-财报 |
| | `management-discuss-earnings-call` | 管理层讨论-业绩会 |
| | `viewpoint-debate` / `viewpoint-debate-check` | 观点PK（异步） |
| **Vault** | `drive-list` / `drive-download` | 云盘文件列表与下载 |
| | `record-list` / `record-download` | 录音速记列表与下载 |
| | `my-conference-list` / `my-conference-download` | 我的会议列表与下载 |
| | `wechat-message-list` / `wechat-chatroom-list` | 群消息列表与群ID查询 |
| | `stock-pool-list` / `stock-pool-stocks` | 自选股股票池列表与证券明细 |
| **Indicator** | `search` | 证券级数据指标搜索（按名称匹配，返回 indicatorCode 及可传参数 parameterList） |
| | `cross-section` | 指标截面数据（多指标 × 多证券，单日快照；前置 `search` 拿 code） |
| | `time-series` | 指标时间序列（多指标 × 单证券 或 单指标 × 多证券，按区间） |
| **Alternative** | `edb-search` | 行业指标搜索（按关键词匹配，返回 indicatorId 等元信息） |
| | `edb-data` | 行业指标时序数据（批量拉取，最多10个指标） |
| | `concept-info` | 题材指数基本信息（投资逻辑/行业空间/竞争格局/催化事件） |
| | `concept-securities` | 题材指数成分股（题材深度F8，按分组，标记重点个股） |
| **Raw** | `call` | 原始接口调用（可访问任意 endpoint） |

## 命令概览

- `gangtise auth ...`
- `gangtise lookup ...`
- `gangtise insight ...`
- `gangtise quote ...`
- `gangtise fundamental ...`
- `gangtise ai ...`
- `gangtise vault ...`
- `gangtise indicator ...`
- `gangtise alternative ...`
- `gangtise reference ...`
- `gangtise raw call ...` / `gangtise raw list`

## 推荐工作流

先查枚举/参数：

```bash
gangtise reference constant-category                              # 有哪些常量分类、各用于哪些参数
gangtise reference constant-list --category citicIndustry         # 中信行业（--industry 通用）
gangtise reference constant-list --category gangtiseIndustry      # Gangtise 行业 + 方向（--research-area 用）
gangtise reference constant-list --category swIndustry            # 申万行业
gangtise reference constant-list --category regionCategory        # 外资研报区域
gangtise reference constant-list --category aShareAnnouncementCategory  # A股公告分类（树形）
gangtise reference sector-constituents --sector-id 2000000014   # 申万行业代码 821xxx.SWI 全量（security-clue --gts-code 用）
gangtise lookup broker-org list      # 券商机构（本地表）
gangtise lookup meeting-org list     # 会议机构（本地表）
```

再调用业务命令：

```bash
gangtise insight opinion list --industry 100800128
gangtise insight summary list --institution C100000017
gangtise quote day-kline --security 600519.SH --start-date 2025-03-01 --end-date 2025-03-12
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
```

## 性能特性

- **并发翻页**：自动翻页接口的首页拿到 `total` 后，剩余页用 `Promise.all` 并发拉取（默认并发数 5，可通过 `GANGTISE_PAGE_CONCURRENCY` 调整）。20 页查询从串行 ~10s 降到 ~2s。
- **HTTP keep-alive**：所有请求复用同一个 `undici.Agent`（连接池 16），避免重复 TLS 握手。
- **流式下载**：指定 `--output` 时，二进制响应（PDF 等）直接 `pipeline` 到磁盘，不经过内存缓冲；50MB PDF 内存占用近乎为零。
- **流式输出**：`jsonl`/`csv` 格式且 `--output` 指定时，超过 1000 行自动切换为逐行写盘，避免一次性构建百 MB 字符串。
- **自动重试**：5xx / 429 / `ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` / `UND_ERR_*`（undici 连接/超时类）/ `999999` 系统错误自动指数退避重试 2 次。**贵档端点例外**（one-pager 等 13 个生成/提交类 + 50/篇 的 summary/foreign-report/my-conference 下载，共 16 个）：5xx/超时不重放——按次计费不幂等，重放即重复扣分；仅连接失败、429 与 token 自愈重试。**`indicator`（EDE）端点对 `999999` 不重试**——该码实为「查询无数据」（实测），重试纯浪费。**终态码 `999011`（凭证无效）/ `140002`（异步生成失败）在任何 HTTP 状态下都不重试**——凭证错不会因重试而变，异步生成失败是终态。
- **Token 自愈**：调用返回 `0000001008` / `999002` 时自动强制刷新 Token 并重试一次。
- **K线/资金流向自动分片**：`quote day-kline --security all`、`quote fund-flow --security aShares` 等全市场查询自动按日期切分（A股 K线/资金流向 1 天/片、美股 1 天/片、HK 2 天/片、指数 30 天/片），并发执行后合并结果；按日分片自动跳过周六日。分片时如果用户未传 `--limit`，自动注入 `limit: 10000`（API 上限）避免默认 6000 截断。
- **Token 内存缓存**：Token 在进程内存中缓存，避免每次请求读盘。
- **`--verbose`**：打印每个请求的方法、路径、状态码、耗时和响应大小到 stderr，方便定位慢查询。

## 自动翻页

以下列表接口会自动翻页：
- `insight opinion list`
- `insight summary list`
- `insight roadshow list`
- `insight site-visit list`
- `insight strategy list`
- `insight forum list`
- `insight research list`
- `insight foreign-report list`
- `insight announcement list`
- `insight announcement-hk list`
- `insight announcement-us list`
- `insight foreign-opinion list`
- `insight independent-opinion list`
- `insight official-account list`
- `insight qa list`
- `ai security-clue`
- `vault drive-list`
- `vault record-list`
- `vault my-conference-list`
- `vault wechat-message-list`
- `vault wechat-chatroom-list`
- `ai hot-topic`

规则：
- **省略 `--size` 一律拉全量**（无论是否传时间范围），CLI 自动翻页查完
- 数据量未知时，可先 `--size 1` 从 stderr 的 `Total: N` 探明量级，再决定是否全量
- 如果显式传了 `--size`，则按指定值翻页，直到达到 `size` 或数据取完
- `--from` 必须是非负整数，`--size` 必须是正整数；非法数字会在本地直接报 `ValidationError`，不会继续请求 API
- 安全上限：自动翻页最多 1000 页，防止异常循环
- 部分页失败、或服务端实际返回行数与 `total` 矛盾（提前短页）时，不丢弃已取到的数据：结果带 `partial: true`（页失败时另有 `failedPages`；K线分片为 `failedShards`；`--format json` 可见），stderr 输出警告，**进程退出码为 3**（完整成功为 0）
- 分页结果中 `total` 字段会被保留（json 格式输出 `{total, list}`）；其他格式下 stderr 输出 `Total: N, showing: M`（json 格式不输出该行）

## 智能文件命名

下载命令（`summary download`、`research download`、`foreign-report download`、`announcement download`、`announcement-hk download`、`announcement-us download`、`official-account download`、`vault drive-download`、`vault record-download`、`vault my-conference-download`）省略 `--output` 时，自动使用真实标题作为文件名：

1. **缓存优先** — 如果之前执行过对应的 `list` 命令，标题已缓存在 `~/.config/gangtise/title-cache.json`，直接使用，无额外 API 调用
2. **API 回查** — 缓存未命中时，自动查询最近 200 条记录匹配标题
3. **兜底** — 都找不到时使用服务器返回的原始文件名或 `{type}-{id}.{ext}`

推荐工作流：先 `list` 再 `download`，文件名自动正确。

## 常用示例

### 认证

```bash
gangtise auth login
gangtise auth status
```

### Insight

```bash
# 省略 --size → 自动翻页查全
gangtise insight research list --start-time "2026-04-01 00:00:00" --end-time "2026-04-09 23:59:59"

# 无时间范围也是拉全量；只要前 200 条就显式传 --size
gangtise insight research list --industry 100800126 --category company --llm-tag inDepth --rating buy --size 200

# 多值 List 模式：一次查多家券商 + 多个行业 + 多个评级
gangtise insight research list --broker C100000027 --broker C100000014 --industry 100800119 --industry 100800118 --rating buy --rating overweight --format json

gangtise insight opinion list --keyword AI
gangtise insight summary list --keyword 算力

# 下载：先 list 再 download，自动使用真实标题作为文件名
gangtise insight summary download --summary-id 4902586
# → 超颖电子：2026年4月7日投资者关系活动记录表.txt

# 下载 Markdown 版本
gangtise insight research download --report-id 432092410345574400 --file-type 2
# 下载外资研报中文翻译版
gangtise insight foreign-report download --report-id RPT20260401001 --file-type 4
# 下载公告 Markdown 版本
gangtise insight announcement download --announcement-id 123456 --file-type 2

# 也可手动指定文件名
gangtise insight research download --report-id 12345 --output ./report.pdf

gangtise insight roadshow list --institution C100000017

# 港股公告
gangtise insight announcement-hk list --security 01913.HK --rank-type 2 --size 20 --format json
gangtise insight announcement-hk download --announcement-id ANN2026040200012345
gangtise insight announcement-hk download --announcement-id ANN2026040200012345 --file-type 2   # Markdown

# 美股公告（--security 用美股代码；分类用 reference constant-list --category usShareAnnouncementCategory）
gangtise insight announcement-us list --security TSLA.O --rank-type 2 --size 20 --format json
gangtise insight announcement-us download --announcement-id 49629029 --file-type 2   # Markdown

# 外资机构观点
gangtise insight foreign-opinion list --keyword "自动驾驶" --region us --rank-type 2 --format json
gangtise insight foreign-opinion list --security APP.O --rating buy --format json

# 外资独立观点
gangtise insight independent-opinion list --keyword "肿瘤" --industry 100800118 --format json
gangtise insight independent-opinion download --independent-opinion-id 207051900018372 --file-type 2

# 产业公众号资讯
gangtise insight official-account list --keyword 泡泡玛特 --rank-type 2 --size 20 --format json
gangtise insight official-account download --article-id 7286248 --file-type 2

# 投资者问答 QA（按证券；--source/--question-category/--answer-important 精筛，自动翻页）
gangtise insight qa list --security-code 601012.SH --source interactive --answer-important 1 --size 20 --format json
# 研报图表：按关键词搜图拿 chunkId，再下原图（JPEG）
gangtise insight report-image list --keyword AI --top 5 --format json
gangtise insight report-image download --chunk-id image_10_384655917758685184_8 --output ./ai-chart.jpg

# 纪要下载（会议平台来源可选 HTML 格式）
gangtise insight summary download --summary-id 4906813 --file-type 2
```

### Reference

```bash
# GTS Code 搜索：按公司名/代码/拼音查证券代码
gangtise reference securities-search --keyword "贵州茅台" --category stock
gangtise reference securities-search --keyword "600519" --category stock
gangtise reference securities-search --keyword gzmt --top 5
gangtise reference securities-search --keyword "银行" --category stock --category index

# 首席分析师 ID 搜索（按姓名/机构/团队；拿 chiefId 供 insight opinion list --chief 使用）
gangtise reference chiefs-search --keyword 东吴证券 --top 3 --format json
gangtise reference chiefs-search --keyword 芦哲 --format json
# 机构 ID 搜索（--category: domesticBroker/foreignInstitution/leadInstitution/opinionInstitution/foreignOpinionInstitution）
gangtise reference institution-search --keyword 招商证券 --category domesticBroker --top 3 --format json
# 公众号 ID 搜索（按名称/机构/分类；拿 accountId 供 insight official-account list --account-id）
gangtise reference official-account-search --keyword 中信证券 --top 3 --format json

# 常量查询：先看分类，再按分类导出全量常量值
gangtise reference constant-category --format json
gangtise reference constant-list --category citicIndustry --format json
gangtise reference constant-list --category aShareAnnouncementCategory --format json   # 树形，含 children
gangtise reference constant-list --category usShareAnnouncementCategory --format json  # 美股公告分类（103980xxx 段）

# 题材 ID 搜索（供 concept-info / concept-securities / theme-tracking 使用）
gangtise reference concept-search --keyword 机器人 --top 3 --format json
gangtise reference concept-search --keyword jqr   # 拼音首字母

# 板块：先搜板块 ID，再查成分股（sectorId 必须来自 sector-search）
gangtise reference sector-search --keyword 半导体设备 --format json
gangtise reference sector-constituents --sector-id 1000001005 --format json
```

### Quote

```bash
gangtise quote day-kline --security 600519.SH --start-date 2026-03-01 --end-date 2026-03-31
# 查最近/最新 K 线建议显式传 --start-date/--end-date；只传 --limit 会截取查询窗口开头，不等于最近N条
gangtise quote day-kline --format json
# 全市场查询（--security all）
gangtise quote day-kline --security all --start-date 2026-04-01 --end-date 2026-04-01 --limit 100 --format json
# 港股日K线
gangtise quote day-kline-hk --security 00700.HK --start-date 2026-03-01 --end-date 2026-03-31
# 港股全市场
gangtise quote day-kline-hk --security all --start-date 2026-04-01 --end-date 2026-04-01 --limit 100 --format json
# 美股日K线（NASDAQ/NYSE/AMEX，历史）
gangtise quote day-kline-us --security AAPL.O --security MSFT.O --start-date 2026-04-22 --end-date 2026-05-22 --field tradeDate --field open --field close --field volume
# 美股全市场（自动分片）
gangtise quote day-kline-us --security all --start-date 2026-04-01 --end-date 2026-04-02 --field securityCode --field close --format json
# 沪深京指数日K线
gangtise quote index-day-kline --security 000001.SH --security 399001.SZ --start-date 2024-05-01 --end-date 2024-05-20 --field securityCode --field tradeDate --field close --field volume
# A股分钟K线
gangtise quote minute-kline --security 600519.SH --start-time "2026-04-15 09:30:00" --end-time "2026-04-15 15:00:00" --field open --field close --field volume
# 实时行情：三大市场混合查询
gangtise quote realtime --security 600519.SH --security 00700.HK --security AAPL.O --field securityCode --field tradeTime --field latestPrice --field pctChange --field volume --format json
# 实时行情：全市场批量（建议配合 --field 精简字段）
gangtise quote realtime --security aShares --field securityCode --field latestPrice --field pctChange --field volume --format json
# A股个股日资金流向（沪深京；--security aShares 全市场；--limit 上限 10000，超限缩短日期区间分批）
gangtise quote fund-flow --security 600519.SH --security 000001.SZ --start-date 2026-06-01 --end-date 2026-06-05 --field mainNetInflow --field largeInflow --field xlargeInflow --format json
```

> **历史 vs 实时**：`day-kline*` 仅返回历史数据（当日数据入库时间：A 股 ~15:30 / 港股 ~16:30 / 美股 ~07:00 北京时间）。盘中需要最新成交价、振幅等实时字段必须走 `quote realtime`。

### Fundamental

```bash
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2025 --period q3 --field netProfit
# 多年度：同时查2023-2025年报净利润
gangtise fundamental income-statement --security-code 600519.SH --fiscal-year 2023 --fiscal-year 2024 --fiscal-year 2025 --period annual --field netProfit
# 最新一期完整利润表
gangtise fundamental income-statement --security-code 600519.SH --format json
gangtise fundamental balance-sheet --security-code 600519.SH --fiscal-year 2025 --period q3 --field totalCurrAssets --field totalCurrLiab
# 最新一期完整资产负债表
gangtise fundamental balance-sheet --security-code 600519.SH --format json
gangtise fundamental cash-flow --security-code 600519.SH --fiscal-year 2025 --period q3 --field netOpCashFlows --field netInvCashFlows --field netFinCashFlows
# 最新一期完整现金流量表
gangtise fundamental cash-flow --security-code 600519.SH --format json
gangtise fundamental main-business --security-code 600519.SH --breakdown region
# 多报告期：--period 可传多个值
gangtise fundamental main-business --security-code 600519.SH --breakdown product --period annual --period interim
gangtise fundamental valuation-analysis --security-code 600519.SH --indicator peTtm
# 盈利预测（一致预期）
gangtise fundamental earning-forecast --security-code 600519.SH --consensus netIncome --consensus eps --consensus pe
# 利润表（单季度）
gangtise fundamental income-statement-quarterly --security-code 600519.SH --fiscal-year 2025 --period q2 --field netProfit
# 现金流量表（单季度）
gangtise fundamental cash-flow-quarterly --security-code 600519.SH --fiscal-year 2025 --period q2 --field netOpCashFlows
# 前十大股东
gangtise fundamental top-holders --security-code 600519.SH --holder-type top10 --fiscal-year 2025 --format json
# 前十大流通股东（按日期范围）
gangtise fundamental top-holders --security-code 600519.SH --holder-type top10Float --start-date 2025-01-01 --end-date 2025-12-31 --period q3 --format json

# 港股三大报表（中国会计准则，--security-code 用港股代码）
gangtise fundamental income-statement-hk --security-code 09992.HK --fiscal-year 2025 --period annual --field netProfit --field basicEPS
gangtise fundamental income-statement-hk --security-code 09992.HK --fiscal-year 2023 --fiscal-year 2024 --fiscal-year 2025 --period annual --field netProfit
gangtise fundamental balance-sheet-hk --security-code 09992.HK --fiscal-year 2025 --period h1 --field totalCurrAssets --field totalNonCurrAssets --field totalCurrLiab --field totalNonCurrLiab
gangtise fundamental cash-flow-hk --security-code 09992.HK --fiscal-year 2025 --period annual --field netOpCashFlows --field netInvCashFlows --field netFinCashFlows
# 最新一期完整港股利润表
gangtise fundamental income-statement-hk --security-code 09992.HK --format json

# 美股三大报表（--security-code 用美股代码；period 同港股但无 h2）
gangtise fundamental income-statement-us --security-code TSLA.O --period latest --format json
gangtise fundamental balance-sheet-us --security-code TSLA.O --fiscal-year 2025 --period annual --field totalAssets --field totalLiab --field totalEquity
gangtise fundamental cash-flow-us --security-code TSLA.O --fiscal-year 2024 --fiscal-year 2025 --period annual --field netOpCashFlows
```

### AI

```bash
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
# 多 resource-type：同时搜索券商研报和外资研报
gangtise ai knowledge-batch --query 新能源汽车 --resource-type 10 --resource-type 11 --top 10
gangtise ai security-clue --start-time "2026-04-01 00:00:00" --end-time "2026-04-09 23:59:59" --query-mode byIndustry --gts-code 821035.SWI --source researchReport --source announcement
gangtise ai one-pager --security-code 600519.SH
# 个股看点（精炼投研总结，仅 A 股/港股）：传具体代码，或 aShares/hkStocks 拉全市场
gangtise ai stock-summary --security 600519.SH --security 00700.HK --format json
gangtise ai stock-summary --security hkStocks --format json
gangtise ai investment-logic --security-code 600519.SH
gangtise ai peer-comparison --security-code 600519.SH
gangtise ai earnings-review --security-code 600519.SH --period 2025q3
gangtise ai theme-tracking --theme-id 121000131 --date 2026-03-01 --type morning
gangtise ai hot-topic --start-date 2026-03-22 --end-date 2026-03-27 --category morningBriefing --category noonBriefing --with-related-securities --with-close-reading
# 不传 --category 默认查全部类型（早报+午报+盘中快报+晚报），--with-related-securities 和 --with-close-reading 默认开启，可用 --no-with-related-securities / --no-with-close-reading 关闭
gangtise ai hot-topic --start-date 2026-04-15 --end-date 2026-04-17
gangtise ai research-outline --security-code 600519.SH
# 管理层讨论-财报（三个细分维度）
gangtise ai management-discuss-announcement --report-date 2025-06-30 --security-code 000001.SZ --dimension businessOperation
gangtise ai management-discuss-announcement --report-date 2025-12-31 --security-code 000001.SZ --dimension financialPerformance
# 传入 all 返回完整管理层讨论内容（内容较长，谨慎使用）
gangtise ai management-discuss-announcement --report-date 2025-12-31 --security-code 000001.SZ --dimension all
# 管理层讨论-业绩会
gangtise ai management-discuss-earnings-call --report-date 2025-06-30 --security-code 000001.SZ --dimension financialPerformance
# 观点PK（异步，返回 dataId）
gangtise ai viewpoint-debate --viewpoint "飞天茅台的批价低点是1500元"
# 等待生成完成后查询结果
gangtise ai viewpoint-debate-check --data-id 202603310528
# 也可以 --wait 同步等待结果（最长约 5 分钟：14 次指数退避轮询，累计 ≈316s）
gangtise ai viewpoint-debate --viewpoint "比亚迪股价将突破500元" --wait
gangtise ai knowledge-resource-download --resource-type 60 --source-id 3052524 --output ./resource.txt
```

### Vault

```bash
gangtise vault drive-list --keyword 部门文档 --space-type 1 --file-type 1

# 云盘下载：自动使用文件标题命名
gangtise vault drive-download --file-id 62130
# → 2028 全球智能危机  一份来自未来的金融史思想实验  .pdf

# 录音速记列表
gangtise vault record-list --keyword 晨会 --category upload --category mobile
# 录音速记下载（--content-type: original/asr/summary）
gangtise vault record-download --record-id 49412 --content-type summary

# 我的会议列表（--source 录制来源：1=企微会议助理 2=会议服务微信群，可重复；不传返回全部）
gangtise vault my-conference-list --keyword AI --category earningsCall --institution C100000027
gangtise vault my-conference-list --source 2 --category earningsCall --size 20
# 我的会议下载（--content-type: asr/summary）
gangtise vault my-conference-download --conference-id 43319 --content-type asr

# 群消息：先按群名称查群ID，再按群ID查消息
gangtise vault wechat-chatroom-list --room-name "AI学习群,投研分享群" --size 50
gangtise vault wechat-message-list --keyword AI应用 --wechat-group-id ueKEGyhdjFGkjyebh --category text --category url --tag roadShow --tag meetingSummary --size 50
# 按证券代码过滤群消息
gangtise vault wechat-message-list --security 000001.SZ --security 300750.SZ --size 50

# 自选股股票池
gangtise vault stock-pool-list
# 查询指定股票池中的证券
gangtise vault stock-pool-stocks --pool-id 808477293
# 查询所有股票池中的全量证券（默认行为）
gangtise vault stock-pool-stocks
```

### Indicator（证券级数据指标 EDE）

```bash
# Step 1：按名称搜索，拿 indicatorCode（绝不猜编码）；--format json 看可传参数 parameterList 及 required
gangtise indicator search --keyword 收盘价 --format table             # → qte_close
gangtise indicator search --keyword 平均ROE --limit 5 --format json    # 看 parameterList

# 截面：多指标 × 多证券，单日快照（行情类用交易日；财务类用报告期末，如 2026-03-31）
gangtise indicator cross-section \
  --indicator qte_close --indicator qte_vol --indicator qte_mkt_cptl \
  --security 600519.SH --security 09992.HK \
  --date 2026-05-18 --format table

# 时间序列：多指标 × 单证券 或 单指标 × 多证券（不能多 × 多，否则报 410001）
gangtise indicator time-series --indicator qte_close \
  --security 600519.SH --security 09992.HK \
  --start-date 2026-05-12 --end-date 2026-05-18 --format table

# 复权 / 指标专属参数用 --indicator-param "code:key=value"，参数 key 以 search 的 parameterList 为准
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2026-05-18 --indicator-param "qte_close:adjustmentType=3"   # 1不复权/2前复权/3后复权

# 必填参数：很多指标默认调用报 410106（缺必填参数），按 parameterList 的 required 补齐再取：
#   N 期统计补 periodNum、区间/周期类（如 qte_amp_mo 月振幅）补 startDate、年度/分红类补 fiscalYear
gangtise indicator cross-section --indicator finc_roe_avg_avg --security 600519.SH \
  --date 2026-03-31 --indicator-param "finc_roe_avg_avg:periodNum=4"
```

### Alternative（行业指标数据库 EDB）

```bash
# Step 1：按关键词搜索指标，获取 indicatorId
gangtise alternative edb-search --keyword 空调 --limit 50 --format table
gangtise alternative edb-search --keyword "海尔销量"

# Step 2：按 indicatorId 拉取时间序列数据（最多10个指标）
gangtise alternative edb-data \
  --indicator-id S14001618 \
  --indicator-id S14001620 \
  --start-date 2024-01-01 \
  --end-date 2024-12-31 \
  --format table

# 导出为 CSV
gangtise alternative edb-data \
  --indicator-id S14001618 \
  --start-date 2023-01-01 \
  --end-date 2024-12-31 \
  --format csv \
  --output ./indicator.csv

# 题材指数：先查 conceptId（与 theme-id 共用 ID 体系），再拉画像 / 成分股
gangtise reference concept-search --keyword 机器人 --format json   # → 121000130
gangtise alternative concept-info --concept-id 121000130 --format json
# 题材成分股（题材深度 F8，按分组返回，标记重点个股）
gangtise alternative concept-securities --concept-id 121000130 --format json
```

### Raw

```bash
# 先列出所有 endpoint key（配合 raw call，不必翻文档记 key）
gangtise raw list
gangtise raw list --format json   # key / method / path / description

gangtise raw call insight.opinion.list --body '{"from":0,"size":120}'
```

说明：对已标记为自动翻页的 endpoint，`raw call` 也会复用同一套 client 翻页逻辑；这里的 `size` 仍表示最终希望返回的记录数。

## 输出格式

支持：

- `table`
- `json`（分页结果保留 `{total, list}` 结构）
- `jsonl`（每行一条记录）
- `csv`
- `markdown`

所有格式均支持 `--output <path>` 输出到文件（自动创建父目录）。

## 参数校验

CLI 会在本地校验常见数值参数，避免把明显非法的请求发到 API：

- `--from`：非负整数
- `--size` / `--limit` / `--top`：正整数
- `--file-type` / `--resource-type` 以及数值型列表参数：有限数字
- 所有 date 参数（`--start-date`/`--end-date`/`--date`/`--report-date`，含 Quote/Fundamental/AI/Alternative/Indicator）：`YYYY-MM-DD`（严格——年在后等歧义格式在发请求前拒绝）
- 所有 `--start-time` / `--end-time`（Insight/Vault/AI 透传、`quote minute-kline`，以及 A 股公告 / `knowledge-batch` 两个转换端点）：`YYYY-MM-DD[ HH:mm[:ss]]`（时间部分秒可省、空格或 `T` 分隔）或 10/13 位 Unix 时间戳（严格校验——年在后等歧义格式在发请求前拒绝）

校验失败会输出 `ValidationError: Invalid ...` 并以非 0 状态退出。

## 常见错误

| 错误/错误码 | 说明 |
|-----------|------|
| `ValidationError` | 本地参数校验失败，检查 `--size` / `--limit` / `--from` / `--file-type` 等数值参数 |
| `API error (HTTP 4xx/5xx)` | HTTP 层失败；CLI 会把 4xx/5xx 响应视为错误，即使响应体不是标准 `{code,msg,data}` 信封 |
| `999011` | 开发账号凭证无效（AK/SK 不匹配）——**取代旧 `8000014`/`8000015`**，不再区分是 AK 错还是 SK 错 |
| `999002` / `0000001008` | Token 无效或已过期（有 AK/SK 时 CLI 自动重登重试一次） |
| `999001` / `0000001007` | 请求未携带 token |
| `999003` | 未开通接口权限（定制接口需联系客户经理） |
| `999005` | 积分不足 |
| `999006` | 调用超出上限（HTTP 429，CLI 按 Retry-After 退避重试） |
| `999010` | 接口地址不存在（`raw call` 的 key 可能已下线，用 `raw list` 核对） |
| `999012` / `999013` / `999014` | 账号禁用 / 已过期 / 租户失效 |
| `999016` | 调用方 IP 不在允许范围 |
| `999999` | Gangtise 系统错误，请稍后重试（`indicator` 端点此码多为查询无数据） |
| `100003` | 参数值非法——**最宽的兜底码**；msg 通常已指明字段（如「limit 最小为 1，最大为 10000」），先读 msg |
| `100001` | 缺必填参数（msg 带字段名，如「缺少必填参数: reportId」） |
| `100006` | 查询/下载数量超限——**取代旧 `430007`** |
| `110001` / `110002` | 日期格式错误 / 日期区间非法（起晚于止） |
| `120001` | 证券代码无效（用 `reference securities-search` 确认代码与后缀） |
| `130001` | 数据未找到或无指标权限——**取代旧 `410004`** |
| `130002` | 资源不存在——**下载类的兜底码**，`--report-id` 不存在 / 非数字 / `--file-type` 非法都归这里（取代旧 `430004`） |
| `410110` / `410111` | 异步任务生成中（继续轮询）/ 生成失败（终态）——**实测服务端仍发这两个旧码**；新码 `140001`/`140002`，CLI 两代都认 |
| `240001` | 财报期未披露或超出查询期（`earnings-review` 提交阶段即报，不扣积分） |
| `250001` | 不支持该数据源（`knowledge-resource-download` 需正确的 `resourceType + sourceId` 组合）——**取代旧 `433007`** |
| `900002` | 请求方法不正确（服务端 msg 为「请求类型有误」；旧文档写作"缺少 uid"是错的） |

> **关于这次错误码重排**：服务端 2026-07-17 重排了 41 个公开码（三层：`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层），信封新增 `errorType` 和 `traceId`。2026-07-20 逐码实测发现**迁移是按「错误处理层」而非按业务模块进行的**：同一个接口内，参数校验层与路由层已发新码，方法路由层、token 过滤器、以及异步生成状态仍发旧码。新码信封 `code` 是 JSON 数字且带 `errorType`，旧码是字符串且没有——但这判断的是单条错误路径，不是整个接口；CLI 对两代都能识别。报错行会带 `[trace <id>]`，**报障时请带上它**。
>
> 其余码（`999003`–`999006`、`999012`–`999016`、`100002`、`100004`、`100005`、`110003`、`130003`–`130005`、`210001`、`220001`、`230001`、`240002`、`240003`）在实测中未触发到，多被上面的兜底码接管，CLI 仍内置了对应提示。两个实测坑：**枚举值拼错和分页越界服务端不报错**（静默忽略该筛选条件）；**`viewpoint-debate` 的敏感内容不会被提前拦截**，会扣满 50 积分再以 `410111` 失败。

---

## 发布（维护者）

> 面向仓库维护者的发版流程，普通用户可跳过。

npm 发版通过 GitHub Actions Trusted Publishing 完成，不需要 `NPM_TOKEN`。npm 包设置里的 Trusted Publisher 需要匹配本仓库和 workflow 文件名 `publish.yml`。

```bash
npm version patch --no-git-tag-version
npm run prepare
VERSION=$(node -p "require('./package.json').version")
git commit -am "chore: release v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"   # 必须 annotated：--follow-tags 不推 lightweight tag
git push --follow-tags
```

推送 `v*` tag 后，`.github/workflows/publish.yml` 会在 GitHub-hosted runner 上使用 OIDC 发布到 `https://registry.npmjs.org/`。也可以从 GitHub Actions 页面手动运行该 workflow。
