# Changelog

本项目完整版本历史。README 顶部仅展示最近 5 个版本摘要与关键历史里程碑。

> 🔴 **服务端问题的逐轮复核记录在 `bug/review-log.md`**，不在本文件。本文件只记版本变更。

### v0.38.0 — 2026-09-05

**两部分：跟进 2026-09-05 接口变更通知（文档与 help）；两轮质检（本仓 + Codex）共识的第一批数据正确性护栏。**

**1. 行情三接口新增沪深 ETF 与 20 个全球指数**

`quote realtime` / `day-kline` / `minute-kline` 都能直接传 `512800.SH` 这类 ETF 代码和 `SPX.SPI`（标普500）/ `N225.NKI`（日经225）/ `HSI.HI`（恒生）等 20 个全球指数代码，CLI 参数透传、不需要改逻辑；更新三条命令的 `--security` help 与 skill / README 的品种表，20 个全球指数代码清单放进 `references/commands/quote.md`（逐个实测出数）。实测要点：

- 全市场关键字 `aShares` **不含 ETF**（全 A 5556 行里 0 只）——ETF 与各类指数一样要逐个传代码
- 全球指数：realtime 的 `volume` / `amount` / `amplitude`、分钟 K 的 `volume` / `amount`、日 K 的 `amount` 为 `null`；`tradeDate` / `tradeTime` 是交易所当地时间（美股个股同：`AAPL.O` 收盘快照 `16:00`），分钟 K 的时间过滤也按当地时间
- ETF 有复权因子（day-kline `adjustFactor`，EDE `qte_adj_factor` 的 `scopeList` 已含「场内基金」）；`volume` 单位为「份」

**2. `quote realtime` 字段集变化（台账 P1-11 关闭）**

新增 `tradeStatus`（交易状态中文，仅 A 股 / 港股个股有值）；**`turnoverRate` / `volumeRatio` 已不再返回**——传了会连字段名一起被静默丢掉、不报错，存量脚本要改口径（换手率可走 EDE `qte_turn`）。美股 `amount` 由 `0` 改为 `null`，全市场 5585 行有成交记录 100% 为 `null`、0 行为 `0`，`fields.md` 三处「美股恒 0」标注撤掉。realtime 对不存在的字段名现在是名和值一起丢，`--field` 文案把它从「回显字段名」那一组移出（`main-business` 仍是回显，CLI 照常拦截长度不匹配）。

**3. 盈利预测 `roe` 单位改为百分比**

`fundamental earning-forecast --consensus roe` 返回值单位由万分比改为百分比（茅台 `2025E` = `35.6`），`fundamental.md` 补充说明；存量脚本若做过换算要撤掉。

**4. 🔴 缺列护栏（`missingFields`）**

realtime / day-kline / minute-kline / fund-flow 对不认识或已下线的字段名是名和值一起丢、HTTP 200——长度仍相等，v0.28.3 的错列护栏管不到它，结果就是「少一列、退出 0」，脚本按列名取值拿到 `undefined`。现在 `flagMissingFields` 比对请求的 `--field` 与响应 `fieldList`，缺列标 `partial` + `missingFields`（退出 3）并在 stderr 点名。只判「请求了但没回」，不依赖字段白名单，服务端新增列不受影响。两轮质检都把它列为 P1。

**5. K 线分片合并按列名对齐（Codex P1）**

`quoteSharding` 合并时只保留第一片的 `fieldList`，其余片的行按位置直接拼接——某一片列序不同（`volume, close` vs `close, volume`）就会静默错列，且无任何标记。现在每片按自己的 `fieldList` 重排到首片列序；缺少首片某列的片按失败片处理（`failedShards` + `partial`），不再按错名合并。属客户端缺陷，尚未观察到线上触发。

**6. 完整性检查补齐两处分支（Codex P2）**

- `requestPaginated` 从末页起步的全量拉取（`from=9950`、`total=10000`）在首页即完成的分支上直接返回，跳过了 `total` 封顶探测；探针抽成 `flagIfTotalCapped`，两条出口共用
- `quote` 单请求路径收到 `data: null` 会把 `null` 打出去、退出 0；分片路径早已把无 `list` 的片当失败。新增 `requireListPayload`，四个 quote 命令的单请求与分片出口统一：无 `list` 数组即报错退出 1

**7. 测试覆盖本次契约（Codex P2）**

realtime 桩改为当前形态（15 列、不认识的字段名连名带值一起丢、`tradeStatus` / 美股 `amount` / 全球指数三个 `null`），旧的「回显字段名」桩只在请求含 `close` 时返回，继续守错列护栏。新增 11 个用例：缺列退出 3、15 列契约透传、`data: null` 退出 1、分钟 K 截断提示的参数名、分片列对齐（重排 / 缺列）、封顶探针的首页完成分支（有 / 无 `--size`）、`flagMissingFields` 三态。

**8. 线上契约探针 `npm run contract`（不发布）**

`scripts/contract-probe.mjs` 跑 13 次免费调用（三个行情接口的列名与各品种的 `null` 形态、5 个指标的 `parameterList` / `scopeList`、常量分类），与 `contracts/api-contract.json` 基线比对，有差异退出 1；`--update` 重写基线。进发版前复核步骤（`release.md` 3.5）。只比名字与 `null`，不比数值，交易日与假日出同一份快照。

**9. Skill 指令一致性（Codex P1）**

`SKILL.md` 两处会直接导致调用失败的写法：截面示例 `--indicator-param "F1:reportDate=..."`（`F1:` 是 screener 语法，截面要 `<code>:`）→ 改正并注明；`securities-search` 取值路径 `data.list[0].gtsCode` → `list[0].gtsCode`（CLI 已剥信封）。`indicator.md` 同一处示例一并改。主规则里「全球指数成交量额类字段为 `null`」补上日 K `volume` 有值的区别。

**10. 其它**

`minute-kline` 的截断提示原来指向 `--start-date/--end-date`，改为该命令实际的 `--start-time/--end-time`。`normalize.ts` 顶部关于 realtime 回显字段名的注释按 09-05 复测更正。

**跨 session 复核第一轮（Codex）修掉的 8 条**

- R1 / R2：分片合并加 schema 校验——每片的数组行必须与自己的 `fieldList` 等宽、列名唯一、且有 `fieldList`，否则按失败片处理（此前重排会把短行补 `undefined`、长行裁掉、重复列取后者，绕过 `zipFieldRow` 的行宽护栏）；空片（`list: []`）既不当合并表头也不当失败片（此前首片 `fieldList: []` 会把后续全部列吞成 `{}`）。6 个反例测试
- R3 / R4：契约探针执行失败与契约变化分开记，`--update` 遇执行失败不写基线、退出 1；按证券排序后比较，行序不再是契约。`tests/unit/contractProbe.test.ts` 用 `tests/fixtures/fake-gangtise.mjs` 替身 CLI 覆盖 5 个用例
- R5：每个 quote 命令、每条出口（单请求 / 分片）各一条缺列端到端（此前删掉 `minute-kline` 那一句接入全套仍绿）；桩按实测拆开——`fund-flow` 自动附带 `securityCode` / `tradeDate`，kline 系只回点名的列。这条线上事实同时补进 `quote.md` / `fields.md` / `SKILL.md` / README
- R6：空载荷检查从 `cli.ts` 移到 `client.requestJson`，由端点注册表的 `expects: "list"` 驱动——`data: null` 挂不上 traceId 符号，只有在信封还在手上的那一层才能把 traceId 带进报错
- R7：`SKILL.md` 证券搜索的顶层结构写成 `{returnedCount, list}`（此前误写 `{total, list}`）
- R8：`bug/cli-backlog.md` 的「真待办」总述同步到 K22 / K24–K28；`bug/README.md` 通则 ⑭ 记下接线层零覆盖的又一次复发

**跨 session 复核第二轮修掉的 7 条**

- N1：只有经数组行校验过的 `fieldList` 才能成为合并表头；对象行片的 `fieldList` 不再约束后续数组片
- N2：`expects: "list"` 抛出的 ApiError 标记为结构性错误（`markStructural` / `isStructuralError`），分片器对它只记当前片失败、不中止其余片；此前一个 `data: null` 片会让后续片全部不发
- N3：三个已下线 K 线端点也标 `expects: "list"`（实测它们对无效代码与空区间都答 `{total: 0, list: []}`），`data: null` 不再退回成功
- N4：`total > 0`（或带 `partial`）却零行的片按失败片处理，不再当假日空窗
- N5：输出的 `fieldList` 只取校验过的列式表头，基片自带的空 `fieldList` 不再随展开带出（此前会让 `flagMissingFields` 把对象行里明明有的列报成缺失）
- N6：文档里分钟 K 的身份列写错成 `tradeDate`，改为 `tradeTime`（线上实测），四处文案同步；分钟桩改为按请求回列并断言这个示例
- N7：契约测试补「真实列变化 → 普通运行退出 1、基线不动、`--update` 才接受」

**跨 session 复核第三轮修掉的 2 条**

- M1：合并结果的 `fieldList` 分三档——校验过的列式表头；否则对象行的键并集（返回的列就是键，`flagMissingFields` 的依据不再随删除 `fieldList` 一起丢）；全空结果保留服务端明确给出的列集（含空集），只有完全没有元信息时才不带。此前第三轮把非列式结果的 `fieldList` 一律删除，对象行合并里真正缺失的请求列不再报 `missingFields`
- M2：空片带显式 `partial` 的分支补独立测试（删掉该条件此前 750 项仍绿）；警告文案区分「total>0」与「带 partial 标记」

**跨 session 复核第四轮修掉的 2 条**

- F1：全空结果的元信息只从「合法空片」取——已判失败的片（`total>0` 却零行、带 `partial`、schema 不过）不再充当基片，其 `fieldList` 不再变成「服务端返回的列」（此前失败首片的 `[]` 会让存活空片明确返回的列被报成缺失）。全部分片失败仍直接抛错；部分失败保留 `partial` / `failedShards`；`{}` 只是防御性的元信息默认值
- F2：对象行键并集补「列只在后续行出现」的用例（正反两种行序），只遍历首行的退化会被拦住

**11. 对外文档去流水账 + SKILL 瘦身（K29）**

用户要求对外文档只写现行口径。`SKILL.md` 从 62KB 精简到规则 + 工作流 + 计费 + 路由 + 响应骨架 + 时间词 + 高频错误码 + 引用索引；错误码全表、「不报错的坑」、未见触发的码、退出码 3 与 `screener` 缺列判据、Troubleshooting 整体移到新文件 `references/errors.md`；规则 11 与「易混淆消歧」里的 EDE 长段压成判据句 + 指向 `indicator.md`。`indicator.md` 整篇重写：去掉「2026-xx 实测 / 起 / 此前一版」叙述与抽样计数，保留判据与示例；`qte_vol` 随机 `null` 一节改为现象 + 做法，删掉日期表；原文里「空表基本只意味着真的没数据」与末尾「空表等于 code 未识别或参数名写错」自相矛盾，按后者统一。其余 references（examples / insight / response-schema / quote / reference-and-lookup / ai / fundamental / lookup-ids / vault / tool / fields）与 README 正文逐句改：日期与版本号叙述删除或改成当前行为，「取代旧 X」改成「旧码 X」，错误码重排段改成「两代并存」的现行说明。示例命令里的日期参数是样例值，保留。`docsConsistency` 守卫要求的 no-replay 注释块与「共 18 个」句子原样保留。

**12. 多证券 K 线逐只并发（K27）**

新增 `src/core/perSecurity.ts`：`callPerSecurity` 按 `PAGE_CONCURRENCY` 逐只请求、按传入顺序合并；各只必须回同一列布局，否则整条命令报结构性错误（不像按日分片那样容忍坏片——用户点名了每一只，少一只就是退出码该暴露的缺口）；任一只填满 `--limit` 标 `partial` + `truncatedSecurities`。`minute-kline` 的 `--security` 改为可重复（缺省本地报 `--security is required`）；`day-kline` 显式多证券在「证券数 × 交易日数上界」超过 `--limit` 时走逐只路径（上界 = 区间内工作日精确计数，节假日只会更少所以不会漏分批；只传起始日期时计到明天——服务端用最新交易日补结束日；只缺起始日期才按一年 262）。单只与不超限的多只仍是原来的单请求。合并规则：空表（`list: []`）不参与列比较、也不设置表头，只在全部为空时供出 `fieldList` 让缺列护栏仍能报告，但 `total > 0` 或带 `partial` 却没有行的空表是矛盾响应，按结构性错误拒绝（与分片合并同一判据）；带数组行的响应必须自带合法 `fieldList`（存在、不重名、每行等宽），缺失即该只结构性报错，与到达顺序无关（列式校验 `columnarSchemaValid` 与分片合并共用，位于 `normalize.ts`）；任一只自带的 `partial` 透传到合并结果。11 个单元测试 + 5 个端到端。

**13. skill 场景评测集（K28）**

`evals/scenarios.json` 16 个场景（公司重名与 A+H、ETF 与全球指数路由、全市场关键字、EDE 报告期 vs 交易日、日频估值、realtime 缺字段改口径、多证券身份列、分钟 K 多只、退出码 3 处理、screener 空集归因、高积分与全市场限制、盈利预测单位、年在后日期、公告的 `--start-time`），每条按「命令 / 参数 / 证券 / 单位 / 完整性」五维度正则判分。`scripts/skill-eval.mjs` 用 `codex exec`（默认 `gpt-6-astra` / `model_reasoning_effort=high`）逐场景独立会话、`--output-schema` 强制 `{commands, notes}`；`--live` 真跑并把本仓 `dist/` 包成 `gangtise` 放到 PATH 最前，提示里给绝对路径并要求 `gangtise --version` 自检，结果里校验版本。无效运行（codex 退出非 0 含超时、回复解析失败、实跑 `cli=` 自检不等于本仓版本）整场景判无效、检查全计未过；匹配前去掉无空白 token 的引号；超时杀整个进程组；`--rescore <results.json>` 用保存的回复按当前判据重算。基线（按现行 64 项判据重算保存的回复）：干跑 64/64、实跑 64/64，全部核验为 0.38.0。首轮实跑因登录 shell 重建 PATH 而跑到全局 0.37.1，按现行规则 0/64 全部无效。实跑还顺带发现 `stock-summary` 5556 只返回 0 行（`bug/server-open.md` P1-12）。原始回复落 `evals/results/`（gitignored），基线表在 `evals/README.md`。

**14. 大导出按批写出 + 导出元信息（K24）**

`--format jsonl --output` 时，翻页（`requestPaginated`）、全市场分片（`callKlineWithSharding`）、逐只请求（`callPerSecurity`）三条取数路径把行按到达顺序逐批交给 `src/core/rowSink.ts` 的 `JsonlRowSink` 写盘，不再先攒成整份 `list`：新增 `transport.runInOrder`（结果按序号顺序消费，取数侧在待写结果达到并发宽度时等待，两侧都有界）；sink 先缓冲到 1000 行才开文件（`<file>.part` + rename，失败 unlink），不足 1000 行的结果原样交回普通渲染路径，文件字节与之前一致；结果对象 `list` 为空、用非枚举 symbol 挂着 sink，`printData` 据此收尾；`total` / `partial` / `failedPages` 等标记不变，`flagIfImplicitCapHit` 改用 `rowCount()` 读行数；命令内只有第一次翻页 / 分片 / 逐只调用拿到 sink；下载文件名缓存改由 sink 在写出时收集标题。只做 jsonl（自描述、无需先知列集）；csv 要列并集做表头，取数阶段仍在内存。判据：80 万行 × 12 列导出在 `--max-old-space-size=100` 下流式成功（RSS 148 MB），收集模式 OOM（无上限 RSS 704 MB）；40.7 万行全程 gc 后堆 11–15 MB 不增长。

`csv` / `jsonl` 落盘时旁边写 `<file>.meta.json`：`file` / `format` / `rows` / `complete` / `exitCode` / `command`（argv）/ `cliVersion` / `fetchedAt`（含时区偏移）/ `timezone` / `columns`（`fieldList`）/ `result`（结果对象除 `list` 外的全部顶层键，所以任何新增标记自动进入）。`json` 自带标记不生成；没有关闭开关。单位信息 CLI 不掌握（待 K25 契约元数据），未写入。26 个新测试（sink、`runInOrder` 背压、三条取数路径各自的顺序 / 标记、printer 收尾与 sidecar、端到端 1000 行流式 + 隐式封顶 + csv/json）。

**未做、记入 `bug/cli-backlog.md`**：标题缓存跨进程写丢（K23，有意暂不做）；`cli.ts` 按命令组拆分 + 端点契约元数据（K25）；统一请求预算 / 总超时 / 限流（K26）。

### v0.37.1 — 2026-08-31

**文档修正，无代码变更。**

**1. `screener` 用静态属性选股的示例补进 README**

`pty_*` / `scr_*` 两族用 `--indicator-param "F1:"`（冒号后留空）声明不吃查询日期后可直接用于条件选股（服务端 2026-08-17 修复，CLI 侧绕行已于 v0.36.0 撤除），但 README 的 EDE 示例段仍写着「screener 上当前取不到；改用 `cross-section` 取回来再本地筛」——同一份 README 里 changelog 与示例段互相矛盾。撤绕行时只扫了 `references/`，漏了 README。

**2. 数据权限时间范围的说明按实测更正（台账 P0-4 关闭）**

`110003` 的可查窗口按**账号**配、不按接口配：EDE 三接口与 `quote day-kline` 逐日同界（实测 `2015-12-31` ❌ `110003` / `2016-01-04` ✅）。此前文档写的「三接口范围可能不一致，`screener` 撞界改用 `cross-section` 拉数再本地筛」已不成立——照做会多花一次全量取数的积分，且同样撞界。改为：换接口绕不过去，把日期移进权限范围或联系客户经理开通更长历史。

涉及 `README.md`、`gangtise-openapi/SKILL.md`（数据范围段 + `110003` 行）、`gangtise-openapi/references/commands/indicator.md`（错误码表 + 通用说明）。

**3. EDE 文本筛选示例换成有区分度的条件**

`pty_op_scope contains '酒'` 在中信白酒板块是 **19/19 全员命中**（该板块 universe 本身就是 19 只，`cross-section` 返 19 行 0 个 `null`），演示不出筛选在生效——与 `bug/README.md` 通则「全员命中的条件分不出『生效』与『条件被丢弃后返回全集』」是同一个坑。换成 `contains '葡萄酒'`（19 → 1，皇台酒业）。对外示例同时去掉写死的命中数：同一条命令 08-17 记 12 只、08-31 实测 19 只，而 `--date` 对静态属性无影响。

### v0.37.0 — 2026-08-29

**1. 🔴 下载的「智能文件命名」不再自动付费回查（行为变更）**

省略 `--output` 时的文件名解析原本是两级：先读 `title-cache`，未命中就自动查 list 接口最近 200 条去匹配标题。第二级不是免费的：

- `TITLE_LOOKUP_SIZE = 200`，而 list 单页上限 50 → **每次未命中发 4 次请求**（实测；且目标常在第 1 页，后 3 页纯浪费）
- 12 个接了标题回查的下载命令里，**9 个的 list 按 0.1 积分/条计费** → 一次未命中 ≈ **20 积分**，而下载本身才 10–50
- 取回的 200 条**没有写回缓存**，所以批量下 N 篇 = 4N 次请求、20N 积分

改为：**默认只读缓存**，未命中退回服务端 `Content-Disposition` 文件名，再退到 `<type>-<id>.<ext>`。回查改为显式 `--resolve-title`，且回查取到的 200 条标题**一并写回缓存**，同批后续下载不再重复付费。

先 `list` 再 `download` 的正常工作流**行为完全不变**（缓存命中，零额外调用）。

**2. 下载成功却退出 3（`resolveTitle` 的退出码外溢）**

标题回查走的是分页端点，`requestPaginated` 在首包异形时会写 `process.exitCode = 3`。回查本身是「尽力而为」的（失败就静默退回 ID 文件名），但这个副作用没人回滚——于是**文件完整下载成功、进程却退出 3**，而 3 的语义是「有数据但不完整」，按 `!= 0` 判失败的脚本会把成功的下载当失败。实测复现：

```
$ gangtise insight announcement-us download --announcement-id 12345
[gangtise] warning: insight.announcement-us.list is marked paginated but the first page has an unexpected shape ...
x.pdf
EXIT=3        ← 文件是完整的
```

