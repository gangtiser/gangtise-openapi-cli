# AI 命令详细参数

注意：`ai one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `viewpoint-debate-check` / `earnings-review-check` 返回 `{content: "markdown文本"}`；这类命令仍然加 `--format json`，但呈现给用户时直接取 `content` 字段，不要展示 JSON 包装层。

**⏱ 超时与重复扣分**：7 个 agent 类（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`）CLI 已内置 120s 超时下限，**无需前缀**；`stock-summary` / `hot-topic` 首次生成也常 >30s，仍建议前置 `GANGTISE_TIMEOUT_MS=120000`。自 v0.26.0 起**贵档端点超时/5xx 不再自动重试**（重放=重复扣分）——超时报错后内容可能已在服务端生成并扣费，同参数再调会**再扣一次**（实测按次计费、无缓存命中豁免），所以一次调用给足超时比失败重跑省钱；拿到的生成内容自行留存复用，别为"刷新"重调。`earnings-review` / `viewpoint-debate` 是异步——用 `--wait`（工具超时 ≥360s）或 `*-check` 轮询，不吃这个超时。

---

## 知识库搜索 `ai knowledge-batch`

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>] [--start-time <ts|datetime>] [--end-time <ts|datetime>]
```

- `--query`（**必选**，可重复，最多 5 个）：缺失时本地报错，不发空请求
- `--top` 默认 10，最大 20
- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库
- `--start-time` / `--end-time`：13/10 位时间戳或 `YYYY-MM-DD[ HH:mm[:ss]]`（秒可省、空格或 `T` 分隔；CLI 统一转 13 位毫秒，10 位秒自动 ×1000），按时间范围过滤

## 知识资源下载 `ai knowledge-resource-download`

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回），错配返回 `250001`（旧 `433007`）。

## 投研线索 `ai security-clue`

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>] [--from <n>] [--size <n>]
```

- `--query-mode`（**必选**）：`bySecurity` 按证券 | `byIndustry` 按行业
- `--gts-code`（建议必传，CLI 未强制）：个股代码（如 `600519.SH`）或申万行业代码（如 `821035.SWI`）。**先用 `reference securities-search` 查个股，或读 `references/lookup-ids.md` 查行业**（全量行业代码：`reference sector-constituents --sector-id 2000000014`）
- `--source`：`researchReport` | `conference` | `announcement` | `view`
- `--from` / `--size`：自动翻页（单页 500）；省略 `--size` 拉全量

