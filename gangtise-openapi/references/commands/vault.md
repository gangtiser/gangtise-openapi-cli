# Vault 命令详细参数（私域数据）

列表类命令大多有 `--keyword` `--start-time` `--end-time` `--from` `--size`；`wechat-chatroom-list` 只有 `--from` / `--size`，股票池的查询命令都没有这些选项，笔记查询只有 `--from` / `--size`。`my-conference-list` 按条计费，省略 `--size` 时估算全量超过 1000 积分会报错退出 1，确认后加 `--yes` 或改传 `--size N`。

---

## AI 云盘 `vault drive-list/download`

```bash
gangtise vault drive-list [--keyword <text>] [--file-type <n>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault drive-download --file-id <id> [--output <path>] [--resolve-title]
```

- `--file-type`：`1` 文档（含 PDF/Word/PPT）| `2` 图片 | `3` 音视频 | `4` 公众号文章 | `5` 其他
- `--space-type`：`1` 我的云盘 | `2` 租户云盘

## AI 云盘管理 `vault drive-*`（目录、上传、增删改）

全部**免费**。🔴 **除 `drive-folder-list` 外都会改动账号数据**；租户云盘（`--space-type 2`）的内容对整个租户可见，往里上传、复制，或在里面删除前先向用户确认。

```bash
gangtise vault drive-folder-list [--space-type 1|2] [--parent-id <id>]
gangtise vault drive-upload --file <path> [--space-type 1|2] [--folder-id <id>] [--title <name>]
gangtise vault drive-create-folder --name <name> [--space-type 1|2] [--parent-id <id>]
gangtise vault drive-rename --type file|folder --id <id> --name <name>
gangtise vault drive-move-file --file-id <id>... --target-folder-id <id|root>
gangtise vault drive-move-folder --folder-id <id> --target-parent-id <id|root>
gangtise vault drive-copy --file-id <id>... --target-folder-id <id|root>
gangtise vault drive-copy --folder-id <id> --target-parent-id <id|root>
gangtise vault drive-delete-file --file-id <id>... --yes
gangtise vault drive-delete-folder --folder-id <id> --yes
```

- **ID 从哪来**：文件夹 ID 用 `drive-folder-list` 逐层看（根目录写 `root` 或不传）；文件 ID 在 `drive-folder-list` 的 `fileList` 或 `drive-list` 里。`--space-type` 默认 `1`（我的云盘），**`--parent-id` / `--folder-id` 必须属于该空间**，否则报 `100003`（「parentId 与 spaceType 不一致」）
- `drive-folder-list` 只返回该文件夹的**直接**子文件夹（`folderList`）与**直接**文件（`fileList`），不递归；返回为 `{folderTotal, folderList, fileTotal, fileList}`，默认 json 输出
- **同名不报错**：文件与文件夹都允许同名，以 ID 区分。所以**上传 / 新建 / 复制每执行一次就多一份**，这三个命令超时不会自动重发；对同一内容别重复执行
- `drive-upload`：单个文件 ≤100MB（CLI 本地先拦）；试用账号每天累计上传 ≤500MB（超出 `230008`）。`--title` 不传用本地文件名
- 名称（`--name` / `--title`）≤200 个字符，按 UTF-16 计——中文算 1、emoji 算 2；超出 `230004`
- **移动只能在同一空间内**：`drive-move-file` 里跨空间的文件进 `failList`（「空间不一致」）；`drive-move-folder` 移到其他空间、自身或其子文件夹报 `230005`
- **跨空间用 `drive-copy`**：在「我的云盘 ↔ 租户云盘」之间复制，源保留不动，同空间复制报 `100003`。两种用法二选一：复制文件用 `--file-id`（可批量）+ `--target-folder-id`，返回 `successList[]{fileId, newFileId}`；复制整个文件夹用 `--folder-id` + `--target-parent-id`，连同其中的子文件夹与文件一起复制，返回 `{folderId, newFolderId}`。目标 ID 必须在另一空间，`root` 即另一空间的根目录
- 🔴 **删除不可恢复，必须 `--yes`**：`drive-delete-file` 可批量；`drive-delete-folder` **连同其中全部子文件夹与文件一起删除**，删前先 `drive-folder-list --parent-id <id>` 看清里面有什么。拒绝后**不要自行补 `--yes` 重跑**，把要删的名称列给用户确认
- **批量命令的部分失败**：`drive-delete-file` / `drive-move-file` / `drive-copy` 对单条失败仍返回成功，明细在 `failList`（`fileId` + `failReason`，如「文件不存在」）。CLI 把失败的 ID 写到 stderr、结果标 `partial` 并**退出 3**

