---
name: repo-audit
description: >-
  深度分析 repo 结构、逻辑、依赖和配置，生成结构化审计报告。
  产出两份文档：docs/repo-audit.md（人读）和 docs/repo-audit.json（机读，供 repo-tidy 消费）。
  分析优先级：项目结构 > 逻辑疑问 > 代码重复 > 配置管理 > 死代码 > 硬编码 > 依赖健康。
  所有不确定的发现收集为问题，一次性呈现给用户批量回答。
  TRIGGER when: "审计 repo", "audit repo", "分析项目结构", "repo 理解",
  "帮我理解这个项目", "review repo structure", or /repo-audit command.
  DO NOT TRIGGER when: user wants to clean/tidy files (use repo-tidy),
  user wants to refactor code logic (use optimize),
  user wants to plan a new feature (use ccplan),
  user wants a code overview document (use summarize).
origin: custom
---

# repo-audit — 深度 Repo 审计

先理解，再判断。分析 repo 的结构、逻辑、依赖和配置，产出结构化报告。

## Core Philosophy

> **整理的前提是理解。不理解项目逻辑，就无法判断什么该留、什么该清。**
> 规则匹配只能处理垃圾文件；真正的整理需要知道每个文件为什么存在。

Three principles:
1. **理解先行** — 先读 README、入口文件、依赖关系，建立项目心智模型后再分析
2. **量化不确定性** — 每条发现都有 confidence 分数；不确定的生成 question 让用户决定
3. **只读不写** — audit 绝不修改项目文件，只生成报告文档

## When to Use

- 接手一个新 repo，想快速理解结构和潜在问题
- 项目发展一段时间后，做一次"健康检查"
- 准备大规模重构前，先了解当前状态
- 配合 `/repo-tidy` 使用，提供更智能的清理建议

**Do NOT use** for:
- 清理文件（use repo-tidy）
- 重构代码逻辑（use optimize）
- 规划新功能（use ccplan）
- 生成项目概述文档（use summarize）

**与 summarize 的区别：** summarize 是描述性的（"这个项目做什么"），repo-audit 是诊断性的（"这个项目有什么问题"）。

## Analysis Priorities

按优先级从高到低排列。详细检测规则见 `references/analysis-heuristics.md`。

| Priority | Category | Description | 默认 Confidence |
|----------|----------|-------------|-----------------|
| 1 | structure | 项目结构合理性 | 0.75-0.9 |
| 2 | logic | 逻辑疑问（大函数、空 catch、TODO 等） | 0.7-0.9 |
| 3 | duplication | 代码重复/冗余 | 0.6-0.85 |
| 4 | config | 配置管理（secrets、magic numbers） | 0.5-0.95 |
| 5 | dead_code | 死代码/未用文件 | 0.5-0.9 |
| 6 | hardcoded | 硬编码路径/URL/端口 | 0.6-0.85 |
| 7 | dependency | 依赖健康度 | 0.6-0.85 |

## Workflow — 六阶段

### Phase 1: Context Gathering（上下文收集）

**Goal:** 建立项目的心智模型。

Steps:
1. 检查是否存在旧的 `docs/repo-audit.json`：
   - 存在且 <7 天 → 询问用户：从头审计还是增量更新？
   - 存在且 >7 天 → 通知用户旧报告将被备份
   - 不存在 → 继续
2. 读取项目身份文件（按优先级）：
   - `README.md`, `CLAUDE.md` → 项目目的
   - `pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod` → 技术栈
   - `.gitignore`, `Makefile`, `Dockerfile` → 构建/部署模式
   - `docs/` 目录列表 → 已有文档
3. 映射目录结构：
   ```bash
   find . -maxdepth 3 -type d -not -path '*/\.*' -not -path '*/node_modules/*'
   ```
