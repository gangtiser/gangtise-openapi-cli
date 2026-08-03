# 响应结构详细对照

CLI 自动处理 envelope：`{code, msg, data}` 信封会按 `code === "000000"` 解包，stdout 直接是 `data`。无 envelope 的响应原样透传。

> 例外：`indicator`（EDE）四个接口（`search` / `cross-section` / `time-series` / `screener`）成功时**双层信封**（`data` 里再裹一层 `{code, status, data}`）。内层字段名 2026-08-01 起为 `securityCodeList` / `securityNameList` / `indicatorList[{code,name,dataType}]`（screener 另带 `field`），`values` 是 2D 矩阵：**截面与 screener 为 `[证券][指标]`**（该版转置过，此前是 `[指标][证券]`）、时序仍为 `[序列][日期]`。
>
> 缺数据分三档：**部分**缺 → 单元格 `null`；某指标对所有证券都无数据 → 该指标**整列**从 `indicatorList` 消失；某证券对所有指标都无数据 → 该证券**整行**从 `securityCodeList` 消失；整查询无数据 → 全空数组。CLI 的 `indicator` 子命令已二次解包、拍平成宽表，并在整列/整行被略过时标 `partial` + `omittedIndicators`/`omittedSecurities` + 退出码 3。**`screener` 例外**：把缺列的变量当作无法求值，按表达式的**布尔结构**判断是否还有分支能成立（`A && B` 要两边、`A || B` 只要一边）。一条都不剩 → **退出码 1 且不输出**（那些行以「通过了该条件」的名义呈现，而条件根本无法证明被执行过）；仍有分支可求值、或缺的只是输出用的辅助变量 → `partial` + 退出码 3。重复绑定同一指标另标 `unreliable` + `duplicatedIndicators` + 退出码 3；直接 `raw call indicator.*` 只会剥外层，内层与缺数据形态需自行处理。

## 通用模式（5 类）

| 模式 | 结构 | 提取方式 |
|------|------|---------|
| 列表 | `{list: [...], total: N}` | 遍历 `list[]`；`total` 决定是否还有更多 |
| 下载 | stdout = 文件路径字符串 | 直接读取整行 |
| AI 内容 | `{content: "markdown文本"}` | 直接呈现 `content` |
| 列式 K 线 | `{fieldList: [...], list: [[...], ...]}` 或 `{list: [{...}]}` | CLI 已规范化为对象 list |
| 异步任务 | 提交：`{dataId}`；轮询：`{status:"pending"}` 或 `{date, content}` | 详见 `commands/ai.md` |

## 全命令字段对照

