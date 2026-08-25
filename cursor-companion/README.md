# Cursor Companion — 怎么用

这是一个装进 Cursor 的 **AI harness**。每个想法是图上的一个节点；Agent 必须按节点走，不能跳过对齐直接改产品代码。

不是旧的 ECL / `/ccplan`。不要和那套混用。

---

## 0. 装一次

在 **ai-companion 仓库根目录** 执行。需要 Node，以及 `npx tsx`。

```bash
# 装进当前仓库（已经装过就不用再装）
npx tsx cursor-companion/install.ts .

# 装进另一个项目（默认拷贝，目标项目自包含）
npx tsx cursor-companion/install.ts D:\path\to\your-project

# 多个项目共用这一份源码
npx tsx cursor-companion/install.ts D:\path\to\your-project --link

# 技能装到 ~/.cursor/skills/，每个 Cursor 窗口都能看到
npx tsx cursor-companion/install.ts D:\path\to\your-project --global
```

装完后 **新开一个 Agent 对话**（hooks / skills 才稳定加载）。

目标项目里会出现：

| 路径 | 作用 |
|---|---|
| `ideas/graph.yaml` | 想法图。若这个名字已被 Claude/Codex 占用，则改用 `ideas/graph.cursor.yaml` |
| `ideas/graph.html` | 可视化（后缀跟 yaml 走） |
| `ideas/log.md` | 流水账（占用时为 `log.cursor.md`） |
| `.cursor/skills/idea-*` | 五个 slash skill |
| `.cursor/hooks/gate.mjs` | 写代码闸门 |

---

## 1. 日常流程（按这个顺序）

```
看懂仓库     对齐新想法      实现          对不上就修
/idea-onboard → /idea-discuss → /idea-build → /idea-debug
                      ↑ 记录一直在写 ideas/log.md
```

在 Cursor Agent 输入框打 `/`，选对应 skill。

### `/idea-onboard` — 第一次，或隔了很久再进项目

Agent 通读仓库，抽出想法，写成图。

你要做的：

1. 回答「这个项目怎样算做完了」（1～3 个终点）。
2. 打开 `ideas/graph.html` 看图。节点只显示**名字**；点进去是八个问题、前置、后继。
3. 看报告里「没答上的 `why_this_way` / `expected` / `verify`」——那是下一步讨论清单。

这一步**不能改产品代码**。闸门会拦。

### `/idea-discuss` — 你有一个新想法

Agent 必须先和你对齐三件事（高层次，不要一上来就设计）：

1. 要做什么
2. 预期结果是什么
3. 为什么要做这个事情

对齐之后才会拆成更小的节点、画图给你审。你点头之后，它才调研（**能借鉴现成的就借鉴**）、写「如何实现 / 为什么这样实现」、设计测试（先不写测试文件）、按周出计划。

你要做的：每一步停下来时，看图、看 plan，说通过或改。**不要在这一步让它写业务代码。**

### `/idea-build` — plan 通过了，开始做

按图的拓扑序，一次一个节点：

1. `set <id> doing`（没填 `how` / `expected` / `verify` / `code.file`，或前置没完成，引擎会拒绝）
2. **先写测试**（必须先红）
3. 再写 `code` 里声明的那些文件
4. 跑通 `verify.command`
5. `set <id> done`（会**真的跑**验证命令；失败就不能标完成）

闸门只开放当前 `doing` 节点声明过的文件。想改别的文件会被挡住。

没有参数：做当前能做的前沿（前置都已 `done` 的 `todo`）。`--all` 一直做到前沿空了或卡住。指定 `I-014` 只做那一个。

### `/idea-debug` — 验证失败，或你觉得实现不对

两步，不能跳：

1. **代码 vs 文档**：每一处不一致都要带行号。你决定是改代码还是改想法。
2. 若代码已经按文档做了：拿出**真实**输入/输出，让你改想法本身。

改代码前同样要 `set doing`，否则闸门不放行。