4. 识别入口文件：
   - Python: `__main__.py`, `main.py`, `app.py`, `cli.py`, `pyproject.toml [project.scripts]`
   - JS/TS: `package.json "main"/"bin"`, `index.ts/js`, `server.ts/js`
   - Rust: `src/main.rs`, `src/lib.rs`
   - Go: `cmd/*/main.go`, `main.go`
5. 统计文件类型和规模：
   ```bash
   find . -type f -name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.rs' -o -name '*.go' | wc -l
   ```
6. 查看近期活动：
   ```bash
   git log --oneline -20
   ```
7. **目录职责分析：**
   - 对每个顶层目录和关键子目录（depth ≤ 2），确定其职责
   - 读取目录下的 README、`__init__.py`、`index.ts` 等判断用途
   - 如目录名不自明（如 `utils/`、`lib/`、`core/`），读 2-3 个代表文件推断
   - 产出：`directory_map` — 每个目录一句话说明
8. **关键文件标注：**
   - 识别"必须了解"的文件：入口文件、核心配置、关键抽象/基类、API 定义
   - 为每个标注：一句话功能说明 + 为什么重要 + 依赖谁/被谁依赖
   - 产出：`key_files` 列表（Phase 2 的 hub files 自动纳入）
9. **实现逻辑梳理：**
   - 主要数据流 / 调用链是什么（入口 → 中间处理 → 输出）
   - 为什么选择了这种架构（从代码注释、README、commit message 推断）
   - 如无法推断，标注 `[推测]` 并在 Phase 4 生成确认问题
   - 产出：`implementation_rationale` 列表
10. **使用方式收集：**
    - README / CLAUDE.md 中的 usage 命令、quick start
    - CLI 入口和参数（从 argparse / click / clap 定义中提取）
    - 配置文件位置及其关键字段
    - 产出：`usage` 对象
11. **导航提示生成：**
    - 基于步骤 7-10 的结果，生成"我想做 X → 去看 Y"的速查表
    - 覆盖至少 5 个常见意图：了解项目、修改核心逻辑、添加功能、运行测试、部署
    - 产出：`navigation_hints` 列表

**Scale bound:** 步骤 7-11 中，目录职责分析限制在 depth ≤ 2 的目录。关键文件标注上限 20 个。>200 文件的 repo 优先标注入口 + hub files + 配置文件。

**Output to user:**
```
Phase 1 完成 — 上下文收集与深度理解
- 项目: <name> (<primary language>)
- 规模: N 个源文件, M 个目录
- 入口: <entry points>
- 技术栈: <detected stack>
- 目录分析: N 个目录已标注职责
- 关键文件: N 个核心文件已标注
- 导航提示: N 条速查条目
→ 进入 Phase 2: 依赖映射
```

**→ NEXT:** 立即进入 Phase 2。

### Phase 2: Dependency Mapping（依赖映射）

**Goal:** 构建内部依赖图，识别 orphan files 和 hub files。

Steps:
1. **内部 import 图：** 对所有源文件 grep import 语句：
   - Python: `^import |^from .* import`
   - JS/TS: `^import |require\(`
   - Rust: `^use |^mod `
   - Go: import block 中的包路径
   构建有向图：文件 A → import → 文件 B。
2. **外部依赖清单：** 解析依赖 manifest：
   - `requirements.txt`, `pyproject.toml`
   - `package.json`
   - `Cargo.toml`, `go.mod`
3. **Orphan files:** 源文件从未被任何其他文件 import，且不是入口文件。
4. **Hub files:** 被 >30% 其他源文件 import 的文件。
5. **循环依赖检测：** 在 import 图中查找环。

**Scale bound:** >200 源文件时，深度 import 追踪只覆盖 top 50 最近修改 + 所有入口文件。其余文件做浅层分析（只看直接 import，不追踪链）。

**No user interaction.** → NEXT: 立即进入 Phase 3。

### Phase 3: Priority Analysis（按优先级分析）

**Goal:** 按 7 个优先级执行分析，产出 findings 列表。

