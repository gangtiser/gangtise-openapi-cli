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

## 首席 ID 搜索 `reference chiefs-search`

```bash
gangtise reference chiefs-search --keyword <text> [--top <n>]
```

- 用途：查首席分析师 ID，拿到的 `chiefId` 用于 `insight opinion list --chief <id>` 按首席筛选内资观点
- `--keyword`（**必选**）：支持中文姓名 / 机构名称 / 所属团队多维匹配
- `--top`：默认 10，**上限 10**
- 免费调用
- 返回字段：`chiefId` / `chiefName` / `institution`（所属证券机构）/ `team`（所属团队）/ `matchScore`（`0~1`）

**示例：**
```bash
gangtise reference chiefs-search --keyword 东吴证券 --top 3 --format json   # → 周良玖 / 芦哲 / 陈李，chiefId 如 P100005161
```

## 常量分类 `reference constant-category`

```bash
gangtise reference constant-category [--format json]
```

- 用途：全量导出常量分类及每个分类适用于哪些接口的哪些参数（无需传参，免积分）
- 返回 `{total, list}`，`list[]` 字段：`category`（分类代码）/ `categoryName` / `structureType`（`flat` 平铺 | `tree` 树形）/ `maxLevel` / `usageScopes[]`（`apiName` + `paramName`）
- 当前 8 个分类：

| category | 名称 | 结构 | 用于参数 |
|----------|------|------|---------|
| `citicIndustry` | 中信一级行业（30，`1008001xx`） | flat | `--industry` 全命令通用首选（见下方说明） |
| `swIndustry` | 申万一级行业（31，`104xxx`） | flat | `--industry`（仅 6 个 insight list；wechat 静默忽略，见下方说明） |
| `gangtiseIndustry` | Gangtise 行业（30 行业 `1008001xx` + 6 方向 `122000xxx`） | flat | `--research-area` 首选（含宏观/策略等方向，见下方说明） |
| `domesticCity` | 国内城市（省级 ID） | flat | `--location`（roadshow / site-visit / strategy / forum）|
| `aShareAnnouncementCategory` | A股公告分类 | tree（2 级） | `insight announcement --category` |
| `hkShareAnnouncementCategory` | 港股公告分类 | tree（2 级） | `insight announcement-hk --category` |
| `usShareAnnouncementCategory` | 美股公告分类（`103980xxx` 段） | tree（2 级） | `insight announcement-us --category` |
| `regionCategory` | 区域分类 | flat | `insight foreign-report --region` |

> **行业 / 研究方向过滤——选哪套 category（⭐ 权威口径，其他文件引用此处、勿重复枚举命令清单以免漂移；实测 + spec，2026-06-15）：**
> - **`--industry`（industryList）→ 用 `citicIndustry`（`1008001xx`）**：opinion / research / foreign-report / foreign-opinion / independent-opinion / official-account / wechat-message 全部正确过滤。`swIndustry`（`104xxx`）在 6 个 insight list（含 official-account）上等效（spec 多数命令写 citic+sw），但 **`vault wechat-message-list` 只认中信码、传申万码会静默返回全量** → 统一用中信码最稳。
> - **`--research-area`（researchAreaList）→ 用 `gangtiseIndustry`**：完整研究方向分类 = 30 个行业（`1008001xx`，与 citicIndustry 相同）+ 6 个方向（宏观 `122000001` / 策略 `122000002` / 固收 `122000003` / 金工 `122000004` / 海外 `122000005` / 其他 `122000007`）。行业码与方向码均已实测正确过滤（opinion / summary / roadshow / site-visit / forum）。`citicIndustry` 也能用但只含行业、无方向；`swIndustry`（`104xxx`）除 summary / my-conference 外返 0，勿用。

## 常量值 `reference constant-list`

```bash
gangtise reference constant-list --category <code> [--format json]
```

- `--category`（**必选**）：分类代码，见上表
- 返回 `{category, structureType, maxLevel, constantCount, list}`（CLI 把 API 的 `constants` 规范化为 `list`）
- `list[]` 字段：`constantId` / `constantName` / `level`；树形分类的父节点含 `children[]`（结构同父节点，可继续嵌套）
- 树形分类（公告分类）用 `--format json` 自行递归 `children`；`table` 不会展开子节点

**示例：**
```bash
gangtise reference constant-list --category citicIndustry --format json
gangtise reference constant-list --category aShareAnnouncementCategory --format json   # 树形，含 children
```

## 题材 ID 搜索 `reference concept-search`

```bash
gangtise reference concept-search --keyword <text> [--top <n>]
```

- 用途：查题材 ID，供 `alternative concept-info / concept-securities --concept-id` 和 `ai theme-tracking --theme-id` 使用（三者共用同一套 ID）
- `--keyword`（**必选**）：中文题材名/简称、拼音/首字母（`jqr`）、分组名（如 灵巧手）
- `--top`：默认 10，**上限 10**；搜索型接口，**非全量导出**
- 返回 `{returnedCount, list}`，`list[]`：`conceptId` / `conceptName` / `matchScore`（0~1，降序）

**示例：**
```bash
gangtise reference concept-search --keyword 机器人 --top 3 --format json   # → 121000130
gangtise reference concept-search --keyword jqr
```

## 板块 ID 搜索 `reference sector-search`

