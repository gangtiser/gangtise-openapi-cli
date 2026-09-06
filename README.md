# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 获取全量金融信息的命令行工具，同时提供Agent Skill。

## Changelog

README 仅列最近 5 个版本摘要：

- **v0.38.0 — 2026-09-05**：① `quote realtime` / `day-kline` / `minute-kline` 支持**沪深 ETF**（`512800.SH`）与 **20 个全球指数**（`SPX.SPI` 标普500 / `N225.NKI` 日经225 / `HSI.HI` 恒生…，清单见 `gangtise-openapi/references/commands/quote.md`），代码直接传即可；全市场关键字 `aShares` 不含 ETF；全球指数 realtime 的 `volume` / `amount` / `amplitude` 与分钟 K 的 `volume` / `amount` 为 `null`，日 K 只有 `amount` 为 `null`；`tradeTime` 是交易所当地时间。② `quote realtime` 字段集：新增 `tradeStatus`（仅 A 股 / 港股个股有值），`turnoverRate` / `volumeRatio` 不再返回，美股 `amount` 由 `0` 改为 `null`。③ **新增缺列护栏**：`quote` 系带 `--field` 时，请求了但服务端没回的列（字段名写错或已下线，服务端不报错）现在标 `partial` + `missingFields`、退出码 3 并在 stderr 点名；`--field` 只回点名的列、不自动附带身份列（日 K 要自己写进 `securityCode` / `tradeDate`，分钟 K 是 `securityCode` / `tradeTime`，realtime 是 `securityCode`；`fund-flow` 会自动附带）。④ K 线全市场分片合并时按列名对齐各片（此前直接按位置拼接）；`quote` 单请求收到无 `list` 的载荷报错退出 1（此前打印 `null` 退出 0）；全量翻页从末页起步时同样做 `total` 封顶探测；`minute-kline` 的截断提示改为指向 `--start-time/--end-time`。⑤ `fundamental earning-forecast` 的 `roe` 单位改为百分比（`35.6` = 35.6%）。⑥ ETF 有复权因子：day-kline `adjustFactor` 与 EDE `qte_adj_factor` 都覆盖。
- **v0.37.1 — 2026-08-31**：**文档修正，无代码变更**。① `indicator screener` 用静态属性选股的示例补进 README——`pty_*`（经营范围·注册地…）/ `scr_*`（上市板块·ISIN…）两族用 `--indicator-param "F1:"`（冒号后留空）声明该指标不吃查询日期后，可直接用于条件选股（v0.36.0 起支持），此前 README 示例仍写着要先用 `cross-section` 取回再本地筛。② **数据权限时间范围的说明按实测更正**：这个窗口按**账号**配、不按接口配——`indicator` 的 `cross-section` / `time-series` / `screener` 与 `quote day-kline` 在同一条边界上，**撞到 `110003` 换接口绕不过去**，正确做法是把日期移进权限范围，或联系客户经理开通更长历史；文档此前建议的「`screener` 撞界改用 `cross-section` 拉数再本地筛」已不适用。③ EDE 文本筛选示例换成有区分度的条件，避免示例条件把整个板块原样返回、看不出筛选是否生效。
- **v0.37.0 — 2026-08-29**：🔴 **下载的「智能文件命名」改为默认只读缓存**。省略 `--output` 时仍优先用 `title-cache` 里的真实标题——先 `list` 再 `download` 的常规用法**不受影响，也不产生额外调用**；但**缓存未命中时不再自动回查 list 接口**，改为退回服务端返回的文件名或 `<type>-<id>.<ext>`。回查一次要拉 200 条记录（4 次请求），而这 12 个下载命令里有 9 个的 list 按 0.1 积分/条计费，约 20 积分——这笔开销只用于取一个更易读的文件名，所以改成显式的 `--resolve-title`。加了该参数时，取回的 200 条标题会一并写入缓存，同一批后续下载不再重复回查。⚠️ **依赖旧行为拿中文文件名的脚本**：升级后会得到 ID 文件名，补 `--resolve-title`，或按推荐用法先跑一次 `list`。**另有三项修正**：① 下载已成功、仅标题回查阶段遇到异常响应时，退出码会变成 3（脚本按 `!= 0` 判失败会误判为下载失败），现已隔离——下载完整就是 0；② `indicator cross-section` / `time-series` 的 `--indicator-param` 若写了 `--indicator` 里没有的指标编码（多为拼写错误），此前该参数不会作用到你要查的指标上且没有任何提示，现改为发请求前直接报错并指出是哪个编码（`screener` 一直是这个行为）；③ 下载请求的超时改为与其他请求同一套解析逻辑，行为对齐。
- **v0.36.0 — 2026-08-18**：**日期写法放宽**——`YYYY-MM-DD`、`YYYY/MM/DD`、`YYYYMMDD` 三种「年在前」写法都收，统一归一成 `YYYY-MM-DD` 发出（datetime 只归一日期部分，Unix 时间戳原样透传）；「年在后」写法（`01-07-2026`）仍在本地拒绝——接口会按美式「月在前」解析它，欧洲习惯写法会静默拿到差半年的数据，详见「关于日期格式」。**`indicator screener` 支持无日期指标**：`--indicator-param "F1:"`（冒号后留空）声明该指标不要查询日期，`pty_*` / `scr_*` 静态属性两族与 `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg` 现在可以直接用于条件选股（此前只能在 `cross-section` 取回后本地筛），写法与截面一致、可与真实参数共存。**全量拉取的 `total` 封顶探测恢复覆盖 `ai hot-topic`**（v0.35.0 曾跳过）。另：EDE 报错提示同步更新；补充计费说明（`ai hot-topic` 50/篇 的「篇」= 一整份报告；按篇/按条计费的接口查不到内容不扣分）。
- **v0.35.0 — 2026-08-16**：新增 `--indicator-param "<code>:"`（冒号后留空）声明「这个指标不要查询日期」，用于 `parameterList` 里没有日期参数的指标——`pty_*`（经营范围/注册地/法定代表人…）、`scr_*`（上市市场/上市板块/ISIN…）两族，以及 `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg`。这类指标此前在 `indicator cross-section` 上取不到数（`--date` 必填且会注入 `tradeDate`，而它们不收，整条请求被拒）；该写法可与真实参数共存（`"code:" + "code:fiscalYear=2025"`）。**EDE 日期参数报错提示重写**：拆成五种报文形态分别给建议，服务端同时点名「不该有的键」和「缺的键」时直说换哪个，只说了一半时不再瞎猜，多指标批量报错时不再用单数口吻指向其中一个指标。另：`--rank-type` 的说明按实测更正（差别大小取决于关键词，`--search-type` 不影响 `--rank-type 1` 取回哪些条目）；`ai hot-topic` 全量拉取跳过 `total` 封顶探测（**已于 v0.36.0 撤回**——该探测不额外计费）。