`resolveTitle` 现在在回查前后保存/还原 `process.exitCode`。还原而不是清零——下载自身设的退出码必须原样存活。

**3. `--indicator-param` 引用未绑定的指标 code 不再静默发出**

`indicator screener` 一直会拦「参数绑到没有 `--indicator` 绑定的变量」，`cross-section` / `time-series` 没有同款检查：

```
--indicator is_op_rev --indicator-param "is_op_rve:reportDate=2025-06-30"   # 拼写错
→ indicatorCodeList: ["is_op_rev"]，indicatorParamList: [{ indicatorCode: "is_op_rve", … }]
```

`time-series` 上全程静默（那里不注入日期，没有冲突暴露它），用户以为设上的参数根本没生效。拼错**裸 `"<code>:"` 不要日期**那种写法更糟：真正的指标保留了被注入的 `tradeDate`，而那正是该写法要去掉的东西。现改为发请求前 `ValidationError`。

**4. 下载路径不认端点声明的超时下限**

`requestJson` 一直走 `resolveTimeoutMs(config, endpoint)`，`download()` 直读全局 `config.timeoutMs`，端点声明的 `timeoutMs` 被静默忽略（重定向跳转同样）。当前没有 download 端点声明下限，所以是**潜伏缺陷而非现行 bug**——`tool.file-parse.result` 是最可能触发的那个（500 页解析结果 ZIP）。已改为与 `requestJson` 同一条路径，并加测试钉住。

**5. 两条测试/文档守卫补齐（`bug/closed.md` K15 / K16）**

- **K15**：`totalCapped` 探针的 6 个 guard 里 `!totalDrift` 与 `failedPages.length === 0` 零覆盖——原有测试只断言最终 `partial`，而这两种情形本来就会由别的路径标 `partial`，删掉守卫测试照绿。新增两条测试直接断言**探针请求没有发出**（`{from: total, size: 1}`）。
- **K16**：README 与 SKILL.md 里「共 18 个 `no-replay` 端点」的点名清单是注册表的第二份手抄件，没有守卫。两份文档各加一段 HTML 注释形式的 endpoint key 清单（读者不可见、机器可解析），`docsConsistency.test.ts` 对其做 set-equality，并另行校验正文里的「共 N 个」。判据实测：加第 19 个 `no-replay` 端点而不改文档 → 4 条测试红。

### v0.36.0 — 2026-08-18

**1. 日期写法放宽到三种「年在前」格式，统一归一后发出**

`--start-date` / `--end-date` / `--date` / `--report-date` 以及各 `--start-time` / `--end-time` 现在都接受 `YYYY-MM-DD`、`YYYY/MM/DD`、`YYYYMMDD`，一律归一成 `YYYY-MM-DD` 再发请求（datetime 只归一日期那一半，时间部分与分隔符原样保留；Unix 时间戳原样透传）。三种写法对任何读者都是同一天，接受它们没有成本。

**「年在后」写法（`01-07-2026` / `07/01/2026`）仍在本地拒绝**，这是有意的：接口本身会解析它，且一律按美式「月在前」——按欧洲/国际习惯写 `01-07-2026` 表示「7 月 1 日」的人会拿到 1 月 7 日的数据，HTTP 200、行数看着也正常、没有任何报错。本地拒掉才有信号，还省一次请求与计费。README 新增「关于日期格式」一节写清两张对照表。

**2. `indicator screener` 放开无日期指标**

`parameterList` 里没有任何日期键的指标（`pty_*` / `scr_*` 静态属性两族，加 `div_cash_paid_ratio` / `div_cash_yr` / `pty_shr_reg`）现在可以直接用于条件选股：`--indicator-param "F1:"`（冒号后留空）声明该变量不要查询日期，与 `cross-section` 的 `"code:"` 是同一个写法，且可与真实参数共存（`"F1:" + "F1:fiscalYear=2025"`）。此前这类筛选只能先用 `cross-section` 取回再本地筛。

`errors.ts` 里指向旧限制的那句提示同步改成给出 screener 的等价写法。

**3. 撤回 v0.35.0 的「`totalCapped` 探针跳过 `no-replay` 端点」**

v0.35.0 给全量拉取的封顶探针加了 `endpoint.retry !== "no-replay"` 排除，理由写成「`no-replay` 标的是按次计费的端点，那里空探针不免费」。**这个理由两层都不成立**，由 `gangtise-mcp` 提出、本仓复核后采纳：

1. **`no-replay` 不是计费标记。** 它的定义是「never resend a request the server may already have executed」——**重放安全**：请求超时或 5xx 时你不知道服务端执行没执行，自动重发可能被扣两次。而探针是一个**从未发过的新请求**（`from = total`），不是重发，这个标记对它无话可说。
2. **`ai.hot-topic` 不按次计费。** 它是 50/篇，一「篇」= 一整份报告（早报/午报/盘中快报/晚报），即**按返回条数计**；而按篇/按条计费的接口**查不到内容就不扣积分**。所以空探针本来就是 0 积分，那个排除**一分钱也没省**。

代价却是实的：同时满足「分页」与 `no-replay` 的端点全库只有 `ai.hot-topic` 一个（24 ∩ 18 = 1），排除之后它就是**唯一没有截断检测的分页端点**——省不下钱，只丢检测。

现已撤掉排除项与那段错误注释，并补两条测试钉住：`ai.hot-topic` 上仍会发出 `from = total, size = 1` 的探针；rows 越过 `total` 时照常标 `totalCapped` + `partial`。变异验证：把排除项加回去 → **只有这两条红**，其余 686 条不受影响。同时订正了 `endpoints.ts` / `transport.ts` / `docs/architecture.md` 里把 `no-replay` 描述成「按次计费端点」的措辞——**那才是这次错误的源头**：它是重放安全标记，`ai.hot-topic` 带着它却是按篇计费。

**另修一处文案**：EDE 报错提示里「screener 上这个写法用不了」那句已过期（服务端 2026-08-17 起接受该写法），改为给出 screener 的等价写法 `--indicator-param "F1:"`。

`gangtise-mcp` 已先行撤回同款改动；`gangtise-python`（该改动的最初提出方）已同步撤回。

### v0.35.0 — 2026-08-16（跟进下游两仓的上游反馈）

逐条复核 `gangtise-mcp` 的 `bug/cli-upstream.md`（C5 / C6 / C7）与 `gangtise-python` 的 `bug/upstream-cli.md`（U1–U4）。**七条里六条成立**，其中一条（U2 的一半）**驳回并附反例**，并在追查过程中查出一条新的服务端问题。

**1. 报错提示不再在「半句」上断言一个错误的键（MCP C7(2) / Python U1）**

v0.34.1 的 `MESSAGE_HINTS` 用一条 alternation 同时覆盖拼接句（`不支持 A; 缺少 B`）与半句（只有 `不支持 A`）。半句只证明 `tradeDate` 被拒，**推不出要 `reportDate`**——`scr_exchg_mkt` 的 `parameterList` 是空的，照提示补 `reportDate` 同样被拒，而 CLI 对那半句没有规则，用户就此卡住。

拆成三条规则，判别式用 `notMatch` 编码（「半句 = 有『不支持』但没有『缺少必填参数 reportDate』」），**不依赖数组顺序**。半句配不断言的提示：指向 `parameterList`，分「空 / 只有 fiscalYear / 有别的键」三种给法，并点名 `indicator time-series` 这条实测可行的路。另补一条「缺少必填参数 tradeDate」（K13 那条路，此前落在 `100001` 的通用提示上）。四种形态都对着线上复跑确认。

**2. 新增无日期 opt-in 逃生口 `--indicator-param "<code>:"`（MCP C7(1) / Python U2）**

2026-08-14 服务端收紧参数校验后，**31 个指标在 `cross-section` 上彻底取不到数**：`--date` 必填且会给每个指标注入 `tradeDate`，而这些指标的 `parameterList` 里没有日期键，注入即 `100003` 拒绝整条请求。

- **28 个 `parameterList: []`**：`pty_*`（公司属性）18 个 + `scr_*`（证券属性）10 个，**整族**
- **3 个有参数但无日期键**：`div_cash_paid_ratio` / `div_cash_yr`（仅 `fiscalYear`）、`pty_shr_reg`（仅 `currency`/`scale`）

🔴 **这一条的判据前后错了三轮，值得完整留档**：

1. 下游报 8 个；我们用中文关键词扫 665 个指标得出 7+2 —— 都不到实际的三分之一。**改用 code 前缀能按族穷举**（`pty_` 19 / `scr_` 20 / `div_` 18 / `frcst_` 8，均未撞 100 上限）。
2. 两边都用「`parameterList` 是不是 `[]`」当判据，于是都漏掉了 `pty_shr_reg`（非空、但没有日期键）。
3. 改成「有没有 `tradeDate` / `reportDate`」后**仍是错的**——`gangtise-python` 的复核方指出：约 117 个 `is_*` 报告期指标声明 `[reportDate]`，**照样拒收注入的 `tradeDate`**，按这个判据会被判成不受影响，而那是最大的一族。它们操作上没出事，只是因为解法（自己传 `reportDate`）恰好触发了 `DATE_PARAM_KEYS` 的抑制——**判据不能靠这种巧合成立**。

**最终判据（单向蕴含，不是当且仅当）：`parameterList` 里有 `tradeDate` → 注入安全；没有 → 大概率被拒。** 「当且仅当」那版也被证伪了——`cdr_conv_ratio` 空 `parameterList` 却接受注入（200 + null）。

🔴 **而且这个集合结构上就不可穷举**（同一复核方的论证，本仓实测坐实）：`indicator search` 必须给关键词（空串报 `100001`）、`--limit` 上限 100、无 `--from`，泛化关键词 `_` 正好返 100 条即已截断。**没有列表端点，「扫完所有前缀」就没有终点**——你不可能先验地知道有哪些前缀。所以代码注释、help、对外文档一律写成**判据 + 重新生成的命令**，名单只标注「当前已知快照」，一个固定条数都不写死。

名单里漏掉的 `pty_op_scope` 正是官方文档 `F3 contains '酒'` 示例用的指标——本仓 `indicator.md` 与 `README.md` 的同源示例因此都是坏的，已改走 `cross-section` + 本地筛。

冒号后留空即声明「这个指标不要查询日期」。该拼法此前是 `ValidationError`，**没有任何既有调用会变行为**。标记走独立的 `noQueryDate` 集合而非「空参数表」，为的是能与真实参数共存（`fiscalYear` 那两个需要两条一起给）。

🔴 **驳回 `gangtise-python` 的「把 `fiscalYear` 加进 `DATE_PARAM_KEYS`」**：`frcst_op_rev` / `frcst_op_rev_yoy` / `frcst_pe` / `frcst_shnp` / `frcst_shnp_yoy` 的 `tradeDate` 与 `fiscalYear` **都是 `required: true`**，今天正常出数（`frcst_pe` = 19.4055），抑制注入后全部变成 `100001 缺少必填参数 tradeDate`——**用 2 个换 5 个**，而逃生口一样能修那 2 个。已加测试钉住。他们那边已经这么改了，回执里附了反例。

**3. `totalCapped` 探针不再在按次计费的端点上白花一次调用（Python U3）**

探针原本无条件跑，注释写「these endpoints charge per row」（空探针不计费）。`ai.hot-topic` 是唯一同时带 `pagination` 与 `retry: "no-replay"` 的端点（24 ∩ 18 = 1），而 `no-replay` 标的正是「按次计费、无缓存豁免」。已加 `endpoint.retry !== "no-replay"` 排除；已观察到的 `total` 封顶只出现在三个 `insight.opinion*`（按行计费），跳过不损失覆盖面。

**4. 🔴 P2-7 当天在 open / closed 之间搬了三次，归因错了两轮（MCP C5 + 跨 session 复核）**

v0.34.0 把 P2-7（`rankType=1` 综合排序）判为已修复、**并撤掉了对外文案**。MCP 用 `searchType=1` + `PCB` 复跑，rank1 与 rank2 逐位相同 → 我们据此重开，并归因到 **`searchType`**（「标题档没修」）。跨 session 复核换了第三组关键词，证明**两次归因都不对**：

| 关键词（同命令、同 `searchType=1`） | `research` rank1∩rank2 | `summary` |
| :-- | --: | --: |
| `机器人` / `PCB` | **50/50** | 50/50 |
| `人形机器人` | 9/50 | 15/50 |
| `新能源汽车` | 2/50 | 0/50 |

**真正的变量是关键词区分度。** 宽泛词下相关度拉不开差距、退化成时间序，这不是缺陷。决定性证据是内容级的：`新能源汽车` 组 rank1 前 50 有 47 条标题含「新能源」，rank2 只有 28 条。P2-7 已按修正后的机制**重新归档为已修复**。

🔴 **顺带纠正一条我们自己写错的建议**：`searchType` **完全不影响 `rankType=1` 取回哪些条目**（3 关键词 × 2 命令前 50 逐位相同，尽管 `total` 差 5–15 倍）。「要最相关必须加 `--search-type 2`」已从 `insight.md` / `SKILL.md` 撤掉。

**判别要点**：前三轮每轮的证据在各自样本里都自洽，而三轮各自只动了一个变量（端点 / `searchType`），真正的变量始终没被动过。

**5. 新发现：`screener` 静默丢弃 `parameters: []` 的指标（`server-open.md` P1-7）**

追 C7(1) 时查出来的。同一个指标，`cross-section` 传空参数表正常出数，`screener` 上**整条被丢弃**——200、无错误码、`indicatorList` 里那一项直接消失；表达式筛的就是它时条件等于没加、返 0 行，而**真·无匹配的载荷逐字相同**。带任意参数则报 `100003`，两侧都堵。上面那 31 个指标在选股上因此完全不可用，`contains` 类文本筛选（筛主板 / 筛经营范围 / 筛注册地）一条都做不了。

这是**回归**：2026-08-02 记过同样的丢弃行为，08-03 复测判已修，08-14 收紧后从另一侧堵了回来。**两个改动各自都讲得通，合起来把一整类查询变成不可达且不报错。** CLI 在本地拦下 screener 上的 opt-out（P1-7 修好后要撤）。

**6. C6 已订正**：`closed.md` P2-8 整段的 `industryList` 改为 **`industryIdList`**（请求体真实字段名，`industryList` 是**返回行**里的同名不同物字段——名字写错的源头）。照旧名字做黑盒复核会得出与结论正好相反的判断，MCP 差点据此误报。

**7. 台账**：`bug/` 新增 `python-downstream.md`（编号 `PY`，3 条）；`mcp-downstream.md` 关闭 D4、新开 D5/D6/D7；K13 扩写成「日期扇出的三种形态」；P2-7 先移回 `server-open.md` 又按修正后的机制移回 `closed.md`（当天三次）；新开 P1-7（screener 静默丢弃空参数指标）与 P1-8（年在后日期静默解析，从 P0-3 残留分出）；`bug/README.md` 补归档纪律的反面（关闭一条时残余必须独立立条）+ 三条零成本自检。

**8. 跨 session 复核走了 6 轮**（`/cross-review`，另一个干净上下文 session），签字放行。它抓到的 16 条里，**只有少数是逻辑错，绝大多数是「我的验证方法在骗我」**：

| 轮 | 抓到什么 | 类别 |
| :-- | :-- | :-- |
| 1 | 对外文案里的 rankType 绝对句被第三组关键词证伪；`P2-12` 悬空引用；`cdr_conv_ratio` 证伪 `iff` | 抽样下绝对结论 |
| 2 | `SKILL.md` 的祈使句里仍留着已撤回的药方；规则② 在「键写反」形态上给出**死路**建议 | 清扫遗漏 / 新形态 |
| 3 | 两条 nit「说改了其实没改」（批处理半途抛错）；**多指标批量报错时断言型 hint 指向错的指标** | 验证对象错 / 样本单一 |
| 4 | 批量规则的「成因各不相同」是假断言且构成能力回退；**我的 N2b 变异全绿是假阳性**（规则④ 无守卫，靠数组顺序兜） | 假断言 / 变异无覆盖 |
| 5 | 已撤回说法在 `README.md` 仍有残留 | 清扫遗漏 |
| 6 | 无（我自己按「概念扫」又扫出 `examples.md` 第四处同义残留） | — |

**这一轮真正的产出是 `bug/closed.md` K1 那条根因——「验证对象不是被验证的那个东西」，现在有八种面孔**：变异变错形态 / 拿陈旧 `dist` 跑 live / `N` 凭印象 / 用一个接口的字段校验另一个接口 / 转述只发半张配对表 / 批处理抛错却拿测试绿当验证 / 变异全绿当护栏有效 / 清扫范围按改动文件划。八种都会给出一个**很像成功的信号**，所以不会自己暴露。


---

### v0.34.1 — 2026-08-15

发版后逐条复核 `bug/cli-backlog.md` 的遗留项，关掉 6 条、新开 1 条，过程中修了两处代码。**经四轮跨 session 对抗审查**，其中三条实质问题是审查方独立跑出来的。

**1. EDE 报告期指标：报错里直接给出该改的 CLI 写法**

服务端对 `is_*` 等报告期类指标拒收 `tradeDate`，报「缺少必填参数 reportDate」——但没说在 CLI 里怎么改。`errors.ts` 新增按**消息内容**匹配的提示层（`100003` 是 EDE 所有入参错误的兜底码，按码只能给通用建议），直接给出 `--indicator-param "<code>:reportDate=..."`。

⚠️ **提示文案刻意不做归纳**：初版写成「报告期类＝`is_*`/`bs_*`/`cf_*`，`finc_*` 不受影响」，被 170 指标抽样证伪——7 个 `finc_*` 和 3 个 `div_*` 要 `reportDate`，8 个 `is_*` 和 4 个 `cf_*` 要 `tradeDate`。现在只说「以 `indicator search` 的 `parameterList` 为准」，并注明少数指标（`div_cash_yld`）两个日期都要、另有指标要 `fiscalYear`。同一句 msg 服务端会以 `100001` 或 `100003` 送达，两个码都收。

**2. 下载文件名缓存的并发写丢数据（K1，从「有意不做」翻案）**

两层：`flush` 取快照后到期的写会被接到已在 resolve 的 promise 上、永不落盘（两个 `await` 都正常返回）；`loadInto` 并发时各自建对象、后者覆盖前者。修法是 `flush` 循环 + 出口与释放 handle 同步化，`loadInto` 按**路径分键**的 promise coalescing。

单进程 CLI 够不着这个场景（判断至今成立），改的理由是修法便宜、且把「正确性依赖调用方自律」变成「模块自身正确」。

**3. 台账**：关闭 K1 / K3 / K4 / K5 / K8 / K12（其中 **K3 / K4 / K5 是早已做完、台账没回写**——反向检查一次抓到三条）；新开 **K13**（`DATE_PARAM_KEYS` 对「两个日期都必填」的指标会抑制 `tradeDate` 注入）。

**审查中值得留档的三条**：

- 修复本身引入了更糟的缺陷——`loadInto` 的 coalescing 没按路径分键，把「丢缓存」变成「返回别的文件的内容」
- 用 10 个关键词的抽样下了「没有交叉、没有遗漏」的绝对量词，**且是在自己刚写完「别按 code 前缀硬编码」之后**
- 🔴 **变异测试验错了对象**：变异让 handle 永不释放、连普通写都坏了，于是「3 条红」看起来像护栏有效；用正确的变异（退回旧形状但保留循环）一试，**全绿**——那处修复实际零覆盖。**变异要模拟「未来的人会怎么改回去」，不是「怎么把代码弄坏」**

---

### v0.34.0 — 2026-08-15

跟进 2026-08-14 服务端更新。**有破坏性变更，但破坏来自服务端**——本版做的是让它们尽早、清楚地暴露，而不是让用户对着一个指向错误位置的报错排查。

**1. 🔴 `quote day-kline` 的全市场关键字换了（破坏性）**

服务端把「历史日K线（A）」升级为统一的「历史日K线」，**停止支持 `["all"]`**，改为 `aShares` / `hkStocks` / `usStocks`，且市场标识**只能单独传**（不能与证券代码或另一个标识混填）。

CLI 侧：`--security all` 与混填都在**发请求前**报错，并直接给出该用哪个关键字。这一步是必要的——服务端对这两种输入都回 `120001「证券代码无效」`，提示是「用 securities-search 确认代码与后缀」，而代码本身完全正确，照着排查会一路走偏。

