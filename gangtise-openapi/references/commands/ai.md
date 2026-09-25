# AI 命令详细参数

注意：`ai investment-logic` / `peer-comparison` / `research-outline` 返回 `{content: "markdown文本"}`，`ai one-pager` 与 `viewpoint-debate-check` / `earnings-review-check`（完成时）返回 `{date, content}`；这类命令仍然加 `--format json`，但呈现给用户时直接取 `content` 字段，不要展示 JSON 包装层。

**⏱ 超时与重复扣分**：同步生成类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，**无需前缀**；`stock-summary` 同样有 120s 下限；`hot-topic` 首次生成也常 >30s，仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。**贵档端点超时/5xx 不自动重试**（重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调会**再扣一次**（`one-pager` 等生成类按次计费、无缓存命中豁免），所以一次调用给足超时比失败重跑省钱；拿到的生成内容自行留存复用，别为"刷新"重调。`earnings-review` / `viewpoint-debate` 是异步——用 `--wait`（工具超时 ≥360s）或 `*-check` 轮询，不吃这个超时。

---

## 知识库搜索 `ai knowledge-batch`

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>] [--start-time <ts|datetime>] [--end-time <ts|datetime>]
```

- **积分**：10/次（按次计费；没检索到内容与报错不扣；超时不自动重发）

- `--query`（**必选**，可重复，最多 5 个——上限由接口校验，CLI 不拦）：缺失时本地报错，不发空请求。**每个 `--query` 整段送出**——句子里的逗号是标点，不会被当成分隔符拆成两个查询；要问多个问题就重复传 `--query`
- `--top` 默认 10，最大 20
- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库
- `--start-time` / `--end-time`：13/10 位时间戳或 `YYYY-MM-DD[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔；CLI 统一转 13 位毫秒，日期与时刻按**北京时间**解释、与机器时区无关，10 位秒自动 ×1000），按时间范围过滤

## 知识资源下载 `ai knowledge-resource-download`

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回），错配返回 `250001`。

## 投研线索 `ai security-clue`

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>] [--from <n>] [--size <n>]
```

- **积分：5/条**（按返回条数计）。`--start-time` / `--end-time` 必填，省略 `--size` 即拉全量（估算超过 1000 积分时 CLI 报错拦下，加 `--yes` 才放行）——**务必带 `--size`**，先 `--size 1` 看 `Total` 再估总价
- `--start-time` / `--end-time`（**必选**）
- `--query-mode`（**必选**）：`bySecurity` 按证券 | `byIndustry` 按行业
- `--gts-code`（必传：`bySecurity` 下不传，接口报 `410120 gtsCodeList不能为空`；CLI 未强制）：个股代码（如 `600519.SH`）或申万行业代码（如 `821035.SWI`）。**先用 `reference securities-search` 查个股，或读 `references/lookup-ids.md` 查行业**（全量行业代码：`reference sector-constituents --sector-id 2000000014`）
- `--source`：`researchReport` | `conference` | `announcement` | `view`（可重复；其他取值 CLI 在本地拒绝——接口对错值不报错，会返回不按来源过滤的全部结果）
- `--from` / `--size`：自动翻页（单页 500）；省略 `--size` 拉全量

## 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager        --security-code <code>
gangtise ai investment-logic --security-code <code>
gangtise ai peer-comparison  --security-code <code>
```

- **积分**：50/次（按次计费，重复调用每次都扣；超时不自动重发）

- 都支持 A 股 / 港股
- 返回 `{content: "markdown"}`（`one-pager` 另带 `date`，即一页通的生成日期；取的是该公司最新一份）— 直接呈现 content
- 首次调用可能耗时数十秒，告知用户

## 个股看点 `ai stock-summary`

```bash
gangtise ai stock-summary --security <code> [--security <code2> ...]
```

