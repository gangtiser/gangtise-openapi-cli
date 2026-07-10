# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 获取全量金融信息的命令行工具，同时提供Agent Skill。

## Changelog

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

### v0.22.1 — 2026-07-03

**修复**
- 错误码 `410004` 提示改为中性措辞「数据未找到或无指标权限，请检查查询条件与指标权限」——此前只说"数据未找到"，与 `indicator` 内层信封的"无权限"消息拼接后自相矛盾

**文档 / Skill**（随 `/sync-skill` 分发，不影响 CLI 行为）
- gangtise-openapi Agent Skill 经 fable5 审计 + 多轮 review 优化：官方积分计费速查表 + 高积分 pre-flight 闸门、AI 同步生成命令 `GANGTISE_TIMEOUT_MS=120000` 超时前置、大结果集 `--output` 落盘、异步 `--wait` 主路径、行业码口径收敛到单一权威、市值量纲实测（`qte_mkt_cptl` 仅 A 股 / 默认原始「元」/ `scale`+`currency`）等文档补全与消歧

### v0.22.0 — 2026-07-02

**行为变更（注意）**
- ⚠️ 自动翻页接口省略 `--size` 现在一律拉全量（不再区分是否传时间范围）；需要只取前 N 条时请显式传 `--size N`。数据量未知时可先用 `--size 1` 从 stderr 的 `Total: N` 探明量级
- 部分结果可机器识别：翻页页失败、K 线分片失败、或服务端提前短页但仍报告更大 `total` 时，结果会带 `partial: true`（页失败另有 `failedPages`，分片为 `failedShards`），非 json 行式输出仍只输出数据行，但进程退出码为 3

**修复（鉴权 / 请求可靠性）**
- Token 自愈覆盖服务端 `0000001008` 踢线失效，并能处理 HTTP 4xx 错误信封；`GANGTISE_TOKEN` + AK/SK 场景下环境 token 失效后不再反复回放旧 token
- 并发请求同时遇到旧 token 失效时复用一次刷新结果；若刚拿到的新 token 本身被踢掉，则强制再次登录，避免"刚登录窗口期"误跳过刷新
- 自动重试范围扩展到 429、DNS/网络临时错误与 undici 超时类错误；`GANGTISE_BASE_URL` 带路径前缀时 URL 拼接不再丢前缀

**修复（下载 / 输出 / 数据正确性）**
- 下载接口跟随最多 3 次 30x 跳转；跨域跳到对象存储签名 URL 时不携带 Authorization；服务端返回 `{url}` 且用户传 `--output` 时会真正下载文件，而不是把 URL 字符串写进文件
- 自动文件名补齐清洗、截断与去重：服务端文件名、标题缓存名和 fallback 名都不会把 `/`、控制字符、过长中文名或重复标题变成路径/覆盖问题
- `table`/`markdown` 输出清理控制字符、正确按 CJK 宽字符对齐，并转义 markdown 表头中的 `|`；CSV 输出转义表头、文件输出带 UTF-8 BOM，流式 CSV 遇全标量列表时回退到正常渲染而不是只写 BOM
- `indicator search` / `cross-section` / `time-series` 的内层失败信封即使没有 `data` 字段也会抛出 `ApiError`，不再把"无权限/参数错误"渲染成成功结果
- `--indicator-param` 等逗号列表支持全角逗号 `，`；日期型时间参数按本地零点解析，避免 `yyyy-MM-dd` 被当作 UTC 造成查询窗口偏移
- `fundamental earning-forecast` 省略 `--start-date` 时按传入的 `--end-date` 往前一年计算，不再总是按今天往前一年
- AI 异步 `--wait` 对 `410111` 终态失败只提示"不要重试"，超时才提示稍后用 check 命令查询；等待说明同步为最长约 5 分钟

**CLI / 工程**
- `raw call` 会在本地拒绝 JSON endpoint 的 `--query` 和 download endpoint 的 `--body`，避免静默丢参数；`--format` 在发请求前校验，格式拼错不再先消耗接口调用
- `gangtise ... | head` 遇 stdout `EPIPE` 时安静退出；只有首个参数是 `--version` / `-V` 时才触发版本快捷路径
- Endpoint registry 的 `key` 改为由记录键自动派生，减少映射漂移；新增真实 CLI 选项到请求体的 stub 测试；测试 272 → 323

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
export GANGTISE_PAGE_CONCURRENCY=5     # 翻页并发数（默认 5）
export GANGTISE_VERBOSE=1              # 打印每个请求的耗时与字节数
export GANGTISE_TIMEOUT_MS=30000       # 请求超时（默认 30s）
export GANGTISE_TOKEN_CACHE_PATH=...   # 覆盖 token 缓存路径（默认 ~/.config/gangtise/token.json）
```

如果没有 `GANGTISE_TOKEN`，CLI 会自动调用 token 接口并缓存到本地（`~/.config/gangtise/token.json`，权限 0600）。Token 失效（8000014/8000015/0000001008）时会自动重新登录并重试一次。


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

安装：

```bash
# Claude Code
cp -r gangtise-openapi ~/.claude/skills/gangtise-openapi

# Codex
cp -r gangtise-openapi ~/.codex/skills/gangtise-openapi

# OpenClaw
cp -r gangtise-openapi ~/.openclaw/skills/gangtise-openapi

# Hermes
cp -r gangtise-openapi ~/.hermes/skills/gangtise-openapi
```

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
- **自动重试**：5xx / 429 / `ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` / `UND_ERR_*`（undici 超时类）/ `999999` 系统错误自动指数退避重试 2 次。
- **Token 自愈**：调用返回 8000014/8000015 时自动强制刷新 Token 并重试一次。
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
- 公告 `--start-time` / `--end-time`：可解析的时间字符串或 Unix 时间戳

校验失败会输出 `ValidationError: Invalid ...` 并以非 0 状态退出。

## 常见错误

| 错误/错误码 | 说明 |
|-----------|------|
| `ValidationError` | 本地参数校验失败，检查 `--size` / `--limit` / `--from` / `--file-type` 等数值参数 |
| `API error (HTTP 4xx/5xx)` | HTTP 层失败；CLI 会把 4xx/5xx 响应视为错误，即使响应体不是标准 `{code,msg,data}` 信封 |
| `8000014` | `GANGTISE_ACCESS_KEY` 错误 |
| `8000015` | `GANGTISE_SECRET_KEY` 错误 |
| `8000016` | 开发账号状态异常 |
| `8000018` | 开发账号已到期 |
| `900001` | 请求参数为空或缺少必填项 |
| `900002` | 请求缺少 uid |
| `903301` | 今日调用次数已达上限 |
| `999995` | 积分不足 |
| `999997` | 未开通接口权限 |
| `999999` | Gangtise 系统错误，请稍后重试 |
| `433007` | 不支持该数据源（`knowledge-resource-download` 需正确的 `resourceType + sourceId` 组合） |
| `430007` | 行情查询超出限制（数据量过大，请缩短日期范围或减少 `--limit`） |
| `410110` | 异步任务生成中（非终态，需继续轮询） |
| `410111` | 异步任务生成失败（终态，不可重试） |

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