分片逻辑随之改为按市场取粒度（实测 2026-08-13 单交易日行数：A 股 5543 / 美股 5919 / 港股 2810）：`aShares` 与 `usStocks` 1 天/片、`hkStocks` 2 天/片，都保证单请求不撞 10000 行 API 上限。旧的三个命令仍用 `all`、粒度不变。

**2. `day-kline` 覆盖面扩大，三个旧命令标记下线**

`day-kline` 现在支持 A股/港股/美股个股 + 交易所指数（沪深京）、概念指数（`.GT`）、行业指数（中信 `.CI` / 申万 `.SWI`），**可在一次请求里混着传**。`day-kline-hk` / `day-kline-us` / `index-day-kline` 官方已从菜单下线（接口仍可调），help 与文档标注为 deprecated。

⚠️ **没有直接删掉它们，有实测理由**：`index-day-kline` 仍有两处 `day-kline` 做不到的能力——`--security all` 一次取全部 531 条指数，以及返回 `securityName` 指数名称（`day-kline` 查指数只有代码没有名称）。删掉会让这两件事没有替代路径。反过来 `day-kline` 独有 `adjustFactor`（指数为 `null`）。

`minute-kline` 同步扩展到交易所指数 / 概念指数 / 行业指数（仍是沪深，不含北交所，一次一只）。

**3. `ai stock-summary` 不再支持全市场批量（破坏性）**

服务端移除了传 `aShares` / `hkStocks` 返回全市场的能力，现仅支持按具体代码批量（A股、港股，单次最多 6000 个）。CLI 在发请求前拦下市场关键字——该接口按 **3 积分/条**计费，让失败落在请求之前而不是之后。

**4. EDE 报告期类指标必须显式传 `reportDate`**

服务端对 `is_*` 等报告期指标的 `tradeDate` 从「归一到所在报告期」改成了直接拒绝（`100003 不支持参数 tradeDate; 缺少必填参数 reportDate`）。CLI 的 `DATE_PARAM_KEYS` 机制本来就让用户传的 `reportDate` 顶掉注入的 `tradeDate`，所以补一个 `--indicator-param "code:reportDate=..."` 即可正常取数——但 `--date` 的 help 此前写着「服务端会 resolve 到报告期」，现在是假的，已改。

**5. 三大报表新增 `earliestAnncDate`**

首次公告日。**做 point-in-time 对齐改用它**：实测存在个股的 `announcementDate` 把四个季度全填成年报披露日（五粮液 FY2025 四期都返 `20260430`），而 `earliestAnncDate` 分别是 `20250426` / `20250828` / `20251031` / `20260430`，与公告列表一致。盘后披露计次日，即永不早于真实披露时点。

**5.5 跨 session 对抗审查后补修的三项**

发版前把改动交给另一个 session 独立复核，抓到三处必修（它跑的探针与我不同，这是价值所在）：

- 🔴 **`quote fund-flow` 把「关键字 + 代码」静默降级成单只**：`--security aShares --security 600519.SH` 此前 exit 0、只返 600519.SH 一行、无告警——服务端在这个端点上是**静默丢弃关键字**（统一 `day-kline` 则是硬报 `120001`）。同一个用户错误，两个端点一个硬失败一个给半个结果，后者正是 v0.33.0 要消灭的形态。`fund-flow` 现已接上同一个校验。
- 🔴 **`index-day-kline --security all` 的 30 天/片必然截断**：531 行/交易日 × 一个 30 天窗口约 22 个交易日 ≈ 11.7K，超 10K 上限。虽有 `truncatedShards` 兜底（不是静默），但**分片本就不该切出必然超限的窗口**，而且本版还把「一次拿全部指数」当作保留旧命令的理由推荐给了客户。粒度改为 **15 天**：实测同一区间从「20000 行 + partial」变成 **22833 行、无 partial**，找回约 12%。
- 🔴 **市场关键字大小写敏感**：API 本身不区分大小写（`ashares` 照常返全市场），而 CLI 精确匹配，于是 `--security ashares` 既过不了本地校验也匹配不上分片，落到单请求 6000 行——实测 12 天区间直接报 `100003 查询规模过大`、`hkstocks` 三天则被截断到 6000。关键字改为按小写比对并归一化后再下发。

顺带修正了**三处已判定「已修复」但客户侧警告没撤干净**的文案（`indicator.md` 的 `adjustmentType`、`fundamental.md` 与 `response-schema.md` 的 `companyType`/`currency`）——其中 `adjustmentType` 那条本文件上一版**已声称撤过而实际没撤**，比漏改更危险，因为下轮复核会照 CHANGELOG 当已完成跳过。根因记进了 `bug/closed.md` P2-1：那条只写「CLI 侧无需改动」，把「CLI 侧」默认等同于代码，漏掉 skill 文案。

还发现一个**测试在为 bug 背书**：`cliBodyMapping` 里的 fund-flow body 映射测试用的正是 `600519.SH` + `aShares`，等于把「混填照原样发出去」写成了期望值。已换成两个普通代码，混填交给新增的守卫测试。

**5.6 第二 / 三轮复核补的三件**

- **`index-day-kline --security all` 的 15 天粒度加了测试**：这一轮唯一的数值缺陷此前**零护栏**——把它改回 30 全套测试照样绿。现在 45 天区间 pin 了 index=3 片 / hk=23 / us=33。（写这条时我把工作日数算错一次，测试当场变红，正好证明它有效。）
- **`quote fund-flow` 的关键字归一加了测试**：实测六个 quote 端点，**只有 `fund-flow` 不折叠大小写**（`ashares` 返 `120001 非有效A股`，只认逐字 `aShares`），其余五个都折叠。也就是说 `canonicalizeMarketKeywords` 在另外五处只是让分片查表对得上，**在 `fund-flow` 上却是「删掉就从能跑变报错」**——而那一路原本没有任何测试。相关注释也从「the API is case-insensitive here」改成按端点分档，服务端侧不一致立为 `bug/server-open.md` **P2-11**。
- **`ALL` 被解析成全市场，澄清为「不是缺陷」**（`bug/closed.md` C4）：`all` 关键字与 Allstate 的 ticker 根固有碰撞，服务端在三个旧端点上对 `all` 一律大小写不敏感，正解是带后缀的 `ALL.N`。中途曾据此改成「对 `all` 大小写敏感」，实测反事实后**撤回**——那个改法保护不了任何人，反而把 `--security ALL` 跨 5 天的 29588 行完整结果换成 6000 行截断。

**6. 错误码提示更新**

`100006` 现在也涵盖「单页 size 超 50」；`130003` 从「该条记录可能未附带文件」改为覆盖「资源未生成」；`130002` 去掉「非法 file-type 也归此码」的断言（已拆到 `130005`）。

**7. 新增指标**

`scr_indu_citic` / `scr_indu_sw` / `scr_indu_gics` 三个行业组合指标（体系写进编码，只需可选的 `industryLevel`）；区间融资融券指标的 `changePeriod` 改为可选。

---

### v0.33.0 — 2026-08-09

四处**行为变更**，都是把「静默给出看着正常的错结果」改成显式失败。两处会改变退出码，对按 `!= 0` 判失败的脚本是破坏性的，故走 minor。

**1. 分页端点的异形首包不再静默通过（退出码 0 → 3）**

分页端点本该返回 `{total, list}`，真实的空结果是 `{total: 0, list: []}`。此前只要形状不对就原样透传、退出 0：
- `insight foreign-opinion` / `independent-opinion` 传 `--industry` 时服务端返 `data: null`，CLI 打印 `null` 退出 0——脚本无从区分「这个筛选确实没命中」和「这个筛选没生效」
- `total` 变成字符串这类形状漂移会把 fetch-all **截断成第 1 页**，而结果看着完整——比明显为空更危险

现在一律 stderr 告警 + **退出码 3**。全部 24 个分页端点都是真 `{total, list}` 列表（形状特殊的 `reference.constant-list` 没标分页，`null` 是合法答案的 `ai.one-pager` 也不分页），无误报空间。

**2. `total` 被服务端封顶时标 `totalCapped` 并退出 3（新增检测）**

`insight opinion` / `foreign-opinion` / `independent-opinion` 三个端点的 `total` **恒为 10000，而实际记录远不止**（把 `from` 加到远超该值仍能取到真实记录，`publishTime` 单调变老）。省略 `--size` 的全量拉取按 `total` 定目标，于是**正好取满 10000 条就停、`collected === total`**——短页、页失败、`total` 漂移三个完整性检查一个都不触发，导出的文件被截断却退出 0。`opinion` 按 30 积分/条计费，一次自以为完整的导出就是 30 万积分换一份截断数据。

现在全量拉取结束后**探一行 `from = total`**：探到数据就标 `partial` + `totalCapped` + 退出 3。**判据不写死 10000**，服务端改配置仍然有效；`total` 诚实时探针返回空、按条计费下不产生费用；传了 `--size` 的有界请求不探（要多少给了多少，没有完整性可言）。

代价是每次全量拉取多一个请求。实测非 opinion 端点全部通过（`summary` total 52 万、`research` 337 万，`from = total` 均返 0 行）。

**3. 空结果不再在 stdout 留一个空行**

`renderOutput` 返回空串时 `printData` 仍无条件补 `\n`，于是 jsonl / csv 的管道里躺着一个空行——`wc -l` 报 1、`while read` 读到一条空记录，正是「幻影记录」本身。现在空渲染**一个字节都不输出**；`table` / `markdown` 的 `(empty)` 标记和 `--format json` 的 `null` 保持不变。⚠️ 带 `--output` 时文件仍会创建：csv 写 3 字节 UTF-8 BOM、jsonl 为 0 字节。

**4. `null` payload 不再被渲染成一条记录**

`toRows(null)` 此前落到 `[{ value: null }]`，jsonl 输出 `{"value":null}`。现在 `null` / `undefined` 直接视为零行；`0` / `""` / `false` 不受影响（有回归测试钉住）。

**帮助文案与文档**

- `insight foreign-opinion` / `independent-opinion` 的 `--industry`、`foreign-opinion` 的 `--region`、`vault wechat-message-list` 的 `--industry` 加上「本端点当前不生效 / 不可靠」的说明与规避方法
- 7 个带 `--research-area` 的端点全部写明码系（`opinion` / `summary` / `my-conference` 此前是内联定义、漏在共享 helper 之外）
- 🔴 **EDE 缺数据的占位值不统一**：多数指标填 `null`，但 `is_dnrpnp`（扣非归母净利润）填 **`0`**，且是**指标属性、与日期对不对无关**——日期落在报告期末时，覆盖不到的证券同样返 `0`。`0` 会穿过比较与聚合：`screener` 的 `F1 > 0` 可能筛出空集、时序整列求均值可能差几十倍。已写进 `SKILL.md` 必备规则 #11 与 `indicator.md`，并订正 v0.32.0 那段「一律返回 `null`」的说法
- 新增：EDE 与 `valuation-analysis` **在非交易日行为不同**（前者返 `null`、后者顺延上一交易日），交叉核对时日期要落在交易日上
- `999004` 的提示改为覆盖「整库未开通」与「单条记录不可见」两种；错误码表把它从「未构造出」挪进已实测
- 对外措辞与数字清理：移除平台各库的绝对条数（含单独售卖库的总量与本机账号自有数据），改为 ✅/❌ 或相对幅度；描述服务端行为的措辞统一为「可观察结果 + 怎么办」

**测试** 637 → 643：分页封顶探测 3 条、空渲染不输出 3 条、异形首包退出码 2 条。修了三个**测试替身对任意 `from` 无限吐行**的问题——其中 `cliBodyMapping` 的 stub 忽略 `from`，意味着该文件此前所有分页断言都是空的。

### v0.32.0 — 2026-08-08

跟进 2026-08-07 的服务端更新：新增帕米尔专家纪要两个接口，并按实测**推翻了 v0.30.1–v0.31.0 三个版本累积下来的 EDE 缺数据模型**——那套「四档」判据整个作废了。同时移除一个已经变成误报的告警（`unreliable`），对读取该字段的脚本是破坏性的，故走 minor。

**新增**
- **帕米尔专家纪要** `insight pamirs-summary list` / `download`（`/application/open-insight/pamirs-summary/*`）。这是一个独立的专家纪要库，不是 `summary list` 的筛选项，**需单独购买专家纪要数据库**，且不受历史数据范围限制。
  - 筛选项是 `summary` 的**真子集**：只有 `--search-type` / `--rank-type` / `--keyword` / `--research-area` / `--security` / `--category` / `--market`，**没有** `--source` / `--institution` / `--participant-role`。没有复用 `summary` 的 body 构造：服务端会静默丢弃不认识的字段，照搬会让用户以为过滤生效、实际拿到全量（`insight roadshow` 那批命令当初就是栽在这上面）
  - `download` 归入 `no-replay`：spec 只写了权限门槛、没写单次价格，按其 `summary` 同类处理——万一计费，一次 5xx 重放就是双倍扣分，而判错的代价只是少一次重试
  - 实测（2026-08-08，账号有权限）：全量 2963 条；`--category` companyAnalysis 2673 / industryAnalysis 279；`--keyword PCB` 标题 36 / 全文 113；`--research-area` **citic 与申万码都生效**（食品饮料 citic `100800119` 143 / 申万 `104340000` 145）；⚠️ 方向码 `122000xxx` 在本端点返 0。翻页完整性干净（三页无重复无缺口、可重放、`total` 不漂移）

    > **订正（2026-08-08 晚）**：本条原写「食品饮料 373 / 145」——373 是用 `100800111` 测出来的，那是**电力设备及新能源**，不是食品饮料（食品饮料的中信码是 `100800119`）。同一个错码还写进了 `bug/` 报告的 P2-4 表和「帕米尔其他观察」，并由此推出一条错误结论，详见下面「申万码」那条的订正。
    >
    > ⚠️ **本条全部数字取自 2026-08-08 的权限窗口期**：同一账号 2026-08-09 复跑 `insight pamirs-summary list` 已报 `999004`（专家纪要库需单独购买），这批数字目前无法在本机复现。将来引用前先确认账号权限。
  - 🔴 **服务端缺陷：标签字段大面积不回填**（6 种查法 × 30 条实测）。`conceptList` **在所有查法下恒为空**，而接口没有 concept 过滤参数——目前**拿不到主题概念标签，无变通办法**。`categoryList` 与 `marketList` **绑定在一起**：用 `--category` 或 `--market` 任一过滤时两者都回填（30/30），其余查法（无过滤 / `--security` / `--research-area` / `--keyword`）两者都空。回填的是该记录**全部**的值（多市场纪要按 `aShares` 过滤也回 `["aShares","hkStocks"]`，排除了「回显过滤值」）。文档已写明：别拉全量再本地分组
  - 🟡 服务端未执行 spec 写的「单页最大 50」（传 100 返 100）。CLI 仍按 50 翻页——保守值在服务端某天开始执行上限时不会被静默截断
  - ✅ 翻页完整性实测干净：`from=0/50/100` 三页 150 条零重复零缺口、同一页两次请求完全一致、`total` 不随分页漂移、`from` 越界返空列表；`--security` 过滤命中的 15 条逐条核对全部真含该证券
- 补 `230002`（微信账号未绑定）的错误提示与测试。该码属私域模块，而 `vault wechat-*` 正在该模块下、明确要求「已绑定并激活群消息助理」——够得着，不能只登记不接提示

**EDE 缺数据模型作废重写（🔴 这是本版最重要的一条）**

v0.30.1 起我们记录并逐版加固的判据是：服务端不给缺数据补 `null`，某指标对全批证券无数据就**整列消失**、某证券对全批指标无数据就**整行消失**，还得靠「同批里还查了什么」推断落进四档中的哪一档。v0.31.0 甚至把它写成了「两个维度各自独立」的完整表格。

**2026-08-08 实测：整个模型没了。** 服务端现在给缺数据补占位单元格，行列一律保留：

> 🔴 **订正（2026-08-09）**：本节原写「补 `null`」，**占位值其实不统一**——多数指标是 `null`，但 `is_dnrpnp` 等个别指标填 `0`，且是指标属性、与日期对不对无关。`0` 会穿过比较与聚合，比 `null` 危险得多。作为 `bug/server-open.md` **P0-5** 单独立条，`closed.md` F1 已标部分订正。下面表格里的「1 行 `null`」等具体观测仍成立（那三个指标确实是 `null` 一档），但**别把它读成通则**。

| 查法 | 旧行为 | 现行为（2026-08-08 实测） |
| :--- | :--- | :--- |
| `finc_pb_mrq` × `09992.HK`（港股无 PB 数据） | 四数组全空，退出 0 | 1 行 `finc_pb_mrq: null`，退出 0 |
| `finc_pb_mrq` × 茅台 + 泡泡玛特 | 泡泡玛特**整行消失**，退出 3 | 2 行，泡泡玛特为 `null`，退出 0 |
| `finc_pb_mrq` + `qte_close` × 仅泡泡玛特 | PB **整列消失**，退出 3 | 1 行 2 列，PB 为 `null`，退出 0 |
| `mgn_bal` × `00700.HK`（融资融券仅 A 股） | — | 1 行 `null`，退出 0 |
| `qte_close` × `--date 2027-01-04`（未来日期） | — | 1 行 `null`，退出 0 |

**仍然会整列/整行消失的，只剩「服务端解析不了那个 code」**：

| 查法 | 结果 |
| :--- | :--- |
| `--indicator qte_close --indicator not_a_real_code` | `not_a_real_code` 整列消失，退出 3 + `omittedIndicators` |
| `--security AAPL.US --security AAPL.O` | `AAPL.US` 整行消失，退出 3 + `omittedSecurities`（美股后缀是 `.O`/`.N`，`.US` 本身就是错代码） |
| `--indicator not_a_real_code --security 999999.SH` | 全空表，退出 0（无从判断是哪一轴写错） |

**所以 `partial` / 退出码 3 的语义反转了**：从「这批数据不完整，去查 scopeList 覆盖和日期语义」变成**「你有 code 写错了，去查拼写和证券后缀」**。这是净收益——拼错代码原本是完全静默的（退出 0、表看着正常、`--key-by code` 回填时 key 直接不存在），而真实的覆盖缺口现在也留在表里（就是那个占位单元格），多数情况不再需要「和一个已知有数的标的一起查」那套对照法。⚠️ **但只有 `null` 那一档一眼可见**——填 `0` 的指标（`is_dnrpnp`）无覆盖时与真值无法区分，对照法仍然必要，见 `bug/server-open.md` P0-5。检测代码本身没动（同一份 diff 逻辑），改的是它的**告警文案与文档解释**，以及 `flagDropped` / `droppedFromMatrix` 的注释。

同步改写：`SKILL.md` 的缺数据段与退出码 3 说明、`indicator.md` 的「缺数据的四种形态」整节、`response-schema.md` 的 EDE 概述、`examples.md` 的例 15 第 6 条。

**枚举参数改为本地白名单拦截（破坏性）**

服务端对**非法枚举值**的处理和对**未知字段**一样——静默丢弃该条件、返回未过滤的全量、退出码 0。最坏的一例是非法 `searchType` 会**连带吞掉 `keyword`**：

| 命令 | 正常 | 非法 `--search-type 99` |
| :--- | ---: | ---: |
| `insight summary list --keyword 茅台` | 135 | **196988（全库）** |
| `insight research list --keyword 茅台` | 776 | **707847（全库）** |

调用方读到的是「搜索茅台的结果」，实得全库转储，自动化流程里几乎不可能发现。

改动：`--search-type` / `--rank-type`（共 19 处）改用 commander 原生 `.choices(["1","2"])`；`--file-type`（9 处 download，含 `foreign-report` 的 1–4）在 `addDownloadCommand` 的 spec 里新增**必填**的 `choices` 字段（类型上强制，防止将来新增下载命令漏掉）；帕米尔的 `--category` / `--market` 走既有的 `parseChoiceList`，枚举提成常量并反向拼进帮助文案，避免枚举与文案漂移。全部在本地拦截、**不发请求**。

**破坏性**：此前 `--rank-type 3`、`--file-type 99` 这类值能跑完（服务端静默忽略或照常下载），现在直接报错退出 1。合法值行为不变（实测 `--search-type 2` → 2338、`--category companyAnalysis` → 2673、`foreign-report --file-type 4` 正常放行）。

