---
name: gangtise-openapi
description: |-
  通过 gangtise CLI 直接调用 Gangtise OpenAPI，拉取投研原始数据、批量导出、下载文件、调用 AI 能力。

  覆盖：首席观点、纪要、路演、调研、策略会、论坛、研报、外资研报、公告、日K线行情、基本面（利润表/主营/估值）、AI知识库搜索、投研线索、一页通、投资逻辑、同业对比、云盘。

  **触发场景（即使用户没有明确提到 API 或 CLI 也要使用）**：
  - 用户提到"调接口"、"CLI"、"openapi"、"导出"、"下载研报"、"批量查"
  - 需要原始数据（非经过其他 skill 加工）、批量导出 jsonl/csv、下载 PDF
  - 查行情K线、财务报表、估值指标等结构化金融数据
  - 调用 AI 能力（知识库搜索、一页通、投资逻辑、同业对比、投研线索）

  **不要用此 skill**：个股研究工作流用 gangtise-stock-research、观点分析用 gangtise-opinion-*、仅查证券详情/板块/股东用 gangtise-data-client。当此 skill 作为数据源被其他 skill 调用时，直接执行 CLI 命令，不要再转发给其他数据 skill。
---

# Gangtise OpenAPI CLI

## 核心规则

1. **agent 调用务必加 `--format json`** 便于解析
2. **opaque ID 参数**（research-area / broker / institution / chief / industry / concept）— **先用 `gangtise lookup` 查准确 ID，禁止凭记忆猜测**
3. **证券代码带后缀**：`600519.SH`（沪）、`000858.SZ`（深）、`300750.SZ`（创）、`01913.HK`（港）
4. **时间格式**：datetime 用 `"YYYY-MM-DD HH:mm:ss"`（带引号），date 用 `YYYY-MM-DD`
5. **多值参数重复传入**：`--security 600519.SH --security 000858.SZ`
6. **省略 `--size` 自动翻页查全**，需要限量时才传 `--size`

## 快速路由

| 用户想要 | 命令 |
|----------|------|
| 首席/分析师观点 | `insight opinion list` |
| 纪要 | `insight summary list/download` |
| 路演 / 调研 / 策略会 / 论坛 | `insight roadshow/site-visit/strategy/forum list` |
| 研报（券商） | `insight research list/download` |
| 外资研报 | `insight foreign-report list/download` |
| 公告 | `insight announcement list/download` |
| K线行情 | `quote day-kline` |
| 利润表 | `fundamental income-statement` |
| 主营业务 | `fundamental main-business` |
| PE/PB/PEG 估值 | `fundamental valuation-analysis` |
| 知识库搜索 | `ai knowledge-batch` |
| 投研线索 | `ai security-clue` |
| 一页通/投资逻辑/同业对比 | `ai one-pager/investment-logic/peer-comparison` |
| 云盘文件 | `ai cloud-disk-list/download` |
| 不确定 ID | `lookup` 先查 |

---

## Insight 命令

所有 insight list 命令共享以下参数：

`--keyword <text>` `--start-time <datetime>` `--end-time <datetime>` `--from <n>` `--size <n>`

### 首席观点

```bash
gangtise insight opinion list [--research-area <id>] [--chief <id>] [--security <code>] [--broker <id>] [--industry <id>] [--concept <id>] [--llm-tag <tag>] [--source <source>] [--rank-type <n>]
```

枚举值：
- `--llm-tag`：`strongRcmd` 强烈推荐 | `earningsReview` 业绩点评 | `topBroker` 头部券商 | `newFortune` 新财富团队
- `--source`：`realTime` 实时 | `openSource` 开放来源
- `--rank-type`：`1` 综合排序（默认）| `2` 时间倒序

示例：查中信证券近一周的强烈推荐观点
```bash
gangtise insight opinion list --broker C100000027 --llm-tag strongRcmd --start-time "2025-04-01 00:00:00" --format json
```

### 纪要

```bash
gangtise insight summary list [--search-type <n>] [--rank-type <n>] [--source <n>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--market <name>] [--participant-role <name>]
gangtise insight summary download --summary-id <id> [--output <path>]
```

枚举值：
- `--search-type`：`1` 标题搜索（默认）| `2` 全文搜索
- `--market`：`aShares` A股 | `hkStocks` 港股 | `usChinaConcept` 美股中概 | `usStocks` 美股
- `--participant-role`：`management` 管理层 | `expert` 专家

### 路演 / 调研 / 策略会 / 论坛