```bash
gangtise reference sector-search [--keyword <text>] [--top <n>]
```

- 用途：查板块 ID（行业/概念/指数成份等分类树节点），供 `sector-constituents` 使用
- `--keyword`：中文板块名/简称、拼音/首字母
- `--top`：默认 10，**上限 10**
- 返回 `{returnedCount, list}`，`list[]`：`sectorId` / `sectorName` / `hierarchy`（层级路径，如 `中国内地股票-概念类-科技-半导体设备`）/ `matchScore`
- 同名板块可能出现在多个层级（概念类 vs 指数成份类），用 `hierarchy` 区分

## 板块成分股 `reference sector-constituents`

```bash
gangtise reference sector-constituents --sector-id <id>
```

- `--sector-id`（**必选**）：板块 ID，**必须来自 `reference sector-search`**
- 返回 `{total, list}`，`list[]`：`gtsCode` / `gtsName`（全量成分股，纯名单）
- **返回 0 条** → sectorId 不对：题材 `conceptId` 与板块 `sectorId` 是两套 ID，不通用；先 `sector-search` 确认
- 与 `alternative concept-securities` 的区别：后者是题材深度 F8（按分组、含 `isKey` / `inclusionReason`），本接口是板块树节点的纯成分股名单

**示例：**
```bash
gangtise reference sector-search --keyword 半导体 --top 3 --format json   # → 1000001005 半导体设备
gangtise reference sector-constituents --sector-id 1000001005 --format json
```

**申万行业代码全量列表**（`ai security-clue --gts-code` 用的 `821xxx.SWI`）也走这两步——申万行业指数板块的成分就是 31 只行业指数本身：

```bash
gangtise reference sector-search --keyword 申万一级行业指数 --format json
# 取「指数数据板块-行业指数-申万指数-申万一级行业指数」层级的 sectorId（2000000014）
# 注意：「中国内地股票-指数成份类」层级下的同名节点查成分返回 0 条
gangtise reference sector-constituents --sector-id 2000000014 --format json
# → total 31，gtsCode 即 821xxx.SWI
```

单个行业也可以直接 `reference securities-search --keyword 申万银行 --category index` → `821047.SWI`。

## Lookup 本地表（仅剩 2 个）

常量/板块 API 未覆盖的 ID 仍走本地表：

```bash
gangtise lookup broker-org list           # 券商机构（--broker 用）
gangtise lookup meeting-org list          # 会议机构（--institution 用）
```

行业 / 区域 / 公告分类 / 研究方向 / 题材 ID / 申万行业代码已改用 API：`reference constant-list` / `reference concept-search` / `reference sector-constituents`（v0.16.0 起移除对应 lookup 子命令）。

### 常见行业别名映射

| 用户说法 | 标准（申万）行业 | 申万码¹ | `--gts-code`（security-clue） |
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

> ¹ 第 3 列是**申万码**（`104xxx`），仅在 opinion / research / foreign-report / foreign-opinion / independent-opinion / official-account 这 6 个 insight list 上作 `--industry` 等效；`vault wechat-message-list` 会静默返回全量、`--research-area` 返 0——通用/推荐的**中信码**（`1008001xx`）见 `references/lookup-ids.md` 中信表或 `constant-list --category citicIndustry`。

> **参数名选择**：`--industry`（industryList，用 `citicIndustry` 码 `1008001xx`）用于 opinion / research / foreign-report / foreign-opinion / independent-opinion / official-account / wechat-message；`--research-area`（researchAreaList，用 `gangtiseIndustry` 码 = 行业 `1008001xx` + 方向 `122000xxx`）用于 opinion / summary / roadshow / site-visit / forum / my-conference；`--gts-code` 仅用于 `ai security-clue`（需申万格式 `821xxx.SWI`，不是数字 ID）。注意 strategy（线下策略会）无 `--research-area`，只按 `--institution` / `--location` 筛。

> **"消费"歧义**：用户说"消费/大消费"覆盖多个子行业（食品饮料 `104340000` / 商贸零售 `104450000` / 社会服务 `104460000` / 家电 `104330000` / 纺织服饰 `104350000` / 美容护理 `104770000`），需向用户确认具体方向，或用 `--keyword 消费` 做宽泛搜索。

## Raw 调用 `gangtise raw call`

```bash
gangtise raw call <endpoint.key> --body '{"from":0,"size":120}'                                       # JSON 端点（POST，绝大多数）
gangtise raw call insight.research.download --query reportId=<id> --query fileType=1 --output x.pdf   # 仅 kind=download 端点用 --query
```

- endpoint key 格式：`<命令组>.<子命令>.<操作>`，如：
  - `insight.opinion.list`、`insight.announcement-hk.list`、`insight.foreign-opinion.list`、`insight.independent-opinion.list`
  - `reference.securities-search`、`reference.constant-list`、`quote.day-kline`、`fundamental.income-statement`、`ai.knowledge-batch`
- **JSON 端点**（绝大多数）用 `--body` 传 JSON；**`kind=download` 端点**（各 `*.download`）用 `--query key=value`（可重复）。传反会被 CLI **直接拒绝**（JSON 端点给 `--query`、或 download 端点给 `--body`，都抛 ValidationError，不发请求）
- 自动翻页 / 重试 / Agent 复用与封装命令一致