> ⚠️ **`--rank-type` 的行为查了三轮才收敛，结论写在 `insight.md` 开头**。中途两次误判都记在这里防止再犯：第一次判成「死参数」（只在无 `--keyword` 下测，那时综合排序无从计算，自然无差异）；第二次判成「只影响并列时间戳的 tie-break」（只在 `summary`/`research` 上测，那两个端点确实如此）。
>
> 全量实测三端点 × 两种 `--search-type` 后的实际情况：`--rank-type 2` 永远严格按 `publishTime` 倒序；`1` 的强弱**按端点不同**——`pamirs-summary --search-type 2` 是**真正的相关度重排**（`rank1` 对两个时间字段都不单调，`rank2` 的首条掉到第 118 位，且该结果集**零并列时间戳**，排除 tie-break 解释），而 `summary`/`research` 的 `rank1` 仍严格时间倒序、只改变并列处的先后。教训：**排序类参数必须跨端点 × 跨 `searchType` × 全量取数验证**，任何一维取窄了都会得出自洽但错误的结论——这次三轮探测分别在 `keyword`、端点、`searchType` 三个维度上各取窄过一次，每次都得到内部一致的错误答案。**跨人复核这类结论时先对 `total` 再对内容**：本轮两边卡了很久，直到发现 `AI` 的 total 一个是 118、一个是 448，才定位到打的根本不是同一个查询（标题搜索 vs 全文搜索）。

**移除已成误报的 `unreliable` 告警（破坏性）**
- **screener 把同一 `indicatorCode` 绑到多个变量已被服务端修复**（2026-08-08 复测）。旧缺陷是所有绑定按其中最早的日期取数、值落到第一列其余置 `null`，还有约 1/3 概率返空集；现在 `F1@08-07 + F2@08-06` 各自返回 1309.22 / 1308.55，与 `time-series` 对照完全一致，连跑 5 次稳定。
- 因此移除 `unreliable: true` + `duplicatedIndicators` 标记、对应 stderr 警告、`duplicateScreenerCodes()`，以及 `printData` 里 `unreliable` 触发退出码 3 的分支。继续保留只会把一个正确结果标成「整份不可信」并退出 3。
- **破坏性**：读 `unreliable` / `duplicatedIndicators` 字段的脚本会拿到 `undefined`，这类查询的退出码从 3 变 0。退出码 3 现在只由 `partial` 触发。
- 测试与本地 stub 一并改为镜像修复后的行为（stub 原先硬编码 `[1350.6, null]`）。

**其余复测结论（服务端侧，本版只改文档不改代码）**

⚠️ **订正一条归因**：本版最初把官方 changelog 里「时序同一 `indicatorCode` 多套参数」那条记成了「我们验证的 screener 修复」，是错的——那条讲的是 `time-series`，两件事。经确认，**截面与时序在设计上就不支持同一 code 多套参数**（要拆两次调用），只有 `screener` 支持，因为它把指标绑到不同变量上。CLI 的 `parseIndicatorParams` 按 code 建 Map、同 code 参数合并成一组，**与该设计一致**，无需改动。🔴 需要注意的是服务端对这种输入是**静默处理**：raw 直发会取最后一组并丢弃其余（`adjustType` `[2,3]` 返 13609.6168=后复权、`[3,2]` 返 1531.225=前复权），不报错——已作为「不支持的输入应报错而非静默降级」反馈后台。

已修复：
- **根级 `--scale` 不再污染不支持 scale 的指标**：`qte_close` + `qte_mkt_cptl` 加 `--scale 8`，收盘价照旧 1309.22、市值正确缩到 16366.3183 亿（旧行为是把收盘价缩成 `0`）
- **`contains` / `notcontains` 大小写不敏感**：`F1 CONTAINS '酒'` 与小写同为 19 命中（旧行为报表达式语法错）
- **`indicatorList` / `securityCodeList` 顺序稳定**（旧行为随机重排）。⚠️ 但**两个轴排法不同**：`indicatorList` = 请求顺序；`securityCodeList` 是**按代码升序重排**、不是请求顺序（请求 `000858,600519,000001` → 回 `000001,000858,600519`，连跑 3 次一致）。行序不能按请求下标对位，一律按 `security` 字段取值
- **吃 `reportDate` 的指标收到 `tradeDate` 不再静默返空**：服务端会归一到所在报告期，`is_op_rev_mom` 两种传法都返 33.4903（@2026-03-31）。CLI 的「已传 reportDate 就不注入 tradeDate」逻辑保留——发用户自己的日期字段是更诚实的请求，也扛回滚

仍未修复（文档里的警告继续有效）：
- `adjustmentType` 错名仍**静默退回不复权**（1685.01 = 不复权，正确的 `adjustType=3` 是 13609.6168）
- 日期「年在后」格式仍按分隔符翻转日月且静默误解析：`07/01/2026` 与 `01-07-2026` 都被读成 1 月 7 日（基准 `2026-07-01` 返 1749 条，两者均返 1551 条）。CLI v0.28.0 的本地拦截继续保留
- Quote 系对非法证券代码仍静默返 `total: 0`
- `fundamental balance-sheet` 的 `companyType` / `currency` 取值仍互换（茅台返 `companyType=人民币` / `currency=一般企业`）
- ~~申万码仍不能用于 `--research-area`（用于 `--industry` 正常：食品饮料 research 4544 / opinion 2495）~~

  > **订正（2026-08-08 晚，gangtise-mcp 侧交叉复核后复测）**：这条一刀切写法是错的，**申万码按端点区分**——`summary` 和 `pamirs-summary` 认，其余返 0。且不是服务端缺陷：`reference constant-category` 的 `usageScopes` 里 `swIndustry` 声明的就是「查询纪要列表 :: researchAreaList」，行为与声明一致。逐端点实测（食品饮料，中信 `100800119` / 申万 `104340000` / 方向宏观 `122000001`，各跑 3 次数值不漂）：
  >
  > | 端点 | 中信 | 申万 | 方向 |
  > | :--- | ---: | ---: | ---: |
  > | `summary` | 15678 | **16016 ✅** | 9446 |
  > | `pamirs-summary` | 143 | **145 ✅** | 0 |
  > | `opinion` | 5038 | 0 | 4752 |
  > | `roadshow` | 11630 | 0 | 11892 |
  > | `site-visit` | 2620 | 0 | 197 |
  > | `forum` | 206 | 0 | 112 |
  > | `vault my-conference-list` | 12 | 0 | 9 |
  >
  > 不只是 total 对上：用申万码查 `summary` 取回的 30 条记录，`researchAreaList` 全部是 `{100800119, 食品饮料}`——服务端确实把申万码映射到了内部行业，排除了「非零数字纯属巧合」。
  >
  > 唯一仍算服务端不一致的是 `my-conference`：`usageScopes` 声明 `swIndustry` 可用于「我的会议查询 :: researchAreaList」，实测食饮/电子/医药三个行业全返 0（中信码对应 12/17/16）。已记入 `bug/` P2-4。
  >
  > 引用的 `--industry` 数字（research 4544 / opinion 2495）也不复现，**已于 2026-08-09 全部重测**，结论一并订正：申万码在 `--industry` 上确实生效，但**与中信码不等效**——4 个端点里 2 个结果集对不上。食品饮料实测（中信 `100800119` / 申万 `104340000`）：research 22874/22874 相等、foreign-report 15507/15507 相等，**opinion 5195/4946、official-account 102776/100576 不等**。所以文档口径是「都能用，但别混用」，不再写「等效」。权威口径见 `gangtise-openapi/references/commands/reference-and-lookup.md`。
- 未知 body 字段仍被静默丢弃（这正是帕米尔命令不复用 `summary` 参数集的原因）

**新增指标（服务端数据侧）**
- 融资融券 21 个 `mgn_*`：`mgn_bal` 两融余额、`mgn_fin_*` 融资（余额/买入/偿还）、`mgn_sl_*` 融券（余额/余量/卖出额量/偿还额量）、各自的 `_intvl` 区间变体、`mgn_flag` 是否标的（字符串「是」/「否」）。**`scopeList` 与实测都只有 A 股**，港/美股返 `null`
- 行业分类 `scr_indu`「所属行业」：一个指标覆盖四套体系，A/港/美股均支持，返回字符串。**两个必填参数** `industryType`（1 申万 / 2 中信 / 3 恒生 / 4 GICS）+ `industryLevel`（0 全路径 / 1–4 各级），缺任一报 `140002`。体系要与市场配对——茅台查恒生或 GICS 都返 `null`
- `finc_pb_mrq` 现在每个交易日都有数（v0.30.x 已记录，本次复测仍然如此）

**数据权限范围（2026-08-07 官方放宽）**

行情/财务/指标 3Y→**5Y**、投研线索 7D→**1M**、主题/热点/日程/纪要/观点/研报/公众号 1M→**3M**、管理层讨论/公告/行业 1Y→**3Y**。

⚠️ **以上是官方公布的口径，不是实测边界**——本次验证账号被后台单独开通了 10 年扩展权限（其他客户仍按试用/正式档走），实测下界落在 **2016-01**：日 K 传 `--start-date 2010-01-01` 返 2574 条、最早 `2016-01-04`；`fundamental` FY2016 有数、FY2015 报 `110003`；EDE 截面 / 时序取到 `2016-01-04`（茅台 210.02）。**别把本仓库任何时间范围结论当作平台口径。**

🔴 **但 EDE 三个接口的放宽不一致**：`cross-section` / `time-series` 已放到 2016，**`screener` 仍卡 today−3 年滚动**。边界二分（今天 2026-08-08）：`2023-08-07` 报 `110003`、`2023-08-08` 通过；同一天 `@2020-01-02` 的对照很干净——同指标 `qte_close` 同证券 `600519.SH`，`cross-section` 正常出数、`time-series` 返 7 行、`screener` 直接 `110003`，排除了数据缺失的可能。撞界时改用 `cross-section` 拉数再本地筛。已写进服务端问题报告。

顺带订正 `SKILL.md` 里「`110003` 未触发（1900 年至今仍正常返回）」的旧结论：**它是能触发的**，且本轮是触发最频繁的码。同时改掉了 `errors.ts` 里「缩短查询窗口后重试」这句提示——整个区间都早于权限下界时（如 `--fiscal-year 2015`）缩窗口没有用，应当把日期移进范围或联系客户经理。

### v0.31.0 — 2026-08-03

**退出码语义变更，对按 `!= 0` 判失败的脚本是破坏性的**（详见下节，也是本版走 minor 而非 patch 的原因）；另修复 v0.30.1 的一个回归，并按实测收紧多处措辞。

**修复**
- 🔴 **`indicator time-series` 传单个板块 ID 直接报错退出**（v0.30.1 回归）。v0.30.1 把时序的列轴判定改成只看请求里 `--security` 的条目数，但**板块 ID 是服务端展开的**——请求 1 条、响应 N 只，于是判成指标轴，随即被同版新加的矩阵维度校验拦下：`Indicator matrix shape mismatch: got 19 value rows for 1 indicators`，退出码 1。而这恰恰是板块 ID 在时序接口上**唯一合法**的用法（多指标时不允许传板块 ID）。触发条件很窄：`--security` 恰好 1 条且会展开成多只；传两个板块 ID 或板块+代码混传都正常，只有最标准的单板块写法炸。

  轴判定改为响应优先、请求兜底：响应有多个指标 → 指标轴；响应有多只证券 → 证券轴（板块展开走这条）；两边都是 1 才回落到请求数（这是 v0.30.1 要解决的「服务端丢掉无数据证券后仍要按证券标列」）。补了缺失的那档测试：请求 1 条 × 响应 N 只。

**措辞订正**
- screener 重复 `indicatorCode` 的警告此前说「服务端返回空结果」，实测更糟也更不稳定：至多一个变量拿得到值、其余恒为 `null`，同一请求有时返一行、有时整体返空（`F1@07-31 + F2@2024-01-02` 返空，顺序对调后返 `[[1685.01, null]]`）。涉及 `null` 变量的比较等于没筛，警告改为强调**结果不可信**，避免用户看到有数据就以为警告与自己无关
- `time-series` 的输出说明补上「板块 ID 算多证券」：传 1 个 `sectorId` 会展开成 N 列

**退出码语义（对脚本是破坏性变更 → 走 minor，不是 patch）**

约定为：`0` 完整成功（**含合法空结果**）／`3` 有数据但不完整或不可信／`1` 硬失败。

版本号选 `0.31.0` 而非 `0.30.2`：退出码 3 的覆盖面扩大对按 `!= 0` 判失败的脚本是破坏性的，而 `^0.30.1` 会自动吃下任何 `0.30.x`、却不会吃 `0.31.0`——minor 位正好把这层隔离做出来。与 v0.30.0（`universe` 改名 + 矩阵转置）同为破坏性变更走 minor 的先例一致。

- **服务端整行/整列丢数据 → 标 `partial` + 退出码 3**，并在结果里附 `omittedIndicators` / `omittedSecurities`。此前只写 stderr，退出码仍是 0、JSON 无任何标记，自动化调用方把一份短结果当完整结果用。这与「翻页失败」「行数触顶」是同一类缺陷，因此复用同一套信号
- **screener 重复指标 → 标 `unreliable` + `duplicatedIndicators` + 退出码 3**。这类结果不是"少了行"而是"在场的值不可信"，所以用 `unreliable` 而非 `partial`，`printData` 两者都触发退出码 3。**状态是「已检测并告警，等待服务端修复」，不是「已修复」**——服务端缺陷仍在，已报后台。
  - 2026-08-03 用相邻交易日重新定性，比最初的判断更严重：服务端把重复绑定**全部按其中最早的那个日期**取数，该值落到它们的第一列、其余列 `null`。所以**活下来的数字未必属于它标注的变量**——`F1@07-31 + F2@07-30` 的 F1 列返回 07-30 的 1361.76，F1 自己请求的 1350.6 全程没出现。六种组合（含三绑定、正反序、跨两年）全部吻合，判别性用例是 `F1@07-29 + F2@07-31` → 返回 1321.0（F1 自己的，若是「后者覆盖」应为 1350.6）。命中的证券集合同样不可信，且同一请求约 1/3 概率返回空集（恒真表达式下 12 次测得 4 次）。警告文案与 skill 说明都已按「整份结果不可用」改写
- **合法的全空结果保持退出码 0 且不标任何缺失**。整个查询无数据时，「请求 vs 响应」的差集按构造就是全部——把每个请求的 code 都列进 `omitted` 是假元数据。现在这种响应只在 stderr 提示「无数据也可能是参数名/日期字段写错」，不碰 `partial`（实测：纯周末区间 TD 查询修前被标 `partial` + 全量 `omitted` + 退出 3）
- 触发门槛比看上去高：只要批量里有一个广覆盖指标（如 `qte_close`），行和列都保得住，跨市场查询仍是退出 0 + 一堆 `null`；真正触发的是「某指标一个值都没有」或「某证券在全部指标上一个值都没有」

**收紧**
- **畸形矩阵不再伪装成「合法全空」**。`isEmptyMatrix` 此前只看两个轴列表为空，于是 `values: null`、缺 `values`、以及「`dates` 有值但 `values` 为空」都被判成合法空结果：前两种把原始信封原样打印、第三种造出一条只有 `date`、没有任何证券/指标身份的幽灵行，**全部退出码 0**——恰好绕过本版新增的所有矩阵保护。现在要求每个**结构性**数组都为空才算合法空结果：`securityCodeList`、`indicatorList`、`values` 必须是空数组，`dates` 存在时也必须为空（实测 2026-08-02：时序的无数据应答是五个空数组，截面是四个——它根本不带 `dates` 键，所以判据是「缺省或为空」而不是固定个数）。`securityNameList` 有意不校验：它只是展示用标签、不承载结构，`null` 也错不了位，而把它算进去会重新引入本函数要防的那个假 partial
- **缺数据判据是两个维度，不是一个**（订正本条目前面几处的说法）。中间几稿写成「取决于同批里有没有别的**标的**有数」，把指标那一维吞掉了，对单指标批次会给出相反的预测。实测四档（2026-08-03，`finc_pb_mrq` 无港股数据）：

  | 查法 | 结果 |
  | :--- | :--- |
  | `finc_pb_mrq` + `qte_close` × 茅台 + 泡泡玛特 | `null` 单元格，退出 0 |
  | `finc_pb_mrq` + `qte_close` × 仅泡泡玛特 | PB **整列**消失，退出 3 + `omittedIndicators` |
  | 仅 `finc_pb_mrq` × 茅台 + 泡泡玛特 | 泡泡玛特**整行**消失，退出 3 + `omittedSecurities` |
  | 仅 `finc_pb_mrq` × 仅泡泡玛特 | 整表为空，退出 0、不标 partial |

  判据：单元格 `null` ⟺ 该**证券**在同批还有别的指标有数 **且** 该**指标**对同批还有别的证券有数；整列消失 ⟺ 该指标对同批所有证券都无数；整行消失 ⟺ 该证券对同批所有指标都无数。**要把「整行消失」降级成 `null`，得加有覆盖的指标，不是加有数据的证券**——第 3 行就是反例。
- **`securityNameList` 异常不再静默错标，但也不会因此炸掉整条命令**。名称是**按位置**消费的：`["泡泡玛特"]` 配 `["600519.SH","09992.HK"]` 会把茅台的序列标成泡泡玛特，`[null]` 元素则渲染出一个字面量叫 `"null"` 的列（都是 2026-08-02 实测）。现在长度不符 → **整份丢弃名称、列头回落证券代码 + stderr 警告**；单个元素为 `null` / 空 / 纯空白 → 该列静默回落代码（对某只证券没有名字是合理的）；**非字符串**元素 → 回落并警告一次。**有意与本模块其他守卫不对称**：那些守卫拦的是「值被错误归属」，必须致命；这一条拦的只是标题，而 `securityCodeList` 本身就承载身份——丢标题保数据，比连正确的数值一起毙掉更优
- **时序响应同时出现多证券和多指标 → 硬失败**。这是接口明确不支持的形态（作为**请求**服务端自己会报 `100003`），作为**响应**则无法归属：无论哪个轴当列，另一个轴的身份都会被静默丢掉，而请求与响应的差集又是空的，连 `partial` 都不会标（实测 2×2 渲染成「收盘价/成交量」，两只证券身份全没）
- **`cross-section` 没有名称列表时不再建 `name` 键**（此前是 `name: undefined`——JSON 里看不见，CSV/table 却实打实多一列空的）。也不回落成证券代码：行轴 `security` 已经是代码，复制一遍没有信息量。（时序的**列头**确实会回落到代码，两者是不同的东西）
- **矩阵端点的异形载荷一律硬失败**。此前 `null`、数组、以及不含任何矩阵字段的对象都会被原样透传（`data: null` 直接把 `null` 打到 stdout、退出码 0）。「要给 `indicator search` / `raw call` 留透传」的理由不成立——前者根本不经过拍平函数、后者完全绕开，三个矩阵命令不可能合法地收到这些形状。现在它们走 `requireIndicatorMatrix`：在**丢弃信封之前**校验，因为 `data: null` 承载不了那个不可枚举的 traceId，只有拿信封当 details 才能让这类失败仍可追踪。拍平函数本身也不再透传任何非矩阵载荷
- **身份轴的元素一律不许强转**。`securityCodeList` / `dates` 的元素此前走 `String()`，`null` 会变成字面量 `"null"` 并作为一个看着完全正常的标签打出来（实测 `dates:[null]` → `date:"null"`、`securityCodeList:[null]` → `security:"null"`，全程 exit 0）；`indicatorList` 里的非对象元素会塌成 `{}` 再以 `col0` 出现，`--key-by code` 根本映射不回请求。现在这三处要求：证券代码与日期必须是非空字符串，指标条目必须带非空 `code`，否则抛形状错。**捏造出来的身份比缺数据更危险**——它看起来是有效答案
- **条件选股校验返回的变量绑定**。响应里每列带的 `field` 是**唯一**能把这一列追溯回它来自哪个筛选条件的东西，而载荷里没有任何别的信息能发现它漂了：实测把请求的 `F1` 换成 `F9` 返回，CLI 照样退出 0、stderr 全空、打出一张正常的选股表。现在只要**有证券命中**就要求：每个返回条目命名一个**请求过的**变量、带该变量对应的 code、不重复；缺列的变量按表达式的**布尔结构**判定（详见下条）——整个表达式再无可求值分支时**退出码 1**（这不是「少了行」也不是「值可疑」，是整份结果无法归属到条件，不该打印）。
  - **致命判定按表达式的布尔结构走**，不是「有没有 `||`」。把缺列的变量当作无法求值，看整个表达式是否还有一条能成立的分支：`A && B` 要两边都可求值，`A || B` 只要一边。
    - 起因：早先的规则是「表达式用到的每个变量都必须有列」，对析取不成立——实测 `F1 > 0 || F2 > 0` 扫 `09992.HK`（`finc_pe_ttm` 无港股覆盖），泡泡玛特靠 `F2 > 0` 正当命中，服务端给的是**一份正确完整的答案**，却被整份丢弃。「PE 低 **或** 价格高」扫港美股是很普通的筛法
    - 但只看「含不含 `||`」又太松：`F1 && (F2 || F3)` 缺必选的 F1、以及 `F1 || F2` 两列全缺（没有任何可求值分支），都会被错误放行。所以实现了一个最小的布尔求值器（含括号、字符串字面量保护），三种情形各有单测与 CLI E2E 钉住
  - 这套判定写进了随包 skill（`SKILL.md` 的退出码 3 说明 + `indicator.md` 的缺数据表 + `response-schema.md` 的缺数据说明），并各有 E2E 钉住三档：**无可求值分支** → 退出 1 且 stdout 为空；**仍有分支可求值**（如 `F1 || F2` 只缺 F1）→ 退出 3 + `omittedIndicators` 且数据行照常输出；**缺的只是未参与表达式的辅助变量** → 同样退出 3 且数据保留
  - 「少一列可能只是被筛掉了」这个直觉是错的：**筛选移除的是证券（行），永远不是指标（列）**。某列消失意味着该指标对所有命中证券都无数据，也就是写在它上面的条件根本无法证明被执行过，而那些行却是以「通过了该条件」的名义呈现的。实测两种漏网形态——只返回 `F1`（表达式是 `F1 > 0 && F2 > 0`）、以及命中一只证券但 `indicatorList: []`（打出只有代码和名称的「命中行」）——此前都是退出 0
  - 绑定了但**没参与表达式**的辅助指标缺列，只是少了输出信息、不影响正确性，降级为 `partial` + 退出码 3
  - 整批全空的结果没有命中、不绑定任何东西，照常退出 0
