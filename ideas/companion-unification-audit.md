# 共同基座统一审计

日期：2026-09-01  
仓库：`D:\GitHub\ai-companion`  
性质：只读审计落盘，不改产品代码、测试、`FORMAT.md` 或想法图。

审计依据：`companion/FORMAT.md`（D1–D34）、根目录 `CLAUDE.md`、`ideas/graph.claude.yaml` / `ideas/log.claude.md`（I-069–I-075、I-088–I-099）、`ideas/graph.yaml`（Cursor 遗留图）、三家 README，以及 `companion/` 源码与 `.devcompanion/tests/test_base_*.test.ts`。没有单独的「共享基座设计文档」；计划就是规范 + 想法图。

---

## 执行摘要

共同基座已经不是纸面计划：`companion/` 里有一份引擎、一份守卫、三家薄映射、五份共用 Skill、单文件打包脚本和安装器，对应想法 I-088–I-099 / 里程碑 I-070–I-072 在图上标为 **done**。规范承诺「吸收三家最强保证、不取最小公分母」，代码大体按这个方向做了：Claude 的 YAML 图 / 扫描 / 渲染 / apply·serve，Cursor 的开工检查 / next_id / 默认拒绝 / failClosed，Codex 的一次性口令批准和 RED→GREEN。

**当前生产路径没有切过去。** 本仓库 Claude 仍跑 `claude-companion/guard.ts`（`.claude/settings.json` 里写死本机绝对路径）；Cursor 仍跑 `.cursor/hooks/gate.mjs`；Codex 仍跑 Python `codex-companion/scripts/companion.py`。`package.json` 的 `graph` 脚本仍指向 Claude 引擎。这符合「先做新版本、不碰现网」的意图。

真正的隔离漏洞不在 hook 接线，而在**文件名**：新引擎只认 `ideas/graph.yaml`，但这个文件已经是 Cursor 2026-08-24 的 26 节点旧图（`agent: cursor`，I-001 还在 `doing`）。活的统一计划在 `ideas/graph.claude.yaml`（约 59 个节点，终点含 I-075）。对这个仓库跑 `npx tsx companion/ideas.ts next`（不带 `--file`）会操作错图。`migrate` 看见已有 `graph.yaml` 会直接拒绝，且它只找 `graph.cursor.yaml`，找不到这份裸名 Cursor 图。

I-073 / I-074 / I-075 仍是 **todo**（前沿上）。在真实 Cursor/Codex 验收并迁图之前，不能把共同层当日常入口。另外，网页/apply/serve 仍在改 `claude-companion/ideas.ts`（I-080 为 `doing`；2026-09-01 的草稿面板修复**没有**搬进 `companion/ideas.ts`），两份引擎已经开始分叉。

---

## 文档实际裁了什么

**唯一规范：** `companion/FORMAT.md`。2026-08-29 推翻旧 I-059「不做统一抽象层」。当时未提交的 8 行改动只是把 D33 技能名改成 `ccscan/ccthink/ccbuild/ccfix/ccgraph`。

**图上的统一线：**

| ID | 角色 | 状态 |
|---|---|---|
| I-069 | 写出 D1–D34 | done |
| I-088–I-092、I-099 | 引擎：无后缀图、readiness、批准、证据、migrate、缺口收口 | done |
| I-093–I-094 | 规则核心 + 三家 normalize/encode | done |
| I-095–I-098 | Skill、bundle、manifest、install | done |
| I-070 / I-071 / I-072 | 上述三组的里程碑 | done |
| I-073 / I-074 | Cursor / Codex 真机接入 + 迁图 | **todo** |
| I-075 | 终点：三家接力同一张图，改一处三边生效 | **todo** |
| I-059 | 改写成「三家共用一张图」（推翻旧决定后） | **todo**，与 I-075 部分重叠 |

**裁决要点（落地与否见后文）：**

