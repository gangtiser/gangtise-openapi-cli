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
1. 路由 → quote day-kline（2026-08-14 起一个命令覆盖 A/港/美股，跨市场可一次查完）
2. 比亚迪 A 股 002594.SZ，港股 01211.HK
   "最近" → K 线默认今日往前 45 天（保证含最近 10 个交易日）
3. Pre-flight：认证 OK
4. gangtise quote day-kline --security 002594.SZ --security 01211.HK --start-date 2026-03-19 --end-date 2026-05-03 --format json
5. 按 securityCode 分组，各自按 tradeDate 取尾部最近 10 个交易日
   注意：两地交易日历不同（A 股与港股假期不重合），同一日期未必两边都有行——按 securityCode 分组后再取尾部，别按行下标对齐
```

## 例 6：指数最近值（务必拉范围）

**用户**："查上证综指最近的指数"

```
1. 路由 → quote day-kline（指数已并入，index-day-kline 已下线）
2. 上证综指 → 000001.SH；"最近" → 今日往前 45 天
3. Pre-flight：认证 OK；今天若周末 end-date 仍填当天，API 返回最近交易日
4. gangtise quote day-kline --security 000001.SH --start-date 2026-03-19 --end-date 2026-05-03 --format json
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
   （第 4 步的 drive-list 已把标题写进 title-cache，省略 --output 即自动用真实标题做文件名）
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

## 例 15：多证券已实现财务 / 估值指标（EDE 多截面，按日期语义拆分）

**用户**："把茅台、五粮液、宁德时代 2025 年营收和已实现 EPS，与最新 PE/PB 做成一张表"

> 示例日期为**截至 2026-08-02 的实测快照**：`2026-07-31`=当时最新交易日。PE 与 PB 现在同为日频（`finc_pb_mrq` 2026-08-02 复测任意交易日都有数），实跑时替换为当下的最新交易日即可。

```
1. 路由 → indicator：多证券批量取一组已实现财务 / 估值指标；不是逐只 fundamental，也不是 EDB。
   若改成单票、盈利预测/一致预期、估值历史分位、完整报表或 OHLCV/K 线，则分别走 fundamental / quote 专用命令。
2. 每个概念都先 search --format json（绝不猜 code，也不能只取第一条）：
     gangtise indicator search --keyword 营业收入 --limit 10 --format json
     gangtise indicator search --keyword 基本每股收益 --limit 10 --format json
     gangtise indicator search --keyword 市盈率 --limit 10 --format json
     gangtise indicator search --keyword 市净率 --limit 10 --format json
   对每个候选同时核对：
   - indicatorName + description：累计/单季、营业收入/营业总收入、已实现/预测等语义准确
   - scopeList：覆盖全部三只 A 股；缺失/null/空也视为不通过
   - parameterList：补 required 参数并核对枚举
   任一不符 → 回退相应专用接口。
3. 两类指标日期语义不同 → 拆两次截面，均加 `--key-by code`（列头用 indicatorCode，跨表按 code 稳定合并、免受同名/服务端重排干扰；省略 reportType 即取合并口径，label 与取数已一致：1=合并 2=合并(调整) 3=母公司 4=母公司(调整)）：
   a) 财务（营收/EPS）用报告期末 2025-12-31：
     gangtise indicator cross-section \
       --indicator is_op_rev --indicator is_eps_bas \
       --security 600519.SH --security 000858.SZ --security 300750.SZ \
       --date 2025-12-31 --key-by code --format json
   b) 估值 PE + PB 同为日频，用同一个最新交易日即可（2026-08-02 复测 finc_pb_mrq
      在任意交易日都有数；用季末日期会拿到几个月前的陈值）。
      ⚠️ 要估值指标的历史序列做分位/回测，两个接口都拉一遍交叉核：EDE 按正式财报
      披露日切换财报口径，fundamental valuation-analysis 按业绩快报切，同一天取到
      的值可能不同（已验证 PE TTM；PB 是 MRQ 口径，规则未单独验证）。详见 indicator.md：
     gangtise indicator cross-section --indicator finc_pe_ttm --indicator finc_pb_mrq \
       --security 600519.SH --security 000858.SZ --security 300750.SZ \
       --date 2026-07-31 --key-by code --format json
4. 按 security 合并两张宽表（列头即 indicatorCode，各取所需日期的值）；不要把不同日期语义的指标塞进同一个 --date。
5. 计费：search 免费；两次取数各按请求单元格数量计费，每次不足 100 单元格按 100 计。
6. 无数据（无覆盖 / 非交易日 / 未来日期）一律保留行列并给占位单元格，退出码 0——占位值统一是 null（见 commands/indicator.md）；⚠️ 报告期类指标（is_*）的时序只有报告期末那几行是真值，别对整列手工求均值。代码写错或参数名写错则直接报 100003 并点名是哪个（指标码拼错、证券后缀错如美股写成 .US、参数名写错、同 code 重复配置），按报错改即可。
```