- **条件选股的空结果也给歧义提示**。`SKILL.md` 承诺全空时 stderr 会提醒「也可能是参数写错」，但 screener 此前不走 `flagDropped`、空结果静默退出 0。现在三个矩阵命令的承诺一致，且 screener 的判据是「**零证券命中**」而非严格的「四个数组全空」——一个返回零证券却仍回显 `indicatorList` 的响应，对调用方一样是空的、一样有歧义
- **`--indicator` / `--security` 本地拦截**。两者都是可重复选项、Commander 标不了必填，但每个矩阵端点都至少各需要一个，缺了要发一趟请求才换回 `100001`，而它的提示又让用户去看 `--help`——`--help` 里恰恰显示成可选、默认 `[]`。现在本地报错、不发请求，且消息点名是哪个 flag
- **时序数据必须同时具备两个身份轴**。`securityCodeList: []` 配一个有数据的矩阵，行数列数照样对得上，此前没有任何守卫会注意到，而每一行都不属于任何证券
- **必需轴缺失或类型错误不再透传成功**。透传条件写的是「完全没有轴字段」，实际却是「**任意**一个轴解析失败就透传」——于是时序返回完整的证券/指标/values 但 `dates: null`、或 screener 缺 `indicatorList`，都会原样打印原始信封、退出码 0、stderr 全空，本轮的形状保护照样被绕过。拍平函数现在对**任何**非矩阵载荷都抛错（包括一个矩阵字段都不带的对象）；只要进到拍平函数，该端点需要的每个轴（截面/选股：`securityCodeList` + `indicatorList` + `values`；时序另加 `dates`）都必须在场且为数组，否则抛形状错并带 traceId
- **矩阵形状校验补上第二个维度**。v0.30.1 只校验行数，现在每行的单元格数也必须等于列轴长度（截面=指标数、时序=日期数）。此前行长不符会静默丢值或留下幽灵列——正是这个 API 最擅长的那种无声失败。实测确认服务端**恒定按 `null` 补齐行内单元格**、从不返回不等长行（A/HK/US 三市场 × 4 指标，美股缺 3 个仍是满长度行；跨市场时序也按交易日并集补满），所以按精确相等校验是安全的
- **修掉一条靠子串巧合通过的测试**。`client.test.ts` 断言 999999 的 hint 含「无数据」，而 v0.30.1 改写后「无数据」只出现在否定句里（「查询无数据现在返回空表**而不是**此码」）——测试照样绿，但已不再验证它声称的东西。改为断言 hint 含 `parameterList` / `指标周期` 且**不含**「稍后重试」，并补一条 `indicator.screener` 也走同一 hint 的用例

**文档（随 npm 包分发的 skill，逐条实测订正）**
- 🔄 **港/美股覆盖在发版窗口内被服务端补齐，随包 skill 的否定断言同步订正**。2026-08-03 实测：`qte_mkt_cptl`（总市值）与 `shr_tot`（总股本）**A/港/美股均已有数**（泡泡玛特 2165.47 亿 / 腾讯 43207.64 亿 / 苹果 45128.55 亿），`finc_pe_ttm`（PE TTM）**港股已有数**（腾讯 16.15 / 泡泡玛特 14.93）；`finc_pb_mrq`（PB MRQ）仍只有 A 股。
  - 这是**最难发现的一类文档过期**：正面结论过期会给错数据（会被察觉），否定结论过期只会让 agent 拒掉一个现在能跑的查询——不报错、不告警、只是少一次调用。原文写着「PE/PB 等核心估值 EDE 也只有 A 股，别假定港/美股估值能从 EDE 取」，而回退目标 `valuation-analysis`/`earning-forecast` 又标着仅 A 股，于是 agent 会回报「当前 CLI 无可用口径」，实际有数
  - `indicator.md`、`SKILL.md`、`quote.md` 里的相关表述全部订正，并给这类结论加上了约定：**否定断言一律注明「以当次 `scopeList` + 抽查为准，本结论截至 YYYY-MM-DD」**，让读者知道要复验而不是直接信
  - `scopeList` 与数据不同步是双向的：08-02 是 `qte_mkt_cptl` 声明超前于数据，08-03 数据补齐后换成 `finc_pb_mrq` 声明超前。「声明不是保证」这条仍然成立，只是例子换了
- **纠正上一稿对港/美股市值的过度修正**。中间几稿写成「不是 `null`，只会整列消失」，实测（3 证券 × 3 指标）确实拿到了 `null` 单元格、退出码 0。⚠️ 当时给的判据「取决于同批里有没有别的**标的**有数」后来被证伪——见本节末「缺数据判据是两个维度」。三档口径（部分缺 → `null`／整指标整证券缺 → 整列整行消失 + 退出码 3／整批全空 → 空表 + 退出码 0）保持不变
- 🔴 **MRQ 口径已变，旧文档会导致错数**。`indicator.md` / `examples.md` 都写着 `finc_pb_mrq` 只在报告期末打值、交易日取 `null`，要改用季末日期。2026-08-02 复测：**任意交易日都有数且逐日变动**（茅台 `07-31`=6.2325 / `07-22`=6.0221 / `06-30`=5.4706 / `03-31`=7.0634，五粮液与宁德时代同样）。照旧文档改用季末日期会拿到 4 个月前的陈值——茅台 7.0634 比当日 6.2325 高 13.5%，在估值指标上就是实打实的错数。「日期路由」整段结论跟着调整：PE 与 PB 现在同为日频、用同一个交易日即可，示例也从"拆三次截面"简化成两次
- **`response-schema.md` 的 EDE 概述整段过期**：还写着「三个接口」「平行 `indicatorCodeList`/`indicatorNameList`」「截面 `[指标][证券]`」「无数据为 `null` 单元格」，与同文件后半段自相矛盾。改为四个接口、结构化 `indicatorList`、截面 `[证券][指标]`（并注明该版转置过），以及四档缺数据形态
- **`usageRestriction` 的两处说法自相矛盾**：`indicator.md` 开头说它意味着"只能用 cross-section/screener"，第 85 行又说它不是硬约束。统一为「提示不是保证」，并给出反例（`qte_vol_intvl` 带着该标注调时序照样返数据）
- **`reportType` 不再说「悬案关闭」**：`enumList` 与实测一致，但同一份 `search` 响应的 `paramDescription` 仍留着相反的旧映射文字。改为明确「以 `enumList` 和实测值为准，别读 `paramDescription`」
- `examples.md` 的「单元格缺值返回 null 且不丢证券行」同步改为四档说明
- 订正 `indicator.md` 里「港股市值/股本」的描述：它按缺数据口径走。（这条当时写成「与有数的**标的**混查就是 `null` 单元格」，同样被后来的两维判据修正——加证券不够，得加有覆盖的**指标**）
- 说明 `cross-section` 的 `--date` 必填是 CLI 护栏而非协议要求：截面接受 `indicatorParamList: []`（`pty_op_scope` 实测照常返值）。多带一个无害参数 vs 漏传触发空表，权衡不对称。（`screener` 那边曾另有「空 `parameters` 被丢弃」的服务端缺陷，2026-08-03 已修复）

**内部**
- **补顶层 `uncaughtException` / `unhandledRejection` 兜底**。此前 `main()` 的 try/catch 只罩住 `program.parseAsync`，事件回调里抛出的错误会走 Node 默认路径：一坨崩溃转储 + 非零退出——于是一条**数据已经正确打印完**的命令看起来像硬失败。现在统一收敛成 `Name: message` + 退出码 1；**栈只在 `--verbose` 下打印**（走到这里意味着是 CLI 自身的 bug 而非 API 失败，一行消息不足以定位），且 verbose 下只打栈——`error.stack` 本身就以 `Name: message` 开头，两个都打会重复首行。终止方式也有讲究：**不能立即 `process.exit()`**（管道下两个流的写入都是异步的，会截掉已交给流的数据），**也不能只设 `exitCode`**（有常驻句柄时进程永不退出、致命错误后还会继续执行）。取中间：等**诊断本身写完**（stderr 的写回调，不是只看队列长度——诊断是当场发出的，只有回调知道它何时真正落到管道；此前立即退出会把一份 4 MiB 诊断截到 65,536 字节）**加上** stdout 还欠的部分，两者共用同一个 200ms 上限，到点无论如何退出
- **stdout 的读端消失一律退出 0**。`EPIPE`、`ERR_STREAM_DESTROYED`、`EBADF` 都是读端先走了，不是本进程的失败——`gangtise … | head` 就是日常场景，它同样截断输出却退出 0，同类竞态没道理退出 1。此前只放行 `EPIPE`，另两个码走 `throw` 变成未捕获异常（在**正确的 JSON 已经打完之后**再追加一段崩溃转储）
- `cross-section` / `time-series` 的丢行警告移到 flatten 之后：形状异常时不再先打一条读起来像「只是少了几行」的警告
- 形状异常的 `ApiError` 带上原始响应，traceId 不再丢失——这恰恰是最需要报障的一类错误。`unwrapIndicatorData` 现在把信封的 traceId 转交给内层载荷：此前它只挂在被剥掉的外层上，下游拍平函数看到的内层根本没有，形状报错依旧是无 trace 的
- 时序轴按**去重后**的 `--security` 条目数判定：同一证券传两次此前会被当成双证券请求，列名从指标名退化成证券代码
- **板块查询始终按证券轴出列，不再丢失证券身份**。时序轴此前在响应为 1 指标 × 1 证券时只看「请求 universe 条目数 = 1」，无法区分「单证券」和「单板块 ID」——板块只剩一只成分股时（本就只有一只，或其余因无覆盖被略过）输出会变成裸的 `qte_close` 列，数据归属彻底丢失，而板块 ID 又被 dropped 检测有意跳过，所以连退出码 3 都不会给。现在把 universe 本身传进拍平函数：**含板块 ID 的请求一律优先证券轴**
- 「未来再次转置必然报错」的注释改准：方阵（1×1、2×2）转置后维度不变，校验只能保证非方阵的结构变化被发现
- `package-lock.json` 根版本补到与 `package.json` 一致（此前停在 0.29.0）
- **记录本地偶发批量失败的真因**（`tests/globalSetup.ts` 注释）。症状是 spawn 型 E2E 成片失败（7～27 个）、只在跑完整套件时出现、单跑该文件从不复现。真因不是产品也不是 stub：`prebuild` 会 `rmSync('dist')`，测试进行中一旦有人 `npm run build`/`prepare`（或并发跑第二个 vitest），那几秒窗口里每个 `node dist/src/cli.js` 都以 `Cannot find module` 退出 1。CI 单次串行跑不受影响，本地别边测边构建。（下面那条 stub 加固修的是**另一个**真实机制，两者独立）
- **E2E stub 不再会被一个畸形请求整体带走**。`cliBodyMapping` 的本地 stub 在 `req.on("end")` 里裸跑 `JSON.parse`（代码注释自己写着「曾经把整个 stub 搞挂」）——在那个回调里抛出就是 vitest worker 的未捕获异常，该文件**剩余用例全部连带失败**。这正是本轮 3 次「24/25/27 个用例批量失败」的签名：数量接近半个文件、只在跑完整套件时出现、单独跑该文件 30+ 次从不复现。现在坏 body 变成 `undefined`（让断言自己报错并指向真正的请求），并补上 `clientError` / `error` 处理器

### v0.30.1 — 2026-08-02

对 v0.30.0 做了一轮针对性复审（两组独立验证 + 本轮 40 余次真实 API 探针），修掉 1 个 v0.30.0 自己引入的静默错数、1 个让官方招牌用法失效的服务端缺陷绕过，以及一批把危险行为写反的文档。

**修复**
- 🔴 **`sDate` 被当成 `tradeDate` 的替代，导致区间指标静默错数**（v0.30.0 引入）。`qte_vol_intvl`/`qte_avg_vol` 的 `sDate` 是区间**起点**，`tradeDate` 是 required 的区间**终点**——v0.30.0 把 `sDate` 列进「替代日期」于是吞掉了 `--date`，区间终点漂移。实测茅台 `sDate=2024-01-02`：修前 `2,265,873,849`，修后（补上 `tradeDate=2024-01-31`）`65,687,435`，两次都是退出码 0。`cross-section` 与 `screener` 都受影响，后者会直接漏选股票
- 🔴 **条件选股的文本筛选（`contains`/`notcontains`）当时不可用**（服务端已于 2026-08-03 修复，详见本条末）。根因不是「不支持 string 指标」，而是 **screener 丢弃任何 `parameters` 为空数组的指标**：`pty_op_scope` 按官方格式传 `[]` 时 0 命中，挂上一个（对它无意义的）`tradeDate` 就正确返回。CLI 因此把 `--date` 改为**必填**并无条件下发给每个指标，官方文档的招牌示例 `F3 contains '酒'` 由此可用（白酒板块 19 只全部命中）。
  - 服务端已于 **2026-08-03 修复**该缺陷（`parameters: []` 现可直接工作，复测连跑 3 次稳定 19/19）。CLI 的无条件下发保留：对无参指标无害，一条规则比按指标开例外简单，且能扛住回滚。`--date` 必填也独立成立——绝大多数指标吃 `tradeDate`，漏传就是空表 + 退出码 0
- **时序的列轴改按请求判定**。服务端会丢掉完全无数据的证券，于是「单指标 × 2 证券」在一只无覆盖时缩成 1 只，`flattenTimeSeries` 据此翻转成指标轴，输出一个裸的指标名列，看不出是哪只证券的序列（实测 `finc_pe_ttm` 查 `600519.SH`+`09992.HK`）。现在列头稳定是「贵州茅台」，并额外警告港股被略过
- **重复指标列全部带上变量名**。screener 把一个 code 绑到两个变量时，此前只有第二列加 `(F2)` 后缀，裸的那列读起来像「唯一的收盘价」。现在两列都是 `收盘价 (F1)` / `收盘价 (F2)`

**新增防护**
- **服务端整行/整列丢数据时在 stderr 警告**。EDE 不给缺失数据补 `null`：某指标对 universe 内所有证券无数据就**整列**从 `indicatorList` 消失，某证券对所有指标无数据就**整行**从 `securityCodeList` 消失（只有部分缺才是 `null`）。这两种都是退出码 0 的短结果，`--key-by code` 回填时 key 直接不存在。`cross-section` / `time-series` 现在会列出被整个略过的指标与证券（stderr，stdout 的 JSON 不受影响）。板块 ID 不会被误报为「丢失」——服务端会把它展开成成分股
- **矩阵维度校验**：`values` 行数与轴长度不符时抛 `ApiError` 而不是错位贴值。2026-08-01 的转置是无版本标记发生的，再转一次必须炸出来
- **`--expression` 引用未绑定变量本地拦截**，不再白发一次计费请求（字符串字面量里的 `F2` 不会误判）。服务端对此报 `100003`
- **screener 重复 `indicatorCode` 时 stderr 警告**：API 规格允许一个 code 绑两个变量，但服务端当前对这种请求返回空结果（已报后台，修复中）。CLI 只警告不拒绝——能力是设计内的，硬拦会在服务端修好后要撤回

**文档订正（全部实测）**
- **「无数据返回 `null` 且不丢行」写反了**，这是最危险的一条。已改为四档说明（部分缺 → `null`／整指标缺 → 整列消失／整证券缺 → 整行消失／全空 → 空表），并标出各自后果
- **区间指标的起始参数是 `sDate`（`yyyy-MM-dd`），不是 `startDate`（`YYYYMMDD`）**。旧写法传下去是静默失效（茅台实测 296 万 vs 正确 4673 万）；示例指标也改了——`qte_amp_mo` 现在根本没有起始日参数，只吃 `tradeDate`
- **错误码表全线更新**：`410001`/`410106` 已不再出现。现在是 `100003`@400（入参/表达式错，含多×多时序、未声明变量）与 `140002`@500（终态参数错：必填缺失、枚举越界、表达式语法错，**不重试**）。`140002` 的 hint 此前只讲异步生成失败，与 EDE 的参数错完全对不上，已改写
- `999999` 的提示不再说「多为查询无数据」——无数据现在返回空表，此码基本只剩真故障；但参数排查清单保留，因为参数写错恰恰表现为空表而非报错
- `usageRestriction` **不是硬约束**：`qte_vol_intvl` 标着「不支持指标时间序列接口」，调时序照样返数据。按「口径可能不对」理解，别当成会报错
- `scopeList` 的港股声明补上美股：`qte_mkt_cptl`/`shr_tot` 港股与美股均无数据
- SKILL.md 修正「`--indicator` 支持板块 ID」（只有 `--security` 收 `sectorId`）；`indicator` 命令组描述补上 `screener`；README 的「仅列最近 5 个版本」与实际条数对齐

**关于 reportType**：服务端 `enumList` 与实际取数已一致（`1`=合并 `2`=合并调整 `3`/`4`=母公司），但 `paramDescription` 里仍留着相反的旧映射文字。以 `enumList` 和实测值为准。

### v0.30.0 — 2026-08-02

🔴 **破坏性修复**：服务端 2026-08-01 重构了 EDE 取数接口，v0.29.0 的 `indicator cross-section` / `time-series` **已完全不可用**（旧 body 一律 `100001 缺少必填参数`）。本版对齐新契约并新增条件选股。所有改动均对真实 API 实测通过。

**新增**
- `gangtise indicator screener` — 条件选股：`--indicator F1:qte_mkt_cptl` 把变量绑到指标，`--expression "F1 >= 500 && F2 <= 30"` 组合筛选，从证券/板块范围里筛出命中的股票。支持 `contains`/`notcontains` 文本匹配（仅 `dataType: string` 指标）。`--indicator-param` 按**变量**索引（`F1:scale=8`）而非按 code——同一指标可绑到两个变量取不同参数（如比较两个日期的收盘价），只有变量能区分；引用未绑定的变量直接 `ValidationError`，不静默丢弃。输出同 `cross-section` 宽表。实测：中信白酒板块 19 只 → 市值≥500亿 且 PE≤30 筛出 5 只
- `indicator cross-section` / `time-series` / `screener` 的 `--security` 现在也接受**板块 ID**（`reference sector-search` 返回的 10 位 `sectorId`，与证券代码混传取并集去重）。⚠️ 中信行业码那类 9 位 ID（`100800109`，官方文档示例里用的就是它）**不是** `sectorId`，实测返 0 只

