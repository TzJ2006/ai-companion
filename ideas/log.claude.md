# Change log

Append-only. Every code, doc, and idea change goes here.

## 2026-08-24 · idea-record

- files: cursor-companion/
- note: created the Cursor Companion harness (skills, engine, install, hooks)
- 2026-08-24 20:31  Edit claude-companion/guard.ts
- 2026-08-24 20:31  Edit claude-companion/guard.ts
- 2026-08-24 20:31  Edit claude-companion/guard.ts
- 2026-08-24 20:31  Edit claude-companion/guard.ts
- 2026-08-24 20:31  Edit claude-companion/guard.ts
- 2026-08-24 20:32  Edit claude-companion/example/graph.yaml
- 2026-08-24 20:33  Edit claude-companion/README.md
- 2026-08-24 20:35  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:36  Edit C:/Users/tongt/.claude/projects/D--GitHub-ai-companion/memory/project_claude_companion.md
- 2026-08-24 20:39  Edit claude-companion/guard.ts
- 2026-08-24 20:39  Edit claude-companion/guard.ts
- 2026-08-24 20:40  Edit claude-companion/guard.ts

## 2026-08-24 · idea-record
- note: harness: preToolUse write-gate, set doing/done enforcement, verify.command actually runs
- 2026-08-24 20:40  Edit claude-companion/guard.ts
- 2026-08-24 20:40  Edit claude-companion/guard.ts
- 2026-08-24 20:40  Edit claude-companion/guard.ts
- 2026-08-24 20:40  Edit claude-companion/guard.ts
- 2026-08-24 20:40  Edit claude-companion/guard.ts
- 2026-08-24 20:41  Edit claude-companion/install.ts
- 2026-08-24 20:41  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:41  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:41  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:42  Edit claude-companion/README.md
- 2026-08-24 20:43  Edit claude-companion/commands/ccscan.md
- 2026-08-24 20:43  Edit claude-companion/commands/ccthink.md
- 2026-08-24 20:43  Edit claude-companion/commands/ccbuild.md
- 2026-08-24 20:43  Edit claude-companion/example/graph.yaml
- 2026-08-24 20:45  Edit C:/Users/tongt/.claude/projects/D--GitHub-ai-companion/memory/project_claude_companion.md
- 2026-08-24 20:50  Write claude-companion/README.md
- 2026-08-24 20:53  Edit claude-companion/ideas.ts
- 2026-08-24 20:53  Edit claude-companion/ideas.ts
- 2026-08-24 20:54  Edit claude-companion/ideas.ts
- 2026-08-24 20:54  Edit claude-companion/ideas.ts
- 2026-08-24 20:54  Edit claude-companion/ideas.ts
- 2026-08-24 20:54  Edit claude-companion/guard.ts
- 2026-08-24 20:54  Edit claude-companion/guard.ts
- 2026-08-24 20:54  Edit claude-companion/install.ts
- 2026-08-24 20:54  Edit claude-companion/guard.ts
- 2026-08-24 20:55  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:55  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 20:55  Edit claude-companion/ideas.ts
- 2026-08-24 20:55  Edit claude-companion/ideas.ts
- 2026-08-24 20:56  读 .agents/skills/ccaudit/SKILL.md  (扫描还剩 510)
- 2026-08-24 20:56  Grep .agents/skills/ccdebug/SKILL.md
- 2026-08-24 20:57  Edit claude-companion/commands/ccscan.md
- 2026-08-24 20:57  Edit claude-companion/commands/ccscan.md
- 2026-08-24 20:57  Edit claude-companion/commands/ccscan.md
- 2026-08-24 20:57  Edit claude-companion/README.md
- 2026-08-24 20:58  Edit claude-companion/README.md
- 2026-08-24 20:58  Edit claude-companion/README.md
- 2026-08-24 20:58  Edit claude-companion/README.md
- 2026-08-24 20:58  Edit claude-companion/README.md
- 2026-08-24 20:59  Edit claude-companion/example/graph.yaml
- 2026-08-24 20:59  Edit claude-companion/example/graph.yaml
- 2026-08-24 21:01  Edit claude-companion/install.ts
- 2026-08-24 21:01  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-24 21:03  Edit C:/Users/tongt/.claude/projects/D--GitHub-ai-companion/memory/project_claude_companion.md
- 2026-08-24 21:03  Write ideas/graph.yaml