## 例 15b：帕米尔专家纪要（新库，筛选项与踩坑都和 summary 不同）

**用户**："看看帕米尔最近有什么 PCB 相关的纪要" / "帕米尔纪要下载一篇"

```
1. 确认走的是帕米尔而不是普通纪要——两者是不同的库，pamirs 需单独购买专家纪要数据库。
   用户没点名"帕米尔/Pamirs"就走 insight summary。
2. 检索（全文 + 按相关度）：
     gangtise insight pamirs-summary list --keyword PCB --search-type 2 --rank-type 1 \
       --size 20 --format json
   - --search-type 2 = 全文（标题搜索是 1，命中少很多：PCB 标题 36 / 全文 113）
   - --rank-type 1 在有 keyword 时按相关度挑条目；要最新就用 2。差别多大取决于关键词本身，
     --search-type 不影响 rank-type 1 挑哪些条目（这里加 2 是为了扩大命中面，不是为了排序）
   - 筛选项比 summary 少：没有 --source / --institution / --participant-role
3. 🔴 别拉全量再本地按类别/市场分组——服务端只在你用该字段过滤时才回填标签：
   不带 --category 查，categoryList 100% 是空数组；conceptList 任何查法都是空。
   要分组就让服务端筛：
     gangtise insight pamirs-summary list --category industryAnalysis --market aShares --size 50
4. 下载（省略 --output 自动用标题命名）：
     gangtise insight pamirs-summary download --summary-id 5863771 --file-type 2
     → PCB钻针：高端钻针扩产有壁垒，供需紧缺会持续到28年.html
   --file-type 只有 1（原始）/ 2（HTML）两种
5. 数据范围不限历史；单价未公布，大批量前先小量试。
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

## 例 18：财报日历（本周谁发业绩预告）

**用户**："这周 A 股有哪些业绩预告"

```
1. 路由 → insight performance-calendar list（不是 announcement——预告/快报/公告事件走财报日历）
2. ⚠️ 本命令用 --start-date/--end-date（yyyy-MM-dd，过滤 publishDate），不是其余 insight list 的 --start-time
   "这周" → 本周一至今天
3. Pre-flight：不加筛选 total 十万量级（含未来排期）→ 必须带日期范围；0.1 积分/条，先 --size 探量
4. gangtise insight performance-calendar list \
     --start-date 2026-07-20 --end-date 2026-07-25 \
     --market aShares --category performanceForecast \
     --size 50 --format json
   → list[].securityName / title / publishDate / performanceReportId / hasAttachment
5. 用户要原文时：只有 hasAttachment: true 能下（A股 10 积分/篇）
   gangtise insight performance-calendar download --performance-report-id 33753017 --output ./预告.pdf
```

## 例 19：外部 PDF 转 Markdown（异步文件解析）

**用户**："把这份 PDF 转成 Markdown 我要读正文"

```
1. 先判断来源：平台自有研报/公告 → 直接 download --file-type 2 出 Markdown（只花下载积分），不要走解析
   外部 PDF（用户自己的文件）→ tool file-parse
2. Pre-flight：🔴 按页计费 0.8/页、提交即扣——先看页数估积分（50 页 = 40 积分）告知用户
   本地限制 CLI 会先校验：.pdf 后缀 / 非空 / ≤100MB
3. gangtise tool file-parse --file ./x.pdf --wait --output ./x.zip
   （--wait 内部轮询 ≈316s；外层工具超时设 ≥360s。不带 --wait 则拿 taskId，稍后
     gangtise tool file-parse-check --task-id <id> --output ./x.zip——取结果免费）
4. unzip 后读 file.md（图片在 images/）；正文长先 wc -l / head 采样再呈现
5. 超时不要重跑 file-parse（会重复扣费），用 file-parse-check 拿同一个 taskId 的结果
```
