# Skill 场景评测（K28）

量化 `gangtise-openapi/` 这份 skill 的调用准确度：改 skill 前后各跑一轮，看五个维度的通过率有没有变。

## 怎么跑

```bash
npm run skill-eval                       # 干跑：agent 只读 skill、输出它会执行的命令，不真跑
npm run skill-eval -- --live             # 实跑：agent 真执行命令（凭证从环境继承，CLI 用本仓 dist/ 的构建）
npm run skill-eval -- --only S06,S09     # 子集
npm run skill-eval -- --model gpt-6-astra --effort high --concurrency 2 --timeout 900000
npm run skill-eval -- --rescore evals/results/<ts>.json   # 用保存的回复按当前判据重算，不跑模型、不花积分
```

- 运行器：`scripts/skill-eval.mjs`，驱动 `codex exec`（默认 `gpt-6-astra`、`model_reasoning_effort=high`），每个场景一个独立会话，`--output-schema evals/response.schema.json` 强制回 `{commands, notes}`
- 场景：`evals/scenarios.json`，每条一句用户话 + checks；`where` 指定在命令行（`commands`）、说明（`notes`）还是两者（`all`）里匹配；`must` / `mustNot` 是正则，`before=[A,B]` 要求先 A 后 B
- 五个维度：**命令**（选对命令）/ **参数** / **证券** / **单位** / **完整性**（先查 ID、落盘、退出码 3 的处理、积分确认）
- 原始回复与逐项判分落在 `evals/results/<时间戳>.json`（gitignored），stdout 是汇总表
- 干跑用只读沙箱；实跑用 `--dangerously-bypass-approvals-and-sandbox` 并把本仓 `dist/src/cli.js` 包成 `gangtise` 放到 PATH 最前，提示里写明积分已预先授权
- **无效运行不计分**：codex 退出非 0（含超时 124）、回复解析失败、实跑时 `cli=` 自检不等于本仓版本（或没报），该场景所有检查计为未过并在表里标「⚠️无效」。判定在计分之前——正则分不清「答对了」和「拿错的二进制答对了」
- 超时杀的是 codex 的整个进程组（agent 的子命令会继承输出管道，只杀父进程会一直等不到 close）
- 改了判据后用 `--rescore` 对已保存的结果重算再更新基线；旧的 live 文件没有 `cli=` 自检的会整份判无效

## 判据设计原则

- 判「做法对不对」，不判「文案怎么写」：正则只钉命令名、参数名、代码、单位关键词；匹配前会去掉无空白 token 两侧的引号（`--security "aShares"` 与不加引号同分）
- 判据要卡在场景要测的那个点上：S06 测的是报告期指标必须显式 `reportDate`，判据就不能放过只传 `--date` 的写法；S11 测的是补拉要覆盖全部缺失区间，就要三个日期各自被某条命令的窗口覆盖（单日三条或一条区间都行）
- 不惩罚 skill 要求的保守行为：公司不在速查表时先 `securities-search` 与直接写代码同等通过（S06 的教训）
- 一个场景只测一件事的多个侧面；新增陷阱类场景优先（静默错数那类）

## 基线

| 日期 | 模式 | 模型 | 合计 | 命令 | 参数 | 证券 | 单位 | 完整性 | 备注 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 2026-09-06 | 干跑 | gpt-6-astra / high | 64/64（100%） | 16/16 | 29/29 | 11/11 | 1/1 | 7/7 | `--rescore evals/results/2026-09-06T02-39-18-434Z.json`；首次计分为 61/62，未过项是判据写死了五粮液代码，agent 先查代码是对的，判据已放宽 |
| 2026-09-06 | 实跑 | gpt-6-astra / high | 64/64（100%） | 16/16 | 29/29 | 11/11 | 1/1 | 7/7 | `--rescore evals/results/2026-09-06T03-02-09-066Z.json`；16 个场景的 `cli=` 自检全部为 0.38.0；S13 两次观察到 5556 只 `stock-summary` 返回 0 行（台账 P1-12） |

两行都是按现行判据（S06 收紧为必须显式 `reportDate`、S11 改为三个缺失日期都要被覆盖，共 64 项）对保存的回复重算的结果。

首轮实跑（`2026-09-06T02-48-35-437Z.json`）作废：agent 的登录 shell 重建 PATH，把前置的封装目录丢掉，16 个场景实际跑的都是全局安装的 0.37.1（S10 的双证券分钟 K 只回了后一只，就是旧版 `--security` 单值的表现）。运行器已改为在提示里给出封装脚本绝对路径、要求 `gangtise --version` 自检并在结果里校验；那份文件按现行规则重算为 0/64、16 个场景全部无效。
