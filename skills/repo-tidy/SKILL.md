---
name: repo-tidy
description: >
  整理 working repo：清理垃圾文件、归档散落文件、梳理 Git 状态。
  根据 repo 类型（code / docs / data / general）应用不同策略。
  所有操作先 git stash 兜底，提出计划等用户确认后再执行。
  TRIGGER when: "整理 repo", "clean up repo", "tidy repo", "repo 太乱了",
  "清理项目", "organize files", or /repo-tidy command.
  DO NOT TRIGGER when: user wants to refactor code logic (use code-optimizer),
  or wants to restructure architecture (use ccplan).
origin: custom
---

# repo-tidy — Working Repo 整理工具

整理你的 working repo：清理垃圾、归档散落文件、梳理 Git 状态。
所有操作保守安全——先备份、先计划、用户确认后才动手。

## Core Philosophy

> **整理不是删除，是归类。**
> 垃圾文件移入 `archive/`，不直接删除。
> 每一步都可逆，每个决定都要用户确认。

Three principles:
1. **安全第一** — 动手前 `git stash`，归档而非删除，`archive/` 自动加入 `.gitignore`
2. **按类型定策略** — code / docs / data / general 四种模式，规则不同，保守程度不同
3. **计划先行** — 扫描完成后展示完整计划，用户 approve 后才执行

## When to Use

- Repo 里积累了大量临时文件、缓存、日志
- 根目录散落着各种脚本和笔记，需要归类
- Git 状态混乱（大量未跟踪文件、废弃分支）
- 换项目阶段前的"大扫除"

**Do NOT use** for:
- 重构代码逻辑（use code-optimizer）
- 重新设计项目架构（use ccplan）
- 清理 Git 历史 / rebase（直接用 git 命令）

## Repo Type Reference Files

每种 repo 类型有独立的规则文件，定义了该类型特有的清理目标和保护列表：

| Type | File | 适用场景 |
|------|------|---------|
| code | `references/code.md` | Python/JS/Rust 等代码项目 |
| docs | `references/docs.md` | 文档、笔记、写作项目 |
| data | `references/data.md` | 数据分析、ML 实验项目 |
| general | `references/general.md` | 混合项目或不确定类型 |

## Workflow — 五步流程

### Phase 1: Pre-flight Check

**Goal:** 确保环境安全，为所有后续操作兜底。

Steps:
1. 检测当前目录是否是 git repo（`git rev-parse --is-inside-work-tree`）
   - 如果不是 git repo：警告用户，询问是否仍要继续（无 git 备份能力）
2. 检查 working tree 状态（`git status --porcelain`）
3. 无论是否有未提交改动，都执行安全备份：
   ```bash
   git stash push -m "repo-tidy backup $(date +%Y-%m-%d_%H%M%S)"
   ```
   - 如果没有改动可 stash，git 会提示 "No local changes to save"——这是正常的，继续即可
4. 记录当前 stash 的 ref，以便后续恢复：
   ```bash
   git stash list | head -1
   ```

**Output to user:**
```
Pre-flight ✓
- Git repo: Yes
- Branch: main
- Backup: stash@{0} — "repo-tidy backup 2026-04-21_1430"
```

### Phase 2: Identify Repo Type

**Goal:** 确定 repo 类型，加载对应规则。

Ask the user to choose:
```
请选择 repo 类型：
1. code — 代码项目（Python/JS/Rust/Go 等）
2. docs — 文档/笔记项目（Markdown/LaTeX/Obsidian 等）
3. data — 数据/实验项目（Jupyter/CSV/模型文件等）
4. general — 混合项目或不确定
```

After user selects, load the corresponding `references/<type>.md` file.

### Phase 3: Scan

**Goal:** 全面扫描 repo，识别需要整理的内容。分三个维度扫描（+ 可选审计增强）。

#### 3.0: Audit Intelligence（审计增强，可选）

在规则扫描前，检查是否有 repo-audit 的审计报告可用：

```bash
test -f docs/repo-audit.json && echo "AUDIT_FOUND" || echo "NO_AUDIT"
```

**If `docs/repo-audit.json` exists:**

1. 检查 `audit_metadata.version` — 仅消费 major 版本为 `1` 的 JSON
2. 检查 `audit_metadata.timestamp` — 默认 7 天过期：
   ```
   ⚠️ 审计报告已过期 (N 天前生成)。建议先运行 /repo-audit 更新。
   继续使用旧报告？(y/n)
   ```
