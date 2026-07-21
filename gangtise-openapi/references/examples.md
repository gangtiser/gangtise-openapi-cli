# 典型执行示例

每个示例展示从用户语句到完整命令的全流程。Skill 主文件不再内嵌示例；遇到不确定的场景时来这里查同类。

---

## 例 1：研报检索 ＋ 下载（list→download 多步编排）

**用户**："下载中金最近的宏观策略研报"

```
1. 路由 → insight research list + download
2. 中金 → C100000026（references/lookup-ids.md 速查）
   "宏观策略" → 研报分类 --category macro + strategy（research list 无 --research-area）
   "最近" → 默认 7 天
3. Pre-flight：
   - 认证 OK
   - 结果可能 >200 条 → 🔴 询问"先看前 20 还是导出全量？"
   - 下载格式 → 🔴 询问 PDF 还是 Markdown
4. gangtise insight research list \
     --broker C100000026 \
     --category macro --category strategy \
     --start-time "2026-04-08 00:00:00" --end-time "2026-04-15 23:59:59" \
     --rank-type 2 --format json
   （选"导出全量"分支：改 `--format jsonl --output cicc_macro.jsonl` 落盘，再 `wc -l` / `head` 采样，别把全量塞进上下文）
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
3. Pre-flight：首次生成常 >30s → 前置 `GANGTISE_TIMEOUT_MS=120000` 防超时重试；告知用户"生成中..."
4. GANGTISE_TIMEOUT_MS=120000 gangtise ai one-pager --security-code 002594.SZ --format json
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

## 例 10：实时行情（盘中快照，跨市场）

**用户**："茅台、腾讯、苹果现在的最新价"

```
1. 路由 → quote realtime（A/港/美都走同一个接口）
2. 茅台 600519.SH（速查表）/ 腾讯 00700.HK（速查表）/ 苹果 AAPL.O
3. Pre-flight：用户只关心几个核心字段 → 用 --field 精简返回
4. gangtise quote realtime \
     --security 600519.SH --security 00700.HK --security AAPL.O \
     --field securityCode --field tradeTime --field latestPrice --field pctChange --field volume \
     --format json
5. 返回最新时刻快照；非交易时间返回最近一个交易日的收盘快照
   注意：日 K 线（day-kline）不返回盘中数据，问"现在/此刻"必须走 realtime
```

## 例 11：美股日 K 线（历史）

**用户**："苹果过去一个月的日 K 线"

```
1. 路由 → quote day-kline-us（仅历史；盘中数据走 realtime）
2. 苹果 AAPL.O；"过去一个月" → 今日往前 30 天
3. Pre-flight：认证 OK；当日数据约 07:00（北京时间）入库
4. gangtise quote day-kline-us --security AAPL.O \
     --start-date 2026-04-22 --end-date 2026-05-22 \
     --field tradeDate --field open --field close --field volume --field pctChange --format json
5. 按 tradeDate 排序展示
```

## 例 12：异步任务（业绩点评）

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
   - 若 410111（新码 140002）→ 终态失败，**不要重提同一任务**（会再扣 50 积分且结果相同）；改参数后再提交，或直接告知用户该期数据暂不可用
```

## 例 13：题材画像 ＋ 成分股（先查 ID 再拉两接口）

**用户**："机器人这个题材现在的逻辑和龙头股"

```
1. 路由 → alternative concept-info（投资逻辑/行业空间/竞争格局）
          + alternative concept-securities（成分股，按分组）
2. "机器人" → concept-id：题材与主题共用 ID 体系，用 concept-search 查
     gangtise reference concept-search --keyword 机器人 --top 5 --format json
       → list[0].conceptId = 121000130
   注意：concept-id 不在速查表，**绝不猜测**，必须查 concept-search
3. Pre-flight：认证 OK；两接口都仅返回最新截面，无历史回溯
4. gangtise alternative concept-info --concept-id 121000130 --format json
     → 单对象 {conceptName, definition, investmentLogic, industrySpace,
              competitiveLandscape, keyEvents:[{date,content}]}
   gangtise alternative concept-securities --concept-id 121000130 --format json
     → 单对象 {securityCount, securityDetail:[{groupName, securityList:[...]}]}
5. 呈现：concept-info 各文本字段直接展示（含 null 则跳过）；
   成分股按 groupName 分组列出，isKey=true 标记为「重点」
```

## 例 14：板块成分股（sector-search → sector-constituents 两步）

**用户**："半导体设备板块现在有哪些股票"

```
1. 路由 → reference sector-search + sector-constituents
   （用户要的是板块名单，不是题材深度 F8 → 不走 alternative concept-securities）
2. gangtise reference sector-search --keyword 半导体设备 --top 5 --format json
     → 同名板块可能出现在多个层级，用 hierarchy 区分：
       中国内地股票-概念类-科技-半导体设备 → sectorId 1000001005
3. gangtise reference sector-constituents --sector-id 1000001005 --format json
     → {total: 59, list: [{gtsCode, gtsName}, ...]}
4. 陷阱：sectorId 必须来自 sector-search；拿题材 conceptId（如 121000130）来查会返回 0 条
5. 呈现：total + 前 20 只列表
```