- **D1–D6 / D11 / D13：** YAML 单文件、Claude 字段名、四状态、`I-NNN`、`needs`、endpoints、短版八问、`log.md` + 节点内 log。
- **D7 / D26 / D27：** 两道常规关卡（decomposition / plan）+ 按需 red-waiver / manual-check；一次性口令，不是整句「批准」。网页 `sign` 与 D27 的冲突**仍标未结**。
- **D8 / D20：** RED→GREEN，不是「测试文件存在即可」；done 要当前 GREEN，没有 `--force`。
- **D9 / D25：** 写前/Stop/批准崩溃则拦；写后记录崩溃则放行；逃生口只有 `AIDEV_GUARD=off`，图内不要 `enforce:false`。
- **D10：** 项目级 `ideas/graph.yaml`，无 `agent:`；旧后缀图只读，安装器不准猜赢家。
- **D14–D15 / D22 / D34：** 一份 `dist/companion.mjs`；平台只留 hook 接线；规则返回 `{allow, reason}`，出口再编码。
- **D16–D21：** 未认领产品文件默认拒绝；doing 要计划齐全 + 批准 + 前置完成 + 文件不重叠；允许多个不重叠 doing；Bash 进同一闸门。
- **D28：** CLI 面包含 `paths init migrate new check status next show set allow scan render apply serve request-approval run-check log`。
- **D31 / D32：** `test_files` 显式路径（可受限 glob）；done 要可解析行号且不超过文件长度。
- **明确不吸收：** Codex 八状态、`code_refs.role`、一想法多 verification、每 agent 一张图、Cursor 图内 `enforce:false`。

规范头仍写「权威引擎在 `claude-companion/`，I-070–I-074 执行前本文件先行」——对 I-070–I-072 已过时，对 I-073/I-074 仍对。`next_id` 旁注「现有图还没有这个字段」对两张活图都仍成立。

---

## 实现地图

| 能力 | `companion/`（新） | Claude 现网 | Cursor 现网 | Codex 现网 |
|---|---|---|---|---|
| 引擎 | `companion/ideas.ts`（约 2953 行） | `claude-companion/ideas.ts`（仍被 hook / `npm run graph` 调用） | `cursor-companion/ideas.ts` + 已装副本 `.cursor/companion/ideas.ts` | Python `scripts/companion.py` |
| 守卫 | `companion/guard.ts`：`decide` + 三对 normalize/encode | `claude-companion/guard.ts`：R1–R7，写前 fail-open，未认领默认放行 | `gate-lib.mjs`：fail-closed、`enforce`/`exempt`、无批准/RED | hooks → Python：apply_patch、五关卡、RED/GREEN |
| 图路径 | 只认 `ideas/graph.yaml` | `ideas/graph.claude.yaml`（本仓库活账本） | `ideas/graph.yaml`（26 节点旧图） | `.codex-companion/nodes/*.json` |
| 批准 | `.runtime/` 一次性口令 | `.approved.claude` + 整句「批准」绑全图哈希 | 无 | pending/receipt JSON，五关卡 |
| 测试先行 | `run-check` + 变更计数器 | 只查测试文件存在 | 提示词约定 | 完整 RED→GREEN |
| Skill/命令 | `companion/skills/cc*` | `.claude/commands/cc*.md` | `.cursor/skills/idea-*`（含 **idea-record**） | 一个 Skill + workflows.md |
| 安装 | `companion/install.ts`（测过临时目录；**未装进本仓库**） | `claude-companion/install.ts` + `.installs.json` | copy/link/global/plugin 四种模式 | 无安装器，走 plugin 市场 |
| 产物 | `companion/build.mjs` → `dist/companion.mjs`（gitignore 的 `dist/` 会吃掉它；工作树里当时没有现成产物） | `npx tsx` 绝对路径 | 复制 TS + npm install | 无第三方依赖的 Python |

接线生成在 `companion/manifests.ts`：三家都调 **同一相对路径** `.claude/companion/companion.mjs`。Skill 测试还**强制**正文出现这串路径（`.devcompanion/tests/test_base_skills.test.ts`）。对 Cursor/Codex 能跑，但会在目标仓种出一个 `.claude/` 目录。

---

## 三家长处：吸进了什么、漏了什么

