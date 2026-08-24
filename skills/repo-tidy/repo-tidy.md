---
description: >-
  整理 working repo — 清理垃圾文件、归档散落文件、梳理 Git 状态。
  根据 repo 类型应用不同策略，所有操作先备份后执行。
---

# /repo-tidy — Working Repo 整理工具

清理垃圾、归档散落文件、梳理 Git 状态。安全第一，计划先行。

## Usage

```
/repo-tidy                     # 交互模式：问 repo 类型，完整流程
/repo-tidy --type code         # 跳过类型选择，直接用 code 规则
/repo-tidy --type docs         # 跳过类型选择，直接用 docs 规则
/repo-tidy --type data         # 跳过类型选择，直接用 data 规则
/repo-tidy --type general      # 跳过类型选择，直接用 general 规则
/repo-tidy --scan-only         # 只扫描报告，不提出改动建议
/repo-tidy --git-only          # 只检查 Git 状态，跳过文件清理
```

### Flags

| Flag | Description |
|------|-------------|
| (default) | 交互模式，询问 repo 类型后执行完整五步流程 |
| `--type <t>` | 跳过类型选择，直接使用指定类型规则 (code/docs/data/general) |
| `--scan-only` | 只扫描并报告当前状态，不生成整理计划 |
| `--git-only` | 只检查 Git hygiene（分支、未跟踪文件、大文件），跳过文件清理 |

## What Happens

1. **Pre-flight Check** — 确认 git repo，自动 `git stash` 备份当前工作
2. **Identify Type** — 问用户选择 repo 类型（code / docs / data / general），或通过 `--type` 指定
3. **Scan** — 三维扫描：
   - **垃圾文件** — `.gitignore` 驱动 + 默认垃圾清单 + 类型特定规则
   - **散落文件** — 根据类型判断可能放错位置的文件
   - **Git 状态** — 未跟踪文件、已合并分支、大文件警告
4. **Propose Plan** — 展示完整整理计划（清理列表 + 归档建议 + Git 建议）
5. **Execute** — 用户确认后执行：文件移入 `archive/YYYY-MM-DD/`，清理分支，更新 `.gitignore`

## Conversation Flow

Skill 会在 Phase 2（选类型）和 Phase 4（确认计划）暂停等待用户输入。

用户可以在 Phase 4：
- 全部确认 → 执行所有计划项
- 部分确认 → "跳过 #2 和 Git #1"
- 拒绝 → 取消整理，`git stash pop` 恢复
- 修改 → 提出调整建议后重新展示计划

## Output

### 计划阶段

表格形式展示三个维度的清理计划，每项有编号方便用户选择性确认。

### 执行完成后

```
## repo-tidy 完成 ✓

- 清理: 12 个文件/目录 → archive/2026-04-21/
- 归档: 3 个文件重新归类
- Git: 2 个已合并分支已删除
- 释放空间: ~45 MB
- 恢复: git stash pop 或从 archive/ 取回
```

## Safety

- 所有文件移到 `archive/` 而非直接删除
- 动手前自动 `git stash` 兜底
- `archive/` 自动加入 `.gitignore`
- `archive/` 保留最近 3 个日期目录，超出部分只提醒不自动删
- 不修改任何文件内容，只做移动和组织
- 不碰 git-tracked 且有未提交修改的文件

## Pipeline

repo-tidy 是代码健康 pipeline 的中间环节。推荐工作流：

```
/repo-audit              # 1. 诊断（生成 audit JSON）
/repo-tidy               # 2. 清理（自动消费 tidy_recommendations）
/optimize --with-audit   # 3. 优化（自动消费 optimize_recommendations）
```

tidy 完成后，如审计 JSON 中还有 `optimize_recommendations` 待处理，会提示下一步。