```bash
gangtise insight roadshow list [options]
gangtise insight site-visit list [options]
gangtise insight strategy list [options]
gangtise insight forum list [options]
```

共用参数：`--research-area <id>` `--institution <id>` `--security <code>` `--category <name>` `--market <name>` `--participant-role <name>` `--broker-type <type>` `--object <type>` `--permission <n>`

枚举值：
- `--category`（路演）：`earningsCall` 业绩交流 | `strategyMeeting` 策略会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `fundRoadshow` 基金路演
- `--category`（调研）：`single` 单场调研 | `series` 系列调研
- `--object`（调研）：`company` 公司调研 | `industry` 行业调研
- `--broker-type`：`cnBroker` 内资券商 | `otherBroker` 其他
- `--permission`：`1` 公开 | `2` 私密

示例：查最近的公司调研日程
```bash
gangtise insight site-visit list --object company --start-time "2025-04-01 00:00:00" --format json
```

### 研报

```bash
gangtise insight research list [--search-type <n>] [--rank-type <n>] [--broker <id>] [--security <code>] [--industry <id>] [--category <name>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>] [--source <type>]
gangtise insight research download --report-id <id> [--file-type <n>] [--output <path>]
```

枚举值：
- `--category`：`macro` 宏观 | `strategy` 策略 | `industry` 行业 | `company` 公司 | `bond` 债券 | `quant` 金工 | `morningNotes` 晨会 | `fund` 基金 | `forex` 外汇 | `futures` 期货 | `options` 期权 | `warrants` 权证 | `market` 市场 | `wealthManagement` 理财 | `other` 其他
- `--llm-tag`：`inDepth` 深度报告 | `earningsReview` 业绩点评 | `industryStrategy` 行业策略
- `--rating`：`buy` 买入 | `overweight` 增持 | `neutral` 中性 | `underweight` 减持 | `sell` 卖出
- `--rating-change`：`upgrade` 上调 | `maintain` 维持 | `downgrade` 下调 | `initiate` 首次
- `--source`：`1` PDF研报 | `2` 公众号
- `--file-type`（download）：`1` 原始PDF（默认）| `2` Markdown

示例：查食品饮料行业的深度研报（买入评级）
```bash
gangtise insight research list --industry 104340000 --category company --llm-tag inDepth --rating buy --format json
```

### 外资研报

```bash
gangtise insight foreign-report list [--search-type <n>] [--rank-type <n>] [--security <code>] [--region <id>] [--category <name>] [--industry <id>] [--broker <id>] [--llm-tag <tag>] [--rating <name>] [--rating-change <name>] [--min-pages <n>] [--max-pages <n>]
gangtise insight foreign-report download --report-id <id> [--file-type <n>] [--output <path>]
```

- `--region`：`cn` 中国 | `cnHk` 香港 | `cnTw` 台湾 | `us` 美国 | `jp` 日本 | `sea` 东南亚 | `gl` 全球 | `uk` 英国 | `fr` 法国 | `de` 德国 | `kr` 韩国 | `in` 印度 | `ca` 加拿大 | `me` 中东 | `othAs` 亚洲其他 | `othEur` 欧洲其他 | `latAm` 拉美 | `oce` 大洋洲 | `af` 非洲
- `--category` / `--llm-tag` / `--rating` / `--rating-change`：同研报
- `--file-type`（download）：`1` 原始PDF | `2` Markdown | `3` 中文翻译PDF | `4` 中文翻译Markdown

示例：下载外资研报的中文翻译版
```bash
gangtise insight foreign-report download --report-id <id> --file-type 3 --output ./report.pdf
```

### 公告

```bash
gangtise insight announcement list [--search-type <n>] [--rank-type <n>] [--security <code>] [--category <id>]
gangtise insight announcement download --announcement-id <id> [--file-type <n>] [--output <path>]
```

- `--category`（一级）：`103910100` IPO | `103910200` 财务报告 | `103910300` 重大事项 | `103910400` 交易提示 | `103910500` 配股 | `103910600` 增发 | `103910700` 股权股本 | `103910800` 一般公告 | `103910900` 公司治理（二级分类用 `lookup announcement-category list`）
- `--file-type`（download）：`1` 原始PDF | `2` Markdown
- 时间参数自动转 13 位时间戳，照常传 `"YYYY-MM-DD HH:mm:ss"`

示例：查贵州茅台最近的财务报告类公告
```bash
gangtise insight announcement list --security 600519.SH --category 103910200 --format json
```

