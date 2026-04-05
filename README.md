# Gangtise OpenAPI CLI

一个可直接调用 Gangtise OpenAPI 的命令行工具。

## 安装

```bash
npm install
npm run build
npm link
```

安装后可直接使用：

```bash
gangtise --help
```

也可以本地开发运行：

```bash
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

## 推荐工作流

先查枚举/参数：

```bash
gangtise lookup research-area list
gangtise lookup broker-org list
gangtise lookup meeting-org list
gangtise lookup industry list
```

再调用业务命令：

```bash
gangtise insight opinion list --industry 104710000 --size 5
gangtise insight summary list --institution C100000017 --size 5
gangtise quote day-kline --security 600519.SH --start-date 2025-03-01 --end-date 2025-03-12
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
```

## 常用示例

### 认证

```bash
gangtise auth login
gangtise auth status
```

### Insight

```bash
gangtise insight opinion list --keyword AI --size 10
gangtise insight summary list --keyword 算力 --size 10
gangtise insight summary download --summary-id 1831171109967 --output ./summary.pdf
gangtise insight roadshow list --institution C100000017 --size 10
gangtise insight research download --report-id 12345 --output ./report.pdf
```

### Quote

```bash
gangtise quote income-statement --security-code 600519.SH --fiscal-year 2025 --period q3 --field netProfit
gangtise quote main-business --security-code 600519.SH
gangtise quote valuation-analysis --security-code 600519.SH --indicator peTtm
```

### AI

```bash
gangtise ai knowledge-batch --query 比亚迪 --query 最近热门概念
gangtise ai security-clue --start-time "2026-03-01 00:00:00" --end-time "2026-03-23 23:59:59" --query-mode bySecurity --gts-code 000001.SZ
gangtise ai one-pager --security-code 600519.SH
gangtise ai investment-logic --security-code 600519.SH
gangtise ai peer-comparison --security-code 600519.SH
gangtise ai cloud-disk-list --keyword 部门文档
gangtise ai cloud-disk-download --file-id 43319 --output ./file.bin
gangtise ai knowledge-resource-download --resource-type 60 --source-id 3052524 --output ./resource.txt
# 若接口返回外链 URL，也会直接输出 URL 或按 --output 保存
```

### Raw

```bash
gangtise raw call insight.opinion.list --body '{"from":0,"size":5}'
```

## 已验证的真实联调

已真实跑通：
- auth: `login`
- lookup: `research-area list` / `broker-org list` / `meeting-org list` / `industry list`
- insight: `opinion list` / `summary list` / `summary download` / `roadshow list` / `site-visit list` / `strategy list` / `forum list` / `research list` / `research download` / `foreign-report list` / `foreign-report download` / `announcement list` / `announcement download`
- quote: `day-kline` / `income-statement` / `main-business` / `valuation-analysis`
- ai: `knowledge-batch` / `knowledge-resource-download` / `security-clue` / `cloud-disk-list` / `one-pager` / `investment-logic` / `peer-comparison`

注意：`knowledge-resource-download` 依赖正确的 `resourceType + sourceId` 组合；错误组合会返回 `433007 不支持该数据源`。

## 输出格式

支持：

- `table`
- `json`
- `jsonl`
- `csv`
- `markdown`

## 常见错误

- `8000014`: `GANGTISE_ACCESS_KEY` 错误
- `8000015`: `GANGTISE_SECRET_KEY` 错误
- `999997`: 未开通接口权限
- `999995`: 积分不足
- `903301`: 今日调用次数达到上限
- `433007`: 不支持该数据源（常见于知识资源下载参数不匹配）
