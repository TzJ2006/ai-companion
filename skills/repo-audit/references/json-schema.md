# repo-audit JSON Schema

`docs/repo-audit.json` 的完整字段定义。这是 repo-audit、repo-tidy 和 optimize 之间的机器契约。

## Version

当前版本：`1.2`

版本规则：
- 新增可选字段：minor bump (1.0 → 1.1)，向后兼容
- 删除/改名字段：major bump (1.0 → 2.0)，不兼容
- repo-tidy / optimize 遇到未知 major 版本时应忽略 audit JSON 并警告用户

版本历史：
- `1.2` — 新增 `optimize_recommendations` 段（供 optimize 消费），Finding 新增 `actionable_by_optimize` 字段，`statistics` 新增 `actionable_by_optimize` 计数
- `1.1` — 扩展 `project_understanding` 段，新增 `directory_map`、`key_files`、`implementation_rationale`、`usage`、`navigation_hints`（全部 optional）
- `1.0` — 初始版本

---

## Top-Level Structure

```json
{
  "audit_metadata": { ... },
  "project_understanding": { ... },
  "findings": [ ... ],
  "tidy_recommendations": { ... },
  "questions": { ... },
  "statistics": { ... }
}
```

所有 top-level 字段均为 **required**。

---

## audit_metadata

审计元信息，用于新鲜度检查和兼容性判断。

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Schema 版本号，如 `"1.0"` |
| `timestamp` | string (ISO 8601) | yes | 审计完成时间，如 `"2026-04-21T14:30:00+08:00"` |
| `project_root` | string | yes | 审计时的项目根目录（相对路径 `"."` 或绝对路径） |
| `files_analyzed` | integer | yes | 实际分析的源文件数 |
| `files_total` | integer | yes | 项目源文件总数 |
| `coverage_percent` | number | yes | `files_analyzed / files_total * 100`，保留一位小数 |
| `primary_language` | string | yes | 主要编程语言（小写），如 `"python"`, `"typescript"` |
| `skill_version` | string | yes | repo-audit skill 版本 |

---

## project_understanding

项目整体理解，帮助 repo-tidy 和人类快速了解项目定位。

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | 项目名称 |
| `description` | string | yes | 一句话描述项目做什么 |
| `tech_stack` | string[] | yes | 技术栈列表，如 `["python", "fastapi", "sqlite"]` |
| `entry_points` | string[] | yes | 入口文件路径列表 |
| `key_modules` | Module[] | yes | 关键模块列表 |
| `hub_files` | HubFile[] | yes | 被最多文件引用的文件 |
| `orphan_files` | OrphanFile[] | yes | 从未被引用且非入口的文件 |
| `circular_dependencies` | Cycle[] | yes | 循环依赖列表（空数组表示无） |

### Module

```json
{
  "path": "src/summarizer/",
  "purpose": "Conversation summarization engine",
  "file_count": 12
}
```

### HubFile

```json
{
  "path": "src/utils/common.py",
  "imported_by_count": 23
}
```

### OrphanFile

```json
{
  "path": "src/old_parser.py",
  "last_modified": "2025-10-15"
}
```

### Cycle

```json
{
  "files": ["src/a.py", "src/b.py", "src/c.py"],
  "description": "a imports b, b imports c, c imports a"
}
```

### DirectoryEntry (v1.1+, optional)

`directory_map` 字段：每个顶层/关键子目录的职责说明。

