---
name: code-optimizer
description: >
  Optimize, refactor, simplify, and improve code in Python, Swift, Rust, or TypeScript.
  Trigger on: "optimize this", "refactor", "simplify", "clean up", "make it more readable",
  "improve this", "this feels hacky", "there must be a better way", "tighten this up",
  "any improvements?", or "/simplify". Language-specific: "make it more Pythonic",
  "make it more idiomatic Rust", "make it more Swifty".
  Do NOT trigger when the user only wants to understand or summarize code — use code-summarizer instead.
origin: custom
---

# Code Optimizer

Analyze code and provide concrete, actionable optimization suggestions — each paired with a ready-to-use code snippet — so the user can quickly improve quality, safety, performance, and readability.

**Supported languages:** Python, Swift, Rust, TypeScript. Language-specific check items are in companion files (`python.md`, `swift.md`, `rust.md`, `typescript.md`).

## Core philosophy

Good optimization makes code that the next person can read, trust, and modify without fear. Every suggestion must pass this test: **does this change make the code simpler, safer, or meaningfully faster — without sacrificing clarity?**

When simplicity and performance conflict, favor simplicity unless the performance difference actually matters for the use case.

## Audit-aware mode (`--with-audit`)

When `--with-audit` is specified (or `docs/repo-audit.json` exists and is <7 days old), optimize reads the `optimize_recommendations` segment from the audit JSON and operates in **targeted mode**:

### Detection & Validation

```bash
test -f docs/repo-audit.json && echo "AUDIT_FOUND" || echo "NO_AUDIT"
```

If `docs/repo-audit.json` exists:

1. 检查 `audit_metadata.version` — 仅消费 major 版本为 `1` 的 JSON，`optimize_recommendations` 需要 ≥1.2
2. 检查 `audit_metadata.timestamp` — 默认 7 天过期：
   ```
   ⚠️ 审计报告已过期 (N 天前生成)。建议先运行 /repo-audit 更新。
   继续使用旧报告？(y/n)
   ```
3. 加载 `optimize_recommendations`：
   - `files_to_optimize` → 按 `dimension` 分组，定向分析每个文件
   - `duplication_groups` → 分析重复代码组，提出合并/抽取建议

### Targeted Workflow

In audit-aware mode, the workflow changes:

1. **展示审计发现摘要** — 列出所有待优化项，按 dimension 分组：
   ```
   ## 审计发现的代码质量问题

   ### Simplification（简化）
   | # | 文件 | 问题 | 置信度 | 审计 ID |
   |---|------|------|--------|---------|
   | 1 | src/parser/core.py:45-198 | 函数过长 (150 行)，嵌套过深 (5 层) | 0.85 | F-008 |

   ### Refactoring（重构）
   | # | 文件 | 问题 | 置信度 | 审计 ID |
   | 2 | src/utils/ + src/helpers/ | 重复的 format_date() 实现 | 0.80 | F-015 |

   按序优化？(y/全部/跳过 #N/选择 #N)
   ```
2. **逐项优化** — 用户确认后，按序读取文件（优先 `line_range`），应用对应 dimension 的检查
3. **标注来源** — 每条优化建议附 `[审计 F-NNN]` 标签，方便追溯

### Confidence Handling

- `confidence ≥ 0.8` → 直接列入待优化
- `confidence < 0.8` → 标注 `[需确认]`，用户可选择跳过

### Flags

| Flag | Behavior |
|------|----------|
| `--with-audit` | 强制使用 audit JSON，即使已过期 |
| `--no-audit` | 跳过 audit JSON，即使存在（使用标准用户驱动模式） |
| (default) | 如果 `docs/repo-audit.json` 存在且 <7 天，自动进入审计模式；否则标准模式 |

### No Audit JSON

If no audit JSON exists or `--no-audit` is specified, optimize operates in its standard mode: user provides code directly, and all five dimensions are analyzed.

## Language detection

1. **`--lang` flag** — if the user specifies a language, use it unconditionally
2. **File extension** — `.py`, `.swift`, `.rs`, `.ts`/`.tsx` map directly
3. **Syntax heuristics** — infer from keywords, patterns, and structure
4. **Ask** — if ambiguous (e.g., pasted snippet with no extension), state your best guess and ask the user to confirm before proceeding

**Single language focus:** After identifying the target language, apply ONLY the checks from the corresponding language file. Ignore all other language files entirely.

## Precedence

When a language file's idiom conflicts with a universal principle in this file, the **language-specific guidance takes precedence**. When project-level `CLAUDE.md` conventions conflict with a language file, **project conventions take precedence**.

## Output format

Produce a **suggestion list**. Each suggestion is self-contained:

**Title** — short, specific (e.g., "Replace nested if-let with guard clause")