**已吸收（且有测试）：**

- Claude：YAML 注释写回、扫描 Read 划除 + 内容指纹（I-099）、Stop 时 `check`、apply/serve 信封、渲染网页。
- Cursor：`isBuildReady` / `needsUnmet` / `fileClash`、四状态转移表、`next_id` 发号、默认拒绝、hooks `failClosed`、SessionStart 简报（**仅 Claude 接线**调 `status`；Cursor/Codex 的 SessionStart 仍进 `guard`，I-097 日志写明留给 I-073）。
- Codex：两道内容绑定批准、RED→GREEN、shell 三层正则、apply_patch 逐文件、MCP 写入、写前 fail-closed / 写后 fail-open、Codex 回包永不 `ask`。

**部分吸收 / 和规范不一致：**

- **D17** 写 todo→doing 要 decomposition+plan 批准都有效。`setStatus` 只查八问/前置/文件冲突（I-089）；plan 批准卡在**写实现文件**时（`decideProductWrite`）。Skill `ccbuild` 也按「先进 doing，写实现才批」来写。规范严、代码松。
- **D31** 允许 `test_files` 受限 glob；匹配是精确 `sameFile`。
- **D32** done 行号只 warning「没有 lines」，不验 `start-end`、不比对文件行数。
- **D28** 的 `log` 子命令不存在（Cursor 有）。usage 默认字符串还漏了 `migrate` / `request-approval` / `run-check`。
- **D30** `apply` 有 `baseDigest`；`set`/`new` 的 `save()` 只有 pid 临时文件 rename，并发 CLI 仍是后写覆盖。
- **I-092 expected** 说把批准和 RED/GREEN 一并迁进 `.runtime/`；`migrate()` 只转 YAML/JSON 节点，**不搬证据文件**。
- **I-097 how** 写了 Claude `ConfigChange`；`manifests.ts` 没有。
- 清单 matcher 含 `PowerShell`，`normalizeClaude` 只把 `Bash` 当 shell；PowerShell 会落成 `other` → **放行**。

**有意不抄（保持）：** 八状态、每 agent 一张图、图内 `enforce:false`、`code_refs.role`、多 verification 数组、Codex `intent` 关卡、Codex「渲染指纹没更新不许收尾」（I-070 记了裁量：用自动 render + Stop check 代替）。

**漏掉、以后也不该整包搬进来的 Cursor/Codex 特性：**

- Cursor **`idea-record`**：第六个技能；D13 已用 `log.md` + 节点 log 覆盖。不要为了「五条工作流」再复制一套。
- Cursor **`exempt:` / harness 锁 / 路径后缀匹配**：和 D16/D31 对着干。本仓库靠 `exempt: cursor-companion/**` 才能改 harness——共同层改成「想法 `code.file` 认领」，切换后这个 exempt 会失效。
- Cursor 安装器的 copy/link/global/plugin 四模式：D14 收成「复制一份 bundle」。link/global 体验没了，但是有意的。
- Codex 一节点一文件、NDJSON 事件流、agent 可调的 `reviewed`：D1/D12/D13 否掉。
- Codex 的「无 Node 也能跑」：D34 否掉第二套业务逻辑。

**Skill 正文变薄了：** Cursor `idea-debug` 要求「先列出带行号的对照、停下来问人再改」；`ccfix` 只保留精神，弱了「必须停下来给人看」和行号对照表。`idea-build` 的 `--all` / 并行 subagent 说明也没完整进来。这是文案问题，不是规则核心问题。

---

## Hook / 适配器分层

分层是对的：**策略只看归一化事件；三家只有入口出口。** 没有 adapter 类树。`allow` 与守卫共用 `decideProductWrite`（I-099），避免「引擎说能写、守卫说不能」。

缺口：