## 例 15：指标取数（search → cross-section / time-series）

**用户**："茅台和泡泡玛特上周的收盘价、成交量对比一下"

```
1. 路由 → indicator（证券级指标，需证券代码 → EDE，不是 alternative edb）
2. 先拿 indicatorCode（绝不猜）：
     gangtise indicator search --keyword 收盘价 --format table   → qte_close
     gangtise indicator search --keyword 成交量 --format table   → qte_vol
3. 取数二选一：
   - 单日横向对比 → cross-section（多指标 × 多证券）：
       gangtise indicator cross-section \
         --indicator qte_close --indicator qte_vol \
         --security 600519.SH --security 09992.HK \
         --date 2026-05-22 --format table
       → 每行一只证券，列 = date/security/name/日收盘价/成交量
   - 一段区间走势 → time-series（这里两只证券 → 只能单指标 × 多证券）：
       gangtise indicator time-series --indicator qte_close \
         --security 600519.SH --security 09992.HK \
         --start-date 2026-05-18 --end-date 2026-05-22 --format table
       → 每行一个日期，列 = date/贵州茅台/泡泡玛特
4. 复权：要前复权收盘价加 --indicator-param "qte_close:adjustmentType=2"
   （参数 key 以 indicator search --format json 的 parameterList 为准）
5. 陷阱：time-series 不能多指标 × 多证券同时（报 410001），那种情况用 cross-section
6. 必填参数：很多指标默认调用会缺参报错（服务端指明缺哪个，如「必填参数 periodNum 不能为空」）→ 先看 parameterList 的 required，补
   periodNum（N期统计）/startDate（区间周期类，如 qte_amp_mo）/fiscalYear（年度分红）：
     gangtise indicator cross-section --indicator finc_roe_avg_avg --security 600519.SH \
       --date 2026-03-31 --indicator-param "finc_roe_avg_avg:periodNum=4"
7. 无数据：截面/时序对无此科目的**格**返回 null（不丢行）；**整个查询无数据**（节假日/未来日期/未覆盖标的）
   仍报 999999+HTTP 500，CLI 不重试并提示检查条件 → 财务用报告期末、现金流附注用年报
   日期(2025-12-31)、行情用交易日；银行/券商/保险科目不同，换对公司类型。详见 commands/indicator.md
```

## 例 16：A 股资金流向（个股 vs 全市场按日分片）

**用户**："看下宁德时代最近一个月的主力资金净流入" / "拉今天全 A 股的资金流向"

```
1. 路由 → quote fund-flow（A 股日频资金流向，免费；仅历史，约 16:30 入库）
2. 个股：宁德时代 300750.SZ；"最近一个月" → 今日往前 30 天
   gangtise quote fund-flow --security 300750.SZ \
     --start-date 2026-06-06 --end-date 2026-07-06 \
     --field tradeDate --field mainNetInflow --field mainInflowRatio --format json
   → 主力 = 大单 + 特大单；字段族 {small|medium|large|xlarge}{Inflow|Outflow|NetInflow|InflowRatio}
   单只无翻页：撞 --limit（默认 6000/上限 10000）会标 partial + 退出码 3 → 缩小日期区间
3. 全市场：--security aShares
   ⚠️ aShares 必须显式传 --start-date/--end-date（缺日期本地报错；否则单请求被服务端 430012 拒）
   单日约 5500 行，CLI 按日自动分片并发合并、无需手动分批（宽区间落盘再采样）：
   gangtise quote fund-flow --security aShares \
     --start-date 2026-07-06 --end-date 2026-07-06 --format jsonl --output aShares_flow.jsonl
```

## 例 17：机构 ID 搜索（名称 → institutionId，喂给 --broker/--institution）

**用户**："查渤海证券最近的研报"

```
1. 机构名不在速查表、要按机构筛选 → 先 reference institution-search 拿 ID（免费，搜索型 top≤10，绝不猜 ID）
2. gangtise reference institution-search --keyword 渤海证券 --format json
   → list[0] = {institutionId: "C100000001", institutionName, usageScopes:[...]}
   usageScopes 直接标明这个 ID 用于哪个命令的哪个参数（省去猜 --broker 还是 --institution）
   可选 --category 缩类：domesticBroker / foreignInstitution / leadInstitution / opinionInstitution / foreignOpinionInstitution
3. 研报按券商筛选走 --broker：
   gangtise insight research list --broker C100000001 --rank-type 2 \
     --start-time "2026-06-06 00:00:00" --end-time "2026-07-06 23:59:59" --format json
4. 只有要「全量枚举」券商/机构表时才用本地 lookup broker-org/meeting-org list（institution-search 是搜索、非全量）
```