- **Where**: Function name or line range
- **Why**: One or two sentences on the concrete benefit
- **Before → After**: Minimal code snippet showing only the changed lines

If many suggestions, end with a **priority summary** ranking by impact.

## Five optimization dimensions

Analyze code across all five. Skip any dimension with no meaningful findings.

### 1. Simplification & Readability

The highest-priority dimension. Look for:
- Overly complex conditionals that can be flattened (guard clauses, early returns)
- Loops replaceable with language-native iteration patterns
- Repeated code blocks that should be extracted
- Deep nesting reducible by early returns
- Magic numbers/strings that should be named constants
- Boolean logic that can be simplified
- Missed opportunities to use the standard library
- Variable/function names that don't convey intent

### 2. Refactoring (Structure, Naming, Design Patterns)

Look at the bigger picture:
- Functions doing too many things — split by responsibility
- God classes or overly long files that should be decomposed
- Inconsistent naming conventions or vague names (`data`, `tmp`, `result`)
- Opportunities for language-native patterns (data classes, enums, protocols, traits)
- Circular or tangled dependencies
- Dead code (unused functions, unreachable branches)

### 3. Idiomatic Style & Conventions

Does the code follow the language's canonical style and community conventions? Each language file defines what "idiomatic" means. Universal checks:
- Consistent formatting and naming conventions
- Modern language features preferred over deprecated patterns
- Type annotations on public APIs
- Appropriate use of the language's error handling idiom

### 4. Performance

Suggest improvements when meaningful — don't micro-optimize startup code. Universal checks:
- Algorithmic inefficiency (O(n²) where O(n) is possible)
- Unnecessary repeated computation
- Loading entire files when streaming/iteration would work
- Blocking I/O that could be batched or concurrent

Always quantify expected impact: "This changes X from O(n²) to O(n), which matters when n > 1000" is actionable. "This is slightly faster" is not.

### 5. Safety & Correctness

Flag issues that could lead to bugs, crashes, or vulnerabilities. Universal checks:
- SQL/command injection via string interpolation
- Hardcoded secrets
- Missing input validation on external data
- Unsafe deserialization of untrusted data
- Path traversal with unsanitized input

Security suggestions should briefly explain the attack scenario so the user understands the risk, not just the fix.

## Multi-language input

When code contains multiple languages in one request:
1. Organize output under a heading per language
2. Apply each language's checks within its section
3. End with a cross-language priority summary

For embedded secondary languages (SQL in Python, C FFI in Rust), apply safety checks to the embedded language and note which rules are being applied.

## Handling different scales

**Small (< 50 lines):** In conversation, 2–5 suggestions.
**Medium (50–300 lines):** Full suggestion list, grouped by dimension.
**Large (300+ lines or multiple files):** Produce a `.md` file organized by file and dimension, with a priority summary at top.

## Tone and approach

- **Constructive**: "This could be simplified to..." not "This is wrong because..."
- **Specific**: Reference exact function, variable, or line
- **Respect intent**: Acknowledge deliberate patterns before suggesting alternatives
- **Prioritize impact**: Lead with highest-impact changes; don't bury security issues under style nitpicks
- **Match the user's language**: If the user writes in Chinese, respond in Chinese

## Guardrails

- **Don't rewrite the whole file.** Show only changed portions.
- **Preserve logic.** Don't change behavior unless the original is clearly a bug (flag it as such).
- **Don't guess.** If unsure whether a change is safe, say so and explain the tradeoff.
- **Skip empty dimensions.** Don't manufacture suggestions to fill space.

## Integration with Other Skills

### Pipeline: repo-audit → repo-tidy → optimize

optimize 是代码健康 pipeline 的最后一环：

```
repo-audit (诊断)
    ├── tidy_recommendations ──→ repo-tidy (文件清理)
    └── optimize_recommendations ──→ optimize (代码优化)  ← 你在这里

推荐执行顺序: /repo-audit → /repo-tidy → /optimize --with-audit
```

### Redirect Table

| Situation | Redirect to |
|-----------|------------|
| 需要先审计再优化 | `/repo-audit`（先生成审计 JSON） |
| 优化过程中发现文件该删/该移 | `/repo-tidy`（文件组织不是 optimize 的职责） |
| 优化涉及架构级重构 | ccplan（optimize 只做文件级改进） |
| 优化后想提交 | git-workflow-and-versioning |

### Completion Summary (audit-aware mode)

审计模式下，优化完成后输出 pipeline 状态：

```
## optimize 完成（审计模式）

- 审计发现: M 个可优化项
- 已优化: X 个
- 跳过: Y 个（用户选择 / 低置信度）
- 涉及文件: N 个

### Pipeline 状态
✓ repo-audit — 已完成 (YYYY-MM-DD)
✓ repo-tidy — [已完成 / 未执行]
✓ optimize — 已完成
```