1. 现网 Claude PreToolUse **不含 Bash**；共同层加上了。切流后会突然拦住重定向/解释器一行流——方向对，但是行为变化。
2. Cursor 现网闸门**没有** `beforeShellExecution` / `beforeSubmitPrompt` / `stop`；共同层有。切流后 Cursor 会严一截（批准消费、Stop check、shell）。
3. Codex 现网 matcher 无 `mcp__`；共同层有。这是补洞，切流前要在真 Codex 上 `/hooks trust`（I-074）。
4. 守卫读图硬编码 `ideas/graph.yaml`。本仓库若误接共同守卫，会按 **Cursor 旧 26 节点图** 判读写，而不是 `graph.claude.yaml`。
5. `claude-companion` 仍 fail-open；共同层写前 fail-closed。切 Claude 时，守卫自己崩会从「放行」变成「锁死」（有 `AIDEV_GUARD=off`）。

---

## 「新版本不影响现网」——隔离是否成立

**对现网 hook：基本成立，前提是不要把安装器对准本仓库。**

未切的证据：

- `.claude/settings.json` → `npx tsx "D:/GitHub/ai-companion/claude-companion/guard.ts"`
- `.cursor/hooks.json` → `node .cursor/hooks/gate.mjs`
- Codex 插件 → `python …/companion.py hook …`
- `package.json` `test` 只是多跑 `test_base_*`；`graph` 仍是 Claude `serve`
- 三家源码目录按计划保留到 I-073/I-074 验收后

**会碰到现网的改动（审计当时已发生）：**

- `claude-companion/ideas.ts`：网页草稿面板 bugfix（I-077 代码，服务现网 `serve`）。**未同步到 `companion/ideas.ts`（没有 `restore-warn`）。**
- `ideas/graph.claude.yaml` / `log.claude.md`：统一工作的账本，这是预期。
- `package.json` 增加 `esbuild`：开发依赖，不改运行时接线。

**切流或误操作才会炸的点：**

| 风险 | 路径 | 后果 |
|---|---|---|
| 对本仓库跑 `companion/install.ts .` | `install.ts` 会 **merge** 进 `.claude/settings.json`、`.cursor/hooks.json`、`.codex/hooks.json` | 双守卫；新守卫读错图；旧 Claude 绝对路径 hook 可能仍在 |
| 不带 `--file` 跑新引擎 | `companion/ideas.ts` → `ideas/graph.yaml` | 操作 Cursor 旧图，统一账本纹丝不动 |
| `migrate` 本仓库 | `graph.yaml` 已存在 → 拒绝；且不识别裸名 Cursor 图为 `graph.cursor.yaml` | I-073 的 how 按「迁 graph.cursor.yaml」写，**对本仓库不成立** |
| 根 `.gitignore` 的 `dist/` | `companion/dist/` 被忽略 | 安装器要求先 `node companion/build.mjs`；产物不会进 git |
| `companion/.installs.json` **未** gitignore（只 ignore 了 `claude-companion/.installs.json`） | 本机绝对路径可能被提交 | |

结论：目录并行是对的；**本仓库已经占用了新引擎的规范文件名。** 这不是「以后迁移才有的问题」，是现在跑新 CLI 就会踩的坑。

---

## 规范 vs 代码漂移（FORMAT / 裁决表）

1. 文首「权威引擎仍在 claude-companion」——核心已搬，接线未搬。
2. D17 批准时机 ≠ `set doing`。
3. D28 `log` 命令、D31 glob、D32 行号硬校验、D30 CLI digest：未做或只做了一半。
4. I-072 的 `verify.command` 仍指向 `.devcompanion/tests/test_ideas_graph.test.ts`（测的是 **claude-companion**），不是 `test_base_skills/bundle/manifests/install`。里程碑靠子想法测试收口，verify 字段是错的。
5. `test_change_envelope.test.ts` / `test_ideas_apply.test.ts` / `test_ideas_serve.test.ts` / 一串 `test_render_*.test.ts` 仍 `import` **claude-companion**。网页链在 Claude 引擎上继续演化，共同层会落后。
6. `check()` 还不认识 `steps`（I-085 仍 todo）；FORMAT 已有「分步概览」整节。
7. 两张图都没有 `next_id`。

---

## 测试覆盖

