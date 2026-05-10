# 典型执行示例

每个示例展示从用户语句到完整命令的全流程。Skill 主文件不再内嵌示例；遇到不确定的场景时来这里查同类。

---

## 例 1：研报检索 ＋ 下载（list→download 多步编排）

**用户**："下载中金最近的宏观策略研报"

```
1. 路由 → insight research list + download
2. 中金 → C100000026（references/lookup-ids.md 速查）
   "宏观策略" → research-area: 宏观 122000001 + 策略 122000002
   "最近" → 默认 7 天
3. Pre-flight：
   - 认证 OK
   - 结果可能 >200 条 → 🔴 询问"先看前 20 还是导出全量？"
   - 下载格式 → 🔴 询问 PDF 还是 Markdown
4. gangtise insight research list \
     --broker C100000026 \
     --research-area 122000001 --research-area 122000002 \
     --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" \
     --rank-type 2 --format json
5. 提取 reportId + title 展示，让用户选择具体一篇 → 确认 file-type
6. gangtise insight research download --report-id <id> --file-type 1
```

## 例 2：观点检索（带模糊时间）

**用户**："查一下最近有哪些首席观点提到 AI"

```
1. 路由 → insight opinion list
2. "最近" → Insight 默认 7 天；"AI" → --keyword AI
3. Pre-flight：模糊时间已映射，认证 OK，无歧义
4. gangtise insight opinion list \
     --keyword AI \
     --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" \
     --rank-type 2 --format json
5. 提取 list[].title / chiefName / publishDate，按时间倒序列表
```

## 例 3：AI 内容生成（content 字段直接呈现）

**用户**："比亚迪的一页通"

```
1. 路由 → ai one-pager
2. 比亚迪 → 002594.SZ（速查表）
   注意：one-pager 用 --security-code，不是 --security
3. Pre-flight：耗时长（~30s），告知用户"生成中..."
4. gangtise ai one-pager --security-code 002594.SZ --format json
5. 返回 {content: "markdown"} → 直接呈现 content，不要展示 JSON 包装
```

## 例 4：估值分析（默认时间范围）

**用户**："贵州茅台过去一年的 PE 估值"

```
1. 路由 → fundamental valuation-analysis
2. 贵州茅台 → 600519.SH；"PE" → --indicator peTtm
   "过去一年"对 valuation 来说是命令默认行为，省略 --start-date 自动查近一年
3. Pre-flight：认证 OK
4. gangtise fundamental valuation-analysis \
     --security-code 600519.SH --indicator peTtm --format json
5. 提取 list[].tradeDate / value / percentileRank，表格 + 分位标注
```

## 例 5：跨市场 K 线（A 股 + 港股）

**用户**："比亚迪 A 股和港股最近的日 K 线"

```
1. 路由 → quote day-kline + quote day-kline-hk（跨市场需分别调用）
2. 比亚迪 A 股 002594.SZ，港股 01211.HK
   "最近" → K 线默认今日往前 45 天（保证含最近 10 个交易日）
3. Pre-flight：认证 OK
4. gangtise quote day-kline --security 002594.SZ --start-date 2026-03-19 --end-date 2026-05-03 --format json
   gangtise quote day-kline-hk --security 01211.HK --start-date 2026-03-19 --end-date 2026-05-03 --format json
5. 合并两次结果，按 tradeDate 取尾部最近 10 个交易日
```

## 例 6：指数最近值（务必拉范围）

**用户**："查上证综指最近的指数"

```
1. 路由 → quote index-day-kline
2. 上证综指 → 000001.SH；"最近" → 今日往前 45 天
3. Pre-flight：认证 OK；今天若周末 end-date 仍填当天，API 返回最近交易日
4. gangtise quote index-day-kline --security 000001.SH --start-date 2026-03-19 --end-date 2026-05-03 --format json
5. 按 tradeDate 取尾部最近 10 个交易日。**不要用 --limit 20**（截取的是窗口开头）
```

## 例 7：云盘文件下载（list→download，需用户选择）

**用户**："帮我下载云盘里那个 AI 相关的 PDF"

```
1. 路由 → vault drive-list → drive-download
2. "AI 相关" → --keyword AI；"PDF" → --file-type 1（文档含 PDF）
3. Pre-flight："那个"暗示特定文件 → 🔴 展示结果让用户选择
4. gangtise vault drive-list --keyword AI --file-type 1 --format json
5. 展示前 10 条让用户挑 → gangtise vault drive-download --file-id <id>
   （省略 --output 自动用真实标题做文件名）
```

## 例 8：跨资源类型语义搜索

**用户**："搜索一下新能源相关的研报和纪要"

```
1. 路由 → ai knowledge-batch（多类文档统一搜索时优先走 knowledge-batch）
2. "新能源" → 行业别名映射 → 电力设备
   "研报和纪要" → resource-type 10(券商研报) + 60(会议平台纪要) + 70(调研纪要公告)
3. Pre-flight：意图明确，无歧义
4. gangtise ai knowledge-batch \
     --query "新能源" \
     --resource-type 10 --resource-type 60 --resource-type 70 \
     --format json
5. 提取 list[].title / resourceType / summary，编号列表呈现
```

## 例 9：未知公司名（走 securities-search）

**用户**："查蔚蓝生物的最新研报"

```
1. 路由 → insight research list；公司名不在速查表
2. 先调 reference securities-search：
     gangtise reference securities-search --keyword 蔚蓝生物 --category stock --top 3 --format json
   返回 list[0].gtsCode = "603739.SH"
3. 拼正式查询：
     gangtise insight research list --security 603739.SH --rank-type 2 \
       --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" --format json
```

## 例 10：异步任务（业绩点评）

**用户**："给贵州茅台写一份 2025Q3 业绩点评"

```
1. 路由 → ai earnings-review（异步）
2. 茅台 600519.SH；--period 2025q3
3. Pre-flight：异步任务，告知用户"提交后需等待，期间可以做别的"
4. gangtise ai earnings-review --security-code 600519.SH --period 2025q3 --format json
   → 返回 {dataId: "xxx"}
5. 等 30s-1min 后调 check：
     gangtise ai earnings-review-check --data-id xxx --format json
   - 若 {status: "pending"} → 再等再 check（最多 3 次）
   - 若 {date, content} → 取 content 呈现
   - 若 410111 → 终态失败，告知用户重试
```