3. 加载 `tidy_recommendations`：
   - `files_to_clean` → 合并到 3A 结果，标注 `[审计推荐]`
   - `files_to_reorganize` → 合并到 3B 结果，标注 `[审计推荐]`
   - `config_issues` → 作为新的 3D 子项展示
4. 审计来源的项目展示 `confidence` 分数和 `finding_id`
5. `confidence ≥ 0.8` → 正常建议；`confidence < 0.8` → 标注 `[需确认]`

**If no audit JSON exists:** Phase 3 按原有逻辑执行（完全向后兼容）。

**Flags:**
- `--with-audit` — 强制使用 audit JSON，即使已过期
- `--no-audit` — 跳过 audit JSON，即使存在

#### 3A: Junk Files（垃圾文件）

Use `.gitignore`-aware scanning as primary source:
```bash
# 列出所有被 .gitignore 覆盖但仍存在于磁盘的文件
git clean -ndX

# 列出未被跟踪的文件（不含 ignored）
git ls-files --others --exclude-standard
```

Cross-reference with the **default junk list** (always clean these regardless of type):
- `.DS_Store`, `Thumbs.db`, `desktop.ini`
- `__pycache__/`, `*.pyc`, `*.pyo`
- `node_modules/`
- `.ipynb_checkpoints/`
- `*.log`, `*.tmp`, `*.swp`, `*.swo`
- `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`
- `*.egg-info/`, `dist/`, `build/` (if not in .gitignore already)
- `.tox/`, `.nox/`, `.coverage`, `htmlcov/`

Then apply **type-specific rules** from the loaded reference file.

#### 3B: Misplaced Files（散落文件）

Scan for files that seem out of place:
- 根目录下的临时脚本（`test_*.py`, `tmp_*`, `scratch_*`, `debug_*`）
- 根目录下的笔记文件（`notes.md`, `TODO.md`, `ideas.txt` 等）
- 不属于当前项目类型的文件（如代码项目中的 `.csv` 数据文件散落在根目录）

**Conservatism rule:** 只标记明显不属于的文件。如有疑问，列入计划但标注 `[需确认]`。

#### 3C: Git Hygiene（Git 状态）

```bash
# 未跟踪文件数量
git ls-files --others --exclude-standard | wc -l

# 本地分支列表
git branch

# 已合并到 main 的分支（候选删除）
git branch --merged main

# 大文件检查（>10MB 且在 git 跟踪中）
git ls-files | xargs ls -la 2>/dev/null | awk '$5 > 10485760 {print $5, $9}'
```

### Phase 4: Propose Plan

**Goal:** 展示完整的整理计划，等待用户确认。

Present the plan in this exact format:

```
## repo-tidy 整理计划

**类型:** code | **备份:** stash@{0}

### 🗑 清理（移到 archive/YYYY-MM-DD/）

| # | 文件/目录 | 原因 | 大小 |
|---|----------|------|------|
| 1 | __pycache__/ | Python bytecode cache | 2.3 MB |
| 2 | .DS_Store | macOS metadata | 4 KB |
| ...

### 📁 建议归档

| # | 文件 | 建议去向 | 备注 |
|---|------|---------|------|
| 1 | test_scratch.py | archive/ | 临时测试脚本 |
| 2 | notes.md [需确认] | docs/ 或 archive/ | 可能是有用笔记 |
| ...

### 🔀 Git 建议

| # | 建议 | 详情 |
|---|------|------|
| 1 | 删除已合并分支 | feature/old-thing (merged 30d ago) |
| 2 | 大文件警告 | data.csv (45 MB) — 考虑 .gitignore 或 git-lfs |
| ...

### ⚠️ archive/ 状态

已有 4 个归档目录（保留上限 3）：
- archive/2026-04-01/ ← 建议手动检查后删除
- archive/2026-04-10/
- archive/2026-04-15/
- archive/2026-04-20/

---
确认执行？(y/n) 你也可以指定跳过某些项，如 "跳过 #2 和 Git #1"
```

**如果有 audit JSON，额外展示：**

```
### 🔍 审计增强建议

(来源: docs/repo-audit.json, 生成于 YYYY-MM-DD)

| # | 文件 | 建议 | 置信度 | 审计 ID |
|---|------|------|--------|---------|
| A1 | src/old_parser.py | 归档（死代码） | 0.75 [需确认] | F-012 |
| A2 | .env | 从 Git 跟踪中移除 | 0.95 | F-020 |
| ...
```

**CRITICAL:** Do NOT proceed past this phase without explicit user approval. The user may:
- Approve all (`y`)
- Approve with exclusions (`跳过 #2`)
- Reject and ask for changes
- Cancel entirely