### 历史里程碑

- **v0.29.0**：新增财报日历与 PDF 解析工具，群消息补 `quoteMsg`，并加强大整数 ID 与高积分调用防护。
- **v0.26.0–v0.27.0**：建立高积分端点 `no-replay`、原子下载与容错分页机制，并补齐 Skill 分发和发布质量门禁。
- **v0.22.0–v0.23.0**：统一“省略 `--size` 即拉全量”的分页语义，引入机器可识别的部分结果、Token 自愈，并完成 API 域名迁移与资金流向、机构搜索支持。
- **v0.19.0–v0.20.0**：上线 EDE 证券指标接口，扩展美股公告与财务报表，同时加强凭证脱敏、CSV 正确性和分页容错。
- **v0.16.0–v0.18.0**：以服务端参考数据替代多数本地静态表，收紧端点参数，并加入产业公众号资讯。
- **v0.14.0–v0.15.0**：新增跨市场实时行情、美股日 K 与题材数据，完善全市场 K 线分片和部分失败容错。
- **v0.12.0–v0.13.0**：奠定并发翻页、连接复用、流式输出与 K 线分片架构，并扩展港股财报、EDB 和股票池。

> 完整更新明细及更早版本见 [CHANGELOG.md](CHANGELOG.md)。

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
    │   ├── indicator.md              #   证券级数据指标 EDE（search / 截面 / 时序 / 条件选股）
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
| | `pamirs-summary list` / `download` | 帕米尔专家纪要（需单独购买专家纪要库；筛选项比 `summary` 少，无 `--source`/`--institution`/`--participant-role`） |
| | `roadshow list` | 路演 |
| | `site-visit list` | 调研 |
| | `strategy list` | 策略 |
| | `forum list` | 论坛 |
| | `performance-calendar list` / `download` | 财报日历（业绩预告/快报/公告，含原文 PDF 下载） |
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
| **Quote** | `day-kline` | 历史日K线——A股/港股/美股个股 + 沪深 ETF + 交易所/概念/行业指数 + 20 个全球指数，可混查 |
| | `day-kline-hk` / `day-kline-us` | ⚠️ 已下线，能力并入 `day-kline`（接口仍可调，但不校验证券代码） |
| | `index-day-kline` | ⚠️ 已下线，能力并入 `day-kline`；但仍是取「全部沪深京指数」（`--security all`）和拿指数名称（`securityName`）的唯一方式 |
| | `minute-kline` | 分钟K线——沪深A股 / ETF + 各类指数含全球指数（一次一只） |
| | `realtime` | 实时行情快照——A股/港股/美股个股 + 沪深 ETF + 各类指数含全球指数 |
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
| | `stock-summary` | 个股看点（精炼投研总结，按代码批量、单次最多 6000 个；仅 A 股/港股，不支持全市场） |
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
| | `screener` | 条件选股（按指标表达式从证券/板块范围筛股；前置 `search` 拿 code） |
| **Alternative** | `edb-search` | 行业指标搜索（按关键词匹配，返回 indicatorId 等元信息） |
| | `edb-data` | 行业指标时序数据（批量拉取，最多10个指标） |
| | `concept-info` | 题材指数基本信息（投资逻辑/行业空间/竞争格局/催化事件） |
| | `concept-securities` | 题材指数成分股（题材深度F8，按分组，标记重点个股） |
| **Tool** | `file-parse` / `file-parse-check` | PDF 解析为 Markdown + 图片（异步，返回 ZIP） |
| **Raw** | `call` | 原始接口调用（可访问任意 JSON / download endpoint；upload 型如 `tool.file-parse.submit` 需走 `tool file-parse`，raw 带不了文件） |

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
- `gangtise tool ...`
- `gangtise raw call ...` / `gangtise raw list`