## 录音速记 `vault record-list/download`

```bash
gangtise vault record-list [--keyword <text>] [--category <name>] [--space-type <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault record-download --record-id <id> --content-type <type> [--output <path>] [--resolve-title]
```

- `--category`：`upload` | `link` | `mobile` | `gtNote` | `pc` | `share`（可重复）
- `--space-type`：`1` 我的速记 | `2` 租户速记
- `--content-type`（download **必选**）：`original` 原始文件 | `asr` 语音识别 | `summary` AI 速记（其他取值 CLI 在本地拒绝：接口对错值报的是「没有文件可供下载」，容易误读成这条记录没附件）
  - 口语映射：「原始文件/原文件」→`original`、「语音识别/转写文本/ASR」→`asr`、「AI速记/智能摘要/会议纪要」→`summary`
  - 「与我分享」类型录音无法下载原始文件
- 返回字段：`recordId` / `title` / `createTime` / `category` / `recordDuration`（秒） / `recordSize`（Byte）/ `url` / `spaceType` / `uploader`

## 我的会议 `vault my-conference-list/download`

```bash
gangtise vault my-conference-list [--keyword <text>] [--research-area <id>] [--security <code>] [--institution <id>] [--category <name>] [--source <n>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
gangtise vault my-conference-download --conference-id <id> --content-type <type> [--output <path>] [--resolve-title]
```

- **积分**：列表 0.1/条；下载 30/篇（超时不自动重发）
- **可查范围：前溯 1 个月**（各档相同）

- `--category`：`earningsCall` 业绩会 | `strategyMeeting` 策略会 | `fundRoadshow` 基金路演 | `shareholdersMeeting` 股东大会 | `maMeeting` 并购会议 | `specialMeeting` 特别会议 | `companyAnalysis` 公司分析 | `industryAnalysis` 行业分析 | `other`（可重复）
- `--source`：录制来源 `1`=企微会议助理 | `2`=会议服务微信群（可重复；不传返回全部）
- `--keyword` vs `--research-area`：用户说"关于AI的"用 `--keyword AI`；说"电子行业的会议"用 `--research-area 100800126`（行业用 `citicIndustry` 码 `1008001xx`、方向用 `gangtiseIndustry` 码 `122000xxx`，**不要用申万码 `104xx0000`**——本端点传申万码一律返 0 且不报错，换中信码即正常过滤）
- `--content-type`（download **必选**）：`asr` 语音识别 | `summary` AI 速记
- 返回字段：`conferenceId` / `title` / `publishTime` / `category` / `institution{...}` / `security{...}` / `researchArea{...}` / `guest` / `sourceList`（录制来源，`1`/`2`）

## 群消息 `vault wechat-message-list`

```bash
gangtise vault wechat-message-list [--keyword <text>] [--security <code>] [--wechat-group-id <id>] [--industry <id>] [--category <type>] [--tag <tag>] [--start-time <datetime>] [--end-time <datetime>] [--from <n>] [--size <n>]
```