### Phase 5: Execute

**Goal:** 按照确认的计划执行整理。

#### 5A: Create archive directory

```bash
ARCHIVE_DIR="archive/$(date +%Y-%m-%d)"
mkdir -p "$ARCHIVE_DIR"
```

#### 5B: Move junk files

For each approved junk item:
```bash
# 保持原始目录结构
mkdir -p "$ARCHIVE_DIR/$(dirname <relative-path>)"
mv <file-or-dir> "$ARCHIVE_DIR/<relative-path>"
```

#### 5C: Move/reorganize misplaced files

For each approved misplaced item, move to the suggested location.

#### 5D: Git cleanup

For each approved Git suggestion:
- Delete merged branches: `git branch -d <branch-name>`
- Add large files to .gitignore (if approved)

#### 5E: Ensure archive/ is gitignored

```bash
# 检查 .gitignore 中是否已有 archive/
if ! grep -q '^archive/' .gitignore 2>/dev/null; then
    echo 'archive/' >> .gitignore
fi
```

#### 5F: Check archive/ retention

If `archive/` has more than 3 date-subdirectories:
- List directories older than the newest 3
- Remind user to review and manually delete them
- Do NOT auto-delete old archives

#### 5G: Summary report

```
## repo-tidy 完成 ✓

- 清理: 12 个文件/目录 → archive/2026-04-21/
- 归档: 3 个文件重新归类
- Git: 2 个已合并分支已删除
- 释放空间: ~45 MB（移到 archive/）
- 恢复方式: git stash pop（恢复 stash 备份）
             或手动从 archive/2026-04-21/ 取回文件
```

**Pipeline 下一步引导（审计模式下额外显示）：**

如果本次 tidy 使用了审计 JSON 且 `optimize_recommendations` 中有待处理项：

```
### 建议下一步

审计报告中还有 M 个代码质量问题可优化：
→ /optimize --with-audit   （定向优化审计发现的问题）

Pipeline 状态:
✓ repo-audit — 已完成 (YYYY-MM-DD)
✓ repo-tidy — 已完成
○ optimize — 待执行（M 个可优化项）
```

## Guardrails

These rules are absolute and cannot be overridden:

1. **NEVER delete files directly.** Always move to `archive/`. The only exception is `.DS_Store` which can be deleted outright if user prefers.
2. **NEVER skip Phase 4 (Propose Plan).** Even if the user says "just do it", show the plan first.
3. **NEVER modify file contents.** This skill only moves, archives, and organizes — it never edits code.
4. **NEVER touch files that are git-tracked and modified.** Those are active work. Only clean untracked or ignored files.
5. **NEVER auto-delete old archives.** Only remind the user.
6. **Respect .gitignore.** Use `git clean -ndX` and `git check-ignore` as primary signals.
7. **Mark uncertainty.** If unsure whether a file should be cleaned, mark it `[需确认]` in the plan.
8. **Preserve directory structure in archive.** Files moved to archive keep their relative path for easy recovery.

## Integration with Other Skills

### Pipeline: repo-audit → repo-tidy → optimize

repo-tidy 是代码健康 pipeline 的中间环节：

```
repo-audit (诊断)
    ├── tidy_recommendations ──→ repo-tidy (文件清理)  ← 你在这里
    └── optimize_recommendations ──→ optimize (代码优化)

推荐执行顺序: /repo-audit → /repo-tidy → /optimize --with-audit
```

### Redirect Table

| Situation | Redirect to |
|-----------|------------|
| User wants deeper analysis before tidy | `/repo-audit`（先生成审计 JSON） |
| User wants to refactor code during tidy | `/optimize`（或 `/optimize --with-audit` 如有审计） |
| User wants to restructure project architecture | ccplan |
| User discovers a bug while reviewing files | cchypothesis |
| User wants to commit after tidy | git-workflow-and-versioning |

## Slash Command

```
/repo-tidy                    # Interactive: ask repo type, full workflow
/repo-tidy --type code        # Skip type selection, use code rules
/repo-tidy --type docs        # Skip type selection, use docs rules
/repo-tidy --type data        # Skip type selection, use data rules
/repo-tidy --scan-only        # Only scan and report, don't propose changes
/repo-tidy --git-only         # Only check Git hygiene, skip file cleanup
/repo-tidy --with-audit       # Force use audit JSON even if >7 days old
/repo-tidy --no-audit         # Skip audit JSON even if present
```