约 **115** 条新测试，按想法对齐，质量不错（临时目录、不碰真注册表、三家同事件同判、安装冒烟要退出码 2）。

| 文件 | 证明了什么 |
|---|---|
| `test_base_engine.test.ts`（10） | 只读写裸名图，不碰后缀诱饵；`paths`；Windows 反斜杠 |
| `test_base_readiness.test.ts`（17） | 缺字段/前置/重叠拒 doing；转移表；next_id |
| `test_base_approval.test.ts`（10） | 口令一次性、散文不消费、内容漂移作废、两关卡独立、manual-check 写回 |
| `test_base_evidence.test.ts`（9） | RED 真失败、意外先绿、测试改动作废、GREEN 过期、done 门 |
| `test_base_migrate.test.ts`（7） | 三种旧格式、双图停下、`--pick`、dry-run、已有 graph.yaml 拒绝 |
| `test_base_guard_rules.test.ts`（19） | D16/D7/D8/D21/D23/D24/D9/D25 |
| `test_base_adapters.test.ts`（12） | 三家同判、三种回包、apply_patch、MCP、Codex 不 ask、E2E 退出码 2 |
| `test_base_skills.test.ts`（13） | frontmatter、无三家源码路径、**强制** `.claude/companion/companion.mjs` |
| `test_base_bundle.test.ts`（4） | shebang、无 node_modules 可跑、可重复构建 |
| `test_base_manifests.test.ts`（4） | 无绝对路径、Claude exec+占位符、Cursor failClosed、Codex 稳定命令串 |
| `test_base_install.test.ts`（5） | 合并不清场、幂等、不覆盖已有图、status/update、临时注册表 |
| `test_base_gap_closures.test.ts`（5） | 后缀图只读、扫描指纹、allow=守卫 |

**没测到、切流前会疼的：**

- 本仓库这种「裸名 `graph.yaml` 其实是 Cursor 图」的 migrate
- 批准回执 / RED 证据随 migrate 搬家
- PowerShell / Cursor SessionStart 简报
- `apply`/`serve`/渲染在 **companion** 上（测试还钉在 Claude 引擎）
- D32 行号、D31 glob、set doing 的批准
- 真 Cursor / 真 Codex hook（I-073/I-074 的事）
- 旧 `test_ideas_guard.test.ts` 仍测 Claude 守卫（默认放行等），**不能**当共同层回归

---

## 按优先级的剩余工作

### P0 — 在把共同层当日常入口之前

1. **本仓库双图，先归档再 migrate**
   `ideas/graph.yaml`（Cursor 旧 26 节点）挡住规范路径；活账本是 `ideas/graph.claude.yaml`。需要显式改名/归档 + `--pick claude`（或先手工合并）。I-073 的 how 写 `migrate graph.cursor.yaml`，对本仓库是错的。
   **完成：** `migrate --dry-run` 能指出两份真相；人选定后只有一份可写 `graph.yaml`；旧文件字节不变。

2. **不要对本仓库跑 `companion/install.ts`，直到上一款完成**
   安装器会把三家 hook merge 进现网 settings。
   **完成：** I-073/I-074 先在临时仓库验收；本仓库切流是另一次显式 update。

3. **停掉双引擎分叉，或规定单向同步**
   `claude-companion/ideas.ts` 仍在改（I-080 `doing`，当天的 restore 面板修复）。`companion/ideas.ts` 已缺这处修复。apply/serve 测试仍 import Claude。
   **完成：** 网页/信封要么只改 `companion/`，要么每次 bugfix 必须搬过去；`test_ideas_apply/serve/render_*` 改指向 `companion/ideas.ts`。

4. **I-073 / I-074 真机验收（图上已有，未做）**
   代码里的 fixture ≠ 产品 hook。Cursor 要关第三方 Claude 兼容仍能拦写；Codex 要 `/hooks trust` 后 apply_patch/Bash/MCP。
   **完成：** 节点上的 manual `signed_off`。

### P1 — 切流时行为才可信

