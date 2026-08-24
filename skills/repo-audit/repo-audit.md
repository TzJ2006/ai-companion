---
description: >-
  深度审计 repo — 分析结构、逻辑、依赖、配置，生成审计报告。
  产出 docs/repo-audit.md（人读）+ docs/repo-audit.json（机读）。
---

# /repo-audit — 深度 Repo 审计

分析 repo 的结构、逻辑、依赖和配置，产出结构化审计报告。
所有不确定的发现收集为问题，一次性批量确认。

## Usage

```
/repo-audit                     # 完整审计，交互模式
/repo-audit --quick             # 快速模式：跳过 P6-P7，不问问题
/repo-audit --structure-only    # 仅分析项目结构（P1）
/repo-audit --deps-only         # 仅执行依赖映射（Phase 2）
/repo-audit --no-questions      # 跳过问题收集，用默认阈值
/repo-audit --update            # 增量：只分析上次审计后变更的文件
```

### Flags

| Flag | Description |
|------|-------------|
| (default) | 完整 6 阶段审计，含交互问答 |
| `--quick` | 跳过低优先级 (P6 硬编码, P7 依赖)，跳过 Phase 4 问题 |
| `--structure-only` | 只执行 Phase 1 + Phase 3 P1，快速了解项目结构 |
| `--deps-only` | 只执行 Phase 1 + Phase 2，输出依赖图 |
| `--no-questions` | 跳过 Phase 4，confidence < 0.7 的 finding 标记为 unresolved |
| `--update` | 增量模式：读取旧 `docs/repo-audit.json`，只重新分析 `git diff --name-only` 以来的文件 |

## What Happens

1. **Context Gathering** — 读 README、入口文件、目录结构，建立项目心智模型。深度理解阶段还会分析每个目录的职责、标注关键文件、梳理实现逻辑、收集使用方式、生成导航速查表
2. **Dependency Mapping** — 解析 import 语句，构建依赖图，识别 orphan/hub files
3. **Priority Analysis** — 按 7 个优先级分析：
   - P1 项目结构合理性
   - P2 逻辑疑问（大函数、空 catch、TODO）
   - P3 代码重复/冗余
   - P4 配置管理（secrets 暴露、magic numbers）
   - P5 死代码/未用文件
   - P6 硬编码路径/URL/端口
   - P7 依赖健康度
4. **Question Collection** — 所有 confidence < 0.7 的发现一次性呈现，批量确认
5. **Report Generation** — 生成两份文档：
   - `docs/repo-audit.md` — 人可读的完整报告（含项目理解、文件索引、实现逻辑、使用指南）
   - `docs/repo-audit.json` — 机器可读，供 `/repo-tidy` 消费
6. **Interactive Q&A** — （可选）按 finding ID 追问细节或标记误报

## Conversation Flow

Skill 在两个地方暂停等待用户输入：
- **Phase 4** — 批量确认不确定的 finding（如有）
- **Phase 6** — 可选的追加问答（用户不追问即结束）

其余阶段自动推进，中间输出进度摘要。

## Output

### During audit

每个 Phase 完成时输出简短进度：

```
Phase 1 完成 — 上下文收集
- 项目: gadget (Python)
- 规模: 87 个源文件, 15 个目录
→ 进入 Phase 2
```

### After audit

两份文件 + 控制台摘要：

```
## repo-audit 完成

- 报告: docs/repo-audit.md（人读）
  包含：项目概述、文件索引（带速查表）、技术栈、架构分析、
  实现逻辑、使用指南、关键文件详解、全部 findings
- 数据: docs/repo-audit.json（机读，供 repo-tidy 和 optimize 消费）
- 发现: 28 个（3 high, 12 medium, 8 low, 5 info）
- 可由 repo-tidy 处理: 8 个
- 可由 optimize 改善: 12 个

### 建议下一步
1. /repo-tidy          — 清理文件（8 个可处理项）
2. /optimize --with-audit  — 优化代码（12 个可改善项）
```

## Integration Pipeline

audit 产出的 `docs/repo-audit.json` 包含两个下游 skill 可消费的段：

| JSON 段 | 消费者 | 内容 |
|---------|--------|------|
| `tidy_recommendations` | `/repo-tidy` | 可清理/归档的文件、配置问题 |
| `optimize_recommendations` | `/optimize --with-audit` | 需要优化的代码文件、重复代码组 |

两个下游 skill 的审计感知行为一致：
- audit JSON <7 天 → 自动加载，标注 `[审计推荐]`
- audit JSON >7 天 → 提示用户是否继续使用
- 无 audit JSON → 照常运行（纯规则匹配 / 用户指定文件）

推荐工作流：
```
/repo-audit              # 1. 先理解（诊断）
/repo-tidy               # 2. 再清理（自动利用审计结果）
/optimize --with-audit   # 3. 再优化（定向改善审计发现的代码问题）
```

## Tips

- **新项目：** 先跑 `--structure-only` 快速了解结构，再决定是否需要完整审计
- **大项目：** 用 `--quick` 避免低优先级分析耗时
- **日常维护：** 用 `--update` 增量更新，不用每次全量审计
- **团队协作：** `docs/repo-audit.md` 可以提交到 git，作为项目健康档案
