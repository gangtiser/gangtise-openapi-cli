# Skill 场景评测（K28）

量化 `gangtise-openapi/` 这份 skill 的调用准确度：改 skill 前后各跑一轮，看五个维度的通过率有没有变。

## 怎么跑

```bash
npm run skill-eval                       # 干跑：agent 只读 skill、输出它会执行的命令，不真跑
npm run skill-eval -- --live             # 实跑：agent 真执行命令（凭证从环境继承，CLI 用本仓 dist/ 的构建）
npm run skill-eval -- --only S06,S09     # 子集
npm run skill-eval -- --model gpt-6-astra --effort high --concurrency 2 --timeout 900000
```

- 运行器：`scripts/skill-eval.mjs`，驱动 `codex exec`（默认 `gpt-6-astra`、`model_reasoning_effort=high`），每个场景一个独立会话，`--output-schema evals/response.schema.json` 强制回 `{commands, notes}`
- 场景：`evals/scenarios.json`，每条一句用户话 + checks；`where` 指定在命令行（`commands`）、说明（`notes`）还是两者（`all`）里匹配；`must` / `mustNot` 是正则，`before=[A,B]` 要求先 A 后 B
- 五个维度：**命令**（选对命令）/ **参数** / **证券** / **单位** / **完整性**（先查 ID、落盘、退出码 3 的处理、积分确认）
- 原始回复与逐项判分落在 `evals/results/<时间戳>.json`（gitignored），stdout 是汇总表
- 干跑用只读沙箱；实跑用 `--dangerously-bypass-approvals-and-sandbox` 并把本仓 `dist/src/cli.js` 包成 `gangtise` 放到 PATH 最前，提示里写明积分已预先授权

## 判据设计原则

- 判「做法对不对」，不判「文案怎么写」：正则只钉命令名、参数名、代码、单位关键词
- 不惩罚 skill 要求的保守行为：公司不在速查表时先 `securities-search` 与直接写代码同等通过（S06 的教训）
- 一个场景只测一件事的多个侧面；新增陷阱类场景优先（静默错数那类）

## 基线

| 日期 | 模式 | 模型 | 合计 | 命令 | 参数 | 证券 | 单位 | 完整性 | 备注 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 2026-09-06 | 干跑 | gpt-6-astra / high | 61/62（98%） | 16/16 | 27/27 | 10/11 | 1/1 | 7/7 | 唯一未过项是判据写死了五粮液代码，agent 先查代码是对的，判据已放宽 |
| 2026-09-06 | 实跑 | gpt-6-astra / high | 62/62（100%） | 16/16 | 27/27 | 11/11 | 1/1 | 7/7 | 16 个场景的 `cli=` 自检全部为 0.38.0；S13 两次观察到 5556 只 `stock-summary` 返回 0 行（台账 P1-12） |

首轮实跑作废：agent 的登录 shell 重建 PATH，把前置的封装目录丢掉，16 个场景实际跑的都是全局安装的 0.37.1（S10 的双证券分钟 K 只回了后一只，就是旧版 `--security` 单值的表现）。运行器已改为在提示里给出封装脚本绝对路径、要求 `gangtise --version` 自检并在结果里校验；`cli=` 与 `package.json` 不一致的场景会在汇总表里标 ⚠️。
