# Vault 命令详细参数（私域数据）

通用：`--keyword` `--start-time` `--end-time` `--from` `--size`（list 类）。

---

## AI 云盘 `vault drive-list/download`

```bash
gangtise vault drive-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault drive-download --file-id <id> [--output <path>]
```

- `--file-type`：`1` 文档（含 PDF/Word/PPT）| `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 租户云盘

## 录音速记 `vault record-list/download`

```bash
gangtise vault record-list [--keyword <text>] [--category <name>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault record-download --record-id <id> --content-type <type> [--output <path>]
```

- `--category`：`upload` | `link` | `mobile` | `gtNote` | `pc` | `share`（可重复）
- `--space-type`：`1` 我的速记 | `2` 租户速记
- `--content-type`（download **必选**）：`original` 原始文件 | `asr` 语音识别 | `summary` AI 速记
  - 口语映射：「原始文件/原文件」→`original`、「语音识别/转写文本/ASR」→`asr`、「AI速记/智能摘要/会议纪要」→`summary`
  - 「与我分享」类型录音无法下载原始文件
- 返回字段：`recordId` / `title` / `createTime` / `category` / `recordDuration`（秒） / `recordSize`（Byte）/ `url` / `spaceType` / `uploader`

## 我的会议 `vault my-conference-list/download`

```bash
gangtise vault my-conference-list [--keyword <text>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--source <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault my-conference-download --conference-id <id> --content-type <type> [--output <path>]
```

- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`（可重复）
- `--source`：录制来源 `1`=企微会议助理 | `2`=会议服务微信群（可重复；不传返回全部）
- `--keyword` vs `--research-area`：用户说"关于AI的"用 `--keyword AI`；说"电子行业的会议"用 `--research-area 100800126`（行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`，**不要用申万码 `104xx0000`**——本端点传申万码一律返 0 且不报错，食饮 / 电子 / 医药三个行业交叉验证过，换中信码即正常过滤）
- `--content-type`（download **必选**）：`asr` 语音识别 | `summary` AI 速记
- 返回字段：`conferenceId` / `title` / `publishTime` / `category` / `institution{...}` / `security{...}` / `researchArea{...}` / `guest` / `sourceList`（录制来源，`1`/`2`）

## 群消息 `vault wechat-message-list`

```bash
gangtise vault wechat-message-list [--keyword <text>] [--security <code>] [--wechat-group-id <id>] [--industry <id>] [--category <type>] [--tag <tag>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
```

- 数据权限：仅用户已绑定并激活群消息助理、且助理已入群的群消息
- `--security`：按证券代码过滤（如 `000001.SZ`），可重复
- `--industry`：**只认中信码**（`1008001xx`，见 `reference constant-list --category citicIndustry`）。⚠️ 申万码（`104xx0000`）与任何不认识的值都报 `100005 枚举值非法`——**换中信码即可**。返回行里不含行业标签字段，过滤在服务端完成
- 🔴 **`--industry` 是收窄工具，不是全量召回**：行业标签由服务端标注，**同一条消息可能挂多个行业，也可能一个都没挂**。实测同一个关键词加上「本行业」过滤后，命中数掉到三到四成——**少掉的既有没打标签的，也有被标到相邻行业去的**（如半导体相关的消息在计算机 / 机械 / 通信下同样查得到）。所以「按行业筛出 N 条」不能读成「该行业只有 N 条」；要尽量全，用 `--keyword` 取回后本地判断，或把相邻行业码一起查再去重
- `--wechat-group-id`：先用 `vault wechat-chatroom-list` 查；可重复
- `--category`：`text` | `image` | `documents` | `url`（可重复）
- `--tag`：`roadShow` | `research` | `strategyMeeting` | `meetingSummary` | `industryComment` | `companyComment` | `earningsReview`（可重复）
- 返回字段（实测 2026-07-25）：`msgId` / **`content`**（正文）/ **`url`**（链接）/ `msgTime` / `wechatGroupId` / `wechatGroupName` / `speakerName` / `category` / `tagList[]{tagCode, tagName}` / `securityList[]{securityCode, securityName}` / `quoteMsg{quoteMsgId, quoteContent, quoteUrl}`。正文取 `content`、链接取 `url`（不是 `msgContent` / `contentUrl`）
- `quoteMsg`（2026-07-24 新增）：被引用的消息，无引用时为 `null`；`quoteContent` / `quoteUrl` 也可能为空。做上下文还原时用它把「回复」接回原消息
- 未打标签/未关联证券的消息，`tagList` / `securityList` 返回 `null`（不是空数组）

## 群 ID 查询 `vault wechat-chatroom-list`

```bash
gangtise vault wechat-chatroom-list [--room-name <name>] [--from <n>] [--size <n>]
```

- `--room-name`：可重复或英文逗号分隔
- 省略 `--size` 拉全量（接口返回 `total`，CLI 按 total 并发翻页）；传 `--size N` 只取前 N 条。单页最大 50
- 返回字段：`total`（总条数）/ `chatroomName` / `chatroomId`

## 自选股股票池 `vault stock-pool-list / stock-pool-stocks`

```bash
gangtise vault stock-pool-list
gangtise vault stock-pool-stocks [--pool-id <id>]
```

- `stock-pool-list`：查询当前用户的全部股票池，返回 `poolId` / `poolName`
- `stock-pool-stocks`：查询股票池中的证券明细
  - `--pool-id`：股票池 ID，可重复；不传默认 `all`（返回所有池中的非重复证券）
  - 传入 `--pool-id all` 等同于全量查询，最多返回 10000 只
  - 返回字段：`securityCode` / `securityName`