```json
{
  "path": "src/engine/",
  "purpose": "处理引擎核心，Pipeline 模式处理多阶段数据转换",
  "key_files": ["pipeline.py", "transform.py", "filters.py"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | 目录路径（相对于项目根） |
| `purpose` | string | yes | 一句话职责说明 |
| `key_files` | string[] | no | 该目录下最重要的文件（文件名，非完整路径） |

### KeyFile (v1.1+, optional)

`key_files` 字段：项目中"必须了解"的核心文件。

```json
{
  "path": "src/engine/pipeline.py",
  "purpose": "Pipeline 处理引擎，编排所有数据转换阶段",
  "why_important": "所有输入数据的核心处理路径，修改此文件影响全局行为",
  "depends_on": ["src/parser/", "config/default.yaml"],
  "depended_by": ["cli.py", "api.py"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | 文件路径（相对于项目根） |
| `purpose` | string | yes | 文件功能 |
| `why_important` | string | yes | 为什么这个文件重要 |
| `depends_on` | string[] | no | 此文件依赖的文件/目录 |
| `depended_by` | string[] | no | 依赖此文件的文件/目录 |

### NavigationHint (v1.1+, optional)

`navigation_hints` 字段：面向实际场景的导航提示。

```json
{
  "intent": "修改核心处理逻辑",
  "target": "src/engine/",
  "detail": "Pipeline 定义在 pipeline.py，各阶段 transform 在同目录下"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intent` | string | yes | 用户意图（"我想..." 的动词短语） |
| `target` | string | yes | 目标文件或目录 |
| `detail` | string | no | 补充说明 |

### Usage (v1.1+, optional)

`usage` 字段：项目的安装、运行和配置方式。

```json
{
  "install": "pip install -e .",
  "run": "python -m myproject run input.json",
  "configure": "编辑 config/default.yaml",
  "test": "pytest tests/",
  "other": {
    "deploy": "bash scripts/deploy.sh"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `install` | string | no | 安装命令 |
| `run` | string | no | 主要运行命令 |
| `configure` | string | no | 配置方式 |
| `test` | string | no | 测试命令 |
| `other` | object | no | 其他命令（key=名称, value=命令） |

### implementation_rationale (v1.1+, optional)

`implementation_rationale` 字段：`string[]`，每条记录一个设计决策或实现理由。

```json
[
  "使用 Pipeline 模式处理多阶段数据转换，各阶段可独立测试和替换",
  "选择 YAML 而非 JSON 作为配置格式（支持注释，人类可读性更好）",
  "[推测] common/ 作为独立 pip 包安装可能是为了支持多项目复用"
]
```

无法确认的推断以 `[推测]` 前缀标注。

---

### v1.1 扩展字段汇总

以下字段添加到 `project_understanding` 对象中，全部 **optional**（缺失时 consumer 跳过即可）：

| Field | Type | Description |
|-------|------|-------------|
| `directory_map` | DirectoryEntry[] | 目录职责地图 |
| `key_files` | KeyFile[] | 关键文件详解（上限 20 个） |
| `implementation_rationale` | string[] | 实现逻辑/设计决策 |
| `usage` | Usage | 安装/运行/配置方式 |
| `navigation_hints` | NavigationHint[] | "我想做 X → 去看 Y" 速查表（至少 5 条） |

---

## findings

所有审计发现的列表，按 priority 升序排列。

### Finding Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | 唯一标识，格式 `F-NNN`（三位零填充） |
| `priority` | integer (1-7) | yes | 优先级（1=最高） |
| `category` | string (enum) | yes | 分类 |
| `severity` | string (enum) | yes | 严重程度 |
| `location` | string | yes | 文件或目录路径 |
| `description` | string | yes | 问题描述 |
| `suggestion` | string | yes | 建议操作 |
| `confidence` | number (0.0-1.0) | yes | 置信度 |
| `status` | string (enum) | yes | 当前状态 |
| `actionable_by_tidy` | boolean | yes | repo-tidy 是否可以直接处理 |
| `actionable_by_optimize` | boolean | yes | optimize 是否可以改善（v1.2+） |

### category enum

| Value | Priority | Description |
|-------|----------|-------------|
| `structure` | 1 | 项目结构合理性 |
| `logic` | 2 | 逻辑疑问 |
| `duplication` | 3 | 代码重复/冗余 |
| `config` | 4 | 配置管理 |
| `dead_code` | 5 | 死代码/未用文件 |
| `hardcoded` | 6 | 硬编码路径/值 |
| `dependency` | 7 | 依赖健康度 |

### severity enum

| Value | Description |
|-------|-------------|
| `high` | 影响项目运行或安全 |
| `medium` | 影响可维护性或开发效率 |
| `low` | 建议改进，不紧急 |
| `info` | 信息性记录，无需行动 |

### status enum

| Value | Description |
|-------|-------------|
| `confirmed` | 已确认的问题 |
| `unresolved` | 用户未回答相关问题 |
| `dismissed` | 用户标记为误报 |

---

## tidy_recommendations

**repo-tidy 直接消费的核心段。** 只包含 `actionable_by_tidy: true` 的 finding 转化而来的具体操作建议。

### files_to_clean

可以直接归档/清理的文件。

```json
{
  "path": "src/old_parser.py",
  "reason": "Dead code: never imported, not entry point",
  "confidence": 0.75,
  "finding_id": "F-012",
  "action": "archive"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | 文件或目录路径 |
| `reason` | string | 清理理由 |
| `confidence` | number | 置信度（repo-tidy 应以 0.8 为默认阈值） |
| `finding_id` | string | 关联的 finding ID |
| `action` | `"archive"` \| `"delete"` | 建议动作（默认 archive） |

### files_to_reorganize

建议移动/重新组织的文件。

```json
{
  "current_path": "src/format_date.py",
  "suggested_path": "src/utils/date/format_date.py",
  "reason": "Misplaced: date utility in root src/",
  "confidence": 0.8,
  "finding_id": "F-003"
}
```

### config_issues

配置相关问题。

```json
{
  "path": ".env",
  "issue": "Tracked in git, may contain secrets",
  "action": "Add to .gitignore, remove from tracking",
  "confidence": 0.95,
  "finding_id": "F-020"
}
```

### dependency_issues

依赖相关问题。

```json
{
  "package": "requests",
  "issue": "Unpinned version in requirements.txt",
  "suggestion": "Pin version",
  "confidence": 0.9,
  "finding_id": "F-025"
}
```

---

## optimize_recommendations

**optimize 直接消费的核心段。** 只包含 `actionable_by_optimize: true` 且 `status != dismissed` 的 finding 转化而来的具体优化建议。

### files_to_optimize

需要代码优化的文件，按优先级排序。

```json
{
  "path": "src/parser/core.py",
  "reason": "Function parse_input() exceeds 150 lines, deep nesting (5 levels)",
  "dimension": "simplification",
  "confidence": 0.85,
  "finding_id": "F-008",
  "line_range": "45-198"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | 文件路径 |
| `reason` | string | 需要优化的原因 |
| `dimension` | string (enum) | 对应 optimize 的维度 |
| `confidence` | number | 置信度 |
| `finding_id` | string | 关联的 finding ID |
| `line_range` | string \| null | 行范围（如适用），格式 `"start-end"` |

### dimension enum

映射 repo-audit 的 finding category 到 optimize 的五个维度：

| audit category | optimize dimension | Description |
|---------------|-------------------|-------------|
| `logic` (P2: 大函数、深嵌套、空 catch) | `simplification` | 简化与可读性 |
| `logic` (P2: 过多参数、复杂条件) | `refactoring` | 重构与结构 |
| `duplication` (P3) | `refactoring` | 消除重复 |
| `config` (P4: magic numbers) | `refactoring` | 提取常量 |
| `hardcoded` (P6: 硬编码值) | `refactoring` | 配置化 |

### duplication_groups

重复/冗余的代码组（P3 finding 的结构化表达）。

```json
{
  "files": ["src/utils/format.py", "src/helpers/format.py"],
  "description": "Both define format_date() with similar logic",
  "suggestion": "Extract shared utility or consolidate into one module",
  "confidence": 0.8,
  "finding_id": "F-015"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `files` | string[] | 涉及的文件路径列表 |
| `description` | string | 重复内容描述 |
| `suggestion` | string | 建议的合并/消除方式 |
| `confidence` | number | 置信度 |
| `finding_id` | string | 关联的 finding ID |

---

## questions

审计过程中产生的问题及其解答状态。

### resolved

```json
{
  "id": "Q1",
  "question": "Is src/legacy/ still in use?",
  "answer": "deprecated",
  "impact": ["F-012 confidence raised to 0.9"]
}
```

### unresolved

```json
{
  "id": "Q3",
  "question": "Are both helper files intentionally separate?",
  "finding_ids": ["F-007"]
}
```

---

## statistics

汇总统计，用于快速概览。

| Field | Type | Description |
|-------|------|-------------|
| `total_findings` | integer | 总发现数 |
| `by_severity` | object | `{"high": 3, "medium": 12, "low": 8, "info": 5}` |
| `by_priority` | object | `{"1": 5, "2": 7, ...}` (key 为字符串) |
| `actionable_by_tidy` | integer | repo-tidy 可直接处理的发现数 |
| `actionable_by_optimize` | integer | optimize 可改善的发现数（v1.2+） |

---

## 下游消费规则

### repo-tidy 消费规则

repo-tidy 读取此 JSON 时应遵循：

1. **检查 version** — 仅消费 major 版本为 `1` 的 JSON
2. **检查 timestamp** — 默认 7 天过期，`--with-audit` 跳过检查
3. **只读 tidy_recommendations** — 其余字段仅用于展示
4. **confidence 阈值** — ≥0.8 作为建议，<0.8 标注 `[需确认]`
5. **保留 finding_id** — 在 Phase 4 计划表中展示，方便追溯

### optimize 消费规则

optimize 读取此 JSON 时应遵循：

1. **检查 version** — 仅消费 major 版本为 `1` 的 JSON（`optimize_recommendations` 需 ≥1.2）
2. **检查 timestamp** — 默认 7 天过期，`--with-audit` 跳过检查
3. **只读 optimize_recommendations** — 其余字段仅用于展示上下文
4. **confidence 阈值** — ≥0.8 直接列入待优化；<0.8 标注 `[需确认]` 让用户决定
5. **保留 finding_id** — 优化建议中引用 finding ID，方便追溯
6. **line_range 优先** — 如有 `line_range`，优先读取该范围的代码而非全文件
7. **dimension 映射** — 按 `dimension` 字段匹配 optimize 的五个维度，聚焦分析