**破坏性变更（服务端契约）**
- 请求体 `securityCodeList` → `universe`（cross-section / time-series 均改）。不改就是 `100001` 硬报错
- **根级 `date` 已废弃**：CLI 现在把 `--date` 下发为**每个指标各自的 `tradeDate`**。⚠️ 吃 `reportDate`/`sDate` 的指标必须显式传 `--indicator-param "code:reportDate=..."`——这类指标收到 `tradeDate` 会**静默返回空结果**（实测 `is_op_rev_mom`：`reportDate=2024-12-31` → 29.03，`tradeDate` → 空）。CLI 检测到某指标已有 `tradeDate`/`reportDate`/`sDate` 就不再注入 `--date`
- **响应结构重写**：`indicatorCodeList`/`indicatorNameList` 两个平行数组 → 单个结构化 `indicatorList: [{code, name, dataType}]`；**cross-section 的 `values` 矩阵转置**成 `[证券][指标]`（此前是 `[指标][证券]`，按旧逻辑读会整表错位）；time-series 的 `values` 仍是 `[序列][日期]`
- **cross-section / screener 输出不再有 `date` 列**：查询日期现在挂在每个指标自己的参数上，各列可以是不同日期，行级单一 `date` 会误导
- 服务端**会重排**返回顺序（实测请求 `qte_close,qte_vol` 回来是 `qte_vol,qte_close`；请求 `600519,09992` 回来是 `09992,600519`），CLI 一律按返回的 `indicatorList`/`securityCodeList` 对齐——批量按 code 回填继续用 `--key-by code`

**修复**
- 🔴 **复权参数名写错，导致静默取到错数据**：正确参数名是 **`adjustType`**，CLI 帮助文案、SKILL.md、README、references 此前全写成 `adjustmentType`（官方文档示例也是错的）。服务端对错误参数名**静默忽略并退回不复权**，用户照抄拿到的数看着正常实则错——实测茅台 `2024-01-02`：`adjustmentType=3` → 1685.01（= 不复权），`adjustType=3` → 13609.6168（真后复权），`adjustType=2` → 1531.225（前复权）。已全线改正并在文档中标注这个坑
- **EDE `reportType` 悬案裁决关闭**：服务端 enum label 已改正，现在 label 与实际取数**一致**，直接按 label 传即可（`1`=合并 `2`=合并(调整) `3`=母公司 `4`=母公司(调整)）。实测闭环：`is_tot_op_rev` + 中信证券 `600030.SH` FY2024 → `1`=637.8922亿 / `2`=581.19亿 / `3`=`4`=321.924亿，与 `fundamental income-statement` 的「合并报表」`totalOpRev` 637.892亿 在 `1` 上吻合。取数值与 2026-07-24 历史实测一致——**变的只是服务端 label，取数从未变过**，文档里「按 label 传会取反」的警告已作废
- `prepare.cjs` 的发版门禁按 README 的新条目式 changelog 格式匹配（README 改版后门禁一直找不到 `### vX.Y.Z`，形同虚设）

**文档（均为实测修正）**
- **无数据不再报 `999999`**：整查询无数据现在返回空数组（`Total: 0`）。这意味着**参数写错也表现为空表**而不是报错——文档补了空表排查顺序：① 参数名（`indicator search` 的 `parameterList`）② 日期语义 ③ `scopeList` ④ 才考虑真没数据
- **根级 `--scale` 会污染不声明 `scale` 的指标**：`qte_close` 的 `parameterList` 里没有 `scale`，但根级 `--scale 8` 把收盘价 1350.6 缩成 `0`（与官方「根级参数仅对支持的指标生效」的说法不符）。价格与金额混查改用 `--indicator-param "code:scale=8"`
- **`scopeList` 是声明不是保证**：`qte_mkt_cptl`/`shr_tot` 已声称覆盖港股，但实测 `09992.HK`/`00700.HK` 仍返 `null`（同一次调用里 A 股正常、港股行情类 `qte_close`/`qte_vol` 也正常）。港股**财务类**指标确已可用（`is_op_rev_ttm` 泡泡玛特 371.2亿 / 腾讯 7682.02亿）
- **币种与汇率已修复**：`DFT` 原始币种识别正确（A股=CNY、港股行情=HKD、美股=USD），汇率互逆且三角一致（误差 <0.003%）。⚠️ 同一只港股**行情类原始币种是 HKD、财务类可能是 CNY**（泡泡玛特财报以人民币计），跨市场比财务数据要显式传 `--currency`；币种枚举 2026-08-01 起**统一大写**，旧文档里的小写 `dft`/`cny` 已过时
- `indicator search` 返回新增 `scopeList[].usageRestriction`（如「不支持指标时间序列接口」，`null`=无限制），已写入 skill 与响应字段文档
- 全线强调：**指标参数名一律以 `indicator search` 的 `parameterList` 为准**，不要照抄任何文档示例——服务端会改参数名且传错是静默失效

**内部**
- `args.ts`：`parseIndicatorParams` 抽出通用的 `parseParamSpecs`；新增 `parseScreenerIndicators`（校验 `F+正整数` 变量名、拒绝重复变量与未绑定变量）
- `indicatorMatrix.ts`：`buildHeaders` 改为接受 bases/suffixes/reserved 三元组，screener 用 `field` 而非 code 做去重后缀（同一 code 可绑两个变量）；多证券时序的列数改从 `securityCodeList` 派生，响应缺 `securityNameList` 时不再退化成 0 列
- 测试 536 → 551：矩阵转置回归守卫、`reportDate` 不被 `--date` 覆盖、screener body 组装与变量校验，以及一条端到端断言 `universe` 上线的守卫（防止旧 body 悄悄回归）

### v0.29.0 — 2026-07-25

对齐服务端 2026-07-24 更新：新增财报日历（列表 + 原文下载）与 PDF 解析工具，群消息补 `quoteMsg` 引用字段。四个接口均已对真实 API 实测通过。

**新增**
- `insight performance-calendar list` — 财报日历：业绩预告 / 业绩快报 / 业绩公告三类事件。按 `--start-date`/`--end-date`（`yyyy-MM-dd`，过滤 `publishDate`）、`--market`、`--security`、`--category` 筛选，自动翻页（单页上限 50）。**它是唯一按 `--*-date` 过滤的 insight list**（其余用 `--start-time`），也没有 `--keyword`/`--rank-type`/`--search-type`；`--market`/`--category` 走本地白名单，拼错直接 `ValidationError`（服务端对错枚举是静默返全量，按 0.1/条计费，拦在本地才不烧积分）。实测无筛选时 `total` 十万量级（126683，含未来排期），而省略 `--size` 等于拉全量（1000 页上限 = 5 万条 ≈ 5000 积分）——CLI 因此要求至少一个约束：完整日期范围 / `--security` / 显式 `--size`，裸跑本地报 `ValidationError` 且不发请求。`--security` 作为唯一约束时另加 **1000 行隐式上限**（实测服务端确实按 `securityList` 过滤：无效码返 0 条；但不拿五位数积分赌它不变——筛选一旦失效，结果会截断标 `partial` + 退出码 3，而不是翻完全表）。上限判据看 `total`，不是单看行数——`from + 行数 >= total` 即为完整结果，不误标 `partial`（否则恰好 1000 行的完整答案会被自动化调用方读成截断）
- `insight performance-calendar download --performance-report-id <id>` — 下载业绩报告原文 PDF（A股 10 积分 / 港美股 20 积分）；仅 `hasAttachment: true` 可下。省略 `--output` 走 title-cache → 真实标题命名（实测落盘 `赛诺医疗 · 发布2026半年度业绩预告.PDF`）
- `gangtise tool file-parse --file <x.pdf>` / `tool file-parse-check --task-id <id>` — PDF 解析（异步）。提交走 multipart 上传拿 `taskId`，`--wait` 阻塞轮询（≈316s 预算，覆盖官方约 3 分钟）后把结果 ZIP（`file.md` + `images/`）落盘。**0.8 积分/页、提交时一次性扣**，取结果免费；提交端点标 `no-replay` + 超时下限 300s（100MB 上传不会被 30s 默认超时掐断，也不会因重放重复扣费）。上传前本地校验后缀/非空/≤100MB
- 新增 skill 文档 `references/commands/tool.md`；`examples.md` 补例 18（财报日历）/ 例 19（PDF 解析），含「平台自有研报优先 `--file-type 2` 直出 Markdown、别花解析费」的路由提醒

**变更**
- 群消息 `vault wechat-message-list` 返回新增 `quoteMsg`（`quoteMsgId` / `quoteContent` / `quoteUrl`，无引用为 `null`）
- **修正随包 skill 里写错的群消息字段名**：正文是 `content`、链接是 `url`（旧文档写作 `msgContent` / `contentUrl`，实测 2026-07-25 不存在这两个字段）；并标注 `tagList` / `securityList` 无值时返回 `null` 而非空数组
- `raw call` 对 POST 型 download 端点放行 `--body`（file-parse 取结果需要），GET 型仍只收 `--query`；upload 型端点（`tool.file-parse.submit`）明确报错并指向 `tool file-parse`
- `--verbose` 的下载日志用端点真实 method（此前一律打印 `GET`，POST 型 download 会误导）

**内部**
- `EndpointDefinition.kind` 增加 `"upload"`；`client.download()` 支持 POST + JSON body；新增 `client.uploadFile()`（multipart，复用 requestJson 的鉴权/重试/信封处理）与 `src/core/fileParse.ts`
- `asyncContent.ts` 导出 `isAsyncPending` / `nextPollDelayMs` 供 file-parse 复用（生成中的 `140001`/旧 `410110` 判定只此一处）
- 新增 `EndpointDefinition.bigIntFields` + `transport.quoteBigIntFields`：解析前把指定字段的**裸数字**重新加引号，防止雪花 ID 被 `JSON.parse` 四舍五入（`1782345678901234567` → `…4700`）。file-parse 的 `taskId` 实测 2026-07-25 返回的是字符串、当前不受影响，这是前向防护——ID 一旦丢位，已扣费的解析任务就再也取不回结果
- `package-lock.json` 根版本补到与 `package.json` 一致（此前停在 0.28.0）

### v0.28.3 — 2026-07-24

🔴 **数据完整性修复**：`--field` 传错字段名会导致**静默错列**（值贴到错误的字段上）。

**修复**
- 列式响应（`{fieldList, list}`）拍平时校验字段数与行长度，不匹配直接报错（`ValidationError`，退出码 1），不再输出错位数据。上游对不存在的字段名有两套处理：`day-kline` / `minute-kline` / `fund-flow` 名值同丢、三大报表补 `null`（长度相等，安全）；但 **`quote realtime` / `fundamental main-business` / `valuation-analysis` 只丢值、字段名照请求回显**——实测 `quote realtime --field securityCode --field close --field turnoverRate`（realtime 根本没有 `close`）把换手率 `28.5573` 拍成了 `close`，茅台真实价 1297.41。不报错、数字看着合理、却完全是另一个指标。`alternative edb-data` 的同款拍平（`{fieldList, dataList}`）改为复用同一个 `zipFieldRow` 一并纳入校验

**文档（随包 skill）**
- SKILL.md 必备规则加第 10 条：`--field` 不确定就别传（返回全量最稳）；`quote realtime` **无 `close`**（用 `latestPrice`）、**无市值**（总市值走 `indicator cross-section --indicator qte_mkt_cptl`，仅 A 股）
- `quote.md` / `fields.md` / `response-schema.md`：补全 realtime 实测 16 字段（此前漏 `turnoverRate` / `volumeRatio`），并写明错名硬失败的行为与自查路径
- `fundamental.md`：`valuation-analysis` 只有 7 个字段、**无 `securityCode`**（误传会拿到一列重复的 `tradeDate`，长度相等拦不住）；`main-business` 的 `--field` 只认主营字段
- **推翻 07-23 关于 EDE `reportType` 的结论**（复测 2026-07-24）：旧文档写「枚举不可信、`value=2/4` 直接 `999999`、要指定口径请改用 `fundamental --report-type`」。实测是 label 与 value **错位但映射稳定**：`1`=合并（默认）、`2`=合并(调整)、`3`=母公司、`4`=母公司(调整)。中信证券 `600030.SH` FY2024 营收四值与三大报表逐一相等（637.9/581.2/321.9/321.9 亿），中国神华 `601088.SH` 的 `1`≠`2`（3383.75 vs 3397.88 亿）可排除「2 即合并原值」。`2`/`4` 为空是该报告期尚无调整表（与 `consolidatedRestated` 同期无数据一致），不是枚举失效；全查询无值时才升级为 `999999`。**结论：EDE 可以指定口径——母公司传 `3`，合并省略即可**，不必再绕道三大报表
- 修正 `response-schema.md` 里会**反向诱导传错字段**的陈旧记录：`main-business` 行原写 `endDate` / `breakdownName` / `revenue`（实测均不存在），改为真实的 `periodName` / `periodEndDate` / `categoryName` + `opRevenue` / `grossProfit` 等 15 个字段；`valuation-analysis` 行补齐 7 字段并标注响应是列式
- 标注上游 meta 字段错位，范围以实测为准：**A 股累计口径的 `balance-sheet` / `cash-flow`** 的 `companyType` 与 `currency` 值互换（茅台/工行/平安银行/中国平安/中信证券五个样本一致：`companyType=人民币`、`currency=银行`/`一般企业`）；A 股 `income-statement`、港股三表、美股三表实测均正确；A 股 `*-quarterly` 单季表则是 `companyType` 返回未映射的数字码（`102119999`）、`currency` 正确。读这两列按值判断语义，科目数字不受影响

### v0.28.2 — 2026-07-24

EDE 指标批量取数优化（基于对上游 990 个指标的实测）。

**新增**
- `indicator cross-section` / `time-series` 加 `--key-by name|code`（默认 `name`）：`code` 模式列头用 `indicatorCode`（时序多证券侧用 `securityCode`），唯一且与服务端返回列序无关。**多证券批量按 code 回填必用**——此前拍平只按指标显示名，而多个指标同名（如 `cf_finc_exp`/`_qtr` 都叫「财务费用」）+ 服务端会重排返回列序，导致按名/按位置都错位、只能绕道 raw API 手工回填

**修复**
- EDE `999999` 无数据提示只对取数端点（`cross-section`/`time-series`）套用，`indicator.search`（同为 no-999999 策略、仅关键词入参）回落通用提示；文案改为「日期匹配指标周期（财务/MRQ 用报告期末、日频估值用交易日）、`scopeList`、`parameterList` 中 required 参数」——修正此前「行情/估值用交易日」与 `finc_pb_mrq` 仅报告期末的矛盾

**文档（随包 skill）**
- `indicator.md`：`--key-by` 文档 + 两处 synopsis；`periodNum` 补「部分需配年报日期」、`startDate` 补「取值须匹配指标周期」
- `examples.md` 例15：批量三截面示例改用 `--key-by code`

### v0.28.1 — 2026-07-23

Agent Skill 文档取数路由对齐（对齐 gangtise-mcp 0.1.46）：多证券取一批**已实现**财务/估值指标优先走 EDE `indicator cross-section`/`time-series` 一次拉取，替代逐只 `fundamental` 循环。**本版仅改随包分发的 skill 文档（`gangtise-openapi/`），无 CLI 代码/命令/参数变更。**

**路由规则**
- 单票财务/估值/盈利预测/股东/主营、单票完整三大报表 → 仍走 `fundamental` 专用命令；行情/K 线 → `quote`（免费批量）
- 多证券已实现财务/估值指标 → 优先 EDE（`cross-section` 单日快照 / `time-series` 单指标×多证券区间）
- 始终排除 EDE：盈利预测·一致预期、估值历史分位（实测 EDE 无此两类）、OHLCV/K 线、单票完整报表
- EDE 取数前三项校验：`indicatorName`+`description` 语义 / `scopeList` 覆盖全部目标市场 / `parameterList` 必填参数，任一不符即回退专用接口

**实测校正（2026-07-23）**
- `scope` 字段更正为 `scopeList[].market/.securityType`（服务端已返回实际覆盖），覆盖按指标而异：`finc_pe_ttm`/`finc_pb_mrq` 仅 A 股、`is_op_rev` A 股+港股，均不含美股；`valuation-analysis`/`earning-forecast` 仅 A 股
- `finc_pb_mrq`(市净率 MRQ) 只在报告期末打值（交易日取 `null`），非日频；EDE 财务指标 `reportType` 枚举 label 与实测取数不符（`value=2/4` 直接 `999999`），要指定报表口径改用 `fundamental` 三大报表 `--report-type`
  - ⚠️ **本条 `reportType` 结论已被 v0.28.3 复测（2026-07-24）推翻，勿据此路由**：`2`/`4` 为空是该报告期尚无调整表、不是 `999999`；实际映射为 `1`=合并 / `2`=合并(调整) / `3`=母公司 / `4`=母公司(调整)，EDE 可直接指定口径，不必绕道三大报表。详见上方 v0.28.3 条目（本条 `finc_pb_mrq` 部分仍成立）

### v0.28.0 — 2026-07-21

对齐服务端 2026-07-17 更新（内资研报下载调价 + 41 个公开错误码重排）。**41 个码逐个打了线上探针**，结论是迁移按「错误处理层」而非按业务模块进行、文档并不等于现状：同一个接口内，参数校验层与路由层已发新码，方法路由层和 token 过滤器仍发旧码，异步生成状态也仍是旧码。CLI 对两代都识别。

**错误码体系**
- `errors.ts` 错误码表按新三层结构（`999xxx` 服务统一层 / `1xxxxx` 业务通用层 / `2xxxxx` 接口专有层）重写，覆盖 41 个公开码 + 实测仍在线的旧码
- 异步轮询同时识别 `410110`/`140001`（生成中）与 `410111`/`140002`（终态失败）。实测服务端**仍在用旧码**（HTTP 400、无 `errorType`），新码为预置——服务端切换那天 `--wait` 不会在首次轮询就抛错中止，把已扣的 50 积分作废
- `140002`（异步 PROCESSING_FAILED，`410111` 的新码）纳入 transport 终态码集合、任何 HTTP 状态都不重试——异步 `*-check`（get-content）端点无 retry 声明、走默认策略，`140002@500` 会被白重试 2 次才轮到 `asyncContent` 的 `FAILED_CODES` 识别（后者在 `client.call` 的 `withRetry` 之上、拦不到重试）；`140002` 语义即「生成失败·终态」、只有那些异步端点会返回它，故全局终态化既安全又省掉白重试。实测服务端仍用 `410111`，此为预置
- token 自愈补上 `999002`（`0000001008` 的新码）；`999011`（AK/SK 不匹配）加入**终态码集合**，任何 HTTP 状态下都不重试——凭证错不会自己好。注意它只来自 `auth.login`，而 login 走 `useAuth=false` 压根不经过自愈码表，所以「不列进自愈表」并拦不住 `auth.login` 在 5xx 上按默认策略重放两次，必须落在终态码上
- 修正 `900002` 的错误释义：实测服务端用它表示「请求方法不正确」（HTTP 405），旧文档写作「请求缺少 uid」，据此排查会走错方向
- 错误提示改为只给下一步动作，不再复述服务端 msg（此前输出形如 `资源不存在 资源不存在，确认 ID 有效`）——新旧两代都过了一遍：留用的 `903301` / `8000016` / `8000018` / `999995` / `999997` / `900001` / `130001` / `410004` / `410110` / `410111` 原本是逐字重复 msg
- 补上 `410001` / `410106` 两个 EDE 专有旧码的提示——它们没被 2026-07-17 重排收编，却是 `indicator` 取数最常见的两个报错（漏传 `--indicator`/`--security`、漏传 `periodNum` 等必填参数），`indicator.md` 早已把它们列为首要排查项
- `110002`（日期区间非法）提示改为同时覆盖 `--start-date/--end-date` 与 `--start-time/--end-time`——此前只提 date 参数，而 `insight` 系 list 按 `--start-time` 排序，旧提示指向的是命令根本没有的参数
- `999006`（限流）提示不再断言「CLI 已退避重试」——仅限流以 429 返回时才全局按 `Retry-After` 退避重试；5xx 形态只有默认策略端点会重试、贵档 no-replay 端点不会，200 错误信封则不重试
- `130001` 提示改为先给通用「未找到数据/核对查询条件」再限定 EDE 指标权限（此前把通用 DATA_NOT_FOUND 一律导向「未开通指标」）；`130002` 提示补上「非法 `--file-type` 也归此码」（下载类兜底）