## 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager        --security-code <code>
gangtise ai investment-logic --security-code <code>
gangtise ai peer-comparison  --security-code <code>
```

- 都支持 A 股 / 港股
- 返回 `{content: "markdown"}` — 直接呈现 content
- 首次调用可能耗时数十秒，告知用户

## 个股看点 `ai stock-summary`

```bash
gangtise ai stock-summary --security <code> [--security <code2> ...]
gangtise ai stock-summary --security <aShares|hkStocks>
```

- `--security`（**必选**，可重复）：证券代码，单次最多 6000 个；**或**传市场关键词 `aShares`（全部 A 股）/ `hkStocks`（全部港股）
- **仅支持 A 股和港股**
- **积分**：`3`/条；个股若无看点总结则不在返回列表中，也不扣分
- 返回字段：`securityCode` / `securityName` / `summary`（精炼投研总结）/ `date`（更新日期 `yyyy-MM-dd`）

**示例：**
```bash
GANGTISE_TIMEOUT_MS=120000 gangtise ai stock-summary --security 600519.SH --security 00700.HK --format json   # 茅台 / 腾讯看点
GANGTISE_TIMEOUT_MS=120000 gangtise ai stock-summary --security hkStocks --format json                        # 全部港股，total 2662
```

## 调研提纲 `ai research-outline`

```bash
gangtise ai research-outline --security-code <code>
```

- 仅 A 股
- 返回 `{content: "markdown"}`

## 业绩点评 `ai earnings-review`（异步）

```bash
gangtise ai earnings-review --security-code <code> --period <period> [--wait]
gangtise ai earnings-review-check --data-id <id>
```

- `--period`：`年份+报告期`，如 `2025q3`（q1/interim/q3/annual），仅 A 股，覆盖最近 6 期
- `--wait`（**推荐**）：阻塞等待到出结果（最长约 5 分钟：14 次指数退避轮询 5s→30s，累计 ≈316s）——**用它时把工具/命令超时设到 ≥360s**，否则外层先超时
- 不带 `--wait` 的手动轮询：① `earnings-review` → 拿 `{dataId, status, hint}` → ② 间隔 ~30s `*-check`（预算 ~2-3 分钟）→ pending 继续 → 多次仍 pending 交用户稍后手动 check
- 错误码：`140001`（旧 `410110`）生成中，继续等待；`140002`（旧 `410111`）生成失败，终态不重试。CLI 两代码都识别

## 观点 PK `ai viewpoint-debate`（异步）

```bash
gangtise ai viewpoint-debate --viewpoint <text> [--wait]
gangtise ai viewpoint-debate-check --data-id <id>
```

- `--viewpoint`：观点文本，**上限 1000 字**
- 双向逻辑校验：看多→拆解风险，看空→挖反转
- 异步流程同 earnings-review

## 主题跟踪 `ai theme-tracking`

```bash
gangtise ai theme-tracking --theme-id <id> --date <yyyy-MM-dd> [--type <name>]
```

- `--theme-id`（**必选**）：用 `gangtise reference concept-search --keyword <主题名>` 查，取 `conceptId`（题材与主题共用 ID 体系）
- `--date`：支持近 30 天
- `--type`：`morning` 晨报 | `night` 晚报（不传返回两者）
- **返回**：`[{type, date, content}, ...]` — 列表，每个元素是一份报告。某主题在指定日期可能只有一种类型（如只有晚报）或两种都没（空列表）。空结果不代表接口出错，建议换主题或换日期再试

**示例：**
```bash
# 查"核电"主题 2026-05-09 的晚报
GANGTISE_TIMEOUT_MS=120000 gangtise ai theme-tracking --theme-id 121000002 --date 2026-05-09 --type night --format json
# 返回 [{"type":"night","date":"2026-05-09","content":"..."}]
```

## 热点话题 `ai hot-topic`

```bash
gangtise ai hot-topic [--start-date <date>] [--end-date <date>] [--category <name>] [--with-related-securities] [--no-with-related-securities] [--with-close-reading] [--no-with-close-reading] [--from <n>] [--size <n>]
```

- 结构化数据：驱动事件 / 投资逻辑 / 核心标的 / 话题精读
- `--category`：`morningBriefing` 早报 | `noonBriefing` 午报 | `afternoonFlash` 盘中快报 | `eveningBriefing` 晚报（可重复，默认全部）
- `--with-related-securities` / `--with-close-reading`：默认开启；`--no-with-related-securities` / `--no-with-close-reading` 显式排除（响应里相应字段置空）
- 自动翻页，单页最大 20

## 管理层讨论-财报 `ai management-discuss-announcement`

```bash
gangtise ai management-discuss-announcement --report-date <date> --security-code <code> --dimension <name>
```

- `--report-date`（**严格**）：仅接受 `xxxx-06-30`（半年报）/ `xxxx-12-31`（年报）
- `--dimension`（**必选**）：`businessOperation` 业务经营与行业 | `financialPerformance` 财务与经营成果 | `developmentAndRisk` 发展规划与风险 | `all` 返回报告中完整的管理层讨论内容（内容可能过长，谨慎使用）
- 返回 `content` 为字符串数组（每段一个元素）

## 管理层讨论-业绩会 `ai management-discuss-earnings-call`

```bash
gangtise ai management-discuss-earnings-call --report-date <date> --security-code <code> --dimension <name>
```

- `--report-date`：接受 `xxxx-03-31` / `xxxx-06-30` / `xxxx-09-30` / `xxxx-12-31`
- `--dimension`（**必选**）：`businessOperation` | `financialPerformance` | `developmentAndRisk`（注意：不支持 `all`，与财报版不同）
- 返回 `content` 为字符串