5. **D17 对齐：** 改规范承认「批准卡在写实现」或 `set doing` 检查 decomposition+plan。现在 FORMAT 和 `setStatus` 打架。文件：`companion/FORMAT.md` D17、`companion/ideas.ts` `setStatus`、`.devcompanion/tests/test_base_readiness.test.ts`。

6. **`migrate` 搬 `.runtime` 证据**（I-092 expected vs 实现）。否则 I-074「RED/GREEN 不得丢失」只对空项目成立。文件：`companion/ideas.ts` `migrate`、`.devcompanion/tests/test_base_migrate.test.ts`。

7. **Claude PowerShell 变成 shell 事件**（或从 matcher 拿掉 PowerShell）。文件：`companion/guard.ts` `normalizeClaude`、`companion/manifests.ts`。

8. **gitignore `companion/.installs.json`**；想分发产物就不要让根目录 `dist/` 一口吞掉 `companion/dist/`。

9. **FORMAT 文首 + I-072 verify.command** 改成与事实一致，避免下一个 agent 以为引擎还没搬、或跑错测试就标里程碑绿。

10. **Cursor SessionStart 简报**接到 `status`（I-097 已记遗留）。文件：`companion/manifests.ts` `cursorHooks`。

### P2 — 应做，不挡切流

11. D32 行号校验；D31 glob（若真要，不要静默只做精确匹配）。
12. D28 `log` 子命令；补全 usage。
13. `set`/`new` 的 digest 冲突（D30）。
14. Skill 里引擎路径改成中性（例如 `node companion.mjs` + 安装器注入），不要把 `.claude/` 写进「平台无关」正文。
15. 把 Cursor debug「带行号对照、先给人看」补回 `ccfix`（文案，不是新机制）。
16. 合并或分清终点 **I-059 与 I-075**（都是三家一张图；I-075 多了「改一处规则三边生效」）。
17. I-085/I-087（`steps` 校验）与共同引擎的关系：现在只在 Claude 图上，迁图后会丢或重复做。

---

## 建议补的想法节点（图上还没有的缺口）

I-073/I-074/I-075 已经覆盖「真机接入 + 接力验收」。还缺的是更小、更可验的节点：

1. **处理本仓库已占用的 `ideas/graph.yaml`：** 把 Cursor 旧图改名为 `graph.cursor.yaml`（或归档），让 `migrate` 按 D10 停下给人 `--pick`，而不是「已存在，无事可做」。这是 I-073 在本仓库的前置，how 写错了。
2. **指定单一网页引擎：** 冻结 `claude-companion/ideas.ts` 的 apply/serve/render，或规定只改 `companion/` 再回拷。否则 I-080 会继续制造分叉。
3. **D17 规范/代码二选一**（上面 P1.5），避免切流后「为什么没批也能 set doing」。
4. **migrate 携带批准与红绿证据**（对照 I-092 expected 和 I-074）。
5. 可选：PowerShell 归一化、Skill 引擎路径中性化、I-059/I-075 终点去重。

不要新开「重写引擎」或「再抽象一层 adapter framework」。现有「一个 `decide` + 六个小函数」是对的。

---

## 不要抄进共同层的东西

- Codex 八状态 / slug id / 一节点一文件 / NDJSON
- Cursor `enforce:false`、`exempt`、按后缀匹配解锁文件
- Claude 未认领文件默认放行、写前守卫崩溃放行
- 每 agent 一张图（I-050 已 done，但是被 D10 取代；别在共同层复活 `nameIsTaken`）
- 网页 `sign` 当可信人工签字（D27 未结：应降成「提出签字请求」）
- 为 Cursor/Codex 再生成一套改写过的 Skill 正文

---

## 总判

共同基座作为**新版本源码**已经可测、可装进空仓库；作为**本仓库或任何已有三家安装的替换物**还不能用。下一步不是继续堆抽象，而是：(1) 解开 `graph.yaml` 撞名，(2) 停掉 Claude/共同层双引擎分叉，(3) 按 I-073/I-074 在临时仓库切流验收。现网 Claude/Cursor/Codex 在不跑新安装器、不把 hook 改过去之前，仍然走旧实现。
