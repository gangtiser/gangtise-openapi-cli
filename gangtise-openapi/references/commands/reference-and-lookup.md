# Reference / Lookup 命令详细参数

## 证券代码搜索 `reference securities-search`

```bash
gangtise reference securities-search --keyword <text> [--category <type>] [--top <n>]
```

- 用途：把公司名/简称/代码/拼音/英文名/曾用名 → `gtsCode`，是 `ai security-clue --gts-code` 等接口的前置查询
- `--keyword`（**必选**）：支持多维度匹配（中文名/简称/证券代码/拼音首字母/英文名/曾用名）
- `--category`（可重复）：`stock` | `dr` 存托凭证 | `index` | `fund`（不传则查所有）
- `--top`：默认 10，**上限 10**
- 返回字段：`gtsCode` / `gtsName` / `category` / `matchScore` / `matchType`
  - `matchType`：`code` 代码 | `abbr` 简称 | `pinyin` 拼音 | `prev` 曾用名 | `engName` 英文名

**示例：**
```bash
gangtise reference securities-search --keyword 茅台 --category stock --top 3
gangtise reference securities-search --keyword 600519
gangtise reference securities-search --keyword gzmt
```

## Lookup 命令

ID 不确定时优先读 `references/lookup-ids.md`（高频 ID 速查表），找不到再调 lookup 命令：

```bash
gangtise lookup research-area list        # 研究方向
gangtise lookup broker-org list           # 券商机构
gangtise lookup meeting-org list          # 会议机构
gangtise lookup industry list             # 行业
gangtise lookup region list               # 外资研报区域
gangtise lookup announcement-category list # 公告分类
gangtise lookup industry-code list        # 申万行业代码（security-clue --gts-code 用）
gangtise lookup theme-id list             # 主题 ID（theme-tracking 用）
```

### 常见行业别名映射

| 用户说法 | 标准行业 | `--industry` ID | `--gts-code`（security-clue） |
|----------|---------|----------------|---------------------------|
| 新能源 / 光伏 / 风电 / 电新 | 电力设备 | `104630000` | `821052.SWI` |
| AI / 人工智能 / 算力 | 计算机 | `104710000` | `821055.SWI` |
| 半导体 / 芯片 | 电子 | `104270000` | `821035.SWI` |
| 互联网 / 平台 | 传媒 | `104720000` | `821056.SWI` |
| 白酒 | 食品饮料 | `104340000` | `821038.SWI` |
| 医药 / 创新药 | 医药生物 | `104370000` | `821041.SWI` |
| 地产 | 房地产 | `104430000` | `821044.SWI` |
| 券商 / 券商股 | 非银金融 | `104490000` | `821048.SWI` |
| 银行 / 银行股 | 银行 | `104480000` | `821047.SWI` |
| 汽车 / 新车 | 汽车 | `104280000` | `821036.SWI` |

> **参数名选择**：`--industry` 用于 opinion / research / foreign-report；`--research-area` 用于 roadshow / site-visit / forum / summary（ID 值与 industry 相同可复用）；`--gts-code` 仅用于 `ai security-clue`（需申万格式 `821xxx.SWI`，不是数字 ID）

> **"消费"歧义**：用户说"消费/大消费"覆盖多个子行业（食品饮料 `104340000` / 商贸零售 `104450000` / 社会服务 `104460000` / 家电 `104330000` / 纺织服饰 `104350000` / 美容护理 `104770000`），需向用户确认具体方向，或用 `--keyword 消费` 做宽泛搜索。

## Raw 调用 `gangtise raw call`

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'
```

- endpoint key 格式：`<命令组>.<子命令>.<操作>`，如：
  - `insight.opinion.list`、`insight.announcement-hk.list`、`insight.foreign-opinion.list`、`insight.independent-opinion.list`
  - `reference.securities-search`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch`
- `--body` 传 JSON 字符串
- 自动翻页 / 重试 / Agent 复用与封装命令一致