| 命令 | data 结构 | 关键提取字段 |
|------|----------|------------|
| insight opinion list | `{list, total}` | `list[].id` / `list[].title` / `list[].publishDate` / `list[].chiefName` / `list[].securityCode` / `list[].institutionName` |
| insight summary list | `{list, total}` | `list[].summaryId` / `list[].title` / `list[].publishTime` |
| insight summary download | 文件路径（stdout） | — |
| insight roadshow / site-visit / strategy / forum list | `{list, total}` | `list[].id` / `list[].title` / `list[].publishTime` / `list[].institution.institutionName` |
| insight research list | `{list, total}` | `list[].reportId` / `list[].title` / `list[].brief`（全文摘要） / `list[].publishTime` / `list[].publisher.brokerName` / `list[].securityList[].rating` |
| insight research download | 文件路径（stdout） | — |
| insight foreign-report list | `{list, total}` | `list[].reportId` / `list[].title` / `list[].titleTranslate` / `list[].brief` / `list[].briefTranslate`（中译全文摘要） / `list[].publishTime` / `list[].publisher.brokerName` |
| insight foreign-report download | 文件路径（stdout） | — |
| insight announcement list | `{list, total}` | `list[].announcementId` / `list[].title` / `list[].publishTime` / `list[].securityCode` |
| insight announcement download | 文件路径（stdout） | — |
| insight announcement-hk list | `{list, total}` | `list[].announcementId` / `list[].title` / `list[].titleTranslate` / `list[].publishTime` / `list[].securityCode` / `list[].primaryCategory.categoryName` |
| insight announcement-hk download | 文件路径（stdout） | — |
| insight announcement-us list | `{list, total}` | `list[].announcementId` / `list[].title` / `list[].publishTime` / `list[].securityList[].securityCode` / `list[].primaryCategory.categoryName` / `list[].sourceName` |
| insight announcement-us download | 文件路径（stdout） | — |
| insight foreign-opinion list | `{list, total}` | `list[].foreignOpinionId` / `list[].titleTranslate` / `list[].publishTime` / `list[].publisher.brokerName` / `list[].securityList[].rating` |
| insight independent-opinion list | `{list, total}` | `list[].independentOpinionId` / `list[].titleTranslate` / `list[].briefTranslate` / `list[].publishTime` / `list[].analyst.analystName` |
| insight independent-opinion download | 文件路径（stdout） | — |
| insight official-account list | `{list, total}` | `list[].articleId` / `list[].accountName` / `list[].title` / `list[].publishTime` / `list[].articleCategory` / `list[].summary` / `list[].industryList[].industryName` / `list[].conceptList[].conceptName` / `list[].securityList[].securityCode` |
| insight official-account download | 文件路径（stdout） | — |
| insight qa list | `{list, total}` | `list[].source`（conference/interactive/survey）/ `list[].publishTime` / `list[].question` / `list[].answer` / `list[].member` / `list[].securityCode` / `list[].questionCategory[]` / `list[].answerImportant`（1/0） |
| insight performance-calendar list | `{list, total}` | `list[].performanceReportId`（下载用）/ `list[].securityCodeList[]`（A+H 可能多个）/ `list[].securityName` / `list[].category`（performanceForecast/performanceExpress/performanceAnnouncement）/ `list[].publishDate`（实测带 ` 00:00:00` 后缀）/ `list[].title` / `list[].hasAttachment`（`false` 则无法下载） |
| insight performance-calendar download | 文件路径（stdout，PDF） | — |
| tool file-parse | `{taskId, status:"pending", hint}`（提交）；`--wait` 或 `file-parse-check` 就绪后 = 文件路径（stdout，ZIP） | ZIP 内 `file.md` + `images/`；未就绪时 check 输出 `{taskId, status:"pending"}`（退出码 0） |
| insight report-image list | `[{...}]`（扁平数组，无 `total`） | `[].chunkId`（下载用 `--chunk-id`）/ `[].title` / `[].sourceId` / `[].broker` / `[].category` / `[].page` / `[].totalPages` / `[].imageCaption[]` / `[].imageFootnote[]` / `[].pageContent`（该页 OCR/描述） |
| insight report-image download | 文件路径（stdout，JPEG） | — |
| reference securities-search | `{returnedCount, list}` | `list[].gtsCode` / `list[].gtsName` / `list[].category` / `list[].matchScore` / `list[].matchType` |
| reference chiefs-search | `{returnedCount, list}` | `list[].chiefId` / `list[].chiefName` / `list[].institution` / `list[].team` / `list[].matchScore` |
| reference institution-search | `{returnedCount, list}` | `list[].institutionId` / `list[].institutionName` / `list[].category` / `list[].usageScopes[{apiName, paramName}]` / `list[].matchScore` |
| reference official-account-search | `{returnedCount, list}` | `list[].accountId`（喂 `insight official-account list --account-id`）/ `list[].accountName` / `list[].category`（四类或 `null`）/ `list[].matchScore` |
| reference constant-category | `{total, list}` | `list[].category` / `list[].categoryName` / `list[].structureType`（flat/tree） / `list[].maxLevel` / `list[].usageScopes[].apiName` / `.paramName` |
| reference constant-list | `{category, structureType, maxLevel, constantCount, list}`（CLI 把 `constants` 规范化为 `list`） | `list[].constantId` / `list[].constantName` / `list[].level`；树形分类父节点含 `list[].children[]`（递归同构） |
| reference concept-search | `{returnedCount, list}` | `list[].conceptId` / `list[].conceptName` / `list[].matchScore` |
| reference sector-search | `{returnedCount, list}` | `list[].sectorId` / `list[].sectorName` / `list[].hierarchy`（层级路径） / `list[].matchScore` |
| reference sector-constituents | `{total, list}` | `list[].gtsCode` / `list[].gtsName`；total=0 说明 sectorId 不对（先 sector-search 确认） |
| quote day-kline / day-kline-hk / day-kline-us / index-day-kline | `{fieldList, list}` 或规范化后 `{list: [{...}]}` | `tradeDate` / `securityCode` / `open` / `close` / `pctChange` / `volume`；index 另含 `securityName`（指数名称，v0.15.0 起） |
| quote minute-kline | `{list: [{...}]}` | `tradeTime` / `open` / `close` / `volume` |
| quote realtime | `{fieldList, list, total}` 或规范化后 `{list: [{...}]}` | `securityCode` / `exchange` / `tradeDate` / `tradeTime` / `open` / `high` / `low` / `latestPrice` / `preClose` / `change` / `pctChange` / `volume` / `amount` / `turnoverRate` / `amplitude` / `volumeRatio`（共 16 个，**无 `close`、无市值**） |
| quote fund-flow | `{fieldList, list, total}` 列式 → 规范化后 `{list: [{...}], total}` 宽表 | `securityCode` / `tradeDate` + 请求的字段（`mainNetInflow` / `largeInflow` / `xlargeOutflow` / …） |
| fundamental income-statement / balance-sheet / cash-flow（含 quarterly / -hk / -us） | `{total, list: [{...}]}` | `fiscalYear` / `period` / `endDate` / `companyName` / `companyType` / `currency` / `unit` + 各 `--field` 字段；港股/美股另含 `timeCovered`（不规则跨度）。⚠️ **A 股累计口径的 `balance-sheet` / `cash-flow` 两个命令**，`companyType` 与 `currency` 的值是互换的（实测 2026-07-24：`companyType=人民币`、`currency=银行`/`一般企业`；A 股 `income-statement` 正确，港股/美股三表均正确）；A 股 `*-quarterly` 单季表则是 `companyType` 返回未映射的数字码（如 `102119999`）、`currency` 正确。读这两列按**值**判断语义，别按列名；科目数字不受影响 |
| fundamental main-business | `{fieldList, list}` 列式 → 规范化后 `{list: [{...}]}` | 前 3 列恒定：`periodName` / `periodEndDate` / `categoryName`（分项名，随 `--breakdown` 变）+ `opRevenue` / `opRevenueYoy` / `opRevenueRatio` / `opCost` / `opCostYoy` / `opCostRatio` / `grossProfit` / `grossProfitYoy` / `grossProfitRatio` / `grossMargin` / `grossMarginYoy` / `grossMarginRatio`（共 15 个，实测 2026-07-24）。`--field` 只能从后 12 个里选 |
| fundamental valuation-analysis（仅 A 股） | `{fieldList, list}` 列式 → 规范化后 `{list: [{...}]}` | `tradeDate` / `value` / `percentileRank` / `average` / `median` / `upper1Std` / `lower1Std`（共 7 个，实测 2026-07-24）；**无 `securityCode`**——误传会拿到一列重复的 `tradeDate` |
| fundamental earning-forecast（仅 A 股） | `{securityCode, securityName, updateList: [...]}` | `updateList[].date` / `updateList[].fieldList[].forecastYear` + 各 consensus 指标 |
| fundamental top-holders | `{holderType, list: [{...}]}` | `reportPeriod` / `rank` / `shareholderName` / `holdingNum` / `holdingPct` / `chgNum` / `chgPct` |
| ai knowledge-batch | `{list: [{...}]}` | `list[].resourceType` / `list[].sourceId` / `list[].title` / `list[].summary` |
| ai security-clue | `{list, total}` | `list[].securityCode` / `list[].title` / `list[].clueType` / `list[].clueDate` |
| ai stock-summary | `{list, total}` | `list[].securityCode` / `list[].securityName` / `list[].summary` / `list[].date`；无看点的证券不在 list 中 |
| ai one-pager / investment-logic / peer-comparison / research-outline | `{content}` | `content` 直接呈现（Markdown） |
| ai theme-tracking | `[{type, date, content}, ...]`（列表，每元素一份报告） | 遍历筛选 `type === "morning" / "night"`；某主题在该日期可能只有一种类型，或两种都没（空列表） |
| ai hot-topic | `{list, total}` | `list[].title` / `list[].reportDate` / `list[].category` / `list[].topics[].topicTitle` / `list[].topics[].driverEvent` / `list[].topics[].investLogic` |
| ai management-discuss-* | `{securityCode, reportDate, discussionDimension, content}` | `content` 为字符串（业绩会）或字符串数组（财报） |
| ai earnings-review | `{dataId}`（提交）/ `{status:"pending"}` 或 `{date, content}`（check） | `dataId` 用于轮询；最终 `content` 直接呈现 |
| ai viewpoint-debate | 同 earnings-review | — |
| vault drive-list | `{list, total}` | `list[].fileId`（下载用 `--file-id`）/ `list[].title` / `list[].fileType` / `list[].uploadTime` |
| vault drive-download | 文件路径（stdout） | — |
| vault record-list | `{list, total}` | `list[].recordId` / `list[].title` / `list[].category` / `list[].createTime` / `list[].recordDuration` |
| vault record-download | 文件路径（stdout） | — |
| vault my-conference-list | `{list, total}` | `list[].conferenceId` / `list[].title` / `list[].category` / `list[].institution.institutionName` / `list[].publishTime` |
| vault my-conference-download | 文件路径（stdout） | — |
| vault wechat-message-list | `{list, total}` | `list[].msgId` / `list[].content`（正文）/ `list[].url` / `list[].msgTime` / `list[].wechatGroupName` / `list[].speakerName` / `list[].category` / `list[].tagList[].tagCode` / `list[].securityList[].securityCode` / `list[].quoteMsg.quoteContent`（引用消息，无引用为 `null`）。**不是 `msgContent`/`contentUrl`**（旧文档笔误，实测 2026-07-25） |
| vault wechat-chatroom-list | `{list, total}` | `list[].chatroomName` / `list[].chatroomId` |
| alternative edb-search | `{list: [...]}` 指标列表 | `indicatorId` / `indicatorName` / `dataSource` / `frequency` / `unit` |
| alternative edb-data | 列表，每行 `{date, <indicatorId>: value, ...}` 宽表 | `date` + 每个 `--indicator-id` 一列（该日指标值） |
| alternative concept-info | `{conceptId, conceptName, ...}`（单对象，**非列表**） | `conceptName` / `definition` / `investmentLogic` / `industrySpace` / `competitiveLandscape` / `keyEvents[].date` / `keyEvents[].content`；文本字段未配置为 `null` |
| alternative concept-securities | `{conceptId, conceptName, securityCount, securityDetail}`（单对象，分组） | `securityCount` / `securityDetail[].groupName` / `securityDetail[].securityList[].securityCode` / `.securityName` / `.isKey` / `.inclusionReason`；无成分股时 `securityDetail` 为 `null` |
| indicator search | `[{indicatorCode, indicatorName, ...}]`（列表） | `indicatorCode` / `indicatorName` / `description` / `scopeList[].market` / `scopeList[].securityType` / `scopeList[].usageRestriction`（接口限制，`null`=无限制） / `parameterList[].paramKey`（**参数名以此为准**） / `.enumList[].value` / `score` |
| indicator cross-section | CLI 拍平为宽表 `{list, total}` | `list[].security` / `list[].name` + 每个指标名一列；**单日多指标 × 多证券**，每行一只证券。**v0.30.0 起没有 `date` 列**（查询日期改挂在每个指标的参数上，各列可为不同日期）；原始响应的 `values` 为 `[证券][指标]`（2026-08-01 转置） |
| indicator time-series | CLI 拍平为宽表 `{list, total}` | `list[].date` + 序列列：单证券时列=各指标、多证券时列=各证券；每行一个日期。原始响应 `values` 仍为 `[序列][日期]` |
| indicator screener | CLI 拍平为宽表 `{list, total}` | 同 `cross-section`：`list[].security` / `list[].name` + 每个指标名一列，每行一只**命中**的证券；无命中返回空表。原始响应的 `indicatorList[]` 多一个 `field`（F1/F2…），CLI 用它给同 code 的重复列去重 |
| lookup broker-org / meeting-org list | `[...]` | `[].id` / `[].name` |