- 数据权限：仅用户已绑定并激活群消息助理、且助理已入群的群消息
- `--security`：按证券代码过滤（如 `000001.SZ`），可重复
- `--industry`：**只认中信码**（`1008001xx`，见 `reference constant-list --category citicIndustry`）。⚠️ 申万码（`104xx0000`）与任何不认识的值都报 `100005 枚举值非法`——**换中信码即可**。返回行里不含行业标签字段，过滤在服务端完成
- 🔴 **`--industry` 是收窄工具，不是全量召回**：行业标签由服务端标注，**同一条消息可能挂多个行业，也可能一个都没挂**。同一个关键词加上「本行业」过滤后，命中数会明显少于只用关键词——**少掉的既有没打标签的，也有被标到相邻行业去的**（如半导体相关的消息在计算机 / 机械 / 通信下同样查得到）。所以「按行业筛出 N 条」不能读成「该行业只有 N 条」；要尽量全，用 `--keyword` 取回后本地判断，或把相邻行业码一起查再去重
- `--wechat-group-id`：先用 `vault wechat-chatroom-list` 查；可重复
- 按偏移量**最多取到第 10000 条**（`--from` + 条数不能超过 10000），且 `total` 最多也只报到 10000——正好报 10000 时实际条数可能更多，CLI 按封顶处理：标 `partial` + `totalCapped`、退出码 3。要更多请缩短时间范围分段取，每段的 `total` 低于 10000 才说明取全了
- `--category`：`text` | `image` | `document`（PDF、Excel 等文档）| `url` | `audio` | `video`（可重复）。其他取值（如 `documents`、`pdf`、`mp4` 这类文件格式名）报 `100005`，`--tag` / `--industry` 同样整批拒绝、不会忽略筛选返回全部
- `--tag`：`roadShow` | `research` | `strategyMeeting` | `meetingSummary` | `industryComment` | `companyComment` | `earningsReview`（可重复）
- 返回字段：`msgId` / **`content`**（正文）/ **`url`**（链接）/ `msgTime` / `wechatGroupId` / `wechatGroupName` / `speakerName` / `category` / `fileInfo{fileName, fileSize}` / `tagList[]{tagCode, tagName}` / `securityList[]{securityCode, securityName}` / `quoteMsg{quoteMsgId, quoteCategory, quoteContent, quoteUrl, quoteFileInfo}`。正文取 `content`、链接取 `url`（不是 `msgContent` / `contentUrl`）
- `msgId` 是长数字串，可能超过 JavaScript 安全整数范围——**始终按字符串保存和传递**，别转成数字（会被舍入，拿去下载就对不上）
- `content` 随 `category` 不同：`text` 为正文、`document` 为文件名、`image` 为图片识别出的文字（可能含 AI 摘要段落，也可能为空，不保证逐字准确）、`url` 为链接标题、`audio` / `video` 为附带文字（常为空，不含转写）
- `fileInfo`：`document` / `image` / `audio` / `video` 消息的文件名与字节数（`fileSize`，未知时为 `null`），其他类型为 `null`。要文件本身用下面的 `wechat-message-download`
- `quoteMsg`：被引用的消息，无引用时为 `null`；`quoteContent` / `quoteUrl` 也可能为空。做上下文还原时用它把「回复」接回原消息。被引用的是文件消息时，`quoteFileInfo` 给文件名与大小，下载用 `quoteMsgId`
- 未打标签/未关联证券的消息，`tagList` / `securityList` 返回 `null`（不是空数组）

## 群消息文件下载 `vault wechat-message-download`

```bash
gangtise vault wechat-message-download --msg-id <msgId> [--output <path>]
```

