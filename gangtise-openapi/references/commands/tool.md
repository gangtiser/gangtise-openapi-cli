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

## 常见搭配

```bash
# 下载研报原文 PDF → 解析成 Markdown
gangtise insight research download --report-id 1234567 --output ./r.pdf
gangtise tool file-parse --file ./r.pdf --wait --output ./r.zip
```

⚠️ 研报/公告类接口本身多数支持 `--file-type 2`（Markdown）直出，**先看能不能直接下 Markdown**（只算下载积分），别为已有 Markdown 的文件再花 0.8/页 走解析。`file-parse` 的价值在于外部来源的 PDF（自己的资料、非平台文件）。