参考 `references/analysis-heuristics.md` 中的具体规则和阈值。

每条 finding 记录为：
```
ID: F-NNN
Priority: 1-7
Category: structure | logic | duplication | config | dead_code | hardcoded | dependency
Severity: high | medium | low | info
Location: 文件或目录路径
Description: 问题描述
Suggestion: 建议操作
Confidence: 0.0-1.0
Status: confirmed (confidence ≥ 0.7) | unresolved (confidence < 0.7)
Actionable by tidy: true/false
Actionable by optimize: true/false
```

**`actionable_by_optimize` 判定规则：**
- P2 logic (大函数、深嵌套、空 catch、过多参数) → `true`
- P3 duplication (代码重复/冗余) → `true`
- P4 config (magic numbers) → `true`
- P6 hardcoded (硬编码值可配置化) → `true`
- 其余 category → `false`

**执行顺序：** P1 → P2 → P3 → P4 → P5 → P6 → P7，严格按序。

**Scale bound:** >100 源文件时，P2 (logic) 和 P3 (duplication) 仅分析 top 30 最近修改 + 入口 + hub files。P4-P7 使用 grep 全量扫描（不需要读文件全文）。

**→ NEXT:** 立即进入 Phase 4。

### Phase 4: Question Collection（问题收集）

**Goal:** 收集所有不确定的发现，一次性呈现给用户。

Steps:
1. 提取所有 `confidence < 0.7` 的 finding
2. 提取所有填了 `question` 字段的 finding（即使 confidence ≥ 0.7）
3. 按 priority 分组
4. 一次性呈现：

```
## repo-audit 需要你确认以下 N 个问题

### 项目结构 (P1)
Q1: <location> — <question>
    → a) <option a>
    → b) <option b>
    → c) 不确定/跳过

### 逻辑疑问 (P2)
Q2: <location> — <question>
    ...

请逐一回答编号即可，如 "Q1:a Q2:b Q3:c"。
输入 "skip all" 跳过所有问题。
```

5. 根据用户回答更新 finding 的 confidence 和 status：
   - 用户确认 → `confidence` 提升至 0.9, `status: confirmed`
   - 用户否认 → `status: dismissed`
   - 跳过 → `confidence` 保持, `status: unresolved`

**如果零问题：** 宣布 "所有发现 confidence ≥ 0.7，无需额外确认" 后直接进入 Phase 5。

**→ NEXT:** 用户回答后进入 Phase 5。

### Phase 5: Report Generation（报告生成）

**Goal:** 生成两份文档。

#### Step 1: 备份旧报告

```bash
# 如果旧报告存在，备份
if [ -f docs/repo-audit.md ]; then
    mv docs/repo-audit.md "docs/repo-audit.$(date +%Y-%m-%d).md"
fi
if [ -f docs/repo-audit.json ]; then
    mv docs/repo-audit.json "docs/repo-audit.$(date +%Y-%m-%d).json"
fi
# 保留最近 3 份备份
ls -t docs/repo-audit.*.md 2>/dev/null | tail -n +4 | xargs rm -f
ls -t docs/repo-audit.*.json 2>/dev/null | tail -n +4 | xargs rm -f
```

#### Step 2: 生成 `docs/repo-audit.md`