## 推荐工作流

先查枚举/参数：

```bash
gangtise reference constant-category                              # 有哪些常量分类、各用于哪些参数
gangtise reference constant-list --category citicIndustry         # 中信行业（--industry / --research-area 的行业维度都用它）
gangtise reference constant-list --category gangtiseIndustry      # 研究方向 6 条（宏观/策略/固收/金工/海外/其他），不含行业
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
- **自动重试**：5xx / 429 / `ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` / `UND_ERR_*`（undici 连接/超时类）/ `999999` 系统错误自动指数退避重试 2 次。**贵档端点例外**（one-pager 等生成/提交类 + `tool file-parse` 提交 + 50/篇 的 summary / foreign-report / my-conference 下载 + 单价未公布但保守同档的 pamirs-summary 下载，共 18 个）：5xx/超时不重放——**重放会重复扣分**：服务端可能已经执行并计费，重发按次计费的再扣一次，重发按篇/按条计费的会把已交付的行再计一次；仅连接失败、429 与 token 自愈重试。**`indicator`（EDE）端点对 `999999` 不重试**——重放一次已计费的查询没有意义（该码 2026-08-01 前还兼表「查询无数据」，现在无数据是保留行列的占位单元格（统一 `null`），空表另表示整轴 code 未识别）。**终态码 `999011`（凭证无效）/ `140002`（异步生成失败）在任何 HTTP 状态下都不重试**——凭证错不会因重试而变，异步生成失败是终态。

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
- **Token 自愈**：调用返回 `0000001008` / `999002` 时自动强制刷新 Token 并重试一次。
- **K线/资金流向自动分片**：`quote day-kline --security aShares|hkStocks|usStocks`、`quote fund-flow --security aShares` 等全市场查询自动按日期切分（A股 K线/资金流向 1 天/片、美股 1 天/片、港股 2 天/片；已下线的 `day-kline-hk`/`day-kline-us`/`index-day-kline` 用 `all`，分别 2/1/15 天/片），并发执行后合并结果；按日分片自动跳过周六日。分片时如果用户未传 `--limit`，自动注入 `limit: 10000`（API 上限）避免默认 6000 截断。
- **Token 内存缓存**：Token 在进程内存中缓存，避免每次请求读盘。
- **`--verbose`**：打印每个请求的方法、路径、状态码、耗时和响应大小到 stderr，方便定位慢查询。

## 自动翻页

以下列表接口会自动翻页：
- `insight opinion list`
- `insight summary list`
- `insight pamirs-summary list`
- `insight roadshow list`
- `insight site-visit list`
- `insight strategy list`
- `insight forum list`
- `insight performance-calendar list`
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
- 部分页失败、或服务端实际返回行数与 `total` 矛盾（提前短页）时，不丢弃已取到的数据：结果带 `partial: true`（页失败时另有 `failedPages`；K线分片为 `failedShards`；`quote` 系带 `--field` 而服务端没回的列为 `missingFields`；`--format json` 可见），stderr 输出警告，**进程退出码为 3**（完整成功为 0）
- **`indicator` 命令的退出码 3**（脚本按 `!= 0` 判失败的需留意）：服务端整指标/整证券没返回时标 `partial` + `omittedIndicators` / `omittedSecurities` 并退出 3。**2026-08-15 起这个分支基本收不到样本**——服务端现在对解析不了的代码直接报 `100003` 并点名是哪个（指标码拼错 →「指标 xxx 不存在」；证券后缀错，如美股写成 `AAPL.US` 而非 `AAPL.O` →「xxx 不是有效证券或者板块ID」），**无论同批有没有正确的代码都会报**，CLI 相应退出 1。真实的无数据/无覆盖仍是占位单元格 + 退出码 0。占位值统一是 `null`。⚠️ **报告期类指标（`is_*`）的时序上大部分行都是占位**（只有报告期末那几行是真值），`null` 虽被 Excel / pandas / SQL 的聚合跳过，**但行数不变**，手工「总和 ÷ 行数」仍会差几十倍；详见 skill 的 `references/commands/indicator.md`。**条件选股的缺列另有更严的一档**：把缺列的变量当作无法求值，若表达式（按 `&&`/`||` 的布尔结构）再无任何可成立的分支，则**退出码 1 且不输出**——那些行以「通过了该条件」的名义呈现，而条件根本无法证明被执行过。⚠️ 这一档以「服务端返回了命中行」为前提；**零命中时一律退出码 0**（没有行需要被质疑），所以空集不能直接当成「无标的符合条件」——另有两种成因产生**逐字相同**的输出：**日期没落在报告期末**（报告期类指标此时整批 `null`），或**该指标不覆盖这批证券**（如拿 A 股专属指标查港美股）。语义约定：`0` 完整成功（含合法空结果）／`3` 有数据但不完整／`1` 硬失败
- **分页端点返回 `null` 也退出 3**：分页端点的正常响应是 `{total, list}`，真实的空结果是 `{total: 0, list: []}`。若响应体是 `null`，CLI 在 stderr 告警并**退出码 3**——只给告警的话，脚本无法区分「这个筛选确实没命中」和「这个筛选没生效」。机器格式（jsonl/csv）此时 **stdout 不输出任何字节**（不是空行），`--format json` 仍忠实打印 `null`。⚠️ 带 `--output` 时文件仍会被创建：csv 会写入 3 字节 UTF-8 BOM（Excel 兼容用），jsonl 为 0 字节——**按文件大小判空的脚本要留意 csv 的这 3 个字节**。
- 🔴 **`total` 被服务端封顶时会标 `totalCapped` 并退出 3**：分页端点的 `total` 若被服务端封顶（返回一个固定上限而非真实条数），省略 `--size` 的全量拉取会**正好取满那个上限就停、且不报任何异常**——导出的文件是截断的却看不出来。现在全量拉取结束后会**多探一行**（`from = total`）：探到数据就标 `partial` + `totalCapped` 并退出 3。判据不写死 10000，服务端改配置仍然有效；`total` 诚实时探针返回空、不产生计费。传了 `--size` 的有界请求不做此探测。
- 分页结果中 `total` 字段会被保留（json 格式输出 `{total, list}`）；其他格式下 stderr 输出 `Total: N, showing: M`（json 格式不输出该行）

## 智能文件命名

下载命令（`summary download`、`pamirs-summary download`、`research download`、`foreign-report download`、`announcement download`、`announcement-hk download`、`announcement-us download`、`official-account download`、`performance-calendar download`、`vault drive-download`、`vault record-download`、`vault my-conference-download`）省略 `--output` 时，自动使用真实标题作为文件名：

1. **缓存优先** — 如果之前执行过对应的 `list` 命令，标题已缓存在 `~/.config/gangtise/title-cache.json`，直接使用，**无额外 API 调用、无额外积分**
2. **兜底** — 缓存未命中时使用服务器返回的原始文件名，无则 `{type}-{id}.{ext}`

推荐工作流：先 `list` 再 `download`，文件名自动正确且零额外成本。

🔴 **缓存未命中时不会自动回查 list 接口**（v0.37.0 起）。回查要拉最近 200 条记录（4 次请求），而上面 12 个命令里有 9 个的 list 按 **0.1 积分/条**计费，约 20 积分——这笔开销只用于取一个更易读的文件名（下载本身 10–50 积分），所以改成按需开启。需要时加 `--resolve-title`：

```bash
gangtise insight research download --report-id 432092410345574400 --resolve-title
```

`--resolve-title` 取回的 200 条标题会一并写入缓存，所以同一批后续的下载不再重复回查。带 `--output` 时该参数无效（文件名已由你指定）。

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

# 帕米尔专家纪要（需单独购买专家纪要库；全文搜索 + 时间倒序）
# --rank-type 2 = 严格时间倒序；换成 1（综合排序）在有 --keyword 时按相关度挑条目。
# 差别多大取决于关键词本身；--search-type 不影响 --rank-type 1 挑哪些条目（详见 skill 的 insight.md）
gangtise insight pamirs-summary list --keyword PCB --search-type 2 --rank-type 2 --size 20
gangtise insight pamirs-summary download --summary-id 5863771 --file-type 2
# → PCB钻针：高端钻针扩产有壁垒，供需紧缺会持续到28年.html

# 下载：先 list 再 download，标题已在缓存里，文件名自动正确且零额外成本
gangtise insight summary download --summary-id 4902586
# → 超颖电子：2026年4月7日投资者关系活动记录表.txt

# 没先跑过 list（缓存未命中）时，默认退回 ID 文件名；要标题就显式回查
gangtise insight summary download --summary-id 4902586 --resolve-title

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

# 财报日历：注意用 --start-date/--end-date（按 publishDate 过滤），不是 --start-time
gangtise insight performance-calendar list --start-date 2026-07-01 --end-date 2026-07-25 \
  --market aShares --category performanceForecast --size 20 --format json
# 下载业绩报告原文（仅 hasAttachment: true 的记录；A股 10 积分 / 港美股 20 积分）
gangtise insight performance-calendar download --performance-report-id 33753017 --output ./业绩预告.pdf
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
# --field 只回点名的列、不自动附带身份列（fund-flow 除外）：日 K 加 securityCode / tradeDate，分钟 K 加 securityCode / tradeTime，realtime 加 securityCode
gangtise quote day-kline --security 600519.SH --security 000858.SZ --start-date 2026-03-01 --end-date 2026-03-31 --field securityCode --field tradeDate --field close
# 查最近/最新 K 线建议显式传 --start-date/--end-date；只传 --limit 会截取查询窗口开头，不等于最近N条
gangtise quote day-kline --format json
# 全市场查询：关键字是 aShares / hkStocks / usStocks，必须单独传（旧的 --security all 已不再支持）
gangtise quote day-kline --security aShares --start-date 2026-04-01 --end-date 2026-04-01 --limit 100 --format json
# 港股 / 美股 / 指数都走同一个 day-kline，可混着传
gangtise quote day-kline --security 00700.HK --security AAPL.O --start-date 2026-03-01 --end-date 2026-03-31
gangtise quote day-kline --security 000001.SH --security 880134.GT --security 821031.SWI --start-date 2026-03-01 --end-date 2026-03-31
# 沪深 ETF 与 20 个全球指数也走 day-kline（全球指数 amount 为 null；ETF 有 adjustFactor；aShares 关键字不含 ETF，要逐个传）
gangtise quote day-kline --security 512800.SH --security SPX.SPI --security N225.NKI --start-date 2026-08-01 --end-date 2026-08-31
# 港股全市场（自动按 2 天/片分片）
gangtise quote day-kline --security hkStocks --start-date 2026-04-01 --end-date 2026-04-10 --format json
# 美股全市场（自动按 1 天/片分片）
gangtise quote day-kline --security usStocks --start-date 2026-04-01 --end-date 2026-04-02 --field securityCode --field close --format json
# 沪深京指数日K线
gangtise quote index-day-kline --security 000001.SH --security 399001.SZ --start-date 2024-05-01 --end-date 2024-05-20 --field securityCode --field tradeDate --field close --field volume
# A股分钟K线
gangtise quote minute-kline --security 600519.SH --start-time "2026-04-15 09:30:00" --end-time "2026-04-15 15:00:00" --field open --field close --field volume
# 实时行情：三大市场混合查询
gangtise quote realtime --security 600519.SH --security 00700.HK --security AAPL.O --field securityCode --field tradeTime --field latestPrice --field pctChange --field volume --format json
# 实时行情：ETF 与全球指数（全球指数 volume/amount/amplitude 为 null，tradeTime 是交易所当地时间；美股 amount 为 null）
gangtise quote realtime --security 512800.SH --security SPX.SPI --security HSI.HI --field securityCode --field tradeTime --field latestPrice --field pctChange --format json
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
# 盈利预测（一致预期）；roe 单位是百分比（35.6 = 35.6%）
gangtise fundamental earning-forecast --security-code 600519.SH --consensus netIncome --consensus eps --consensus pe --consensus roe
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
# 个股看点（精炼投研总结，仅 A 股/港股）：只收具体代码，单次最多 6000 个；不支持全市场关键字
gangtise ai stock-summary --security 600519.SH --security 00700.HK --format json
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
# --security 也接受板块 ID（reference sector-search 的 10 位 sectorId），与代码混传取并集
gangtise indicator cross-section \
  --indicator qte_close --indicator qte_vol --indicator qte_mkt_cptl \
  --security 600519.SH --security 09992.HK \
  --date 2026-07-31 --format table
# 输出列：security / name / <各指标名>…（v0.30.0 起无 date 列——日期挂在每个指标的参数上）

# 时间序列：多指标 × 单证券 或 单指标 × 多证券（不能多 × 多，否则报 100003）
gangtise indicator time-series --indicator qte_close \
  --security 600519.SH --security 09992.HK \
  --start-date 2026-07-29 --end-date 2026-07-31 --format table

# 条件选股：F1/F2… 绑定指标，用表达式组合筛选（--indicator-param 按变量索引，不是按 code）
# --date 必填：绝大多数指标吃 tradeDate，漏传就是空表 + 退出码 0
gangtise indicator screener \
  --indicator F1:qte_mkt_cptl --indicator F2:finc_pe_ttm \
  --indicator-param "F1:scale=8" \
  --security 1000000287 \
  --expression "F1 >= 500 && F2 <= 30" \
  --date 2026-07-31 --format table

# 文本筛选：contains/notcontains 只对 string 类型指标有效
gangtise indicator screener --indicator F1:mgn_flag \
  --security 1000000287 --expression "F1 contains '是'" \
  --date 2026-08-13 --format table   # 白酒板块里的融资融券标的

# 公司/证券静态属性（pty_* 经营范围·注册地 / scr_* 上市板块·ISIN 等）的 parameterList
# 里没有日期参数，要加一条冒号后留空的绑定声明「该指标不要 --date 注入的 tradeDate」；
# 截面与选股写法一致，选股上按变量名（F1:）、截面上按指标 code（code:）：
gangtise indicator screener --indicator F1:pty_op_scope --indicator-param "F1:" \
  --security 1000000287 --expression "F1 contains '葡萄酒'" \
  --date 2026-08-13 --format table   # 白酒板块里经营范围提到葡萄酒的公司
gangtise indicator cross-section --indicator pty_op_scope \
  --indicator-param "pty_op_scope:" \
  --security 1000000287 --date 2026-08-13 --format jsonl | grep 酒

# 复权 / 指标专属参数用 --indicator-param "code:key=value"
# ⚠️ 参数名必须以 search 的 parameterList 为准；写错名会报 100003 并指出是哪个指标的哪个参数
gangtise indicator cross-section --indicator qte_close --security 600519.SH \
  --date 2024-01-02 --indicator-param "qte_close:adjustType=3"   # 1不复权/2前复权/3后复权/4定点
# 不复权 1685.01 → 前复权 1531.225 → 后复权 13609.6168（前复权在最新交易日等于不复权，验证要用历史日）

# 必填参数：部分指标缺必填参数会报 140002，按 parameterList 的 required 补齐再取：
#   N 期统计补 periodNum、区间类补 sDate（起始日，tradeDate 仍是终点）、年度/分红类补 fiscalYear
gangtise indicator cross-section --indicator finc_roe_avg_avg --security 600519.SH \
  --date 2026-03-31 --indicator-param "finc_roe_avg_avg:periodNum=4"

# 区间指标：sDate 是起点、--date 下发的 tradeDate 是终点，两者共存
gangtise indicator cross-section --indicator qte_vol_intvl --security 600519.SH \
  --date 2024-01-31 --indicator-param "qte_vol_intvl:sDate=2024-01-02"
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

### Tool（PDF 解析）

```bash
# 一步到位：上传 → 阻塞等待 → 结果 ZIP 落盘（含 file.md + images/）
gangtise tool file-parse --file ./研报.pdf --wait --output ./研报.zip

