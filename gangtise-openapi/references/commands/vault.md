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
gangtise vault my-conference-list [--keyword <text>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault my-conference-download --conference-id <id> --content-type <type> [--output <path>]
```

- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`（可重复）
- `--keyword` vs `--research-area`：用户说"关于AI的"用 `--keyword AI`；说"电子行业的会议"用 `--research-area 104270000`
- `--content-type`（download **必选**）：`asr` 语音识别 | `summary` AI 速记
- 返回字段：`conferenceId` / `title` / `publishTime` / `category` / `institution{...}` / `security{...}` / `researchArea{...}` / `guest`

## 群消息 `vault wechat-message-list`

```bash
gangtise vault wechat-message-list [--keyword <text>] [--wechat-group-id <id>] [--industry <id>] [--category <type>] [--tag <tag>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
```

- 数据权限：仅用户已绑定并激活群消息助理、且助理已入群的群消息
- `--wechat-group-id`：先用 `vault wechat-chatroom-list` 查；可重复
- `--category`：`text` | `image` | `documents` | `url`（可重复）
- `--tag`：`roadShow` | `research` | `strategyMeeting` | `meetingSummary` | `industryComment` | `companyComment` | `earningsReview`（可重复）
- 返回字段：`msgId` / `msgContent` / `contentUrl` / `msgTime` / `wechatGroupId` / `wechatGroupName` / `speakerName` / `category` / `tagList`

## 群 ID 查询 `vault wechat-chatroom-list`

```bash
gangtise vault wechat-chatroom-list [--room-name <name>] [--from <n>] [--size <n>]
```

- `--room-name`：可重复或英文逗号分隔
- `--size` 默认 20，单页最大 50
- 返回字段：`chatroomName` / `chatroomId`