- 免费。`--msg-id` 取自 `wechat-message-list` 的 `msgId`（按字符串原样传）；只有 `document` / `image` / `audio` / `video` 消息有文件。引用里的文件用 `quoteMsg.quoteMsgId`（先确认 `quoteCategory` 是这四类之一）
- 一次一个文件。不带 `--output` 时按服务端给的文件名保存（文档、音频一般是原文件名，图片、视频多为一串随机字符），同名自动加 `-1`、`-2`；stdout 是保存路径
- 内容原样落盘：`.txt` / `.json` / `.html` 等文本类文件也按原字节保存，不做转码。图片是平台保存的版本，不保证原图分辨率；音频、视频只有文件本身，没有转写
- 报错：`130005` = 该消息是 `text` / `url`，没有文件；`130003` = 消息不存在、本账号无权访问或文件已不可用（三种情况不区分，**重试不会变**，别轮询）；`100003` = `--msg-id` 不是纯数字
- 列表里有 `fileInfo` 不代表文件一定还能下载，以下载结果为准

```bash
# 某个群里最近的文件消息 → 逐个下载
gangtise vault wechat-message-list --wechat-group-id <群ID> --category document --category image --category audio --category video --size 20 --format json
gangtise vault wechat-message-download --msg-id 4784255865508301077
gangtise vault wechat-message-download --msg-id 4784255865508301077 --output ./群文件/研报.pdf
```

## 群 ID 查询 `vault wechat-chatroom-list`

```bash
gangtise vault wechat-chatroom-list [--room-name <name>] [--from <n>] [--size <n>]
```

- `--room-name`：可重复或逗号分隔（名称里的空格、顿号原样保留）
- 省略 `--size` 拉全量（接口返回 `total`，CLI 按 total 并发翻页）；传 `--size N` 只取前 N 条。单页最大 50
- 返回字段：`total`（总条数）/ `chatroomName` / `chatroomId`

## 自选股股票池 `vault stock-pool-*`

查询两个、增删改五个，全部免费。查询可看个人股票池或所属租户的股票池，增删改只操作当前账号本人的个人股票池。

### 查询

```bash
gangtise vault stock-pool-list   [--space-type 1|2]
gangtise vault stock-pool-stocks [--space-type 1|2] [--pool-id <id>]
```

- `--space-type`：`1` 个人自选股股票池（不传即此项）、`2` 所属租户的股票池（终端租户页签下的池；页签名不是池名）。一次只查一种。无租户股票池查询权限时报 `999004`；有权限但没有可见的池返回空列表
- `stock-pool-list`：查询股票池列表，返回 `poolId` / `poolName` / `spaceType`
- `stock-pool-stocks`：查询股票池中的证券明细
  - `--pool-id`：股票池 ID，可重复；不传默认 `all`（返回该 `--space-type` 下所有可见池中的非重复证券）
  - 🔴 **`--pool-id` 要取自同一 `--space-type` 的 `stock-pool-list`**：另一种空间的 ID 不会被匹配——与其他有效 ID 一起传时被静默忽略，全部不匹配时报 `999004`「股票池不存在或无权访问」。租户池的明细要带 `--space-type 2`
  - 按完整 `securityCode` 去重合并，不标注来自哪个池；要逐池归属就逐池查
  - 单次最多返回 10000 只，超出截断且没有截断标记，返回恰好 10000 只时不能当作已取全（逐池查可降低截断）
  - 返回字段：`securityCode` / `securityName`

### 增删改

🔴 **这五个命令会改动账号数据**（与上面的云盘管理命令同属写操作）；`--pool-id` 一律取自不带 `--space-type` 的 `stock-pool-list`（个人股票池）。

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

## 个股投资笔记 `vault stock-note-*`

查询、新增、改写、删除四个命令，全部免费，只操作当前账号本人写的笔记（别人的笔记查不到、改不了、删不到，也不会暴露是否存在）。笔记与证券是多对多：一条笔记关联 1~50 只证券，同一只证券可以有多条笔记，每条笔记以 `stockNoteId` 区分。笔记与自选关注相互独立——取消关注、删股票池都不会删笔记。

```bash
gangtise vault stock-note-list   [--security <code>... | --note-id <id>...] [--from <n>] [--size <n>]
gangtise vault stock-note-add    --security <code> [--security <code>...] --content <正文>
gangtise vault stock-note-update --note-id <id> --content <新正文>
gangtise vault stock-note-delete --note-id <id> [--note-id <id>...] --yes
```

