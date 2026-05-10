# 响应结构详细对照

CLI 自动处理 envelope：`{code, msg, data}` 信封会按 `code === "000000"` 解包，stdout 直接是 `data`。无 envelope 的响应原样透传。

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
| insight research list | `{list, total}` | `list[].reportId` / `list[].title` / `list[].publishDate` / `list[].brokerName` / `list[].rating` |
| insight research download | 文件路径（stdout） | — |
| insight foreign-report list | `{list, total}` | `list[].reportId` / `list[].title` / `list[].publishDate` / `list[].brokerName` |
| insight foreign-report download | 文件路径（stdout） | — |
| insight announcement list | `{list, total}` | `list[].announcementId` / `list[].title` / `list[].publishTime` / `list[].securityCode` |
| insight announcement download | 文件路径（stdout） | — |
| insight announcement-hk list | `{list, total}` | `list[].announcementId` / `list[].title` / `list[].titleTranslate` / `list[].publishTime` / `list[].securityCode` / `list[].primaryCategory.categoryName` |
| insight announcement-hk download | 文件路径（stdout） | — |
| insight foreign-opinion list | `{list, total}` | `list[].foreignOpinionId` / `list[].titleTranslate` / `list[].publishTime` / `list[].publisher.brokerName` / `list[].securityList[].rating` |
| insight independent-opinion list | `{list, total}` | `list[].independentOpinionId` / `list[].titleTranslate` / `list[].briefTranslate` / `list[].publishTime` / `list[].analyst.analystName` |
| insight independent-opinion download | 文件路径（stdout） | — |
| reference securities-search | `{returnedCount, list}` | `list[].gtsCode` / `list[].gtsName` / `list[].category` / `list[].matchScore` / `list[].matchType` |
| quote day-kline / day-kline-hk / index-day-kline | `{fieldList, list}` 或规范化后 `{list: [{...}]}` | `tradeDate` / `securityCode` / `open` / `close` / `pctChange` / `volume` |
| quote minute-kline | `{list: [{...}]}` | `tradeTime` / `open` / `close` / `volume` |
| fundamental income-statement / balance-sheet / cash-flow（含 quarterly） | `{list: [{...}]}` | `fiscalYear` / `period` / `endDate` + 各 `--field` 字段 |
| fundamental main-business | `{list: [{...}]}` | `endDate` / `breakdownName` / `revenue` / `revenueRatio` / `grossProfitRatio` |
| fundamental valuation-analysis | `{list: [{...}]}` | `tradeDate` / `value` / `percentileRank` |
| fundamental earning-forecast | `{securityCode, securityName, updateList: [...]}` | `updateList[].date` / `updateList[].fieldList[].forecastYear` + 各 consensus 指标 |
| fundamental top-holders | `{holderType, list: [{...}]}` | `reportPeriod` / `rank` / `shareholderName` / `holdingNum` / `holdingPct` / `chgNum` / `chgPct` |
| ai knowledge-batch | `{list: [{...}]}` | `list[].resourceType` / `list[].sourceId` / `list[].title` / `list[].summary` |
| ai security-clue | `{list, total}` | `list[].securityCode` / `list[].title` / `list[].clueType` / `list[].clueDate` |
| ai one-pager / investment-logic / peer-comparison / research-outline | `{content}` | `content` 直接呈现（Markdown） |
| ai theme-tracking | `{morningReport: {...}, nightReport: {...}}` | 按 `--type` 取对应报告 |
| ai hot-topic | `{list, total}` | `list[].title` / `list[].reportDate` / `list[].category` / `list[].topics[].topicTitle` / `list[].topics[].driverEvent` / `list[].topics[].investLogic` |
| ai management-discuss-* | `{securityCode, reportDate, discussionDimension, content}` | `content` 为字符串（业绩会）或字符串数组（财报） |
| ai earnings-review | `{dataId}`（提交）/ `{status:"pending"}` 或 `{date, content}`（check） | `dataId` 用于轮询；最终 `content` 直接呈现 |
| ai viewpoint-debate | 同 earnings-review | — |
| vault drive-list | `{list, total}` | `list[].id` / `list[].title` / `list[].fileType` / `list[].uploadTime` |
| vault drive-download | 文件路径（stdout） | — |
| vault record-list | `{list, total}` | `list[].recordId` / `list[].title` / `list[].category` / `list[].createTime` / `list[].recordDuration` |
| vault record-download | 文件路径（stdout） | — |
| vault my-conference-list | `{list, total}` | `list[].conferenceId` / `list[].title` / `list[].category` / `list[].institution.institutionName` / `list[].publishTime` |
| vault my-conference-download | 文件路径（stdout） | — |
| vault wechat-message-list | `{list, total}` | `list[].msgId` / `list[].msgContent` / `list[].msgTime` / `list[].wechatGroupName` / `list[].speakerName` / `list[].category` / `list[].tagList` |
| vault wechat-chatroom-list | `{chatRoomList: [...]}` | `chatRoomList[].chatroomName` / `chatRoomList[].chatroomId` |
| lookup *.list | `[...]` | `[].id` / `[].name` |
