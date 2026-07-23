# 响应结构详细对照

CLI 自动处理 envelope：`{code, msg, data}` 信封会按 `code === "000000"` 解包，stdout 直接是 `data`。无 envelope 的响应原样透传。

> 例外：`indicator`（EDE）三个接口成功时**双层信封**（`data` 里再裹一层 `{code, status, data}`），内层字段名为 `securityCodeList/securityNameList/indicatorCodeList/indicatorNameList/dataTypes`，`values` 是 2D 矩阵（截面 `[指标][证券]`、时序 `[序列][日期]`）；无数据为 `null` 单元格。`indicator` 子命令已在客户端二次解包并拍平成宽表；但直接 `raw call indicator.*` 只会剥外层，需自行处理内层。

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
| quote realtime | `{fieldList, list, total}` 或规范化后 `{list: [{...}]}` | `securityCode` / `exchange` / `tradeDate` / `tradeTime` / `latestPrice` / `pctChange` / `volume` / `amount` / `amplitude` |
| quote fund-flow | `{fieldList, list, total}` 列式 → 规范化后 `{list: [{...}], total}` 宽表 | `securityCode` / `tradeDate` + 请求的字段（`mainNetInflow` / `largeInflow` / `xlargeOutflow` / …） |
| fundamental income-statement / balance-sheet / cash-flow（含 quarterly / -hk / -us） | `{total, list: [{...}]}` | `fiscalYear` / `period` / `endDate` / `companyName` / `companyType`（企业类型名称，如 `一般企业`/`银行`）+ 各 `--field` 字段；港股/美股另含 `timeCovered`（不规则跨度） |
| fundamental main-business | `{list: [{...}]}` | `endDate` / `breakdownName` / `revenue` / `revenueRatio` / `grossProfitRatio` |
| fundamental valuation-analysis（仅 A 股） | `{list: [{...}]}` | `tradeDate` / `value` / `percentileRank` |
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
| vault wechat-message-list | `{list, total}` | `list[].msgId` / `list[].msgContent` / `list[].msgTime` / `list[].wechatGroupName` / `list[].speakerName` / `list[].category` / `list[].tagList` |
| vault wechat-chatroom-list | `{list, total}` | `list[].chatroomName` / `list[].chatroomId` |
| alternative edb-search | `{list: [...]}` 指标列表 | `indicatorId` / `indicatorName` / `dataSource` / `frequency` / `unit` |
| alternative edb-data | 列表，每行 `{date, <indicatorId>: value, ...}` 宽表 | `date` + 每个 `--indicator-id` 一列（该日指标值） |
| alternative concept-info | `{conceptId, conceptName, ...}`（单对象，**非列表**） | `conceptName` / `definition` / `investmentLogic` / `industrySpace` / `competitiveLandscape` / `keyEvents[].date` / `keyEvents[].content`；文本字段未配置为 `null` |
| alternative concept-securities | `{conceptId, conceptName, securityCount, securityDetail}`（单对象，分组） | `securityCount` / `securityDetail[].groupName` / `securityDetail[].securityList[].securityCode` / `.securityName` / `.isKey` / `.inclusionReason`；无成分股时 `securityDetail` 为 `null` |
| indicator search | `[{indicatorCode, indicatorName, ...}]`（列表） | `indicatorCode` / `indicatorName` / `description` / `scopeList[].market` / `scopeList[].securityType` / `parameterList[].paramKey` / `.enumList[].value`（专属参数及枚举） / `score` |
| indicator cross-section | CLI 拍平为宽表 `{list, total}` | `list[].date` / `list[].security` / `list[].name` + 每个指标名一列；**单日多指标 × 多证券**，每行一只证券 |
| indicator time-series | CLI 拍平为宽表 `{list, total}` | `list[].date` + 序列列：单证券时列=各指标、多证券时列=各证券；每行一个日期 |
| lookup broker-org / meeting-org list | `[...]` | `[].id` / `[].name` |