```markdown
# Repo Audit Report

**Project:** <name>
**Date:** YYYY-MM-DD
**Audited by:** repo-audit skill
**Scope:** N/M source files analyzed (X%)

---

## Executive Summary

<2-3 sentences: 项目整体健康度评估>

---

## Project Understanding

### Overview
<项目做什么，核心功能，目标用户/使用场景>

### File Index（文件索引）

<带注释的目录树，每个目录和关键文件附一句话说明>

project/
├── src/              — 核心源码
│   ├── parser/       — 输入解析器（支持 JSON/YAML/TOML）
│   ├── engine/       — 处理引擎（Pipeline 模式）
│   └── output/       — 输出格式化（HTML/PDF/Markdown）
├── tests/            — 测试套件（pytest）
├── config/           — 配置文件模板
├── docs/             — 项目文档
└── scripts/          — 部署和维护脚本

**速查表 — "我想做 X → 去看 Y"：**

| 我想... | 去看 |
|---------|------|
| 了解项目做什么 | README.md |
| 修改核心处理逻辑 | src/engine/ |
| 添加新的输入格式 | src/parser/ |
| 修改输出样式 | src/output/ |
| 运行测试 | tests/ + README "Testing" 部分 |
| 修改配置 | config/default.yaml |
| 部署项目 | scripts/deploy.sh |

（至少 5 条，覆盖：了解项目、修改核心逻辑、添加功能、运行测试、配置/部署）

### Tech Stack
<语言、框架、关键依赖>
<如能推断：为什么选择这个技术栈>

### Architecture
<入口文件 → 调用链 → 模块关系>
<关键抽象/设计模式（如 Pipeline、Observer、Plugin、MVC 等）>
<数据流向描述>

### Implementation Rationale（实现逻辑）
<为什么这样组织代码？关键设计决策是什么？>
<从代码/注释/commit/README 推断的设计动机>
<无法推断的标注 [推测] 并说明依据>

### Usage Guide（使用方式）
<安装方式>
<主要运行命令及参数>
<配置文件位置和关键字段>
<常见操作示例>

### Key Files（关键文件详解）

| 文件 | 功能 | 为什么重要 | 依赖关系 |
|------|------|-----------|---------|
| src/engine/pipeline.py | 处理引擎核心 | 所有输入最终经此处理 | 依赖 parser/, 被 cli.py 调用 |
| config/default.yaml | 默认配置 | 定义所有可配置参数 | 被 engine/ 读取 |
| ... | ... | ... | ... |

（涵盖所有入口文件 + hub files + 核心配置文件，上限 20 个）

---

## Findings

### P1: 项目结构合理性

| # | Severity | Location | Finding | Suggestion |
|---|----------|----------|---------|------------|
| F-001 | ... | ... | ... | ... |

### P2: 逻辑疑问
... (same table format)

### P3-P7: ...
... (same table format)

---

## Dependency Map

### Hub Files
| File | Imported by |
|------|-------------|

### Orphan Files
| File | Last Modified |
|------|--------------|

### Circular Dependencies
<list or "None detected">

---

## Unresolved Questions
<用户跳过或答"不确定"的问题>

---

## Statistics
- Total findings: N
- By severity: H high, M medium, L low, I info
- By priority: P1: N, P2: N, ...
- Coverage: N/M files (X%)
- Actionable by repo-tidy: N
```

#### Step 3: 生成 `docs/repo-audit.json`

按 `references/json-schema.md` 定义的格式生成。确保：
- `audit_metadata.version` 为 `"1.2"`
- `audit_metadata.timestamp` 为当前 ISO 8601 时间
- `tidy_recommendations` 只包含 `actionable_by_tidy: true` 且 `status != dismissed` 的 finding
- `optimize_recommendations` 只包含 `actionable_by_optimize: true` 且 `status != dismissed` 的 finding
  - `files_to_optimize`: P2/P4/P6 中需要优化的单文件 finding，包含 `dimension` 映射和 `line_range`
  - `duplication_groups`: P3 中的重复代码组，列出涉及文件和合并建议
- `questions.resolved` 和 `questions.unresolved` 正确分类

#### Step 4: 确保 `docs/` 目录存在

```bash
mkdir -p docs
```

#### Step 5: Summary