- `--security`（**必选**，可重复）：**只收具体证券代码**，单次最多 6000 个（接口上限，CLI 同值拦截，超过报错并提示分批）——全 A 股可一次提交完，但**按返回条数 3 积分/条计**，数千只就是上万积分，提交前先把估算总价告诉用户
- 🔴 **不支持全市场批量**：`aShares` / `hkStocks` 这类市场关键词不被接受，CLI 会本地报错（服务端对它们返 `120001`，读起来像代码写错，容易误判）。需要覆盖一批标的就先用 `reference securities-search` 或自有清单取到代码，再分批传入
- **仅支持 A 股和港股**
- **积分**：`3`/条；个股若无看点总结则不在返回列表中，也不扣分——所以**返回行数少于提交数是正常的**，不是丢了数据。超时 / 5xx **不自动重试**（一次最多可扣 18000 积分，重放可能重复扣分）：CLI 已给它 120 秒超时下限；失败后先确认再重跑
- 🔴 **整批返 0 行别直接读成「这批都没有看点」**：它与「确实都没有看点」长得一样。挑其中一两只单查确认后再下结论
- 返回字段：`securityCode` / `securityName` / `summary`（精炼投研总结）/ `date`（更新日期 `yyyy-MM-dd`）

**示例：**
```bash
gangtise ai stock-summary --security 600519.SH --security 00700.HK --format json   # 茅台 / 腾讯看点
```

## 调研提纲 `ai research-outline`

```bash
gangtise ai research-outline --security-code <code>
```

- **积分**：50/次（按次计费；超时不自动重发）

- 仅 A 股
- 返回 `{content: "markdown"}`

## 业绩点评 `ai earnings-review`（异步）

```bash
gangtise ai earnings-review --security-code <code> --period <period> [--wait]
gangtise ai earnings-review-check --data-id <id>
```

- **积分**：提交 50/次（按次计费；超时不自动重发，重提会再扣一次）

- `--period`：`年份+报告期`，如 `2025q3`（q1/interim/q3/annual），仅 A 股，覆盖最近 6 期
- `--wait`（**推荐**）：阻塞等待到出结果（最长约 5 分钟：14 次指数退避轮询 5s→30s，累计 ≈316s）——**用它时把工具/命令超时设到 ≥360s**，否则外层先超时
- 不带 `--wait` 的手动轮询：① `earnings-review` → 拿 `{dataId, status, hint}` → ② 间隔 ~30s `*-check`（预算 ~2-3 分钟）→ pending 继续 → 多次仍 pending 交用户稍后手动 check
  - 这一步的 `{dataId, status, hint}` 同样受 `--format` / `--output` 控制，**加了 `--output` 就会落盘**，脚本可以直接从文件里取 `dataId` 再去轮询
  - `*-check` 返回「还在生成中」时同样落盘（`{dataId, status: "pending", hint}`），所以轮询脚本每一轮都能从同一个文件读状态，不必区分「出结果了」和「还没好」两种取法
- 错误码：异步端点返回 `410110`（生成中，继续等待）/ `410111`（生成失败，终态不重试），对应新码 `140001` / `140002`，CLI 两代都认

## 观点 PK `ai viewpoint-debate`（异步）

```bash
gangtise ai viewpoint-debate --viewpoint <text> [--wait]
gangtise ai viewpoint-debate-check --data-id <id>
```

- **积分**：提交 50/次（按次计费；超时不自动重发，重提会再扣一次）

- `--viewpoint`：观点文本，**上限 1000 字**
- 双向逻辑校验：看多→拆解风险，看空→挖反转
- ⚠️ 观点过不了平台的敏感词检测时，提交照常受理并扣分，生成阶段以 `410111` 失败；同样的内容重提仍会失败，提交前自己把关措辞
- 异步流程同 earnings-review

## 主题跟踪 `ai theme-tracking`

```bash
gangtise ai theme-tracking --theme-id <id> --date <yyyy-MM-dd> [--type <name>]
```

- **积分**：50/次（按次计费；超时不自动重发）

