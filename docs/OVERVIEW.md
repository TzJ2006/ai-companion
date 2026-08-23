# AI Dev Companion - Technical Overview

## What Is This?

AI Dev Companion 是一个函数级别的代码变更追踪系统。当开发者（通过 Claude Code 或 CLI）修改代码时，它会：

1. 自动捕获哪些函数被修改了
2. 记录修改的原因（从 AI 上下文自动推断，或手动提供）
3. 维护一份按函数哈希索引的变更历史
4. 生成带注释的 HTML 报告（diff + 原因 + 测试状态）

核心价值：在"谁改了什么"（git blame）之上，增加了"为什么改"和"改了哪个函数"的语义层。

---

## System Architecture

```
                   ┌──────────────────────────────────────┐
                   │         Claude Code Session          │
                   │   developer edits .py / .ts files    │
                   └──────────────────┬───────────────────┘
                                      │ PostToolUse hook
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│  @aidev/hook                                                │
│  handlePostToolUse(stdin)                                   │
│  - non-AST extensions degrade to file-level events         │
│    (file_level: true); only binary artifacts are dropped   │
│  - detect active ECL (docs/ecl/*.yaml)                     │
│  - append HookEvent → .devcompanion/queue/events.jsonl     │
│  Latency budget: <100ms                                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ file watcher (2s poll)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  @aidev/daemon                                              │
│  processQueue(queueFile, projectRoot, store)                │
│  - atomic rename events.jsonl → events.jsonl.processing     │
│  - parse JSONL → QueueEvent[]                              │
│  - getGitDiff() → FileDiff[]                               │
│  - parseFileAuto() per file → FunctionSignature[]          │
│  - annotateChanges() → map hunks to functions              │
│  - toChangeRecords() → ChangeRecord[]                      │
│  - store.saveSession()                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────┐   ┌───────────────────┐   ┌─────────────┐
│  reviews/    │   │  history/<file>.json│  │  index.json │
│  session JSON│   │  per-file history  │   │  global idx │
└──────┬───────┘   └───────────────────┘   └─────────────┘
       │
       │  aidev render --latest
       ▼
┌─────────────────────────────────────────────────────────────┐
│  @aidev/render                                              │
│  renderSessionToHtml(session, diffs, options)               │
│  - group changes by reason                                  │
│  - render collapsible diff per function                    │
│  - dark theme, ECL badges, test status indicators          │
│  Output: standalone HTML file                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow: End-to-End

### Phase 1: Capture (Hook)

**触发条件**: Claude Code 执行 `Edit` 或 `Write` 工具后  
**入口**: `packages/hook/src/index.ts` → `handlePostToolUse(stdin)`

```
stdin (JSON from Claude Code)
  → parse tool_name + tool_input.file_path
  → filter: Edit/Write; non-AST extensions degrade to file_level events
  → findProjectRoot(): walk up to find .devcompanion/ or .git/
  → detectActiveEcl(): scan docs/ecl/*.yaml for non-completed features
  → append to .devcompanion/queue/events.jsonl:
      {timestamp, tool, file_path, pre_snapshot_path, reason, ecl_context}
```

**关键设计**:
- 同步、非阻塞，只做 JSON append
- ECL 上下文自动注入（如果当前有 active 的 ECL feature）
- `findProjectRoot` 向上遍历找 `.devcompanion/` 或 `.git/`

### Phase 2: Processing (Daemon)

**触发条件**: Daemon 文件监视器检测到 `events.jsonl` 更新  
**入口**: `packages/daemon/src/processor.ts` → `processQueue()`

```
events.jsonl → rename to .processing (atomic lock)
  → parse lines → QueueEvent[]
  → deduplicate file paths
  → getGitDiff(projectRoot) → FileDiff[]
  → filter: only diffs touching captured files
  → for each diff file:
      parseFileAuto(file) → ParsedModule {functions, classes, imports}
      build functionMap: Map<filePath, FunctionSignature[]>
  → annotateChanges(diffs, functionMap, context) → AnnotatedChange[]
  → toChangeRecords(annotations, sessionId) → ChangeRecord[]
  → wrap into ReviewSession
  → store.saveSession(session)
```

### Phase 3: Annotation Logic (Core)

**入口**: `packages/core/src/diff/annotator.ts` → `annotateChanges()`

算法:
1. 遍历每个 FileDiff 的每个 DiffHunk
2. 对每个 hunk，调用 `findAffectedFunctions(hunk, functions)`:
   - 检查 hunk 的行范围 `[new_start, new_start + new_count]` 是否与任何函数的 `[start_line, end_line]` 重叠
3. 如果找到匹配函数 → 每个函数创建一个 AnnotatedChange
4. 如果未找到 → 标记为 `<module-level>` 或 `<config-change>`
5. `deduplicateByFunction()`: 合并同一函数的多个 hunk（按 `file_path::function_hash` 去重）
6. `toChangeRecords()`: 转换为最终存储格式，提取 old_content / new_content

### Phase 4: Storage (History)

**入口**: `packages/history/src/store.ts` → `HistoryStore`

存储布局:
```
.devcompanion/
├── index.json           ← ProjectIndex (全局元数据 + 函数索引)
├── reviews/
│   └── 2026-05-17T12-34-56-000Z.json  ← ReviewSession
├── history/
│   └── src/utils.py.json              ← FileHistory (按文件分组)
└── queue/
    └── events.jsonl                    ← Hook 事件队列
```

`saveSession()` 做三件事:
1. 写入 `reviews/<timestamp>.json`（完整 session）
2. 更新每个文件的 `history/<file_path>.json`（追加 record 到对应函数）
3. 更新 `index.json`（递增 session 计数、变更计数、更新函数索引条目）

### Phase 5: Rendering (Report)

**入口**: `packages/render/src/renderer.ts` → `renderSessionToHtml()`

渲染逻辑:
1. `groupByReason(changes)`: 按 reason 分组
2. 每个 reason group → 按文件再分组
3. 每个文件下 → 列出函数，带 change_type badge + line range + ECL badge
4. 每个函数 → 可折叠的 inline diff（红色删除行 / 绿色添加行）

输出: 自包含 HTML（内联 CSS + JS），暗色主题，无外部依赖。

---

## Package Details

### @aidev/types

共享类型定义的单一来源:

| 文件 | 核心类型 |
|------|----------|
| `history.ts` | `ChangeRecord`, `ReviewSession`, `FileHistory`, `ProjectIndex`, `FunctionIndexEntry`, `EclContext` |
| `analysis.ts` | `FunctionAnalysis`, `AnalysisInput`, `AnalyzerOptions` |
| `modularity.ts` | `FunctionModularity`, `CohesionMetrics`, `CouplingMetrics`, `InterfaceContract`, `RefactorRecommendation` |

### @aidev/ast

AST 解析与函数提取:

| 组件 | 职责 |
|------|------|
| `wasm-resolver.ts` | WASM 文件路径解析（向上搜索 node_modules） |
| `parser-factory.ts` | tree-sitter Parser 实例化 |
| `parser.ts` | Python 解析：函数、类、参数、装饰器、docstring |
| `ts-parser.ts` | TypeScript 解析：函数、类、参数、泛型、return type |
| `multi-lang.ts` | 按扩展名分发 → `parseFileAuto()` |
| `identity.ts` | 函数身份哈希：`sha256(path::class::name::params)[0:16]` |

**函数身份哈希**设计:
```
输入: "src/auth/login.py::AuthManager::validate_token::token:str,expiry:int"
输出: "a3f2b8c1e7d04f91" (16 hex chars)
```
- 不依赖行号 → 代码移动不影响身份
- 包含参数类型 → 区分重载
- 包含 class_name → 区分同名方法

### @aidev/core

业务逻辑核心:

#### diff/ 子系统
- `parser.ts` → `getGitDiff(projectRoot)`: 执行 `git diff --unified=3`，解析为 `FileDiff[]`
- `annotator.ts` → `annotateChanges()`: 将 diff hunks 映射到函数级别

#### analysis/ 子系统
- `analyzer.ts` → `analyzeBatch()`: 批量分析函数（LLM 或 heuristic）
- `prompt.ts` → 构建 LLM prompt
- `heuristic.ts` → 无 LLM 时的启发式分析

#### modularity/ 子系统
- `analyzer.ts` → `analyzeModularityBatch()`: 内聚度/耦合度分析
- 检测 god functions、隐藏依赖、接口清晰度
- 生成重构建议和接口契约

#### test-gen/ 子系统
- `generator.ts` → `generateTestSkeleton()`: 为每个函数生成 Vitest 测试骨架

### @aidev/history

JSON 文件存储引擎:

| 类/导出 | 职责 |
|---------|------|
| `HistoryStore` | Session 读写、文件历史追踪、全局索引维护 |
| `AnalysisStore` | 函数分析结果存储（analysis.json） |
| `ModularityStore` | 模块化分析结果存储（modularity.json） |

核心方法:
- `saveSession(session)` → 写 session + 更新文件历史 + 更新索引
- `getFileHistory(path)` → 查询单文件的所有函数变更
- `getFunctionHistory(hash)` → 通过索引定位文件，查询单函数变更
- `listSessions(limit)` → 按时间倒序列出 review sessions

### @aidev/render

HTML 报告渲染（两种模式）:

| 模式 | 入口 | 用途 |
|------|------|------|
| Session Report | `renderSessionToHtml()` | 单次 review session 的 diff 报告 |
| Onboard Report | `renderOnboardHtml()` | 项目全貌扫描报告 |

**Onboard Report** 子模块拆分:
- `overview.ts` → 项目概览面板（文件数、函数数、测试状态统计）
- `modules.ts` → 模块分组列表
- `index-panel.ts` → 可搜索的函数索引表
- `page.ts` → 组装完整 HTML 页面
- `utils.ts` → `escapeHtml`, `escapeAttr`, `slugify`

### @aidev/cli

Commander.js CLI，8 个命令:

| 命令 | 功能 |
|------|------|
| `init` | 初始化 `.devcompanion/` 目录结构 |
| `review` | 解析 git diff → 注释变更 → 保存 session（不渲染） |
| `render` | 加载 session → 渲染 HTML 报告 |
| `history` | 查询变更历史（按文件/函数/session） |
| `analyze` | 扫描所有函数 → LLM/heuristic 分析 → 存储结果 |
| `onboard` | 全项目扫描 → 建索引 → 生成测试骨架 |
| `idea` | 想法清单管理 + 研究运行器 |
| `install` | 把 companion 装进目标仓库（委托给 scripts/install.ts） |

### @aidev/hook

Claude Code PostToolUse 集成:
- 从 stdin 读取 JSON（tool_name + tool_input）
- 过滤非代码文件
- 追加事件到 queue（<100ms）
- 自动检测 active ECL feature

### @aidev/daemon

后台队列处理器:
- 监视 `events.jsonl` 文件变化
- 原子 rename 实现锁机制
- 调用完整的 diff → parse → annotate → save 流水线

---

## Key Data Structures

### ChangeRecord

变更追踪的原子单位 — 一个函数的一次修改:

```typescript
interface ChangeRecord {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  file_path: string;             // relative to project root
  function_hash: string;         // sha256[0:16], stable identity
  function_name: string;         // e.g. "validate_token"
  class_name: string | null;     // e.g. "AuthManager"
  change_type: "add" | "modify" | "delete" | "rename";
  reason: string;                // WHY this changed
  reason_source: "context" | "llm-inferred" | "user-provided";
  old_content: string | null;    // deleted lines
  new_content: string | null;    // added lines
  start_line: number;
  end_line: number;
  test_status: "pending" | "pass" | "fail" | "skipped";
  test_file: string | null;
  error_id: string | null;
  session_id: string;
  ecl_context?: EclContext;      // linked ECL feature/requirements/decisions
}
```

### ReviewSession

一次捕获事件产生的变更批次:

```typescript
interface ReviewSession {
  id: string;
  timestamp: string;
  trigger: "hook" | "cli";
  summary: string;
  total_changes: number;
  files_changed: string[];
  changes: ChangeRecord[];
}
```

### ProjectIndex

全局索引 — 快速查找入口:

```typescript
interface ProjectIndex {
  project_root: string;
  last_updated: string;
  total_sessions: number;
  total_changes: number;
  function_index: Record<string, FunctionIndexEntry>;
}

interface FunctionIndexEntry {
  hash: string;
  file_path: string;
  function_name: string;
  class_name: string | null;
  last_modified: string;
  change_count: number;
  test_status: "pending" | "pass" | "fail" | "skipped";
}
```

### EclContext

ECL (Evolving Constraint Language) 关联:

```typescript
interface EclContext {
  feature: string;          // e.g. "auth-module"
  requirements?: string[];  // e.g. ["REQ-001", "REQ-002"]
  decisions?: string[];     // e.g. ["DEC-003"]
  ecl_file?: string;        // e.g. "docs/ecl/auth.yaml"
}
```

---

## LLM Integration

本工具在三处使用 LLM（通过调用 `claude` CLI）:

### 1. Function Analysis (`core/analysis/`)

```
analyzeFunctionWithLlm(input) → FunctionAnalysis
```

- 输入: 函数签名 + 源代码 + imports
- 输出: 功能描述、复杂度评估、建议
- 限制: `maxLlmCalls: 50`（超出后 fallback 到 heuristic）
- 模型: 默认 haiku（成本优化）
- 并发: 4 个并行调用

### 2. Function Reason Generation (`scripts/collect-report-data.ts`)

```
generateFunctionReason(fn, filePath) → string
```

- 输入: 函数签名 + docstring
- 输出: 一句话功能描述（≤20 词）
- 限制: `maxLlmCalls: 20`
- Fallback: `generateHeuristicReason()` — 根据函数名前缀推断

### 3. Modularity Analysis (`core/modularity/`)

```
analyzeModularityWithLlm(input) → FunctionModularity
```

- 输入: 函数源码 + 上下文
- 输出: cohesion/coupling 指标、隐藏依赖、接口清晰度、重构建议
- 可生成 TypeScript 接口契约

### Heuristic Fallback

所有 LLM 调用都有 heuristic fallback:
- 分析: 基于函数名/参数/行数的规则推断
- Reason: 基于命名约定（get → "Retrieves...", parse → "Parses..."）
- 模块化: 基于 import 计数、参数数量、行数的评分

---

## ECL (Evolving Constraint Language) Integration

ECL 文件 (`docs/ecl/*.yaml`) 记录架构约束:

```yaml
feature_guard:
  generated: "2026-06-01"
  guards:
    - id: GUARD-001
      feature: FEAT-001
      description: "WASM path resolution single source"
      key_files:
        - "packages/ast/src/wasm-resolver.ts"
      invariants:
        - "resolveWasmPath is the single source of WASM path resolution"
      verification:
        command: "npx vitest run .devcompanion/tests/test_ast_findWasmPath.test.ts"
```

**集成点**:
1. **Hook**: 自动检测 active ECL → 注入 `ecl_context` 到 ChangeRecord
2. **Report**: ECL badge 在 HTML 报告中显示 feature/decisions 关联
3. **Guard**: `/ccplan --guard` workflow 在编辑守护文件时自动运行验证命令

---

## Report Scripts

### `scripts/collect-report-data.ts`

收集数据用于 onboard 报告:

```
1. vitest run --reporter=json → 测试结果
2. collectFiles() → 扫描所有源文件
3. parseFileAuto() → 提取所有函数
4. generateFunctionReason() or generateHeuristicReason() → 函数描述
5. 匹配测试结果 → test_status per function
6. 写入 .devcompanion/report-data.json
```

输出结构:
```typescript
interface ReportData {
  generated_at: string;
  total_functions: number;
  total_tests: number;
  tests_passed: number;
  tests_failed: number;
  functions: FunctionReason[];  // 每个函数的描述+测试状态
}
```

### `scripts/generate-report.ts`

生成最终 HTML:
```
1. parseFileAuto() → 所有函数
2. load report-data.json (optional)
3. renderOnboardHtml(index, options) → HTML string
4. write onboard-report.html
```

---

## Design Decisions

| 决策 | 理由 |
|------|------|
| 函数身份 = SHA256 哈希 | 不依赖行号，重构时保持追踪连续性 |
| Hook + Daemon 分离 | Hook 必须 <100ms 不阻塞编辑；Daemon 异步处理 |
| JSON 文件存储 | 人类可读、AI 可读、可 git 版本化、无数据库依赖 |
| 按文件分割历史 | 查询快、扩展好、避免单文件膨胀 |
| AST 解析提取函数 | 精确的变更归因，处理嵌套类/装饰器/类型注解 |
| Heuristic fallback | 无 LLM 时仍可工作，降低成本和延迟 |
| ECL 自动检测 | 无需手动标注，编辑时自动关联到 feature |
| 自包含 HTML 报告 | 无外部依赖，可离线查看，可分享 |
| Monorepo + Project References | 清晰的包边界，独立编译，IDE 支持好 |

---

## Usage Scenarios

### Scenario 1: 自动追踪（Hook Mode）

```
开发者在 Claude Code 中编辑代码
  → Hook 自动捕获
  → Daemon 自动处理
  → 历史自动更新
  → 随时可 render 报告
```

### Scenario 2: 手动 Review（CLI Mode）

```bash
# 初始化项目
aidev init -p /path/to/project

# 手动触发 review（指定原因）
aidev review --reason "Fixed auth token expiry bug" -p .

# 渲染最新 session
aidev render --latest -o report.html -p .

# 查看函数变更历史
aidev history --function a3f2b8c1e7d04f91 -p .
```

### Scenario 3: 项目 Onboard

```bash
# 全项目扫描 + 生成测试骨架
aidev onboard -p /path/to/project --llm-enhance

# 收集测试结果 + 生成数据
npx tsx scripts/collect-report-data.ts --llm

# 生成完整 onboard 报告
npx tsx scripts/generate-report.ts
```

### Scenario 4: 代码质量分析

```bash
# 函数级分析
aidev analyze -p . --model haiku

# 模块化分析 + 生成接口契约
aidev analyze -p . --modularity --emit-contracts contracts/
```