### 查询 `stock-note-list`

- 不传筛选 = 本人**全部**笔记（含已取消关注的证券下仍保留的笔记）；`--security` 按证券筛，笔记关联的证券里**含其中任一只**即命中；`--note-id` 按笔记 ID 精确查。`--security` 与 `--note-id` 二选一，同传本地报错
- `--security` / `--note-id` 各最多 100 个；代码大小写、首尾空格不影响匹配，但港股要 5 位（`00700.HK`，`700.HK` 不会补零）、美股要用交易所后缀（`AAPL.O`，`AAPL.US` 不会转换）。**代码写错、不存在或类型不支持时整次报 `120001`**，不会当成「这只票没有笔记」返回空；有效代码没有笔记才是空结果
- 不存在或不属于本人的笔记 ID 被直接过滤，不计入 `total`、不报错
- 自动翻页，省略 `--size` 取全部；按 `createTime` 倒序（同秒按 ID 倒序），同时命中多只证券的笔记只出现一次。翻页期间有增删时偏移会变，不保证跨页一致
- 返回字段：`stockNoteId` / `securityList`（该笔记**完整**的关联证券，按代码升序，不只是你筛的那几只）/ `content`（纯文本原样，保留换行；Markdown 只是文字）/ `createTime` / `updateTime`（北京时间，精确到秒；正文没变的提交不刷新 `updateTime`）
- 默认输出 json（正文常含换行，表格不便阅读）

### 新增 `stock-note-add`

- `--security`：1~50 只（按规范化去重后计数），可重复或逗号分隔。可关联 A 股、港股、美股（`.O` / `.N` 等）、ETF、交易所指数、概念指数（`.GT`）、中信行业指数（`.CI`）、全球指数（如 `SPX.SPI`），可混传；**申万行业指数（`.SWI`）不支持**。任一只无效则整条不建，报 `120001` 并点名
- `--content`：纯文本，不能为空或全是空白，最长 10000 个字符（按 Unicode 码点计，首尾空白和换行都算）；原样保存，不裁剪
- 返回 `stockNoteId` 与实际关联的 `securityList`（规范化代码、升序）
- 🔴 **关联的证券建好后不能改**：要换关联范围就新增一条、核对无误后再删旧的（两步不是原子操作，中间会短暂同时存在两条）
- 🔴 **超时或 5xx 不会自动重发，也不要直接重跑**：服务端没有防重机制，同样的请求再提交一次就是第二条笔记。超时后先 `stock-note-list --security <code>` 看是否已经写入

### 改写 `stock-note-update`

- `--note-id` 取自 `stock-note-list`；`--content` **整体替换**旧正文（不是追加），规则同新增
- 只改正文，关联证券不变；一条笔记关联多只证券时，改动在每只证券下都可见
- 成功返回 `{}`；`updateTime` 从查询里看。不存在或不属于本人返回 `130002`「笔记不存在或无权操作」
- 没有版本控制，并发改写以最后提交的为准

### 删除 `stock-note-delete`

- **必须显式加 `--yes`**（不加直接报错退出，不发请求）；删除的是整条笔记连同它与全部证券的关联，**不可恢复**。`raw call vault.stock-note.delete` 同样要 `--yes`
- `--note-id` 可重复或逗号分隔，一次最多 100 个；**只接受明确的 ID，没有 `all`**——批量删先 `stock-note-list` 拿 ID 核对
- 幂等：已删掉的、不存在的、不属于本人的 ID 都进 `successList`（不会删到别人的笔记），重复执行仍算成功
- 部分失败同股票池写命令：服务端仍返回成功信封、把失败项放进 `failList`，CLI 在 stderr 列出、标 `partial`、**退出码 3**；拿到结果后只需对 `failList` 里的 ID 重试
- 返回字段：`successList[]` + `failList[]{stockNoteId, failReason}`