---

## Quote 命令

### 日K线

```bash
gangtise quote day-kline --security <code> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> [--limit <n>] [--field <name>]
```

示例：
```bash
gangtise quote day-kline --security 600519.SH --start-date 2025-01-01 --end-date 2025-03-31 --format json
```

---

## Fundamental 命令

### 利润表

```bash
gangtise fundamental income-statement --security-code <code> [--fiscal-year <year>] [--period <p>] [--report-type <type>] [--field <name>]
```

- `--period`：`q1` | `q2` | `q3` | `latest`（默认）
- `--report-type`：`consolidated` 合并报表（默认）| `parent` 母公司报表

### 主营业务

```bash
gangtise fundamental main-business --security-code <code> --breakdown <type> [--period <type>] [--fiscal-year <year>] [--field <name>]
```

- `--breakdown`（必选）：`product` 按产品（默认）| `industry` 按行业 | `region` 按地区
- `--period`：`interim` 中报 | `annual` 年报

示例：查茅台按地区拆分的主营构成
```bash
gangtise fundamental main-business --security-code 600519.SH --breakdown region --format json
```

### 估值分析

```bash
gangtise fundamental valuation-analysis --security-code <code> --indicator <name> [--start-date <date>] [--end-date <date>] [--limit <n>]
```

- `--indicator`（必选）：`peTtm` | `pbMrq` | `peg` | `psTtm` | `pcfTtm` | `em`

---

## AI 命令

### 知识库搜索

```bash
gangtise ai knowledge-batch --query <text> [--query <text2>] [--top <n>] [--resource-type <n>] [--knowledge-name <name>]
```

- `--resource-type`：`10` 券商研报 | `11` 外资研报 | `20` 内部报告 | `40` 首席观点 | `50` 公司公告 | `51` 港股公告 | `60` 会议平台纪要 | `70` 调研纪要公告 | `80` 网络资源纪要 | `90` 产业公众号
- `--knowledge-name`：`system_knowledge_doc` 系统知识库 | `tenant_knowledge_doc` 机构知识库

### 知识资源下载

```bash
gangtise ai knowledge-resource-download --resource-type <n> --source-id <id> [--output <path>]
```

`resourceType + sourceId` 必须匹配（来自 knowledge-batch 返回结果），错误组合返回 `433007`。

### 投研线索

```bash
gangtise ai security-clue --start-time <datetime> --end-time <datetime> --query-mode <mode> [--gts-code <code>] [--source <name>]
```

- `--query-mode`（必选）：`bySecurity` | `byIndustry`
- `--source`：`researchReport` 研报 | `conference` 电话会议 | `announcement` 公告 | `view` 观点
- `--gts-code` 支持个股代码或申万行业代码（如 `821035.SWI`），行业代码用 `lookup industry-code list` 查

### 一页通 / 投资逻辑 / 同业对比

```bash
gangtise ai one-pager --security-code <code>
gangtise ai investment-logic --security-code <code>
gangtise ai peer-comparison --security-code <code>
```

### AI 云盘

```bash
gangtise ai cloud-disk-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--from <n>] [--size <n>]
gangtise ai cloud-disk-download --file-id <id> [--output <path>]
```

- `--file-type`：`1` 文档 | `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 机构云盘

---

## Lookup 命令

不确定 ID 时先查枚举，避免无效调用：

```bash
gangtise lookup research-area list        # 研究方向 ID
gangtise lookup broker-org list           # 券商机构 ID
gangtise lookup meeting-org list          # 会议机构 ID
gangtise lookup industry list             # 行业 ID
gangtise lookup region list               # 外资研报区域 ID
gangtise lookup announcement-category list # 公告分类 ID
gangtise lookup industry-code list        # 申万行业代码（security-clue --gts-code 用）
```

## Raw 调用

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

endpoint key 如 `insight.opinion.list`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch` 等。

---

## 常用 ID 速查

### 申万行业（--industry 参数，完整列表用 `lookup industry list`）