### 记录

不用专门记。改文件会进 `ideas/log.md`；`set` / discuss 也会追加。想补一句原因：`/idea-record`。

---

## 2. 每个想法节点有什么

图上只显示名字。点开（或 `ideas.ts show I-014`）是这八问：

1. 这个想法是什么
2. 为什么有这个想法
3. 预期结果是什么
4. 要如何实现
5. 为什么要这样实现
6. 代码在哪个文件的哪几行
7. 做完如何验证就是预期结果
8. 以后怎么用

A 是 B 的前置 → 箭头从 A 指向 B。字段说明见 [FORMAT.md](FORMAT.md)。

---

## 3. 闸门（Agent 不听话时会发生什么）

| 它想做的事 | 结果 |
|---|---|
| 没 `doing` 就 Write/StrReplace 产品代码 | 被 hook 拒绝 |
| `doing` 了但改的不是该节点的 `code` / 测试文件 | 拒绝 |
| `how` 等没填就 `set doing` | 引擎报错 |
| 前置没做完就 `doing` | 引擎报错 |
| 验证命令没过就 `set done` | 引擎报错，状态不变 |
| 改本 companion 的账本（`graph.yaml` 或 `graph.cursor.yaml` 等） | 允许 |
| 卸掉 `.cursor/hooks/gate.mjs` | 不允许 |

你自己在编辑器里打字**不受拦**。闸门只拦 Agent 的 Write/StrReplace/Delete。

Agent 用终端 `echo > 文件` 仍可能绕过。看到它这么干就停。

紧急关闭闸门：

```bash
npx tsx .cursor/companion/ideas.ts enforce off
```

打开：`enforce on`。不要当作默认。

---

## 4. 你自己常跑的命令

都在项目根目录。没装过则把路径换成 `cursor-companion/ideas.ts`。

```bash
npx tsx .cursor/companion/ideas.ts check          # 图是否合法
npx tsx .cursor/companion/ideas.ts next           # 现在能做哪些
npx tsx .cursor/companion/ideas.ts show I-014     # 一个想法的八问 + 前后置
npx tsx .cursor/companion/ideas.ts paths          # 这份账本实际用哪个文件
npx tsx .cursor/companion/ideas.ts render         # 生成匹配的 graph.html
npx tsx .cursor/companion/ideas.ts allow src/a.ts # 这个文件现在能不能被 Agent 改
npx tsx .cursor/companion/ideas.ts set I-014 doing --by me --note "开始"
npx tsx .cursor/companion/ideas.ts set I-014 done  --by me --note "验证过了"
```

`set done` 会执行该节点的 `verify.command`。只有你明确要求时才用 `--force`（日志会记 `FORCED`）。

---

## 5. 看图

```bash
npx tsx .cursor/companion/ideas.ts render
```

用浏览器打开 `ideas/graph.html`（需要能加载 jsDelivr 上的 mermaid）。颜色：绿=完成，蓝=进行中，灰虚线=待办，橙=受阻，紫=终点。

---

## 6. 这个仓库 vs 其它项目

当前 **ai-companion** 仓库在 `ideas/graph.yaml` 里写了 `exempt: cursor-companion/**`，否则 Agent 连 harness 源码都改不了。

你自己的项目里 **不要抄这段 exempt**。默认 `enforce: true`、`exempt: []`，产品代码全锁，这才是 harness。

---

## 7. 最短路径（新项目）

```text
1. npx tsx cursor-companion/install.ts <项目路径>
2. 用 Cursor 打开那个项目，新开 Agent 对话
3. /idea-onboard          → 审 ideas/graph.html
4. /idea-discuss 某某     → 对齐三问 → 审拆图 → 审周计划
5. /idea-build            → 一个节点一个节点做
6. 红了就 /idea-debug
```

中间你只需要看图、回答问题、说通过或不通过。不要让 Agent 在 discuss 阶段写业务代码；闸门也会拦，但你先口头拦住更快。