**行为变更（本地校验）**
- 所有 date 参数（`--start-date`/`--end-date`/`--date`/`--report-date`，覆盖 Quote/Fundamental、AI `theme-tracking`/`hot-topic`/`management-discuss-*`、Alternative `edb-data`、Indicator）只接受 `YYYY-MM-DD`，其余格式在发请求前报 `ValidationError`——**服务端额外接受的两种「年在后」格式日月顺序相反**：实测 `07/01/2026`（斜杠）读成 `2026-01-07`、`07-01-2026`（横杠）读成 `2026-07-01`，同样三个数字差半年且都返回 HTTP 200，响应里不回显服务端实际采用的日期（用 `25/12` 与 `12/25` 的互补接受结果交叉验证）。CLI 无从判断用户想要哪个读法，故只转发无歧义写法。`20260701` / `2026/07/01` 这类服务端同样能正确处理的写法也一并拒掉——统一成一种入参形态，好过按端点逐一探针维护白名单；报错文案说明该用哪种写法，不再断言输入本身有歧义
- **datetime 参数（`--start-time`/`--end-time`）本地拦截覆盖全部透传命令**（insight research/summary/announcement-hk/us、vault 各 list、`quote minute-kline`、`ai security-clue` 等原样透传的 18 处，外加转时间戳的 A 股 `announcement` / `knowledge-batch`）。**服务端对透传的年在后格式静默误解析、并不报 `110001`**：实测 `insight research list` 对 `07/01/2026` 返回 1562 条（=`2026-01-07`）、`07-01-2026` 返回 210 条（=`2026-07-01`），差半年、都 HTTP 200、响应不回显实际日期。新增 `parseDatetimeOption` 做**时区无关**的字段校验（算术闰年、不构造本地 `Date`，故 DST 缺口时刻等对服务端合法的字符串不被客户端时区误伤）后**原样透传**
- 本地时间校验只认 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm[:ss]`（空格或 `T` 分隔、秒可省）或 10/13 位时间戳；此前 `parseTimestamp13` 用 `new Date()` 兜底还能吞 `.SSS` 毫秒尾、`+08:00` 时区尾、以及 `Infinity`/`1e309`/非整数（数字分支只查 `NaN`，这类会序列化成 null 静默取消过滤），现一律拒绝（时间戳分支改用严格 `^\d{10}$`/`^\d{13}$` 位数正则——这也是科学计数法 / 16 进制 / 空白 / 非标准位数被拒、且 13 位 `1000000000000` 不再落进秒分支的原因）

**修复**
- EDE 内层信封的报错（`indicator` 取数失败的 `999999` / `130001` 等）此前**永远拿不到 traceId**：实测 `traceId` 只挂在外层信封上，而外层在解包时即被丢弃，内层抛错又没传 details。现在外层 id 以不可枚举属性随 payload 带下去（不进 JSON/CSV 输出），`ApiError.traceId` 兜底读它——这类错误恰恰最需要报障，此前与 README「报错行会带 trace」的表述对不上
- HTTP 200 包裹的错误信封（Gangtise 也用这种形态）此前会丢掉服务端的 `Retry-After`：主 JSON 路径与下载 JSON 路径两处 `unwrapEnvelope` 都补上（此前只有 4xx/5xx 的 `throwHttpError` 保留），限流响应的退避窗口不再被丢弃
- `toTimestamp13` 的日历校验补年份与时间 round-trip：`0050-06-15` 曾被 `Date(50,…)` 构造器映射成 1950、DST 缺失时刻（如 America/New_York 的 `02:30`）曾被静默移到 `03:30`——均改为拒绝
- 异步终态失败（`410111`/`140002`）的报错行补上 code / msg / `traceId` 并提示重提会再次计费——此前只打印一句 "Content generation failed"，把本版新增的 trace 信息吞掉了，与 README「报错行会带 trace」的表述矛盾

**可观测性**
- 响应信封新增的 `traceId` 透出到 CLI 报错行：`API error (130002) [trace 830965044897325056]: 资源不存在 确认 ID 有效…`——这是 Gangtise 侧唯一能回溯一次失败的抓手，报障时请带上

**计费**
- `insight research download`（内资研报）**20 → 10 积分/篇**，SKILL.md 积分速查表与 `insight.md` 同步

**文档（实测结论沉淀）**
- SKILL.md 异常处理表重写为「实测确认在用」与「文档列出但未触发」两组，标注每个码的实测状态与兜底关系（`100003` 是参数类兜底、`130002` 是下载类兜底，`130003`/`130004`/`130005` 均未启用）
- 记录两个实测坑：**枚举值拼错与分页越界服务端不报错**（静默忽略该筛选条件，拼错会伪装成"结果正常"）；**`viewpoint-debate` 敏感内容不被提前拦截**，扣满 50 积分后才以 `410111` 失败
- 纠正 SKILL 异常表 `110001`/`110002` 行的日期分类：此前按命令组（「Quote/Fundamental 用 date、Insight/AI 用 datetime」「110001 只有 Insight 系报」）与 AI `management-discuss --report-date`（date 型）及实测都冲突——实测 `fundamental` 对 `2020/01/01` 报 110001、`insight research list` 对 `30/06/2025` 反而宽松解析返回数据，改为按参数名分类、不按命令组预判
- 新增判别法：新码信封 `code` 是 JSON 数字且带 `errorType`，旧码是字符串且没有——但它判断的是**单条错误路径**切没切，不是整个接口（成功响应也没有 `errorType`，别拿它当判据）
- README 常见错误表同步重写；Troubleshooting 的 `8000014/8000015` → `999011`、`430007` → `100006`

### v0.27.0 — 2026-07-11

**EDE 指标（体验修复）**
- `indicator` 三端点对 `999999` 不再自动重试——实测服务端用 `999999` + HTTP 500 表示「查询无数据」（节假日 / 未来日期 / 未覆盖标的），此前每次空查询白烧 3 个请求 + ~4 秒；错误提示改为指向检查查询条件而非「稍后重试」

**资金与下载加固（承接 v0.26.0）**
- 下载路径同样接入重试策略：50/篇 的 `summary` / `foreign-report` / `my-conference` download 改为 no-replay（与 AI Agent 同价档；下载中断重试可能重复计费），10-30/篇 的下载维持默认重试
- 签名 URL 下载增加整体硬截止（10× 单请求超时）——headers/body 超时是空闲型，慢滴速传输可无限续命；最终 rename 失败时清理 `.part`
- `GANGTISE_PAGE_CONCURRENCY` 防御性解析：非法/非正数回退默认 5、上限 32——负值此前被底层钳制成**单 worker 串行**（静默变慢），过大值可能造成过度并发触发限流
- `--version` 更新提示改为数值分段版本比较（不处理预发布号；本项目只发 x.y.z）——刚发版的 registry 滞后窗口不再把旧版本提示成"可更新"

**体验与正确性小修**
- `--wait` 异步轮询容忍瞬态错误：5xx/网络抖动只消耗一次尝试并继续等待，不再作废整段等待（积分不足等终态错误仍立即中止）
- table 输出单元格显示宽度上限 120（超长截断加 `…`）——一个超长字段不再把整列所有行 pad 成同宽（行数 × 宽度的空格放大）
- markdown 输出先转义反斜杠再转义竖线，字面 `\|` 单元格不再错位列；table/markdown 过滤 C1 控制符（U+009B 单字节 CSI 注入面）
- 自动文件名按码点截断，emoji 不再被截成 `�`；EDE 矩阵中与 `date`/`security`/`name` 同名的指标列自动加后缀，不再覆盖元数据列
- 全市场分片截断时输出 `truncatedShards`（具体日期区间，与 `failedShards` 对称），脚本/AI 消费者可定向缩窗补拉
- 分页端点首页形状漂移（如 `total` 变字符串）时 `--verbose` 下告警，不再完全静默退化单页

**Skill 分发**
- `gangtise-openapi/` 目录纳入 npm 包；README 安装命令改为从 `$(npm root -g)` 复制——此前的相对路径命令对 npm 用户不可执行

**防漂移门禁（工程，不影响 CLI 行为）**
- 新增 README↔ENDPOINTS 一致性测试：「自动翻页」清单与注册表 pagination 标记双向比对（此类手抄清单漂移已发生两次）；insight/reference 子命令的 `--help` 覆盖改为从端点注册表派生，新命令漏接线直接测试失败
- `npm run prepare` 前置断言 README/CHANGELOG 含当前版本条目（写盘前检查，失败零残留）；`npm run typecheck` 纳入 tests/（tsconfig.test.json）
- CI：`npm pack` 装包冒烟（`--help` + skill 文件存在校验）、测试矩阵 Node 下限改精确 20.18.1、CI typecheck；publish 的 `workflow_dispatch` 必须指向 `v*` tag（关闭无护栏发布通道）

### v0.26.0 — 2026-07-11

**资金安全（重要）**
- 13 个贵档端点（`one-pager` / `investment-logic` / `peer-comparison` / `research-outline` / `theme-tracking` / `management-discuss-*`×2 / `hot-topic` / `knowledge-batch` / `earnings-review get-id` / `viewpoint-debate get-id` / `concept-info` / `concept-securities`）改为 **no-replay 重试策略**：5xx / 超时 / `999999` 不再自动重放——实测（2026-07-11）平台按次计费且**缓存命中不豁免**，同参数重放每次都扣分；仅连接期错误（`ECONNREFUSED`/DNS，请求未发出）、429 限流和 token 自愈仍重试。便宜按条计费的 list 类维持原全量重试（失败响应没有数据行、不计费）
- 连接失败 `ECONNREFUSED` / `UND_ERR_CONNECT_TIMEOUT` 纳入默认重试范围（此前这两类不重试）

**文件安全**
- 所有 `--output` 落盘（导出、流式下载主路径、签名 URL 跟随下载）改为原子写：先写同目录 `.part` 成功后 rename——重跑失败不再毁掉已有旧文件；顺带修掉中止路径上 `.part` 因流懒打开竞态残留的问题
- 签名 URL 跟随下载改走 transport 层：遵守 `GANGTISE_TIMEOUT_MS`（此前裸 `fetch` 无超时，慢滴速 CDN 可无限挂起）、网络错误自动重试、跟随最多 3 跳重定向（undici 不自动跟随，超限/缺 `Location` 报错而非把跳转页存成文件）、`--verbose` 日志剥离签名 query 只留 origin+path
- 自动命名去重后缀试尽 `-1`…`-99` 仍冲突时报错，不再静默覆盖最早的文件

**修复 / 加固**
- 下载重定向超过 3 跳或缺 `Location` 时报错，不再把跳转页 HTML 当文件内容保存
- 损坏的 gzip 响应包装为带请求上下文的 `ApiError`（此前抛裸 zlib `Z_DATA_ERROR`，与请求无关联且不可定位）
- `alternative edb-search --limit` ≤200、`indicator search --limit` ≤100 本地上限校验——实测服务端对超限值静默截断（201→200、101→100），与 v0.25.0 的 `--top` 同类同修法

### v0.25.0 — 2026-07-10

**新增接口（4）**
- `insight qa list` — 投资者问答 QA：按证券提取互动平台 / 电话会议 / 调研纪要的提问与回答；`--security-code`（必填）、`--source`（`conference`/`interactive`/`survey`）、`--question-category`（11 类，见 `insight.md`）、`--answer-important`（`1` 是 / `0` 否）、`--start-time`/`--end-time`（字符串直传）；自动翻页（单页上限 500）；0.1 积分/条
- `insight report-image list` / `download` — 研报图表：按关键词搜索研报图片，返回 `chunkId` + 元数据（`--keyword` 必填、`--top` 默认 10 上限 20、`--source-id`、时间过滤；**免费**），再 `download --chunk-id` 下二进制原图（JPEG，0.1 积分/张）
- `reference official-account-search` — 公众号 ID 搜索：输入公众号名 / 机构 / 关键字返回 `accountId`（喂 `insight official-account list --account-id`）；`--keyword`（必填）、`--category`（`listedCompany`/`broker`/`government`/`media`，可重复；未分类公众号 `category` 为 `null`，传 `--category` 会漏掉）、`--top`（默认 10 上限 10）；免费

**变更**
- `indicator search` / `cross-section` / `time-series` 市场范围从仅 A 股扩展至 A 股 / 港股 / 美股（服务端变更；CLI 早已支持 `--currency` 与多市场证券代码，无需改动）。⚠️ 美股代码用交易所后缀 `.O`(NASDAQ) / `.N`(NYSE)，**非 `.US`**——官方示例的 `AAPL.US` 查不到数据，实测须 `AAPL.O`

**修复 / 加固**（承接上一批未单独发版的改动）
- 分页 / 分片 `partial` 检测补全：`requestPaginated` 的短后续页、`MAX_PAGES` 上限、`total` 漂移、失败页四种场景统一触发 `partial`（退出码 3）——失败页独立成判定条件，避免超额返回的兄弟页把行数补满、掩盖失败页空洞；`quote` 全市场分片硬错后熔断、破损形状分片计入 `failedShards`
- `--top` 本地上限校验（`report-image` / `knowledge-batch` ≤20，reference 六个搜索命令 ≤10）——实测服务端对超限值**静默截断**不报错，现在发请求前本地报错；`securities-search` / `institution-search` / `official-account-search` 的 `--category` 加本地白名单——实测服务端对拼错的分类**不报错**（securities-search 静默忽略过滤返回全类别、另两个静默返回空），拼写错误不再伪装成"无结果"（`insight qa` 的枚举服务端会报 `100003`，故不做本地白名单）
- 错误码 `100003`（参数值非法）补充中文提示——服务端不指明是哪个参数，提示对照命令 `--help` 检查枚举参数拼写
- undici `^7.16.0` → `^7.28.0`（修 keep-alive 队列污染 GHSA-35p6-xmwp-9g52），`engines.node` `>=20` → `>=20.18.1` 对齐 undici 实际最低要求

### v0.24.0 — 2026-07-07

**新增**
- `raw list` — 列出所有已注册的 endpoint key（含 method / path / description），配合 `raw call <key>` 使用，不必再翻文档记 key；支持 `--format`（默认 table）/ `--output`
- AI 同步生成端点内置 120s 超时下限（`one-pager` / `investment-logic` / `peer-comparison` / `theme-tracking` / `research-outline` / `management-discuss-announcement` / `management-discuss-earnings-call`）——生成耗时长不再撞 30s 默认超时触发重试，**不必再手动前缀 `GANGTISE_TIMEOUT_MS`**；显式设更大值仍生效（取 max）
- 429 响应尊重 `Retry-After`（秒或 HTTP-date；覆盖 JSON、非 JSON、下载三类错误路径），优先于默认指数退避，封顶 60s 防挂死
- 超大结果（≥5 万行且走非流式渲染：table/json/markdown，或 jsonl/csv 未带 `--output`）在 stderr 提示改用 `--format jsonl --output <path>` 流式落盘

**性能**
- JSON 请求启用 gzip（`accept-encoding: gzip` + 本地解压）——实测 `reference constant-list` 2110B→586B（3.6x），K 线类高重复大 JSON 收益更高；下载二进制路径不变
- 全市场按日分片（`quote fund-flow` / `day-kline` / `day-kline-us`，均 1 天/片）自动跳过周六日（A/港/美股周末闭市必空），省 ~28% 请求与每日调用配额；多日分片（`day-kline-hk` 2 天、`index-day-kline` 30 天）不受影响

**修复**
- 表格（table/markdown）显示宽度纳入 emoji 码位区（0x1F000–0x1FAFF），含 emoji 的微信群名/消息不再错位
- `fundamental earning-forecast` 默认 `--end-date`（"today"）改用运行机器本地日期；此前用 UTC 日期，CST 凌晨 0–8 点会算成"昨天"

**文档 / 工程**（不影响已发布 CLI 行为）
- `insight announcement`（A 股公告）时间过滤时区说明：`--start-time`/`--end-time` 按运行机器时区换算，跨机器精确边界改传 13 位毫秒时间戳
- CI 测试矩阵增加 Node 24（此前仅 20；发布用 24）

### v0.23.0 — 2026-07-05

**行为变更（注意）**
- ⚠️ 默认 API 域名迁移：`https://open.gangtise.com` → `https://openapi.gangtise.com`。旧域名仍可用，CLI 只是切换了默认值（新旧域名多接口实测等价）；如需固定旧域名设 `GANGTISE_BASE_URL=https://open.gangtise.com`
- `vault wechat-chatroom-list`：服务端接口改版为返回 `{ total, list }`（此前无 `total`、列名 `chatRoomList`），CLI 相应改为按 `total` 并发翻页；同时移除全仓已无端点使用的 `sequential`/`listKey` 顺序翻页机制
- 无翻页的行情端点（`quote fund-flow` / `minute-kline` / 显式多标的的 `day-kline`·`-hk`·`-us`·`index-day-kline`）返回行数撞上单次 `--limit` 时标 `partial`（退出码 3）+ stderr 警告，避免静默截断；`--limit` 现本地校验 ≤ 10000（撞服务端上限也不漏标）。K 线 `--security all` 仍走日期分片自动补全

**新增**
- `quote fund-flow` — A股个股日资金流向（沪深京；小/中/大/特大单流入流出金额及占比、主力净流入；`--security` 或 `aShares` 全市场、`--start-date`/`--end-date`、`--limit`（默认 6000/上限 10000）、`--field`）；无积分消耗。`aShares` 全市场按日自动分片并发合并、须显式传日期范围（缺日期本地报错）；单只证券无翻页，撞 `--limit` 标 `partial`
- `reference institution-search` — 机构 ID 搜索，5 类机构（`domesticBroker`/`foreignInstitution`/`leadInstitution`/`opinionInstitution`/`foreignOpinionInstitution`——末者文档未列但实测有效），结果自带 `usageScopes` 标明适用接口/参数；覆盖既有 `--broker`/`--institution` 全部机构入参；免费
- `vault my-conference-list` 新增 `--source`（录制来源 1=企微会议助理 2=会议服务微信群）

**文档 / Skill**
- 机构 ID 路由改为 `reference institution-search` 优先（本地 `lookup broker-org/meeting-org` 仅作全量枚举兜底）；指标(EDE) 三接口与更新后服务端文档核对一致

### v0.22.1 — 2026-07-03

**修复**
- 错误码 `410004` 提示改为中性措辞「数据未找到或无指标权限，请检查查询条件与指标权限」——此前只说"数据未找到"，与 `indicator` 内层信封的"无权限"消息拼接后自相矛盾

**文档 / Skill**（随 `/sync-skill` 分发，不影响 CLI 行为）
- gangtise-openapi Agent Skill 经 fable5 审计 + 多轮 review 优化：积分计费速查 + 高积分 pre-flight 闸门、AI 同步命令超时前置、大结果集落盘、异步 `--wait` 主路径、行业码口径收敛、市值量纲实测等

### v0.22.0 — 2026-07-02

**行为变更（注意）**
- ⚠️ 自动翻页接口省略 `--size` 现在一律拉全量（不再区分是否传时间范围）；需要只取前 N 条时请显式传 `--size N`。数据量未知时可先用 `--size 1` 从 stderr 的 `Total: N` 探明量级
- 部分结果可机器识别：翻页页失败、K 线分片失败、或服务端提前短页但仍报告更大 `total` 时，结果会带 `partial: true`（页失败另有 `failedPages`，分片为 `failedShards`），非 json 行式输出仍只输出数据行，但进程退出码为 3

**修复（鉴权 / 请求可靠性）**
- Token 自愈覆盖服务端 `0000001008` 踢线失效，并能处理 HTTP 4xx 错误信封；`GANGTISE_TOKEN` + AK/SK 场景下环境 token 失效后不再反复回放旧 token
- 并发请求同时遇到旧 token 失效时复用一次刷新结果；若刚拿到的新 token 本身被踢掉，则强制再次登录，避免"刚登录窗口期"误跳过刷新
- 自动重试范围扩展到 429、DNS/网络临时错误与 undici 超时类错误；`GANGTISE_BASE_URL` 带路径前缀时 URL 拼接不再丢前缀