- `--theme-id`（**必选**）：用 `gangtise reference concept-search --keyword <主题名>` 查，取 `conceptId`（题材与主题共用 ID 体系）
- `--date`（**必选**）：支持近 30 天
- `--type`：`morning` 晨报 | `night` 晚报（不传返回两者）（**逐字照抄**：CLI 不在本地校验这个取值，拼错会原样发给接口）
- **返回**：`[{type, date, content}, ...]` — 列表，每个元素是一份报告。某主题在指定日期可能只有一种类型（如只有晚报）或两种都没（空列表）。空结果不代表接口出错，建议换主题或换日期再试

**示例：**
```bash
# 查"核电"主题 2026-05-09 的晚报
gangtise ai theme-tracking --theme-id 121000002 --date 2026-05-09 --type night --format json
# 返回 [{"type":"night","date":"2026-05-09","content":"..."}]
```

## 热点话题 `ai hot-topic`

```bash
gangtise ai hot-topic [--start-date <date>] [--end-date <date>] [--category <name>] [--with-related-securities] [--no-with-related-securities] [--with-close-reading] [--no-with-close-reading] [--from <n>] [--size <n>]
```

- 结构化数据：驱动事件 / 投资逻辑 / 核心标的 / 话题精读
- `--category`：`morningBriefing` 早报 | `noonBriefing` 午报 | `afternoonFlash` 盘中快报 | `eveningBriefing` 晚报（可重复，默认全部；其他取值 CLI 在本地拒绝——接口对错值不报错，结果看着像正常查询）
- `--with-related-securities` / `--with-close-reading`：默认开启；`--no-with-related-securities` / `--no-with-close-reading` 显式排除（响应里相应字段置空）
- 自动翻页，单页最大 20
- 🔴 **计费 50/篇，按返回条数计**（不是按调用次数）。📌 **一「篇」= 一整份报告**（一份早报 / 午报 / 盘中快报 / 晚报），**不是报告里的一条话题**——一份报告通常包含多条热点话题，`--category` 选的也是报告类型而不是话题。所以一页 20 条 = 20 份报告 = 1000 积分：**先用 `--start-date`/`--end-date` + `--category` 把范围收窄，再考虑要不要全量**（省略 `--size` 时 CLI 先取 1 篇拿到总数来估算，超过 1000 积分报错，确认要全量加 `--yes`；结果多于 1 篇时这 1 篇会多计一次，知道要几篇就直接传 `--size`）
- **可查的历史范围跟账号权限走**：试用档是滚动的「当前 −1 个月」，正式/定制档更长。超出范围的日期**返回空结果、不报错**——拿到空先确认是不是撞了本账号的窗口，别当成「那天没有报告」

## 管理层讨论-财报 `ai management-discuss-announcement`

```bash
gangtise ai management-discuss-announcement --report-date <date> --security-code <code> --dimension <name>
```

- **积分**：10/次（按次计费；超时不自动重发）

- `--report-date`（**严格**）：仅接受 `xxxx-06-30`（半年报）/ `xxxx-12-31`（年报）
- `--dimension`（**必选**）：`businessOperation` 业务经营与行业 | `financialPerformance` 财务与经营成果 | `developmentAndRisk` 发展规划与风险 | `all` 返回报告中完整的管理层讨论内容（内容可能过长，谨慎使用）
- 返回 `content` 为字符串数组（每段一个元素）

## 管理层讨论-业绩会 `ai management-discuss-earnings-call`

```bash
gangtise ai management-discuss-earnings-call --report-date <date> --security-code <code> --dimension <name>
```

- **积分**：10/次（按次计费；超时不自动重发）

- `--report-date`：接受 `xxxx-03-31` / `xxxx-06-30` / `xxxx-09-30` / `xxxx-12-31`
- `--dimension`（**必选**）：`businessOperation` | `financialPerformance` | `developmentAndRisk`（注意：不支持 `all`，与财报版不同）
- 返回 `content` 为字符串