# 分两步：先提交拿 taskId（此时按页扣费 0.8/页），约 3 分钟后取结果（免费）
gangtise tool file-parse --file ./研报.pdf
gangtise tool file-parse-check --task-id 829081108954501120 --output ./研报.zip
```

限制：单文件 ≤100MB、≤500 页，同一用户最多 10 个并发任务；未就绪时 `file-parse-check` 输出 `{"status":"pending"}`（退出码 0），重试即可，不会重复扣费。

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
- 所有 date 参数（`--start-date`/`--end-date`/`--date`/`--report-date`，含 Quote/Fundamental/AI/Alternative/Indicator）：`YYYY-MM-DD`、`YYYY/MM/DD` 或 `YYYYMMDD`，统一归一成 `YYYY-MM-DD` 发出（年在后等歧义写法在发请求前拒绝，见下节）
- 所有 `--start-time` / `--end-time`（Insight/Vault/AI 透传、`quote minute-kline`，以及 A 股公告 / `knowledge-batch` 两个转换端点）：上述三种日期写法 + 可选的 `[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔），或 10/13 位 Unix 时间戳（同样归一日期部分、拒绝年在后写法）

校验失败会输出 `ValidationError: Invalid ...` 并以非 0 状态退出。

### 关于日期格式

**CLI 接受三种「年在前」写法，并统一归一成 `YYYY-MM-DD` 再发出：**

| 你写的 | 发出去的 |
|--------|---------|
| `2026-07-01` | `2026-07-01` |
| `2026/07/01` | `2026-07-01` |
| `20260701` | `2026-07-01` |

datetime 参数（`--start-time` / `--end-time`）同理，只归一日期部分：`2026/07/01 09:30:00` → `2026-07-01 09:30:00`；Unix 时间戳原样透传。

**「年在后」的写法（`07-01-2026`、`01/07/2026`）会被本地拒绝**，因为它对不同人意思不同：

| 写法 | 美式读法 | 欧洲读法 | 平台实际按 |
|------|---------|---------|-----------|
| `01-07-2026` | 1 月 7 日 | 7 月 1 日 | **1 月 7 日**（美式） |
| `07-01-2026` | 7 月 1 日 | 1 月 7 日 | **7 月 1 日**（美式） |

平台接口本身会解析年在后写法，**一律按美式「月在前」**。所以按欧洲/国际习惯用 `01-07-2026` 表示「7 月 1 日」的话，会拿到 1 月 7 日的数据——请求返回 200、行数看着也正常，**不会有任何报错提示**。CLI 在发请求前就拒掉这类写法（不发请求、不计费，报错直接给出可用的格式），所以经 CLI 调用不会踩到这个坑。

⚠️ **绕过 CLI 直接调 HTTP 接口时，请统一使用 `YYYY-MM-DD`。**

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
| `999999` | Gangtise 系统错误，请稍后重试（`indicator` 端点的「无数据」已不再用此码——有效 code 无数据返回占位单元格（统一 `null`），此码基本只剩真故障） |
| `140002` | 终态失败：AI 异步生成失败，或 `indicator` 的参数/表达式错误（枚举越界、语法错）——改参数重提，不重试 |
| `100003` | 参数值非法——**最宽的兜底码**；msg 通常已指明字段（如「limit 最小为 1，最大为 10000」），先读 msg |
| `100001` | 缺必填参数（msg 带字段名，如「缺少必填参数: reportId」） |
| `100006` | 查询/下载数量超限——**取代旧 `430007`** |
| `110001` / `110002` | 日期格式错误 / 日期区间非法（起晚于止） |
| `120001` | 证券代码无效（用 `reference securities-search` 确认代码与后缀） |
| `130001` | 数据未找到或无指标权限——**取代旧 `410004`** |
| `130002` | 资源不存在——**下载类的兜底码**，`--report-id` 不存在 / 非数字 / `--file-type` 非法都归这里（取代旧 `430004`） |
| `410110` / `410111` | 异步任务生成中（继续轮询）/ 生成失败（终态）——异步端点当前返回的是这两个码；新码为 `140001`/`140002`，CLI 两代都认 |
| `240001` | 财报期未披露或超出查询期（`earnings-review` 提交阶段即报，不扣积分） |
| `250001` | 不支持该数据源（`knowledge-resource-download` 需正确的 `resourceType + sourceId` 组合）——**取代旧 `433007`** |
| `900002` | 请求方法不正确（服务端 msg 为「请求类型有误」，HTTP 405） |

> **关于这次错误码重排**：服务端 2026-07-17 重排了 41 个公开码（三层：`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层），信封新增 `errorType` 和 `traceId`。2026-07-20 逐码实测发现**迁移是按「错误处理层」而非按业务模块进行的**：同一个接口内，参数校验层与路由层已发新码，方法路由层、token 过滤器、以及异步生成状态仍发旧码。新码信封 `code` 是 JSON 数字且带 `errorType`，旧码是字符串且没有——但这判断的是单条错误路径，不是整个接口；CLI 对两代都能识别。报错行会带 `[trace <id>]`，**报障时请带上它**。
>
> 其余码（`999003`–`999006`、`999012`–`999016`、`100002`、`210001`、`220001`、`230001`、`240002`、`240003`）在实测中未触发到，多被上面的兜底码接管，CLI 仍内置了对应提示。⚠️ 两个需要留意的行为：**枚举值拼错和分页越界在部分端点上会报 `100005`/`100006`、在另一些端点上被静默忽略**（后者按未传该筛选条件处理，结果看着正常但范围不对——v0.32.0 起 CLI 对 `--search-type`/`--rank-type`/`--file-type` 等已知枚举本地拦截，未覆盖的自由字符串参数要自己核对）；**`viewpoint-debate` 的敏感内容不会被提前拦截**，会扣满 50 积分再以 `410111` 失败。

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