| ID | 行业 | ID | 行业 | ID | 行业 |
|----|------|----|------|----|------|
| 104110000 | 农林牧渔 | 104220000 | 基础化工 | 104230000 | 钢铁 |
| 104240000 | 有色金属 | 104270000 | 电子 | 104280000 | 汽车 |
| 104330000 | 家用电器 | 104340000 | 食品饮料 | 104350000 | 纺织服饰 |
| 104360000 | 轻工制造 | 104370000 | 医药生物 | 104410000 | 公用事业 |
| 104420000 | 交通运输 | 104430000 | 房地产 | 104450000 | 商贸零售 |
| 104460000 | 社会服务 | 104480000 | 银行 | 104490000 | 非银金融 |
| 104510000 | 综合 | 104610000 | 建筑材料 | 104620000 | 建筑装饰 |
| 104630000 | 电力设备 | 104640000 | 机械设备 | 104650000 | 国防军工 |
| 104710000 | 计算机 | 104720000 | 传媒 | 104730000 | 通信 |
| 104740000 | 煤炭 | 104750000 | 石油石化 | 104760000 | 环保 |
| 104770000 | 美容护理 | | | | |

### 常用券商（--broker 参数，完整列表用 `lookup broker-org list`）

| ID | 券商 | ID | 券商 |
|----|------|----|------|
| C100000027 | 中信证券 | C100000095 | 中信建投 |
| C100000026 | 中金公司 | C100000047 | 国泰海通 |
| C100000021 | 广发证券 | C100000020 | 招商证券 |
| C100000023 | 国信证券 | C100000014 | 华泰证券 |
| C100000051 | 兴业证券 | C100000119 | 申万宏源 |
| C100000050 | 天风证券 | C100000039 | 长江证券 |
| C100000068 | 华创证券 | C100000042 | 东方证券 |
| C100000029 | 光大证券 | C100000006 | 国金证券 |
| C100000034 | 民生证券 | C100000062 | 中泰证券 |
| C100000099 | 中国银河 | C100000096 | 国投证券 |

### 常用研究方向（--research-area 参数，完整列表用 `lookup research-area list`）

| ID | 方向 | ID | 方向 |
|----|------|----|------|
| 122000001 | 宏观 | 122000002 | 策略 |
| 122000003 | 固收 | 122000004 | 金工 |
| 122000005 | 海外 | 104270000 | 申万电子 |
| 104710000 | 申万计算机 | 104370000 | 申万医药生物 |
| 104340000 | 申万食品饮料 | 104630000 | 申万电力设备 |
| 104280000 | 申万汽车 | 104640000 | 申万机械设备 |

### 常用会议机构（--institution 参数，完整列表用 `lookup meeting-org list`）

| ID | 机构 | ID | 机构 |
|----|------|----|------|
| C100000027 | 中信证券 | C100000095 | 中信建投 |
| C100000026 | 中金公司 | C100000047 | 国泰海通 |
| C100000021 | 广发证券 | C100000023 | 国信证券 |
| C100000014 | 华泰证券 | C100000051 | 兴业证券 |
| C100000050 | 天风证券 | C100000068 | 华创证券 |
| C100000020 | 招商证券 | C100000042 | 东方证券 |
| C000000000 | 公司自发 | | |

### 申万行业代码（--gts-code 参数，用于 `ai security-clue`）

| 代码 | 行业 | 代码 | 行业 | 代码 | 行业 |
|------|------|------|------|------|------|
| 821031.SWI | 农林牧渔 | 821032.SWI | 基础化工 | 821033.SWI | 钢铁 |
| 821034.SWI | 有色金属 | 821035.SWI | 电子 | 821036.SWI | 汽车 |
| 821037.SWI | 家用电器 | 821038.SWI | 食品饮料 | 821039.SWI | 纺织服饰 |
| 821040.SWI | 轻工制造 | 821041.SWI | 医药生物 | 821042.SWI | 公用事业 |
| 821043.SWI | 交通运输 | 821044.SWI | 房地产 | 821045.SWI | 商贸零售 |
| 821046.SWI | 社会服务 | 821047.SWI | 银行 | 821048.SWI | 非银金融 |
| 821049.SWI | 综合 | 821050.SWI | 建筑材料 | 821051.SWI | 建筑装饰 |
| 821052.SWI | 电力设备 | 821053.SWI | 机械设备 | 821054.SWI | 国防军工 |
| 821055.SWI | 计算机 | 821056.SWI | 传媒 | 821057.SWI | 通信 |
| 821058.SWI | 煤炭 | 821059.SWI | 石油石化 | 821060.SWI | 环保 |
| 821061.SWI | 美容护理 | | | | |

## 常见错误码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `999997` | 未开通接口权限 | 联系管理员开通 |
| `999995` | 积分不足 | 联系管理员充值 |
| `903301` | 今日调用次数达上限 | 等待次日或升级配额 |
| `433007` | 数据源不匹配 | 检查 resourceType + sourceId 组合 |
