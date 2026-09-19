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
- 🔴 **`--industry` 是收窄工具，不是全量召回**：行业标签由服务端标注，**同一条消息可能挂多个行业，也可能一个都没挂**。同一个关键词加上「本行业」过滤后，命中数只剩三到四成——**少掉的既有没打标签的，也有被标到相邻行业去的**（如半导体相关的消息在计算机 / 机械 / 通信下同样查得到）。所以「按行业筛出 N 条」不能读成「该行业只有 N 条」；要尽量全，用 `--keyword` 取回后本地判断，或把相邻行业码一起查再去重
- `--wechat-group-id`：先用 `vault wechat-chatroom-list` 查；可重复
- `--category`：`text` | `image` | `documents` | `url`（可重复）
- `--tag`：`roadShow` | `research` | `strategyMeeting` | `meetingSummary` | `industryComment` | `companyComment` | `earningsReview`（可重复）
- 返回字段：`msgId` / **`content`**（正文）/ **`url`**（链接）/ `msgTime` / `wechatGroupId` / `wechatGroupName` / `speakerName` / `category` / `tagList[]{tagCode, tagName}` / `securityList[]{securityCode, securityName}` / `quoteMsg{quoteMsgId, quoteContent, quoteUrl}`。正文取 `content`、链接取 `url`（不是 `msgContent` / `contentUrl`）
- `quoteMsg`：被引用的消息，无引用时为 `null`；`quoteContent` / `quoteUrl` 也可能为空。做上下文还原时用它把「回复」接回原消息
- 未打标签/未关联证券的消息，`tagList` / `securityList` 返回 `null`（不是空数组）

## 群 ID 查询 `vault wechat-chatroom-list`

```bash
gangtise vault wechat-chatroom-list [--room-name <name>] [--from <n>] [--size <n>]
```

- `--room-name`：可重复或英文逗号分隔
- 省略 `--size` 拉全量（接口返回 `total`，CLI 按 total 并发翻页）；传 `--size N` 只取前 N 条。单页最大 50
- 返回字段：`total`（总条数）/ `chatroomName` / `chatroomId`

## 自选股股票池 `vault stock-pool-*`

查询两个、增删改五个，全部免费，只操作当前账号本人的数据。

### 查询

```bash
gangtise vault stock-pool-list
gangtise vault stock-pool-stocks [--pool-id <id>]
```

- `stock-pool-list`：查询当前用户的全部股票池，返回 `poolId` / `poolName`
- `stock-pool-stocks`：查询股票池中的证券明细
  - `--pool-id`：股票池 ID，可重复；不传默认 `all`（返回所有池中的非重复证券）
  - 传入 `--pool-id all` 等同于全量查询，最多返回 10000 只
  - 返回字段：`securityCode` / `securityName`

### 增删改

🔴 **这五个命令会改动账号数据**，是本 CLI 仅有的写操作；`--pool-id` 一律取自 `stock-pool-list`。

```bash
gangtise vault stock-pool-create      --name <名称>
gangtise vault stock-pool-rename      --pool-id <id> --name <新名称>
gangtise vault stock-pool-add-stock   --pool-id <id> --security <code> [--security <code>...]
gangtise vault stock-pool-remove-stock --pool-id <id> --security <code> [--security <code>...]
gangtise vault stock-pool-delete      --pool-id <id> [--pool-id <id>...] --yes
```

- `stock-pool-create`：建池，返回新池的 `poolId` / `poolName`
  - **池名上限 10 个字符**（按字符计，中文算 1 个），超出返回 `230007`。⚠️ 在 Gangtise 终端里建的老池名可以更长，通过本接口建池 / 改名则一律受这个上限约束
  - **池名不能与已有池重复**，重名返回 `230006`；判重是整串精确比较——首尾空格不会被去掉（`" A "` 与 `"A"` 可并存），大小写也不归一（`abc` 与 `ABC` 可并存）
  - 每个账号最多 30 个池，达到上限后返回 `230003`
  - 这条命令超时或 5xx **不会自动重发**（重发一个其实已经建成的请求只会撞重名报错）；超时后先 `stock-pool-list` 看池建成没有，再决定重来
- `stock-pool-rename`：只改名，池内自选股不受影响；新名的长度与重名规则同上（改成该池自己当前的名字算成功）
- `stock-pool-add-stock` / `stock-pool-remove-stock`：批量加 / 批量移出，`--security` 可重复或逗号分隔；单池上限 10000 只
  - 代码要带市场后缀且**大小写敏感**：`600519.SH` / `00700.HK` / `AAPL.O` 可混在一次请求里；`600519`（缺后缀）、`600519.sh`、`aapl.o`、`700.HK`（港股要 5 位）都会进 `failList` 报「证券代码不存在」，而不是报错退出
  - 首尾空格会被自动去掉，列表内重复的同一代码会去重（成功项只计一次）
- `stock-pool-delete`：批量删池，**必须显式加 `--yes`**（不加会直接报错退出，不发请求）
  - 删池会同时移除池内全部证券的关注关系，**不可恢复**；个股的投资笔记独立保留，不受影响
  - **`raw call vault.stock-pool.delete` 同样要 `--yes`**——换成 raw 入口不会跳过这道确认

**部分失败会被标出来**：`add-stock` / `remove-stock` / `delete` 是逐条处理的——证券代码不存在这类单条失败，服务端仍返回成功信封，把失败明细放进 `failList`（`successList` 里是成功的那些）。CLI 检测到 `failList` 非空时在 stderr 列出失败项与原因、给结果标 `partial`、**退出码 3**；全部成功才是退出码 0。批量脚本按退出码判断即可，不必自己解析 `failList`。**`raw call` 打这三个端点时判定完全相同**，同一份响应不会一个入口退 3、另一个退 0。

**幂等**：重复加已在池内的证券、移出本就不在池内的证券、删不存在的 `poolId`，都算成功并计入 `successList`，不会报错。唯一不幂等的是 `stock-pool-create`（见上面的重名规则）。

**返回字段**：`create` / `rename` 返回 `poolId` / `poolName`；`add-stock` / `remove-stock` / `delete` 返回 `successList[]` + `failList[]{securityCode 或 poolId, failReason}`。
