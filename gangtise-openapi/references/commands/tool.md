# Tool 命令详细参数（投研工具）

## PDF 解析 `tool file-parse` / `file-parse-check`

把 PDF（研报、公告、合同等）解析成 Markdown 正文 + 提取的图片，结果打包成 ZIP。异步两步：提交拿 `taskId` → 取结果 ZIP。

```bash
# 一步到位（推荐）：提交后阻塞轮询，就绪即落盘
gangtise tool file-parse --file <x.pdf> --wait [--output <out.zip>]

# 两步：先提交，稍后取结果
gangtise tool file-parse --file <x.pdf>                       # 输出 {"taskId": "...", "status": "pending"}
gangtise tool file-parse-check --task-id <id> [--output <out.zip>]
```

- `--file`（**必填**）：待解析的 PDF。CLI 在上传前本地校验：文件存在、非空、后缀 `.pdf`、≤100MB——不合格直接报 `ValidationError`，不发请求也不扣分
- `--wait`：阻塞轮询到结果就绪（预算 ≈316s，覆盖官方「单文件约 3 分钟」）。**外层工具/命令超时要设到 ≥360s**，否则外层先超时（任务仍在服务端跑，之后 `file-parse-check` 照样能取）
- `--output`：结果 ZIP 落盘路径。省略时用服务端返回的文件名（形如 `<taskId>.md.zip`），无则 `file-parse-<taskId>.zip`
- 服务端限制：单文件 ≤100MB、≤500 页，同一用户最多 10 个并发任务
- **积分**：**提交时按实际页数一次性扣费，0.8 积分/页**（50 页 = 40 积分）；取结果免费。提交端点标 `no-replay`——超时/5xx 不自动重放，避免同一文件重复扣费。**重跑 `file-parse` 会重新扣费，取结果请一律用 `file-parse-check --task-id`**
- 未就绪时 `file-parse-check` 输出 `{"taskId": "...", "status": "pending"}` 且退出码 0（服务端返 `140001` RESULT_GENERATING，HTTP 409），隔 ~1 分钟再取即可

ZIP 内容：

```
├── file.md          # Markdown 正文（保留标题层级与阅读顺序）
└── images/          # 从 PDF 提取的图片（JPG，文件名由服务端生成；无图时为空目录）
```

呈现建议：解压后读 `file.md`；正文很长时先 `wc -l` / `head` 采样，不要整篇灌进上下文。

## 联网搜索 `tool web-search`

对公开互联网做投研定向检索。服务端已做转载去重、信源分级、黑名单剔除与内容特征打标，按信源等级排序返回。

```bash
# 轻搜：默认 10 条摘要
gangtise tool web-search --query "<检索词>" [--size N]

# 收窄：定向站点 + 只要高等级信源 + 近一周
gangtise tool web-search --query "减持新规" --site csrc.gov.cn --site sse.com.cn --min-tier T1 --freshness week

# 精读：返回网页正文
gangtise tool web-search --query "<标题>" --site csrc.gov.cn --include-content --max-content-chars 6000 --size 2 --format json
```

- `--query`（**必填**）：1–200 字符。**服务端不做意图推断或改写**，检索词原样发送；要限定站点必须显式用 `--site`
- `--size`：1–20，默认 10；**带 `--include-content` 时上限降为 5**（CLI 本地拦截并说明是哪个 flag 压低了上限）。指去重与过滤**之后**的条数，不足不补
- `--freshness`：`day` / `week` / `month` / `none`（默认）。按 `publishTime` 过滤，⚠️ **判不出发布日期（`publishTime` 为 `null`）的结果在 `day`/`week`/`month` 下不返回**——收窄时效会连带丢掉这批
- `--min-tier`：`T0` / `T1` / `T2` / `T3`（默认 T3 = 不过滤）。低于该等级不返回
- `--site`：注册域或子域（`csrc.gov.cn`、`finance.sina.com.cn`），可重复，**最多 10 个**（按去重后计），相互之间是**或**关系，子域按后缀匹配
- `--include-content`：返回网页正文 `content`（Markdown，保留标题/列表/表格，图片只留链接）。个别页面取不到正文时该条 `content` 为 `null`，不报错
- `--max-content-chars`：1000–20000，默认 8000，仅在 `--include-content` 时生效；超出截断并置 `contentTruncated: true`（按段落边界回退，实际长度可能略小）
- **积分**：**1 积分/次**，与返回条数、是否带 `--include-content` 无关；**零结果与报错不扣**。标 `no-replay`，超时/5xx 不自动重放

返回字段要点：

- `publishTime`（`yyyy-MM-dd`）是**规则判定**的发布日期，判不出为 `null`——**`null` 不表示网页没有日期**。排序与 `--freshness` 只用它；`publishTimeSource` 说明判定依据（`url` / `cluster` / `page` / `index`），与 `publishTime` 同空同有
- `indexTime` 是搜索索引记录的网页时间，**原样转述、不保证是发布时间**（政府站常把页面生成时间写进元数据，部分站点是抓取批次日）。做时点判断用 `publishTime`，不要用它
- `tier` 信源等级 T0–T3；`flags` 内容特征标：`rumor` 传闻 / `forward` 转载稿 / `disclaimer` 含免责声明 / `toutSuspect` 疑似荐股 / `paywall` 付费墙
- `upgradedFrom` 是转载簇合并时被替换掉的低等级来源 URL，本条是簇内保留的最高等级来源
- `hints`：`total = 0` 时必非空（给出放宽建议）；有结果时也可能带提示（如「结果全部为 T3 自媒体」）
- **排序是 `tier` 升序 → `publishTime` 降序 → 相关性**，⚠️ **首条不等于最相关**，接口只保证信源与时效的确定性次序

典型链路：先轻搜 10 条选定目标 → 再用 `--site` 收束到目标站点、带 `--include-content` 搜一次取正文。

## 常见搭配

```bash
# 下载研报原文 PDF → 解析成 Markdown
gangtise insight research download --report-id 1234567 --output ./r.pdf
gangtise tool file-parse --file ./r.pdf --wait --output ./r.zip
```

⚠️ 研报/公告类接口本身多数支持 `--file-type 2`（Markdown）直出，**先看能不能直接下 Markdown**（只算下载积分），别为已有 Markdown 的文件再花 0.8/页 走解析。`file-parse` 的价值在于外部来源的 PDF（自己的资料、非平台文件）。
