# AI 命令详细参数

注意：`ai one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `viewpoint-debate-check` / `earnings-review-check` 返回 `{content: "markdown文本"}`；这类命令仍然加 `--format json`，但呈现给用户时直接取 `content` 字段，不要展示 JSON 包装层。

---

## 知识库搜索 `ai knowledge-batch`

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>]
```

- `--query` 可重复（**最多 5 个**）
- `--top` 默认 10，最大 20
- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库

## 知识资源下载 `ai knowledge-resource-download`

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回），错配返回 `433007`。

## 投研线索 `ai security-clue`

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>]
```

- `--query-mode`（**必选**）：`bySecurity` 按证券 | `byIndustry` 按行业
- `--gts-code`（**必选**）：个股代码（如 `600519.SH`）或申万行业代码（如 `821035.SWI`）。**先用 `reference securities-search` 查个股，或读 `references/lookup-ids.md` 查行业**
- `--source`：`researchReport` | `conference` | `announcement` | `view`

## 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager        --security-code <code>
gangtise ai investment-logic --security-code <code>
gangtise ai peer-comparison  --security-code <code>
```

- 都支持 A 股 / 港股
- 返回 `{content: "markdown"}` — 直接呈现 content
- 首次调用可能耗时数十秒，告知用户

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
- `--wait`：阻塞等待（最多 3 分钟）
- 异步流程：① earnings-review → 拿 `dataId` → ② 间隔 30s-1min `*-check` → 若 pending 继续 → 最多轮询 3 次
- 错误码：`410110` 生成中（继续等待）；`410111` 生成失败（终态，不重试）

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

- `--theme-id`（**必选**）：用 `lookup theme-id list` 查
- `--date`：支持近 30 天
- `--type`：`morning` 晨报 | `night` 晚报（不传返回两者）

## 热点话题 `ai hot-topic`

```bash
gangtise ai hot-topic [--start-date <date>] [--end-date <date>] [--category <name>] [--with-related-securities] [--no-with-related-securities] [--with-close-reading] [--no-with-close-reading] [--from <n>] [--size <n>]
```

- 结构化数据：驱动事件 / 投资逻辑 / 核心标的 / 话题精读
- `--category`：`morningBriefing` 早报 | `noonBriefing` 午报 | `afternoonFlash` 盘中快报 | `eveningBriefing` 晚报（可重复，默认全部）
- `--with-related-securities` / `--with-close-reading`：默认开启
- 自动翻页，单页最大 20

## 管理层讨论-财报 `ai management-discuss-announcement`

```bash
gangtise ai management-discuss-announcement --report-date <date> --security-code <code> --dimension <name>
```

- `--report-date`（**严格**）：仅接受 `xxxx-06-30`（半年报）/ `xxxx-12-31`（年报）
- `--dimension`（**必选**）：`businessOperation` 业务经营与行业 | `financialPerformance` 财务与经营成果 | `developmentAndRisk` 发展规划与风险
- 返回 `content` 为字符串数组（每段一个元素）

## 管理层讨论-业绩会 `ai management-discuss-earnings-call`

```bash
gangtise ai management-discuss-earnings-call --report-date <date> --security-code <code> --dimension <name>
```

- `--report-date`：接受 `xxxx-03-31` / `xxxx-06-30` / `xxxx-09-30` / `xxxx-12-31`
- `--dimension`：同上
- 返回 `content` 为字符串
