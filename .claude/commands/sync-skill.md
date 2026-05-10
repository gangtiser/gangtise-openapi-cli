---
description: Sync gangtise-openapi/ to all 5 skill installation paths (Claude/Hermes/OpenClaw/Martin/Codex)
allowed-tools: Bash
---

把项目里的 `gangtise-openapi/` 目录镜像同步到这 5 个 skill 安装路径，用 `rsync -av --delete`：

| 目标 | 路径 |
|---|---|
| Claude  | `~/.claude/skills/gangtise-openapi/` |
| Hermes  | `~/.hermes/skills/gangtise-openapi/` |
| OpenClaw (workspace) | `~/.openclaw/workspace/skills/gangtise-openapi/` |
| Martin  | `~/.martin/skills/gangtise-openapi/` |
| Codex   | `~/.codex/skills/gangtise-openapi/` |

执行规则：
- 一次 Bash 调用，5 条 rsync 用 `&&` 串联（任一失败即停）
- 每条加 `2>&1 | tail -3` 抓最关键的传输摘要，避免输出爆炸
- 跳过任何不存在的父目录前先用 `[ -d <parent> ]` 检查（避免 rsync 自动创建意外位置）
- 同步完后用一行表格汇报每个目标的状态（同步成功 / 跳过 / 失败）