## 2026-08-24 · ccscan

- files: ideas/graph.yaml, ideas/graph.html
- note: 首次用 claude-companion 的八问格式给整个仓库建图。20 个想法，4 个终点（人选的）。
- 读了什么：根文档（README / AGENTS / CLAUDE / tutorial / docs/OVERVIEW）、全部配置与
  manifest、packages/*/src 下全部 60 个源文件、scripts/ 全部 .ts 与 .sh、claude-companion/
  全部源码与五个命令、cursor-companion 与 codex-companion 的全部入口（含 companion.py 1733 行）、
  .claude/commands/ 全部 13 个命令、docs/ecl/ 全部 17 份 YAML 的头部 + 4 份全文、git log 全部 21 次提交。
- 没读什么：skills/.agents/huashu-nuwa（123 个文件，vendored 第三方人格研究语料，与本项目无关）、
  .devcompanion/tests/ 85 个测试文件（只读了文件名清单和 2 份，用整套测试跑通的结果代替逐份阅读）、
  skills/ccplan/SKILL.md 等 8 份领域技能规格（只读 frontmatter）、packages/*/package.json 与
  tsconfig.json（样板）、packages/dashboard/public/ 三个前端文件、生成产物（*.html、dag/*.md）。
- 图的范围：按人的要求只画 claude-companion 这条线；因为人同时选了「追踪可靠」和「dashboard」
  两个终点，追加了 I-014~I-017 四个粗粒度节点。cursor-companion、codex-companion 和旧的
  ECL 规划执行流水线（skills/ + docs/ecl/ + packages/exec）不在图里。
- 没答上的问题：I-016 与 I-020 的 why_this_way 留空（找不到真实理由，不编）。
  10 个节点的 verify 是人工验证且未签字。
- 本次扫描发现的缺口（已写进 I-006 / I-020）：
  1. R7 的扫描倒计时不可达 —— guard.ts 里 ruleRecord 处理 Read，但 .claude/settings.json
     和 install.ts 注册的 PostToolUse matcher 都是 Edit|Write|NotebookEdit，Read 永远到不了守卫。
  2. listProjectFiles 用 git ls-files（只看已追踪文件），claude-companion/、cursor-companion/、
     codex-companion/ 全部未被 git 追踪，所以正是当前在做的东西不在扫描清单里。
  3. packages/hook 的 capturePreEditSnapshots / enqueueCapturedEvents 只被测试调用，
     live 入口 handlePostToolUse 仍然写旧的 events.jsonl，worker 再把它迁移成 degraded。
- 遗留：仓库根目录的 _gatein.json 是一个格式损坏的 gate 测试残留文件。
- 2026-08-24 21:12  Edit claude-companion/ideas.ts  → I-002 图的解析与校验
- 2026-08-24 21:13  读 README.md  (扫描还剩 455)
- 2026-08-24 21:13  读 AGENTS.md  (扫描还剩 454)
- 2026-08-24 21:13  读 CLAUDE.md  (扫描还剩 453)
- 2026-08-24 21:13  读 devcompanion.config.ts  (扫描还剩 452)
- 2026-08-24 21:13  读 package.json  (扫描还剩 451)
- 2026-08-24 21:13  读 docs/OVERVIEW.md  (扫描还剩 450)
- 2026-08-24 21:13  读 tutorial.md  (扫描还剩 449)
- 2026-08-24 21:14  Edit claude-companion/ideas.ts  → I-002 图的解析与校验
- 2026-08-24 21:17  Edit claude-companion/ideas.ts  → I-002 图的解析与校验
- 2026-08-24 21:17  Edit claude-companion/ideas.ts  → I-002 图的解析与校验
- 2026-08-24 21:17  Write ideas/.scanignore
- 2026-08-24 21:18  读 packages/types/src/index.ts  (扫描还剩 371)
- 2026-08-24 21:18  读 packages/types/src/history.ts  (扫描还剩 370)
- 2026-08-24 21:18  读 packages/types/src/analysis.ts  (扫描还剩 369)
- 2026-08-24 21:18  读 packages/types/src/modularity.ts  (扫描还剩 368)
- 2026-08-24 21:18  读 packages/ast/src/identity.ts  (扫描还剩 367)
- 2026-08-24 21:18  读 packages/ast/src/multi-lang.ts  (扫描还剩 366)
- 2026-08-24 21:18  读 packages/ast/src/wasm-resolver.ts  (扫描还剩 365)
- 2026-08-24 21:18  读 packages/ast/src/index.ts  (扫描还剩 364)
- 2026-08-24 21:18  读 packages/ast/src/types.ts  (扫描还剩 363)
- 2026-08-24 21:18  读 packages/ast/src/parser-factory.ts  (扫描还剩 362)
- 2026-08-24 21:19  读 packages/ast/src/call-graph.ts  (扫描还剩 361)
- 2026-08-24 21:19  读 packages/ast/src/parser.ts  (扫描还剩 360)
- 2026-08-24 21:19  读 packages/ast/src/ts-parser.ts  (扫描还剩 359)
- 2026-08-24 21:19  读 packages/ast/package.json  (扫描还剩 358)
- 2026-08-24 21:19  读 packages/ast/tsconfig.json  (扫描还剩 357)
- 2026-08-24 21:19  读 packages/core/src/index.ts  (扫描还剩 356)
- 2026-08-24 21:19  读 packages/core/src/diff/parser.ts  (扫描还剩 355)
- 2026-08-24 21:19  读 packages/core/src/diff/annotator.ts  (扫描还剩 354)
- 2026-08-24 21:19  读 packages/core/src/diff/index.ts  (扫描还剩 353)
- 2026-08-24 21:19  读 packages/core/src/utils.ts  (扫描还剩 352)
- 2026-08-24 21:19  读 packages/core/src/analysis/analyzer.ts  (扫描还剩 351)
- 2026-08-24 21:19  读 packages/core/src/analysis/heuristic.ts  (扫描还剩 350)
- 2026-08-24 21:19  读 packages/core/src/analysis/prompt.ts  (扫描还剩 349)
- 2026-08-24 21:19  读 packages/core/src/analysis/index.ts  (扫描还剩 348)
- 2026-08-24 21:19  读 packages/core/src/analysis/types.ts  (扫描还剩 347)
- 2026-08-24 21:19  读 packages/core/src/test-gen/generator.ts  (扫描还剩 346)
- 2026-08-24 21:19  读 packages/core/src/test-gen/ts-generator.ts  (扫描还剩 345)
- 2026-08-24 21:19  读 packages/core/src/test-gen/index.ts  (扫描还剩 344)
- 2026-08-24 21:19  读 packages/core/src/modularity/heuristic.ts  (扫描还剩 343)
- 2026-08-24 21:19  读 packages/core/src/modularity/analyzer.ts  (扫描还剩 342)
- 2026-08-24 21:19  读 packages/core/src/modularity/contracts.ts  (扫描还剩 341)
- 2026-08-24 21:19  读 packages/core/src/modularity/aggregator.ts  (扫描还剩 340)
- 2026-08-24 21:19  读 packages/core/src/modularity/prompt.ts  (扫描还剩 339)
- 2026-08-24 21:19  读 packages/core/src/modularity/index.ts  (扫描还剩 338)
- 2026-08-24 21:19  读 packages/core/src/modularity/types.ts  (扫描还剩 337)
- 2026-08-24 21:19  读 packages/core/package.json  (扫描还剩 336)
- 2026-08-24 21:19  读 packages/core/tsconfig.json  (扫描还剩 335)
- 2026-08-24 21:19  读 packages/types/package.json  (扫描还剩 334)
- 2026-08-24 21:19  读 packages/types/tsconfig.json  (扫描还剩 333)
- 2026-08-24 21:20  读 packages/history/src/store.ts  (扫描还剩 332)
- 2026-08-24 21:20  读 packages/history/src/types.ts  (扫描还剩 331)
- 2026-08-24 21:20  读 packages/history/src/index.ts  (扫描还剩 330)
- 2026-08-24 21:20  读 packages/history/src/analysis-store.ts  (扫描还剩 329)
- 2026-08-24 21:20  读 packages/history/src/modularity-store.ts  (扫描还剩 328)
- 2026-08-24 21:20  读 packages/history/src/managed-gitignore.ts  (扫描还剩 327)
- 2026-08-24 21:20  读 packages/history/src/projector.ts  (扫描还剩 326)
- 2026-08-24 21:20  读 packages/history/package.json  (扫描还剩 325)
- 2026-08-24 21:20  读 packages/history/tsconfig.json  (扫描还剩 324)
- 2026-08-24 21:20  读 packages/llm/src/caller.ts  (扫描还剩 323)
- 2026-08-24 21:20  读 packages/llm/src/types.ts  (扫描还剩 322)
- 2026-08-24 21:20  读 packages/llm/src/index.ts  (扫描还剩 321)
- 2026-08-24 21:20  读 packages/llm/package.json  (扫描还剩 320)
- 2026-08-24 21:20  读 packages/llm/tsconfig.json  (扫描还剩 319)
- 2026-08-24 21:20  读 packages/render/src/renderer.ts  (扫描还剩 318)
- 2026-08-24 21:20  读 packages/render/src/index.ts  (扫描还剩 317)
- 2026-08-24 21:20  读 packages/render/src/onboard/index.ts  (扫描还剩 316)
- 2026-08-24 21:20  读 packages/render/src/onboard/page.ts  (扫描还剩 315)
- 2026-08-24 21:20  读 packages/render/src/onboard/overview.ts  (扫描还剩 314)
- 2026-08-24 21:20  读 packages/render/src/onboard/modules.ts  (扫描还剩 313)
- 2026-08-24 21:20  读 packages/render/src/onboard/index-panel.ts  (扫描还剩 312)
- 2026-08-24 21:20  读 packages/render/src/onboard/utils.ts  (扫描还剩 311)
- 2026-08-24 21:20  读 packages/render/src/onboard/types.ts  (扫描还剩 310)
- 2026-08-24 21:20  读 packages/render/tsconfig.json  (扫描还剩 309)
- 2026-08-24 21:20  读 packages/render/package.json  (扫描还剩 308)
- 2026-08-24 21:21  读 packages/exec/src/status-manager.ts  (扫描还剩 307)
- 2026-08-24 21:21  读 packages/exec/src/topological-sort.ts  (扫描还剩 306)
- 2026-08-24 21:21  读 packages/exec/src/build-subagent-context.ts  (扫描还剩 305)
- 2026-08-24 21:21  读 packages/exec/src/types.ts  (扫描还剩 304)
- 2026-08-24 21:21  读 packages/exec/src/cli.ts  (扫描还剩 303)
- 2026-08-24 21:21  读 packages/exec/src/session-recovery.ts  (扫描还剩 302)
- 2026-08-24 21:21  读 packages/exec/src/config.ts  (扫描还剩 301)
- 2026-08-24 21:21  读 packages/hook/src/index.ts  (扫描还剩 300)
- 2026-08-24 21:21  读 packages/exec/src/index.ts  (扫描还剩 299)
- 2026-08-24 21:21  读 packages/hook/src/pre-tool-use-guard.ts  (扫描还剩 298)

## 2026-08-24 · idea-onboard
- ideas: I-021
- note: created 想法图账本（Cursor 引擎）

## 2026-08-24 · idea-onboard
- ideas: I-022
- note: created 写闸门 fail-closed

## 2026-08-24 · idea-onboard
- ideas: I-023
- note: created 五个 idea 技能

## 2026-08-24 · idea-onboard
- ideas: I-024
- note: created 想法图可视化（Cursor）

## 2026-08-24 · idea-onboard
- ideas: I-025
- note: created Cursor harness 可安装

## 2026-08-24 · idea-onboard
- ideas: I-026
- note: created 函数级变更追踪可安装可用
- 2026-08-24 21:25  Edit claude-companion/ideas.ts  → I-002 图的解析与校验
- 2026-08-24 21:25  Edit claude-companion/install.ts
- 2026-08-24 21:26  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-24 21:26  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-24 21:26  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-24 21:29  Write ideas/graph.claude.yaml

## 2026-08-24 · idea-onboard
- note: refresh: files read ~40 in full, ~90 package src identified via exports, ~86 tests named not fully read; skipped node_modules/dist/wasm/huashu-nuwa/ECL bodies; added I-021..I-026 Cursor harness + tracker endpoint; endpoints now I-026,I-025,I-017; open questions: I-016/I-020 why_this_way, claude-companion cluster I-001..I-013/I-019 orphaned, ECL pipeline not graphed

## 2026-08-24 · ccscan（部分完成）
- 范围：372 个文件（排除 huashu-nuwa 第三方包、codex-companion/、cursor-companion/，由人确认）
- 读了：74/372。已覆盖 packages/{types,ast,core,history,render,llm,exec} 与 hook 主干
- 未读：scripts/、skills/、.claude/commands/、docs/ecl/、.devcompanion/tests/、
  claude-companion/、packages/{cli,daemon,idea,dashboard}。断点在 ideas/.scan-todo
- 终点：I-040「一套能装进其它仓库的工作流」（人在第 2 步确认，单终点）
- 建了 20 个想法，check 0 错误
- 未解答：I-008 的 why_this_way（找不到当初选这套指标的记录）、I-040 的 why_this_way
  （旧 ECL 流水线与新想法图两套安装路径的取舍未定）
- 扫描中发现并修掉的工具 bug：node_modules 被 git 跟踪导致混进清单、
  git ls-files 漏掉未提交文件、graph.yaml 与 cursor-companion 抢同一个文件名
- 2026-08-25 01:28  Write claude-companion/README.md
- 2026-08-25 01:28  读 package.json  (扫描还剩 297)
- 2026-08-25 01:28  人工批准想法图 01bff50d2dc5
- 2026-08-25 01:29  Edit claude-companion/guard.ts
- 2026-08-25 01:30  Edit claude-companion/ideas.ts
- 2026-08-25 01:30  Edit claude-companion/ideas.ts
- 2026-08-25 01:32  Edit claude-companion/ideas.ts
- 2026-08-25 01:33  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 01:33  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 01:33  Edit .devcompanion/tests/test_ideas_guard.test.ts
- 2026-08-25 01:34  Write package.json
- 2026-08-25 01:34  Edit claude-companion/FORMAT.md
- 2026-08-25 01:35  Edit claude-companion/README.md
- 2026-08-25 01:35  Edit claude-companion/README.md
- 2026-08-25 01:47  Edit claude-companion/ideas.ts
- 2026-08-25 01:47  Edit claude-companion/ideas.ts
- 2026-08-25 01:47  Edit claude-companion/ideas.ts
- 2026-08-25 01:48  Edit claude-companion/ideas.ts
- 2026-08-25 01:49  Edit claude-companion/ideas.ts
- 2026-08-25 01:49  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 01:57  Edit claude-companion/ideas.ts
- 2026-08-25 01:58  Edit claude-companion/ideas.ts
- 2026-08-25 01:58  Edit claude-companion/ideas.ts
- 2026-08-25 01:59  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 02:36  读 .claude/settings.json  (扫描还剩 296)
- 2026-08-25 02:36  Edit .claude/settings.json
- 2026-08-25 02:37  Write package.json
- 2026-08-25 02:38  Edit package.json
- 2026-08-25 02:44  读 claude-companion/install.ts  (扫描还剩 295)
- 2026-08-25 02:44  Edit claude-companion/install.ts
- 2026-08-25 02:44  Edit claude-companion/install.ts
- 2026-08-25 02:44  Write claude-companion/.installs.json
- 2026-08-25 02:45  Edit claude-companion/install.ts
- 2026-08-25 02:46  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 02:46  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 02:47  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-25 02:47  Edit claude-companion/README.md
- 2026-08-25 03:05  读 claude-companion/FORMAT.md  (扫描还剩 294)
- 2026-08-25 03:06  读 claude-companion/README.md  (扫描还剩 41)
- 2026-08-25 03:06  读 claude-companion/ideas.ts  (扫描还剩 40)
- 2026-08-25 03:06  读 claude-companion/guard.ts  (扫描还剩 39)
- 2026-08-25 03:06  读 claude-companion/install.ts  (扫描还剩 38)
- 2026-08-25 03:06  读 claude-companion/commands/ccthink.md  (扫描还剩 37)
- 2026-08-25 03:06  读 claude-companion/commands/ccbuild.md  (扫描还剩 36)
- 2026-08-25 03:06  读 claude-companion/commands/ccfix.md  (扫描还剩 35)
- 2026-08-25 03:06  读 claude-companion/commands/ccgraph.md  (扫描还剩 34)
- 2026-08-25 03:06  读 claude-companion/commands/ccscan.md  (扫描还剩 33)
- 2026-08-25 03:06  读 .claude/settings.json  (扫描还剩 32)
- 2026-08-25 03:06  读 .gitignore  (扫描还剩 32)
- 2026-08-25 03:06  读 package.json  (扫描还剩 32)
- 2026-08-25 03:07  读 claude-companion/example/graph.yaml  (扫描还剩 31)
- 2026-08-25 03:07  读 .devcompanion/tests/test_ideas_graph.test.ts  (扫描还剩 30)
- 2026-08-25 03:07  读 .devcompanion/tests/test_ideas_guard.test.ts  (扫描还剩 29)
- 2026-08-25 03:07  读 .devcompanion/tests/test_companion_names.test.ts  (扫描还剩 28)
- 2026-08-25 03:07  读 .devcompanion/tests/test_companion_gate.test.ts  (扫描还剩 27)
- 2026-08-25 03:07  读 .devcompanion/tests/test_companion_ideas.test.ts  (扫描还剩 26)
- 2026-08-25 03:07  读 .devcompanion/tests/test_companion_record.test.ts  (扫描还剩 25)
- 2026-08-25 03:07  读 .cursor/companion.json  (扫描还剩 24)
- 2026-08-25 03:07  读 .cursor/hooks.json  (扫描还剩 23)
- 2026-08-25 03:07  读 .cursor/rules/idea-graph.mdc  (扫描还剩 22)
- 2026-08-25 03:07  读 .cursor-plugin/marketplace.json  (扫描还剩 21)
- 2026-08-25 03:07  读 .cursor/companion/package.json  (扫描还剩 20)
- 2026-08-25 03:07  读 .cursor/hooks/gate.mjs  (扫描还剩 19)
- 2026-08-25 03:07  读 .cursor/hooks/record.mjs  (扫描还剩 19)
- 2026-08-25 03:07  读 .cursor/hooks/session.mjs  (扫描还剩 18)
- 2026-08-25 03:07  读 .cursor/companion/gate-lib.mjs  (扫描还剩 17)
- 2026-08-25 03:07  读 .cursor/companion/FORMAT.md  (扫描还剩 16)
- 2026-08-25 03:07  读 .cursor/skills/idea-discuss/SKILL.md  (扫描还剩 15)
- 2026-08-25 03:07  读 .cursor/skills/idea-build/SKILL.md  (扫描还剩 14)
- 2026-08-25 03:07  读 .cursor/skills/idea-debug/SKILL.md  (扫描还剩 13)
- 2026-08-25 03:07  读 .cursor/skills/idea-record/SKILL.md  (扫描还剩 12)
- 2026-08-25 03:07  读 .cursor/companion/ideas.ts  (扫描还剩 11)
- 2026-08-25 03:07  读 .claude/commands/ccgraph.md  (扫描还剩 10)
- 2026-08-25 03:07  读 .claude/commands/ccscan.md  (扫描还剩 9)
- 2026-08-25 03:07  读 .claude/commands/ccbuild.md  (扫描还剩 8)
- 2026-08-25 03:07  读 .claude/commands/ccfix.md  (扫描还剩 7)
- 2026-08-25 03:07  读 .claude/commands/ccthink.md  (扫描还剩 7)
- 2026-08-25 03:08  读 claude-companion/FORMAT.md  (扫描还剩 6)
- 2026-08-25 03:08  读 claude-companion/example/graph.html  (扫描还剩 5)
- 2026-08-25 03:18  Edit ideas/graph.claude.yaml
- 2026-08-25 03:19  Edit ideas/graph.claude.yaml

## 2026-08-25 · ccscan · 重建想法图
- 扫描：worklist 42 个文件，全部 Read 过；账本因并发丢写显示还剩 5（见 I-055）
- 旧图 I-001~I-019 描述的是 ca7e956 删掉的 packages/scripts/skills/docs，经人确认删除
- 新建 19 个想法 I-041~I-059，新 id 不复用旧号；终点三个：I-057 / I-058 / I-059
- check：0 errors / 5 warnings；前沿：I-055、I-056
- 未答：I-054.how、I-054.why_this_way、I-055.why_this_way、I-056.why_this_way、I-053 两侧失败方向相反的原因
- 2026-08-27 17:49  Edit claude-companion/ideas.ts  → I-042 图的解析与校验
- 2026-08-27 17:49  Edit .devcompanion/tests/test_ideas_graph.test.ts
- 2026-08-27 修 bug：图上点节点跳不到详情卡片。pointerdown 就 setPointerCapture 会把整串兼容鼠标事件（含 click）重定向到 .viewport，mermaid 绑在节点上的 handler 永不触发。改成移动超过 4px 才捕获；测试 test_ideas_graph.test.ts "captures the pointer only after the drag threshold"
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:41  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:42  Edit ideas/graph.claude.yaml
- 2026-08-28 03:43  Edit ideas/graph.claude.yaml
- 2026-08-28 03:43  Edit ideas/graph.claude.yaml
- 2026-08-28 03:43  Edit ideas/graph.claude.yaml
- 2026-08-28 03:43  Edit ideas/graph.claude.yaml
- 2026-08-28 03:43  Edit ideas/graph.claude.yaml
- 2026-08-29 01:25  人工批准想法图 379f79e98fe0
- 2026-08-29 01:25  Edit claude-companion/FORMAT.md  → I-041 想法节点的记录格式：每个想法必须回答八个问题
- 2026-08-29 01:25  Edit claude-companion/FORMAT.md  → I-041 想法节点的记录格式：每个想法必须回答八个问题
- 2026-08-29 01:25  Edit claude-companion/commands/ccscan.md  → I-049 五个斜杠命令，覆盖从建图到实现的完整工作流
- 2026-08-28 固化图的写作规范：规则蒸馏自 2026-08-28 03:41 对 graph.claude.yaml 的整轮重写。FORMAT.md 新增「How to write the graph」一节（四条规则：一句人话写它做什么、不用未解释的行话、终点加「终点：」前缀、写明动作主体），节点模板示例同步换成新风格；ccscan.md 第 3 步的旧示例（"函数级变更追踪" 式短名）替换为新规则。ideas.ts 不改 —— wrapLabel 已支持长名称换行。
- 2026-08-29 01:25  Edit ideas/log.claude.md
- 2026-08-29 20:43  Write CLAUDE.md
- 2026-08-29 20:43  Edit C:/Users/tongt/.claude/projects/D--GitHub-ai-companion/memory/feedback_vitest_watch_trap.md
- 2026-08-29 20:59  Write C:/Users/tongt/.claude/plans/rosy-conjuring-cookie.md
- 2026-08-29 21:03  Edit ideas/graph.claude.yaml
- 2026-08-29 21:03  Edit ideas/graph.claude.yaml
- 2026-08-29 21:09  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/fsa-test.html
- 2026-08-29 21:09  Write C:/Users/tongt/.claude/plans/immutable-yawning-trinket.md
- 2026-08-29 21:11  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/fsa-test.html
- 2026-08-29 21:13  Edit ideas/graph.claude.yaml
- 2026-08-29 21:13  Edit ideas/graph.claude.yaml
- 2026-08-29 21:13  Edit ideas/graph.claude.yaml
- 2026-08-29 21:13  Edit ideas/graph.claude.yaml
- 2026-08-29 21:15  Edit ideas/graph.claude.yaml
- 2026-08-29 ccthink 共同基座：提取三个 companion 的共同部分，概念改一次三边生效，新 agent 只写薄接入层。人批准推翻 I-059 的旧决定（「不做统一抽象层」——三家 hook 生态已趋同，旧前提不再成立）。新增 I-069（裁决规范）、I-070（共享引擎）、I-071（共享守卫）、I-072（接入说明安装器）、I-073（Cursor 接入）、I-074（Codex 接入）、I-075（终点：改一处三边生效）；I-053/I-054 置 blocked（被取代）；I-059 前置与实现手段改写。借用：spec-kit 的接入说明模式、Taskmaster 的单引擎模式、Cursor 官方对 Claude 格式 hook 的原生加载、Codex hook 与 Claude 同构的事实、既有 claude 引擎（764 行）与 cursor 增量（约 170 行）、六个既有测试文件当回归网。自建仅两样：分歧决策表、安装器的接入说明层。计划四周（第 3、4 周是猜测）。
- 2026-08-29 21:17  人工批准想法图 e9d8701ca3b4
- 2026-08-29 21:23  Write companion/FORMAT.md  → I-069 把三套实现的分歧逐条裁决，写成一份共同规范
- 2026-08-29 21:24  Edit CLAUDE.md
- 2026-08-29 21:24  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/probe-yaml.ts
- 2026-08-29 21:24  Edit C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/probe-yaml.ts
- 2026-08-29 21:25  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/probe2.ts
- 2026-08-29 21:26  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/probe3.ts
- 2026-08-29 21:27  Write C:/Users/tongt/AppData/Local/Temp/claude/D--GitHub-ai-companion/4ac34e39-cbee-4c5e-8c6b-adb410c67fa8/scratchpad/probe4.ts
- 2026-08-29 21:36  Edit ideas/graph.claude.yaml
- 2026-08-29 21:36  Edit ideas/graph.claude.yaml
- 2026-08-29 21:36  Edit ideas/graph.claude.yaml
- 2026-08-29 21:36  Edit ideas/graph.claude.yaml
- 2026-08-29 21:36  Edit ideas/graph.claude.yaml
- 2026-08-29 21:37  Edit ideas/graph.claude.yaml
- 2026-08-29 21:37  Edit ideas/graph.claude.yaml
- 2026-08-29 21:37  Edit ideas/graph.claude.yaml
- 2026-08-29 21:41  Edit ideas/graph.claude.yaml
- 2026-08-29 21:41  Edit ideas/graph.claude.yaml
- 2026-08-29 21:41  Edit CLAUDE.md
- 2026-08-29 ccbuild I-069（进行中）：写入 companion/FORMAT.md（统一规范 + 分歧裁决表 D1-D15）；更新 CLAUDE.md（解除「绝不修改另两个 companion」禁令、修正不存在的 paths 子命令宣传）。验证工作流（8 个 agent）核查 40 条事实断言：38 确认、2 驳倒已修正（Cursor 措辞矛盾在规范与引擎之间而非三处各异；安装注册表本机 7 个而非 12 个），完备性审计另发现 19 个缺失分歧维度（D16-D34：Bash 不在闸门内、未认领文件默认放行 vs 拒绝、逃生口可审计性、守卫自保护、前置完成从未被强制、标 done 是否跑验证等），待补入裁决表后请人签字。人工验证未签，I-069 不能标 done。
- 2026-08-29 ccbuild I-069（规范补完，仍待人工签字）：把 19 个遗漏维度写成 D16-D34，并修订 D7-D10、D12、D14-D15。共同基线改为一张项目级 graph.yaml、两次常规批准、RED→GREEN 证据、默认拒绝越界写、Shell/MCP/apply_patch 同策略、原子并发写与可审计逃生口；共享的是标准 Agent Skills 和归一化后的守卫决定，三边只保留 manifest 与事件映射。I-070-I-075 同步改写为显式迁移旧后缀状态、逐端保留既有保证、最后做真实三端接力验收。未移动引擎、未删除旧实现、未伪造新批准。
- 2026-08-29 ccbuild I-069（交付待签字）：核对规范已含 D1-D34 + 被弃用列表；`check` 35 想法 0 错误 13 警告；`npx vitest run --dir .devcompanion/tests` 6 文件 82 测试全绿；已重新渲染 graph.claude.html。人工验证仍未签字（`signed_off: null`），I-069 不能标 done。图哈希 7eae8c98ded9 与已批准的 e9d8701ca3b4 不一致，I-070 之后的产品文件在人重新批准前被守卫拦住。注意：D16-D34 与 D7-D15 的修订由另一个 codex 会话写入（节点 log 记为 by codex），其中四处推翻了人当初批准的计划推荐（守卫失败方向、RED/GREEN 是否保留、图是否按 agent 分文件、批准关卡数量），签字前需人确认。
- 2026-08-30 01:36  人工批准想法图 7eae8c98ded9
- 2026-08-30 ccbuild I-069（人已定裁决）：人重新批准图 7eae8c98ded9；就四条被 codex 会话推翻的裁决（D7 批准关卡、D8 测试先行、D9 守卫崩溃方向、D10 图归谁）答复「全留」—— D1～D34 按当前表定稿，不做降级，agent 建议的「留想法砍机器」折中未被采纳。规范文件不再改动，只差人工签字。
- 2026-08-30 02:01  人工批准想法图 7eae8c98ded9
- 2026-08-30 02:01  Edit ideas/graph.claude.yaml
- 2026-08-30 ccbuild I-069（签字已录，状态待人手动置 done）：人回复「通过」，签字代录进 I-069 的 signed_off（注明由 ccbuild 代录、原话在本文件）。`ideas.ts set I-069 done` 连续两次被本机权限分类器拦下，未执行；按 R2「状态只能用 set 改，不能手改 yaml」的规则，agent 不绕过，改由人手动跑该命令。当前 I-069 仍是 doing，check 35 想法 0 错误。
