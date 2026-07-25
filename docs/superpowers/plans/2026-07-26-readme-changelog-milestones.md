# README Changelog Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep five recent release summaries in README and add six concise historical phase milestones, while retaining all detailed release notes in `CHANGELOG.md`.

**Architecture:** This is a documentation-only change. README remains the compact entry point; `CHANGELOG.md` remains the complete source of release history.

**Tech Stack:** Markdown, Node.js assertion script, Vitest documentation consistency test

## Global Constraints

- Keep exactly five recent version summaries (`v0.29.0` through `v0.28.0`).
- Add exactly six historical milestone entries in reverse chronological order.
- Each milestone is one sentence with no nested bullets.
- Do not remove or duplicate detailed release notes in `CHANGELOG.md`.

---

### Task 1: Add the historical milestone timeline

**Files:**
- Modify: `README.md:5`
- Modify: `CHANGELOG.md:3`
- Test: `tests/unit/docsConsistency.test.ts`

**Interfaces:**
- Consumes: Complete release history from `CHANGELOG.md` and the approved milestone design.
- Produces: A compact README changelog with five recent summaries, six historical milestones, and a link to the complete changelog.

- [x] **Step 1: Confirm the historical milestone section is absent**

Run:

```bash
node -e 'const r=require("node:fs").readFileSync("README.md","utf8"); if(!r.includes("### 历史里程碑")) throw new Error("历史里程碑 missing")'
```

Expected: FAIL with `历史里程碑 missing`.

- [x] **Step 2: Add the approved README milestone copy**

After the five recent summaries, add:

```markdown
### 历史里程碑

- **v0.26.0–v0.27.0**：建立高积分端点 `no-replay`、原子下载与容错分页机制，并补齐 Skill 分发和发布质量门禁。
- **v0.22.0–v0.23.0**：统一“省略 `--size` 即拉全量”的分页语义，引入机器可识别的部分结果、Token 自愈，并完成 API 域名迁移与资金流向、机构搜索支持。
- **v0.19.0–v0.20.0**：上线 EDE 证券指标接口，扩展美股公告与财务报表，同时加强凭证脱敏、CSV 正确性和分页容错。
- **v0.16.0–v0.18.0**：以服务端参考数据替代多数本地静态表，收紧端点参数，并加入产业公众号资讯。
- **v0.14.0–v0.15.0**：新增跨市场实时行情、美股日 K 与题材数据，完善全市场 K 线分片和部分失败容错。
- **v0.12.0–v0.13.0**：奠定并发翻页、连接复用、流式输出与 K 线分片架构，并扩展港股财报、EDB 和股票池。
```

Change the `CHANGELOG.md` introduction to:

```markdown
本项目完整版本历史。README 顶部仅展示最近 5 个版本摘要与关键历史里程碑。
```

- [x] **Step 3: Verify the summary and milestone counts**

Run:

```bash
node -e 'const fs=require("node:fs"); const r=fs.readFileSync("README.md","utf8"); const recent=[...r.matchAll(/^- \*\*v0\.2[89]\./gm)]; const history=r.slice(r.indexOf("### 历史里程碑"),r.indexOf("> 完整更新明细")); const milestones=[...history.matchAll(/^- \*\*v/gm)]; if(recent.length!==5||milestones.length!==6) throw new Error(`recent=${recent.length}, milestones=${milestones.length}`); console.log("recent=5, milestones=6")'
```

Expected: `recent=5, milestones=6`.

- [x] **Step 4: Run documentation verification**

Run:

```bash
npm test -- tests/unit/docsConsistency.test.ts
git diff --check
```

Expected: one test file and one test pass; `git diff --check` has no output.

- [x] **Step 5: Review and commit the documentation change**

Run:

```bash
git diff -- README.md CHANGELOG.md
git add README.md CHANGELOG.md docs/superpowers/plans/2026-07-26-readme-changelog-milestones.md
git commit -m "docs: add readme changelog milestones"
```

Expected: one documentation commit containing the compact README timeline, changelog pointer, and implementation plan.
