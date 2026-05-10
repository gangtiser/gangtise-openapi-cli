---
description: Full release flow — bump version, build, test, commit, push, npm publish, sync skill to 5 paths
allowed-tools: Bash, Edit, Read
argument-hint: [version, e.g. 0.13.0 or "patch"/"minor"/"major"]
---

执行 `gangtise-openapi-cli` 的发版流程。目标版本：$ARGUMENTS

## 0. 预检 + 确认版本

- 读 `package.json` 当前版本
- 读 `git status`，必须工作树干净（除了即将 bump 的 package.json）；不干净则**停下让用户处理**，不要替用户决定
- 解析 $ARGUMENTS：
  - 空 → 询问用户要 bump 到的版本
  - `patch` / `minor` / `major` → 在当前版本上递增
  - `x.y.z` → 直接用该版本
- 向用户复述："当前 vX.Y.Z → 准备发 vA.B.C，包含 N 个未发提交：…" 并展示 `git log <last-tag-or-commit>..HEAD --oneline`，让用户确认

## 1. 改版本

- 用 Edit 把 `package.json` 的 `"version": "..."` 改为目标版本
- 不要手动改 `src/version.ts`（gitignored，prepare 脚本生成）
- 不要手动改 `gangtise-openapi/SKILL.md` 的 frontmatter version（同上）

## 2. Build

- `npm run build`
- prepare 脚本会自动同步 `src/version.ts` 和 `SKILL.md` 的 frontmatter
- 失败则停下报告

## 3. Test

- `npm run test`
- 必须全绿。任一 fail 则停，不要重试同样的命令

## 4. Commit + Push

- 跑 `git status` + `git diff --stat` 看一遍要提交的文件
- `git add` **明确列名**（不要 `git add -A`）：至少包含 `package.json` `gangtise-openapi/SKILL.md` 以及任何 src/ 或 references/ 改动
- commit message：
  - 如果距上个 release 只有 docs / chore：用 `chore: release vX.Y.Z`
  - 如果有用户可见功能或 fix：列简明 changelog 后接 `chore: release vX.Y.Z`
  - 末尾加 `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- 用 HEREDOC 传 commit message
- `git push` 到 origin/main

## 5. npm publish

- `npm publish --registry https://registry.npmjs.org`（本机默认源是 npmmirror，**必须显式指定 registry**，否则 publish 失败）
- 等命令成功返回 `+ gangtise-openapi-cli@vX.Y.Z`

## 6. 同步 skill 到 5 个路径

跑下面 5 条 rsync（一次 Bash 调用，&&  串联）：

```bash
rsync -av --delete gangtise-openapi/ ~/.claude/skills/gangtise-openapi/ 2>&1 | tail -3 \
  && rsync -av --delete gangtise-openapi/ ~/.hermes/skills/gangtise-openapi/ 2>&1 | tail -3 \
  && rsync -av --delete gangtise-openapi/ ~/.openclaw/workspace/skills/gangtise-openapi/ 2>&1 | tail -3 \
  && rsync -av --delete gangtise-openapi/ ~/.martin/skills/gangtise-openapi/ 2>&1 | tail -3 \
  && rsync -av --delete gangtise-openapi/ ~/.codex/skills/gangtise-openapi/ 2>&1 | tail -3
```

任何路径 rsync 失败时报告但**不要因此回滚 git/npm**——版本已发，只需重做 sync。

## 7. 验证 + 汇报

- `npm view gangtise-openapi-cli@vX.Y.Z version --registry https://registry.npmjs.org`（注册源传播可能需要 5-15s，第一次 404 可重试一次）
- 汇报最终表：commit hash / npm 版本 / 5 个 sync 目标状态

## 异常处理

- 任一步失败 → 立刻停下报告，不要继续后面的步骤
- 注意 git 提交后 npm publish 失败的情况：commit 和 push 已完成，只需补 publish + sync
- 注意 publish 成功但 sync 失败：包已上线，只需补 sync