**修复（下载 / 输出 / 数据正确性）**
- 下载接口跟随最多 3 次 30x 跳转；跨域跳到对象存储签名 URL 时不携带 Authorization；服务端返回 `{url}` 且用户传 `--output` 时会真正下载文件，而不是把 URL 字符串写进文件
- 自动文件名补齐清洗、截断与去重：服务端文件名、标题缓存名和 fallback 名都不会把 `/`、控制字符、过长中文名或重复标题变成路径/覆盖问题
- `table`/`markdown` 输出清理控制字符、正确按 CJK 宽字符对齐，并转义 markdown 表头中的 `|`；CSV 输出转义表头、文件输出带 UTF-8 BOM，流式 CSV 遇全标量列表时回退到正常渲染而不是只写 BOM
- `indicator search` / `cross-section` / `time-series` 的内层失败信封即使没有 `data` 字段也会抛出 `ApiError`，不再把"无权限/参数错误"渲染成成功结果
- `--indicator-param` 等逗号列表支持全角逗号 `，`；日期型时间参数按本地零点解析，避免 `yyyy-MM-dd` 被当作 UTC 造成查询窗口偏移
- `fundamental earning-forecast` 省略 `--start-date` 时按传入的 `--end-date` 往前一年计算，不再总是按今天往前一年
- AI 异步 `--wait` 对 `410111` 终态失败只提示"不要重试"，超时才提示稍后用 check 命令查询；等待说明同步为最长约 5 分钟

**CLI / 工程**
- `raw call` 会在本地拒绝 JSON endpoint 的 `--query` 和 download endpoint 的 `--body`，避免静默丢参数；`--format` 在发请求前校验，格式拼错不再先消耗接口调用
- `gangtise ... | head` 遇 stdout `EPIPE` 时安静退出；只有首个参数是 `--version` / `-V` 时才触发版本快捷路径
- Endpoint registry 的 `key` 改为由记录键自动派生，减少映射漂移；新增真实 CLI 选项到请求体的 stub 测试；测试 272 → 323

### v0.21.0 — 2026-06-29

**行为变更（注意）**
- ⚠️ `vault wechat-chatroom-list` 省略 `--size` 现在**拉全量**（此前默认只返回 20 条）。该接口不返回 `total`，CLI 改为串行翻页（翻到不满页为止，单页上限 50）；传 `--size N` 仍只取前 N 条。依赖"默认 20 条"的脚本会拿到全部群。

**修复**
- `quote day-kline --security all` 等大结果集用默认 `table` 格式输出时不再因 `Math.max(...大数组)` 撑爆调用栈崩溃（`RangeError`）；`renderTable` 改用 reduce 计算列宽
- CSV 导出：含回车符 `\r` 的字段现在正确加引号（RFC 4180）；`table` / `markdown` 的多行字段折叠换行，保持表格对齐
- 下载文件名剥离控制字符 / NUL，避免 `fs.writeFile` 报错

**修复（安全）**
- token 缓存文件（`~/.config/gangtise/token.json`）改为临时文件 + 原子 `rename` 写入：从第一字节即 `0600`，消除"旧文件宽松权限残留"与"崩溃截断"两个隐患

**内部 / 工程**
- 依赖 `vitest` 升级到 3.2.6（修复 dev-only 安全告警）；新增 `npm run typecheck`；测试 257 → 272

### v0.20.0 — 2026-06-26

**新增接口**
- `insight announcement-us list` / `download` — 美股公司公告列表与下载（`--security TSLA.O`、`--category`〔分类用 `reference constant-list --category usShareAnnouncementCategory`，美股独立的 `103980xxx` 段〕、`--search-type`、`--rank-type`、下载 `--file-type 1` 原始 PDF / `2` Markdown）；自动翻页，单页上限 50
- `ai stock-summary` — 个股看点（精炼投研总结）：`--security` 传具体代码（A股/港股，可重复，单次最多 6000）或市场关键词 `aShares` / `hkStocks` 拉全市场；无看点的证券不返回、不扣分
- `fundamental income-statement-us` / `balance-sheet-us` / `cash-flow-us` — 美股三大财务报表（参数同其他财报：`--security-code` / `--period` / `--report-type` / `--fiscal-year` / `--field` 等）
- `reference chiefs-search` — 首席分析师 ID 搜索（`--keyword` 按姓名/机构/团队匹配，`--top` 默认 10）；用于 `insight opinion list --chief` 的入参

**变更**
- `insight announcement-hk download` 新增 `--file-type`（`1` 原始（默认）/ `2` Markdown），此前无格式选项

**行为变更（注意）**
- ⚠️ `auth login` / `auth status` 默认脱敏 access token：`--format json` 输出里 `authorization` 与 `cache.accessToken` 显示为 `<redacted>`，仅保留过期时间 / 用户名 / 产品码 / uid 等非敏感字段。**依赖 `auth login` 原始 token 输出的脚本会拿到 `<redacted>`**，需改用 `auth login --show-token` 获取明文。

**修复（安全）**
- `auth status` / `auth login` token 脱敏：按凭证字段名模式匹配（`token`/`key`/`secret`/`password`/`credential`），覆盖 `apiKey`/`privateKey`/`refreshToken` 等任何可能携带的凭证字段
- 自愈守卫：同时设 `GANGTISE_TOKEN` + AK/SK 时，注入 token 失效后重新登录不再被旧 token 短路，重试改用登录拿到的新 token

**修复（数据正确性 / 健壮性）**
- ⚠️ **CSV 负数不再被破坏**（影响所有 CSV 导出）：此前防公式注入会把负数（如跌幅 `-3.5`）加 `'` 前缀变成文本，Excel/pandas 无法参与计算；现仅对非有限数字的可疑串（`=`/`@`/`-1+cmd` 等）加前缀，合法数字原样输出
- 自动翻页改为 fail-soft：某页遇不可重试错误（限流 `903301` 等）不再丢弃已取的全部数据，返回已取页 + `partial` / `failedPages` 标记，并在首错后停止继续请求（避免撞限流多烧配额）
- 下载文件名 fallback（服务端 `Content-Disposition`）补清洗：含 `/`、`:` 等字符的文件名不再写到意外路径
- `ai stock-summary` / `ai knowledge-batch` 缺 `--security` / `--query` 时本地报错，不再发空请求（stock-summary 借此避免被后台当全市场误扣积分）
- `ai hot-topic` `--no-with-related-securities` / `--no-with-close-reading` 改为显式发 `false`（语义更明确，不依赖"字段缺失=排除"的隐含约定）

**修复（indicator 适配 EDE 后台新结构）**
- `indicator cross-section` / `time-series` 适配后台改版的返回结构（字段名加 `List` 后缀 `securityCodeList/indicatorCodeList/…`、截面 `values` 改二维 `[指标][证券]`）：此前后台改结构后 CLI 拍平失配、退化成原始矩阵，现恢复 `{date, security, name, 指标:值}` 宽表。配合后台同步变化——无数据从 `999999` 报错改为返回 `null`（截面不再 500、不丢行），缺必填参数从笼统 `410106` 改为直接指明缺哪个参数

### v0.19.0 — 2026-06-24

**新增接口（Indicator · 证券级数据指标 EDE）**
- `indicator search` — 按名称搜索证券级数据指标，返回 `indicatorCode` 及可传参数 `parameterList`（含 `required` 必填标记与枚举）；取数前必先 search 拿 code，绝不猜编码
- `indicator cross-section` — 指标截面数据（多指标 × 多证券，单日快照）：`--indicator` / `--security`（均可重复）/ `--date` / `--currency` / `--scale` / `--indicator-param`
- `indicator time-series` — 指标时间序列（多指标 × 单证券 或 单指标 × 多证券，按区间）：另有 `--start-date` / `--end-date` / `--calendar-type`（`ND`/`TD`/`WD`）
- 复权等指标专属参数用 `--indicator-param "code:key=value"`，参数 key 与取值以 search 的 `parameterList` 为准（行情复权键为 `adjustmentType`：`1` 不复权 / `2` 前复权 / `3` 后复权）
- 很多指标有必填参数，默认调用会报 `410106`（缺必填参数）：N 期统计补 `periodNum`、区间/周期类补 `startDate`、年度/分红类补 `fiscalYear`；`999999` 多为「该证券公司类型/报告期无数据」而非系统故障。详见 `gangtise-openapi/references/commands/indicator.md`

**修复**
- `vault stock-pool-stocks --pool-id <id>` 过滤失效：此前因选项默认值 `["all"]` 泄漏，传具体 pool id 仍返回全部股票池证券；现已修复——传 id 精确过滤，省略则默认全量
- `auth` 缺凭证报错补充跨 shell（bash/zsh/fish）的 `export` 提示

**文档**
- README / SKILL 补充 indicator 命令组与取数最佳实践；`official-account` 命令文档补全

### v0.18.0 — 2026-06-17

**新增接口（Insight · 产业公众号资讯）**
- `insight official-account list` — 查询公众号资讯列表：支持 `--keyword`（需用数据中的具体词，非整句白话）/ `--account-id`（公众号 ID）/ `--security` / `--category`（文章类型枚举：`news`/`law`/`report`/`view`/`data`/`event`/`meeting`/`notice`/`recruit`/`investEdu`/`brand`/`notes`/`other`）/ `--industry`（`citicIndustry`/`swIndustry` 行业 ID）/ `--search-type`（`1` 标题 / `2` 全文）/ `--rank-type`（`1` 综合 / `2` 时间倒序）；返回含模型生成摘要 `summary` 及关联行业/题材/证券列表
- `insight official-account download --article-id <id>` — 下载公众号文章：`--file-type 1` txt（默认）/ `2` HTML

### v0.17.2 — 2026-06-16

**修复**
- 错误码 `0000001008`（服务端 token 失效/他处登录挤掉）现同 8000014/8000015 一样自动重新登录并重试一次

### v0.17.1 — 2026-06-16

**修复**
- 下载中断时自动清理写了一半的文件，不再残留损坏的半截产物
- 自动翻页增加 1000 页安全上限，触达时输出告警，防止异常循环

### v0.17.0 — 2026-06-15

**接口变更（Breaking）**
- 日程类命令（`roadshow` / `site-visit` / `strategy` / `forum` list）改为各自只暴露 API spec 支持的筛选选项，移除原先一刀切多出的无效选项：`strategy` 仅保留 `--institution` / `--location`；`forum` 仅保留 `--research-area` / `--location`；`site-visit` 移除 `--participant-role` / `--broker-type`；`roadshow` 移除 `--object`。传不支持的选项现由 commander 直接报 `unknown option`（此前会静默发送、服务端返回空结果）
- `insight announcement list` 移除无效的 `--announcement-type`（服务端忽略、恒返全量）；A 股公告分类筛选用 `--category`（`aShareAnnouncementCategory` 常量 ID）

**说明 / 修正**
- `--industry` 用 `citicIndustry` 码（`1008001xx`，全命令通用）；`--research-area` 用 `gangtiseIndustry` 码（行业 `1008001xx` + 宏观/策略/固收/金工/海外等方向 `122000xxx`）。详见 `gangtise-openapi/references/commands/reference-and-lookup.md`
  > ⚠️ **后续订正（2026-08-08）**：`gangtiseIndustry` 里**只有 6 条方向码 `122000xxx`，不含任何行业码**（`constant-list --category gangtiseIndustry` 实测 `constantCount=6`，连查 3 次一致）。`1008001xx` 行业码用于 `--research-area` 确实有效，但它们属于 `citicIndustry`，本条把归属写错了。别再照这句去 `gangtiseIndustry` 找行业。
- 日程类 `--location`（domesticCity）服务端过滤已生效（v0.16.0 时曾未生效）

### v0.16.0 — 2026-06-12

**新增接口（参考数据 · 常量查询，均免积分）**
- `reference constant-category` — 查询常量分类：全量导出常量分类及各分类适用于哪些接口的哪些参数（7 个分类：中信/申万/Gangtise 行业、国内城市、A股/港股公告分类、区域）
- `reference constant-list --category <code>` — 查询常量值：按分类导出全量常量（`constantId` / `constantName`，树形分类含 `children` 嵌套）
- `reference concept-search --keyword <kw>` — 查询题材 ID：按名称/拼音/分组名搜索，返回 `conceptId`（供 `alternative concept-info / concept-securities`、`ai theme-tracking` 使用）
- `reference sector-search --keyword <kw>` — 查询板块 ID：返回 `sectorId` + `hierarchy` 层级路径
- `reference sector-constituents --sector-id <id>` — 查询板块成分股：返回该板块全量成分股（`gtsCode` / `gtsName`）；注意 sectorId 必须来自 sector-search，题材 conceptId 查不到成分

**接口变更（Breaking）**
- 移除已被新 API 覆盖的 6 个本地 lookup 子命令及静态数据：`lookup research-area / industry / region / announcement-category / theme-id / industry-code list`，请改用 `reference constant-list` / `reference concept-search` / `reference sector-constituents`（申万行业代码 `821xxx.SWI` 全量：`sector-constituents --sector-id 2000000014`，即申万一级行业指数板块）
- `lookup` 仅保留 2 个 API 未覆盖的本地表：`broker-org` / `meeting-org`
- 路演/调研/策略会/论坛 list 新增 `--location <id>` 按城市过滤（domesticCity 常量 ID；服务端过滤 v0.17.0 起已生效）

### v0.15.0 — 2026-05-29

**新增接口**
- `alternative concept-info` — 题材指数基本信息：返回题材整体画像（定义 / 投资逻辑 / 行业空间 / 竞争格局 / 催化事件）。按 `--concept-id` 查询，仅返回最新截面数据，不支持历史回溯
- `alternative concept-securities` — 题材指数成分股（题材深度 F8）：按分组结构返回当前成分股，每只含是否重点个股 `isKey` 与纳入理由 `inclusionReason`。按 `--concept-id` 查询

**接口变更**
- `quote index-day-kline` 返回字段新增 `securityName`（指数名称，如"上证指数"）

> `--concept-id` 与主题跟踪 `ai theme-tracking --theme-id` 共用同一套题材 ID 体系，可用 `gangtise lookup theme-id list` 按名称查询（如 机器人 → `121000130`）。

### v0.14.4 — 2026-05-29

**Bug fix（全市场 K 线分片容错）**
- `quote day-kline --security all` 等全市场查询的日期分片改为容错：部分分片失败时返回已成功分片的数据并标记 `partial: true` + `failedShards`（失败的日期区间），同时向 stderr 告警；只有全部分片失败才抛错。此前为 fail-fast，单片失败会让整次查询失败，或在异常路径上被误判为空结果。

### v0.14.3 — 2026-05-29

**性能 / 健壮性**
- 标题缓存按端点封顶（5000 条/端点）并清理过期项，修复 `title-cache.json` 无上限增长（曾达 ~58MB）拖慢启动的问题
- 下载接口遇鉴权失效（`8000014` / `8000015`）自动刷新 token 并重试一次（此前仅普通 JSON 调用具备 token 自愈）
- CLI handler 抽出 `emit` / `withClient` 公共封装去除重复样板；CSV 转义逻辑去重；翻页与 K 线分片统一走 `GANGTISE_PAGE_CONCURRENCY` 并发控制
- 补齐多个 core 模块的单元测试

### v0.14.2 — 2026-05-22

**Bug fix（A 股 / HK 全市场 K 线同源问题）**
- `quote day-kline --security all` 由 2 天/片改为 **1 天/片**（A 股全市场单日约 5500 行）
- `quote day-kline-hk --security all` 由 3 天/片改为 **2 天/片**（港股全市场单日约 2770 行）
- 根治性修复：`callKlineWithSharding` 在 `--security all` 路径上，若用户未显式传 `--limit`，强制写入 `limit: 10000`（API 上限），不再走默认 6000——这样即便分片日数估算偏大，每个 shard 也能拿满 10K 行。用户自己传的 `--limit` 仍然保留生效。

### v0.14.1 — 2026-05-22

**Bug fix**
- `quote day-kline-us --security all` 分片由 2 天/片改为 **1 天/片**。美股全市场单日约 5800 行，原 2 天/片会在第一个 shard 命中默认 `--limit 6000` 上限，导致 shard 内第二日数据被截断到几百行。改 1 天/片后每个 shard 数据完整。

### v0.14.0 — 2026-05-22

**新增接口**
- `quote realtime` — 个股实时行情快照，单接口同时覆盖 A 股 / 港股 / 美股；支持代码混合传入或市场关键字（`aShares` / `hkStocks` / `usStocks`）批量查询全市场
- `quote day-kline-us` — 美股历史日 K 线，数据范围 NYSE / NASDAQ / AMEX；支持 `--security all` 全市场（CLI 自动按 1 天/片切分并发拉取，美股全市场单日约 5800 行）

**接口变更**
- `quote day-kline` / `quote day-kline-hk` 明确仅返回**历史**日 K 线，不包含盘中实时数据；当日数据入库时间：A 股 ~15:30 / 港股 ~16:30（北京时间）。盘中实时请走 `quote realtime`
- `fundamental valuation-analysis` 返回字段移除 `p10` / `p25` / `p75` / `p90`（仍保留 `value` / `percentileRank` / `average` / `median` / `upper1Std` / `lower1Std`）

### v0.13.0 — 2026-05-15

**新增接口**
- `fundamental income-statement-hk / balance-sheet-hk / cash-flow-hk` — 港股三大报表（中国会计准则）
- `alternative edb-search` — 行业指标列表搜索（按关键词匹配指标名称，返回 indicatorId 等元信息）
- `alternative edb-data` — 行业指标时序数据（批量按 indicatorId 拉取时间序列，最多 10 个指标）
- `vault stock-pool-list` — 查询用户自选股股票池列表（poolId / poolName）
- `vault stock-pool-stocks` — 查询股票池证券明细（支持 `--pool-id all` 全量查询）

**接口变更**
- `fundamental income-statement / balance-sheet / cash-flow / income-statement-quarterly / cash-flow-quarterly` 名称调整为 A股报表（路径不变）
- `ai management-discuss-announcement` `--dimension` 新增 `all` 选项，返回报告中完整的管理层讨论内容（内容可能较长）
- `vault wechat-message-list` 新增 `--security <code>` 参数（按证券代码过滤），返回结果增加 `securityList` 字段

### v0.12.0 — 2026-05-10

**性能 / 架构**
- 翻页并行化：自动翻页接口拉到首页 `total` 后，剩余页通过 `Promise.all` 并发请求（默认并发 5，`GANGTISE_PAGE_CONCURRENCY` 可调）
- 共享 `undici.Agent`：所有请求复用连接池（keep-alive 60s，max 16 连接），避免重复 TLS 握手
- 流式下载：`--output` 指定时二进制响应直接 `pipeline` 到磁盘，不再走内存 `Uint8Array`
- 流式输出：`--format jsonl/csv --output xxx` 且 ≥1000 行时逐行写盘
- Token 内存缓存：Token 在进程内不再每次读盘
- 自动重试：5xx / `ECONNRESET` / `ETIMEDOUT` / `999999` 自动指数退避重试 2 次
- Token 自愈：8000014/8000015 自动重新登录并重试一次
- 异步轮询退避：`earnings-review` / `viewpoint-debate` 轮询从固定 15s 改为 5→8→13→20→30s 指数退避
- K线自动分片：`quote day-kline --security all` 等全市场查询自动按日期切分并发执行
- 标题缓存：原"读全文→改→写全文"改为内存快照 + 原子写入（temp+rename）

**调试 / 可观测性**
- 新增 `--verbose` / `GANGTISE_VERBOSE=1`：打印每个请求的耗时、状态码、响应字节数到 stderr

### v0.11.1 — 2026-05-10

**新增接口**
- `insight announcement-hk list/download` — 查询/下载港股公告
- `insight foreign-opinion list` — 查询外资机构观点（外资券商）
- `insight independent-opinion list/download` — 查询/下载外资独立分析师观点
- `reference securities-search` — GTS Code 搜索（按名称/代码/拼音多维度匹配证券）

**接口变更**
- `insight summary download` 新增可选 `--file-type`（`1`=原始内容 / `2`=HTML），仅影响来源为会议平台的纪要
- `insight announcement list/download` 名称调整为"查询A股公告列表/下载A股公告文件"（路径不变）
- `insight opinion list` 名称调整为"查询内资机构观点列表"（路径不变）

### v0.11.0 — 2026-04-17

- 新增 `ai viewpoint-debate` / `viewpoint-debate-check` — 观点PK（异步）
- 新增 `ai management-discuss-announcement` / `management-discuss-earnings-call` — 管理层讨论

### v0.10.9 — 2026-04-10

- 修复信封检测、版本更新检查、端点去重
- 新增 `quote index-day-kline` 指数日K线
- 新增 `vault wechat-message-list` / `wechat-chatroom-list` 群消息
