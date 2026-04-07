# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 的命令行工具。

## 安装

```bash
npm install -g gangtise-openapi-cli
```

安装后直接使用：

```bash
gangtise --help
```

本地开发：

```bash
git clone git@github.com:gangtiser/gangtise-openapi-cli.git
cd gangtise-openapi-cli
npm install
npm run dev -- --help
```

## 配置

优先读取以下环境变量：

```bash
export GANGTISE_ACCESS_KEY="your-ak"
export GANGTISE_SECRET_KEY="your-sk"
export GANGTISE_BASE_URL="https://open.gangtise.com"
export GANGTISE_TOKEN="Bearer xxx"
```

如果没有 `GANGTISE_TOKEN`，CLI 会自动调用 token 接口并缓存到本地。

## 命令概览

- `gangtise auth ...`
- `gangtise lookup ...`
- `gangtise insight ...`
- `gangtise quote ...`
- `gangtise ai ...`
- `gangtise raw call ...`

其中 `lookup` 下的研究方向、机构、行业枚举已内置在项目中，无需额外本地文档文件。

## 推荐工作流

先查枚举/参数：

```bash
gangtise lookup research-area list
gangtise lookup broker-org list
gangtise lookup meeting-org list
gangtise lookup industry list
gangtise lookup industry-code list   # 申万行业代码（用于 security-clue --gts-code）
```

再调用业务命令：

```bash
gangtise insight opinion list --industry 104710000
gangtise insight summary list --institution C100000017
gangtise quote day-kline --security 600519.SH --start-date 2025-03-01 --end-date 2025-03-12
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
```

## 自动翻页

以下列表接口会自动翻页：
- `insight opinion list`
- `insight summary list`
- `insight roadshow list`
- `insight site-visit list`
- `insight strategy list`
- `insight forum list`
- `insight research list`
- `insight foreign-report list`
- `insight announcement list`
- `ai security-clue`
- `ai cloud-disk-list`

规则：
- `--from` 表示起始偏移量
- `--size` 表示最终最多返回多少条记录
- 如果未传 `--size`，CLI 会根据返回里的 `total` 自动翻页，把从 `from` 开始的全部数据查全
- 如果传了 `--size`，即使超过接口单次上限，CLI 也会自动翻页，直到累计记录数达到 `size` 或数据取完

## 智能文件命名

下载命令（`summary download`、`research download`、`foreign-report download`、`announcement download`、`cloud-disk-download`）省略 `--output` 时，自动使用真实标题作为文件名：

1. **缓存优先** — 如果之前执行过对应的 `list` 命令，标题已缓存在 `~/.config/gangtise/title-cache.json`，直接使用，无额外 API 调用
2. **API 回查** — 缓存未命中时，自动查询最近 200 条记录匹配标题
3. **兜底** — 都找不到时使用服务器返回的原始文件名或 `{type}-{id}.{ext}`

推荐工作流：先 `list` 再 `download`，文件名自动正确。

## 常用示例

### 认证

```bash
gangtise auth login
gangtise auth status
```

### Insight

```bash
# 只取前 120 条，CLI 内部自动翻页
gangtise insight research list --start-time "2026-04-04 00:00:00" --end-time "2026-04-04 23:59:59" --size 120

# 不传 size，自动查全
gangtise insight research list --start-time "2026-04-04 00:00:00" --end-time "2026-04-04 23:59:59"

gangtise insight opinion list --keyword AI
gangtise insight summary list --keyword 算力

# 下载：先 list 再 download，自动使用真实标题作为文件名
gangtise insight summary download --summary-id 4902586
# → 超颖电子：2026年4月7日投资者关系活动记录表.txt

gangtise insight research download --report-id 432092410345574400
# → 建筑材料行业投资策略周报：战争对预期的影响仍大 中长期关注传统建材底部机会.pdf

# 也可手动指定文件名
gangtise insight research download --report-id 12345 --output ./report.pdf

gangtise insight roadshow list --institution C100000017
```

### Quote

```bash
gangtise quote day-kline --security 600519.SH --start-date 2026-03-01 --end-date 2026-03-31
gangtise quote income-statement --security-code 600519.SH --fiscal-year 2025 --period q3 --field netProfit
gangtise quote main-business --security-code 600519.SH
gangtise quote valuation-analysis --security-code 600519.SH --indicator peTtm
```

### AI

```bash
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
gangtise ai security-clue --start-time "2026-03-01 00:00:00" --end-time "2026-03-23 23:59:59" --query-mode bySecurity --gts-code 000001.SZ --size 800
gangtise ai security-clue --start-time "2026-04-01 00:00:00" --end-time "2026-04-07 23:59:59" --query-mode byIndustry --gts-code 821055.SWI
gangtise ai one-pager --security-code 600519.SH
gangtise ai investment-logic --security-code 600519.SH
gangtise ai peer-comparison --security-code 600519.SH
gangtise ai cloud-disk-list --keyword 部门文档

# 云盘下载：自动使用文件标题命名
gangtise ai cloud-disk-download --file-id 62130
# → 2028 全球智能危机  一份来自未来的金融史思想实验  .pdf

gangtise ai knowledge-resource-download --resource-type 60 --source-id 3052524 --output ./resource.txt
# 若接口返回外链 URL，也会直接输出 URL 或按 --output 保存
```

### Raw

```bash
gangtise raw call insight.opinion.list --body '{"from":0,"size":120}'
```

说明：对已标记为自动翻页的 endpoint，`raw call` 也会复用同一套 client 翻页逻辑；这里的 `size` 仍表示最终希望返回的记录数。

## 已验证的真实联调

已真实跑通：
- auth: `login`
- lookup: `research-area list` / `broker-org list` / `meeting-org list` / `industry list` / `industry-code list`
- insight: `opinion list` / `summary list` / `summary download` / `roadshow list` / `site-visit list` / `strategy list` / `forum list` / `research list` / `research download` / `foreign-report list` / `foreign-report download` / `announcement list` / `announcement download`
- quote: `day-kline` / `income-statement` / `main-business` / `valuation-analysis`
- ai: `knowledge-batch` / `knowledge-resource-download` / `security-clue` / `cloud-disk-list` / `cloud-disk-download` / `one-pager` / `investment-logic` / `peer-comparison`

注意：`knowledge-resource-download` 依赖正确的 `resourceType + sourceId` 组合；错误组合会返回 `433007 不支持该数据源`。

## 输出格式

支持：

- `table`
- `json`
- `jsonl`
- `csv`
- `markdown`

## Claude Code Skill

本项目包含一个 [Claude Code](https://claude.ai/claude-code) skill 定义（`SKILL.md`），可让 AI agent 自动调用 `gangtise` CLI 完成投研数据查询。

安装到 Claude Code：

```bash
# 方式一：从本地项目安装
cp SKILL.md ~/.claude/skills/gangtise-openapi/SKILL.md

# 方式二：手动创建目录并复制
mkdir -p ~/.claude/skills/gangtise-openapi
cp SKILL.md ~/.claude/skills/gangtise-openapi/
```

安装后，在 Claude Code 中可以用自然语言触发，例如：
- "帮我查今天所有的研报"
- "用 gangtise 命令查一下贵州茅台的日K线"
- "导出最近一周的首席观点到 jsonl"

## 常见错误

- `8000014`: `GANGTISE_ACCESS_KEY` 错误
- `8000015`: `GANGTISE_SECRET_KEY` 错误
- `999997`: 未开通接口权限
- `999995`: 积分不足
- `903301`: 今日调用次数达到上限
- `433007`: 不支持该数据源（常见于知识资源下载参数不匹配）