```
## repo-audit 完成

- 报告: docs/repo-audit.md（人读）
- 数据: docs/repo-audit.json（机读，供 repo-tidy 和 optimize 使用）
- 发现: N 个（H high, M medium, L low, I info）
- 可由 repo-tidy 处理: N 个
- 可由 optimize 改善: M 个

### 建议下一步

根据审计结果，推荐按以下顺序执行：

1. `/repo-tidy` — 清理垃圾文件、归档散落文件（N 个可处理项）
2. `/optimize --with-audit` — 定向优化审计发现的代码质量问题（M 个可改善项）

先 tidy 再 optimize：清理完文件结构后，再优化代码质量。
```

### Phase 6: Interactive Q&A（可选交互）

**Goal:** 允许用户对任何 finding 追问或更正。

Phase 5 完成后，skill 保持可用：
- 用户输入 finding ID → 展示详细分析和上下文
- 用户标记误报 → 更新 status 为 `dismissed`，同步更新两份文档
- 用户请求深入分析某目录 → 重新执行 Phase 3 的相关检查
- 用户无追加问题 → 审计结束

## Guardrails

These rules are absolute and cannot be overridden:

1. **纯只读。** audit 不修改任何项目文件。只写入 `docs/repo-audit.md` 和 `docs/repo-audit.json`。
2. **不跳过 Phase 4。** 即使零问题也要宣布。
3. **所有 finding 必须有 confidence 分数。** 0.0-1.0，无例外。
4. **不编造 finding。** 检测规则不匹配就不报告。宁少勿假。
5. **confidence < 0.7 必须有关联 question。** 在 Phase 4 中呈现。
6. **遵守大规模 repo 采样规则。** 报告中注明覆盖率。
7. **旧报告备份。** 覆盖前 rename，最多保留 3 份。
8. **绝不读 .env 内容。** 只检查存在性和 git 跟踪状态。
9. **不修改文件内容。** 这个 skill 只做分析和报告。

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Instead |
|-------------|-------------|---------|
| 跳过 Phase 1 直接分析 | 没有上下文就无法判断结构合理性 | 始终从理解开始 |
| 对所有 finding 给 confidence=0.9 | 掩盖不确定性，用户得不到该问的问题 | 诚实评估，该低就低 |
| 分析每一行代码 | 大 repo 会耗尽 context window | 遵守采样规则 |
| 建议用户做架构级重构 | 超出 audit scope，应转 ccplan | 只报告发现，不做架构决策 |
| 读取 .env 文件内容 | 暴露 secrets | 只检查文件存在性 |
| 边分析边问用户问题 | 打断工作流，用户体验差 | 全部收集，Phase 4 批量问 |

## Integration with Other Skills

### Pipeline: repo-audit → repo-tidy → optimize

三个 skill 形成完整的代码健康改善 pipeline：

```
repo-audit (诊断)
    │
    ├── docs/repo-audit.json
    │   ├── tidy_recommendations ──→ repo-tidy (文件清理/归档)
    │   └── optimize_recommendations ──→ optimize (代码质量优化)
    │
    └── 推荐执行顺序: tidy → optimize（先清理环境，再优化代码）
```

### Redirect Table

| Situation | Redirect to |
|-----------|------------|
| Audit 完成后用户想清理文件 | `/repo-tidy`（自动读取 `tidy_recommendations`） |
| Audit 完成后用户想优化代码 | `/optimize --with-audit`（自动读取 `optimize_recommendations`） |
| 用户想一步到位 | 先 `/repo-tidy` → 再 `/optimize --with-audit` |
| 发现需要重新设计架构 | ccplan |
| 发现 bug 或异常行为 | cchypothesis |
| 用户只想了解项目（不需要诊断） | summarize |

## Slash Command

```
/repo-audit                     # 完整审计，交互模式
/repo-audit --quick             # 快速模式：跳过 P6-P7，不问问题
/repo-audit --structure-only    # 仅分析 P1（项目结构）
/repo-audit --deps-only         # 仅执行 Phase 2（依赖映射）
/repo-audit --no-questions      # 跳过 Phase 4，用默认 confidence 阈值
/repo-audit --update            # 增量更新：只重新分析自上次审计以来变更的文件
```
