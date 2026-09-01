# The idea graph — format（共同基座规范）

本文件是所有 companion 的唯一规范：Claude、Cursor、Codex，以及未来接入的任何
agent。2026-08-29 起，概念性调整只改这一份，三边实现跟随本文件。
三套实现之间发现的每一处分歧，都在文末的「分歧裁决表」里逐条裁决 ——
每一行都有三边现状、裁决和理由，没有一条是「就这样吧」。

（迁移状态：引擎与守卫搬入本目录由想法图 I-070～I-074 执行；在那之前，
权威引擎仍在 `claude-companion/` 下运行。本文件先行，作为裁决的落点。）

One canonical file holds project intent: `ideas/graph.yaml`. Runtime evidence,
approval receipts, scan progress, logs, and rendered HTML are generated beside
it; they never become a second source of intent.

Every idea in a project is one node. Every prerequisite is one arrow. There is
no second document, no requirement/feature/module/function hierarchy, no phase
vocabulary. If it isn't in this file, it isn't tracked.

## A node

```yaml
- id: I-014
  name: "追踪每一次修改落在哪个函数上"   # 一句人话 — see "How to write the graph" below
  status: todo                    # todo | doing | done | blocked
  needs: [I-003, I-008]           # prerequisites — the only kind of edge

  what: >
    是什么。这个想法本身是什么、做什么事。
  why: >
    为什么有这个想法。它解决什么问题，不做会怎样。
  expected: >
    预期结果。做完之后，什么是可观察的、说明它成功了。
  how: >
    如何实现。方法、机制、关键步骤。
  why_this_way: >
    为什么这样实现。相对于其它方案，为什么选这一种。
  code:                           # 代码在哪个文件的哪几行
    - file: packages/ast/src/identity.ts
      symbol: computeFunctionIdentity
      lines: "12-48"
  verify:                         # 实现后如何验证它符合 expected
    command: npx vitest run .devcompanion/tests/test_ast_identity.test.ts
    test_files: [.devcompanion/tests/test_ast_identity.test.ts]
    pass: "exit 0"
  future: >
    未来可以如何使用。这个想法解锁了什么。

  log:                            # append-only；谁改了它、为什么
    - date: "2026-08-24"
      by: ccbuild
      note: "implemented; lines 12-48"
```

## How to write the graph

图上只显示名称，而这张图就是项目的入门文档 ——
图里的每一句话，都必须让一个从没打开过这个仓库的人看懂。
四条规则，适用于名称和所有叙述字段：

- **写它做什么，不写它叫什么。** 名称是一句完整的人话，
  动词开头，或者用「主题：一句话说明」的格式。
  「算出现在可以立刻动手做的想法有哪些」，不是「前沿查询」；
  「只有人亲手输入「批准」才能生效的批准机制」，不是「不可伪造的人工批准」。
- **不用任何未经当场解释的项目行话。**
  「八问」→「八个问题」；「平名文件」→「不带后缀的文件」；
  「账本」→「图和记录文件」。需要读过本文件才懂的词，不进图。
- **终点节点以「终点：」开头**，让图本身就能显示一切通向哪里。
- **写明动作的主体。** 「agent 不能用 Write 直接写它们」，不是「不能被写入」。

名称长没有关系 —— `render` 会自动换行。

## The eight questions

| # | 中文 | 字段 |
|---|------|------|
| 1 | 这个想法是什么 | `what` |
| 2 | 为什么有这个想法 | `why` |
| 3 | 预期结果是什么 | `expected` |
| 4 | 要如何实现 | `how` |
| 5 | 为什么要这样实现 | `why_this_way` |
| 6 | 代码在哪个文件的哪几行 | `code` |
| 7 | 实现后如何验证 | `verify` |
| 8 | 未来可以如何使用 | `future` |

**这张表是八个问题措辞的唯一来源。** 规范、命令输出、渲染出来的网页都引用这里的
措辞，不各自另写一版（这曾是三套实现真实发生过的漂移 —— 见裁决表 D11）。

**When each is answered.** 1–5, 7 and 8 are answered *before* any code exists —
that is what makes an idea reviewable. Question 6 is answered twice: `file` and
`symbol` are the plan (where the code *will* go, decided by the discuss Skill),
`lines` are the truth (filled by build once it exists). Debug compares the two.

**`verify` has two forms.** Prefer the first:

```yaml
verify: { command: "npx vitest run tests/x.test.ts", test_files: [tests/x.test.ts], pass: "exit 0" }
verify: { manual: "打开报告，图里每个节点都能点开", signed_off: null }
```

A `manual` check can never be marked `done` by an agent. The approval command
creates a content-bound challenge; a real `UserPromptSubmit` response makes the
runtime fill `signed_off`. Hand-editing `signed_off` is rejected.

## The file

```yaml
version: 1
project: my-project
overview: >
  一段话说清这个项目在做什么。
endpoints: [I-022, I-030]     # 终点：什么叫"这个项目做完了"
next_id: 31                   # 下一个没被用过的编号；只有写回指令能动它
ideas:
  - id: I-001
    ...
```

- **IDs** are `I-NNN`, sequential, **never reused** — not even for an idea that
  was abandoned. An abandoned idea keeps its id and gets `status: blocked` with
  a `log` entry saying why.
  「废弃」和「删除」是两件事，别混：**废弃 = 保留编号、置 `blocked`、log 写明原因**，
  这是想法被否决掉时的正常归宿；**删除（改动文件里的 `remove`）= 真的从图里去掉**，
  用在建错了、重复了这类根本不该存在的节点上。两者都不让编号回收 ——
  `next_id` 只增不减，正是这一点的保证。
- **`next_id`** —— 只增不减的取号计数器。**发号只有一条路径：取这个数，然后加一。**
  基座里会发号的命令（`new`、`apply`）都必须走它，谁都不许再算「最大编号加一」。
  网页只发 `tmp:1` 这样的临时号，真编号在写回时一次性发放并把所有引用到临时号的地方
  同步替换掉；替换完还剩任何一个临时号，整体拒绝落盘。
  **初值是一条规则，不是一个数**：图里还没有这个字段时，由 `migrate` / `apply`
  一次性算成「这张图里出现过的最大编号 + 1」并写入，之后只由发号递增 ——
  写死一个数迟早会和长出去的图对不上，然后重发已经用掉的编号。
  不让谁按当前图算「最大编号加一」，是因为**被删掉的编号谁都看不见**：
  删掉编号最大的那个想法之后，下一次新建就会拿到刚被删掉的那个号；
  两个人各自开着一份网页，也会同时算出同一个新编号，而合并之后没有人会发现。
  这一条是 D5「顺序编号、永不复用」在能增删节点之后的必然推论。
  *（尚未落地：现有的图里都还没有这个字段。Cursor 现行的 `new` 用的正是被这里
  否掉的「最大编号加一」，迁进基座时必须改。）*
- **`endpoints`** are the terminal deliverables. Everything else exists to reach
  one of them. An idea that reaches no endpoint is either dead work or evidence
  of a missing endpoint — `check` will tell you which ideas those are.
- **The graph must be acyclic.** A cycle means two ideas are actually one idea.
  Merge them, keep the lower id, log the merge.
- **The frontier** — `todo` ideas whose `needs` are all `done` — is your
  next-actions list. It falls out of the data; there is no separate TODO file.

## The step overview

每一张想法图都在文件顶层带一份分步概览：这个项目分几步，每一步做完之后项目多了什么能力。
它是打开网页的人读到的第一段话，也是把这张图发给别人看时对方读到的第一段话。

```yaml
steps:
  - name: 记录格式
    blurb: 定下一个想法要回答哪八个问题，并写出读写这些想法的程序。
  - name: 强制执行
    blurb: 让这些规矩由程序执行，而不是靠自觉 —— 没想清楚不许写代码，没写测试不许写实现。
  - name: 日常命令
    blurb: 把建图、想清楚、动手做、查错、看图这五件事，各做成一条命令。

ideas:
  - id: I-001
    step: 记录格式          # 这个想法属于哪一步
    ...
```

- **`steps` 是有顺序的**，顺序就是这个项目做事的先后。每一项两个键：`name` 是一个短名字
  （页面上显示它，想法也用这个词来认领），`blurb` 是一句话。
- **`step`** 写在每个想法上，填某一步的 `name`。填了一个不存在的名字，`check` 报错 ——
  那是确定的笔误，而且会让页面上的数字凭空少算一个。
- **两个字段都是可选的。** 一张还没写概览的图（比如刚建出来的）什么都不报：
  规矩是给想用的人用的，不是拿来罚不用的人的。但**一旦写了 `steps`，就该让每个想法都认领
  一步** —— 没认领的、步数超出范围的、一个想法都没有的空步，`check` 都会提醒。

### 那几句话怎么写

五条规矩。它们才是这一节真正的内容 —— 字段形状是次要的，话写不好的话，
有这个字段和没有一样。

1. **三到七步。** 超过七行的概览不是概览，是目录 —— 人一眼扫不完，也就不会去扫。
   少于三步的项目不需要概览。
2. **每一步一句动词开头的话，说清这一步做完之后这个项目多了什么能力。**
   写「能做什么了」，不写「里面装了哪些东西」。
   - 对：「让人直接在网页上改这张图，改完自动写回项目文件。」
   - 错：「网页编辑相关的十个想法。」
3. **不用任何缩写。**
4. **不用任何需要读过这个仓库才懂的词。** 一个从没打开过这个项目的人，读完这几句
   就该知道它在做什么。项目内部的黑话、模块名、直接搬过来的外语词，都不算数。
5. **给写图的人分类用的筐，不算一步。**

### 第五条为什么要单独说 —— 一个真实的反例

本仓库自己的图里就有三个这样的筐：「已知缺陷」「终点」「阅读顺序」。
照搬进概览会长成这样：

```
第 5 步：已知缺陷（2 个想法，做完 2 个）
第 6 步：终点（3 个想法，做完 0 个）
第 7 步：阅读顺序（2 个想法，做完 1 个）
```

读的人会当场卡住：**「阅读顺序」是这个项目要做的一件事吗？**

不是。它是写图的人给自己分的类。「已知缺陷」同样不是一步，它是个随时会冒出东西的筐；
「终点」是「什么算做完」的定义，不是做的过程。三个都通不过第 2 条 ——
它们说不出「做完之后项目多了什么能力」。

这三个筐里的想法，各自归到它们真正服务的那一步去：修引擎缺陷的归「记录格式」那一步，
修强制层缺陷的归「强制执行」那一步，终点归到它收尾的那一步。

## The change file

人在网页上改一轮图，改动记在一个**信封**里。信封是编辑界面和写回之间的唯一接口 ——
将来换一种编辑界面（别的 agent 的网页、命令行），只要产出同样的信封就能接上同一条链路。

信封有两条送出去的路，装的是同一个东西：有本地服务时走一次请求，没有时落成
`ideas/changes.json` 让人搬过去。**建成情况**：信封本身已经建好（Claude 引擎的网页
现在就把它存进浏览器草稿），提交按钮、写回指令和本地服务都还没有 —— 下面的格式是
给它们用的，随 D28 的命令面一起迁入基座。

```json
{
  "v": 1,
  "project": "D:/GitHub/my-project",
  "baseDigest": "44e6868c7f2e",
  "ops": [
    { "op": "set",    "id": "I-014", "field": "how", "old": "旧的写法", "new": "新的写法" },
    { "op": "status", "id": "I-014", "from": "todo", "to": "doing" },
    { "op": "add",    "tmp": "tmp:1", "fields": { "name": "", "what": "", "why": "", "expected": "" } },
    { "op": "set",    "id": "tmp:1", "field": "name", "old": "", "new": "新想法" },
    { "op": "link",   "from": "I-014", "to": "tmp:1" },
    { "op": "unlink", "from": "I-003", "to": "I-014" },
    { "op": "remove", "id": "I-020" },
    { "op": "sign",   "id": "I-051", "who": "某人", "words": "装过了，五个命令都在" }
  ]
}
```

七种操作，一张表看完：

| `op` | 字段 | 意思 |
|---|---|---|
| `set` | `id` `field` `old` `new` | 改一个字段 |
| `status` | `id` `from` `to` | 改状态 |
| `add` | `tmp` `fields` | 新建一个想法，真编号还没发 |
| `remove` | `id` | 删掉一个想法（对比「废弃」，见上一节的编号规则） |
| `link` | `from` `to` | 给 `to` 加一条前置 `from` |
| `unlink` | `from` `to` | 把 `to` 的前置 `from` 去掉 |
| `sign` | `id` `who` `words` | 给人工验证签字 |

- **`v`** —— 格式版本。对不上就整体拒绝，不要试着「尽量读懂」：半懂的改动文件
  会把图写坏，而写坏图正是这套工具要防的事。版本检查是写回的第一道，排在指纹之前。
- **`baseDigest`** —— 页面被渲染时那张图的 12 位指纹，**原样带回，页面绝不自己算**。
  写回时拿它和当前图的指纹比，对不上说明图在人编辑期间被别的会话改过了，整体拒绝。
  指纹的算法和批准用的是同一个（换行先归一化，再取 sha256 前 12 位），
  所以 CRLF 签出的仓库不会误报。
- **信封里没有令牌。** 本地服务的一次性令牌只走请求本身，下载出来的改动文件永远不带
  令牌 —— 否则一份躺在下载目录里的文件就成了一把可以捡起来用的钥匙。
- **`add` 出来的想法是空的**，内容随后由一串 `set` 补上 —— 网页是先建一张空卡片、
  人再往里填。所以 `fields` 里几个键都在但都是空串。
- **`sign` 落成一句人话**，格式和手工录入的一致：
  `<名字> <日期> —— 人的原话：「<原话>」；在网页上签的`。三种情况写回会拒：
  那个想法的验证不是人工检查、名字或原话是空的、签字栏已经有值（谁能推翻别人的
  签字是另一件要先想清楚的事，暂不覆盖）。
  签的是**一句话**而不是一个勾：勾只能记下「有人点过」，一句话记下的是这个人对
  这件具体事情的判断 —— 而人工验证之所以要人签，正是因为机器判断不了。
  诚实的边界：`signed_off` 今天并不在守卫的保护范围里（拦手改图的规则只比较状态），
  所以这条路没有拆掉任何一道门 —— 那道门本来就没关，堵它是 D7 那条批准机制的事。
- **临时号会出现在四个位置**：`set` 和 `status` 的 `id`、`link` 和 `unlink` 的
  `from` / `to`。写回发放真编号时这四处要一起替换，漏一处就等于剩下一个没人认领的
  临时号，整份文件作废。
- **`ops` 里的引用有先后**：`add` 一定排在引用那个临时号的 `link` 前面。
  但它**不是人的操作流水** —— 同一个字段改两次只留最后一条，位置也随之挪到队尾；
  写回端还会为了安全重排（先改字段、后删节点），只保证不打破上面那层引用关系。
- **边写成「从哪个到哪个」一对**，不是整个 `needs` 列表的新值 —— 同一个想法上的
  两处边改动才不会互相覆盖。
- **每条 `set` 带旧值**。今天写回只有整体指纹这一道锁，旧值是留着的、还没人用；
  它的用处是将来做逐条比对和冲突展示 —— 只带新值的改动文件一遇冲突就只能整体作废。
- **落盘的那条路只在成功时归档**：写回成功之后把文件改名为
  `changes.applied-<日期>.json`；**被拒时原文件原样不动** —— 写回一旦被拒，
  人的改动不能一份都不剩。

记账本自己会把白做的功抵消掉，所以下面这几种情况不会出现在文件里：
字段改回原值的 `set`、连了又断的同一条边、以及新建之后又删掉的临时想法
（连同它身上的每一种操作）。反过来要说清楚：**删掉一个已经落盘的想法，
不会抵消它身上的 `set` 和边操作** —— 那些改动照样留在文件里，由写回在
`remove` 之后作废处理。

不借 JSON Patch（RFC 6902）：它按数组下标定位，而这条链一旦能加节点，下标就全错了。
也不借 JSON Merge Patch（RFC 7396）：它对数组只能整体替换，而且它用 `null` 表示删除，
和这份格式里真实存在的 `signed_off: null` 直接冲突。按编号寻址的操作清单，
语义上对齐 Kubernetes 那套按键合并的先例。

最后一条边界，必须写明：**这个文件不是可信输入**。写回校验的是格式、指纹和图的
完整性，不是「改动来自人」—— 那道保证由批准机制提供（D7），而批准只认人亲手发的消息。
守卫挂在编辑工具上，看不见 Bash，所以一个 agent 完全可以自己写一份改动文件再跑写回；
挡住这条路是批准机制的事，不是这个格式的事。

## Generated files

```
ideas/graph.yaml     ← the only thing you edit
ideas/graph.html     ← generated by `ideas.ts render`, never hand-edit
ideas/log.md         ← append-only record of every change
ideas/changes.json   ← 没有本地服务时，编辑界面下载出来的改动文件（有服务时不落盘）
ideas/.runtime/      ← approval and RED/GREEN evidence; CLI-managed
ideas/.scan-todo     ← files the scan command still owes a read of
```

**The graph belongs to the project, not to an agent.** Claude, Cursor, and Codex
all read and write the same `ideas/graph.yaml`; this is what makes handoff real.
Legacy `graph.claude.yaml`, `graph.cursor.yaml`, and Codex JSON state remain
read-only until an explicit migration chooses or merges them. The installer
never guesses which legacy graph wins.

## The engine

```bash
node companion/dist/companion.mjs check      # 校验：id 唯一、无环、done 必须有当前证据
node companion/dist/companion.mjs next       # 前沿：现在可以做哪些想法
node companion/dist/companion.mjs show I-014 # 一个想法的全部内容 + 前置 + 后继
node companion/dist/companion.mjs set I-014 doing --by build --note "..."
node companion/dist/companion.mjs render     # → ideas/graph.html
```

Every command takes `--file <path>` (default `ideas/graph.yaml`),
and `--project <dir>` (default the current directory). `paths` prints every
resolved canonical and generated path; no command selects state by agent name.

源码和发布产物都只有一份。三个 agent 的 hook 都用子进程调同一个
`dist/companion.mjs`；语言和传输差异停在入口/出口映射，不进入规则核心。

## Why this shape

One node type instead of four levels, because you asked "所有的想法都会变成一个个
模块" — modules, not a taxonomy. One edge type, because "A 是 B 的前置" is the
only relation you named. Eight fields, because those are the eight questions you
listed, in your order. Anything the format does not hold is something you did
not ask for, and adding it later costs one YAML key.

---

# 分歧裁决表

2026-08-29。背景：此前 Claude（TypeScript）、Cursor（TypeScript，从 Claude 侧
复制后各自演化）、Codex（Python，独立设计）三套实现并存，人批准将它们统一到
本目录的共同基座（想法图 I-069～I-075）。合并前，先把每一处分歧裁决清楚 ——
每一条分歧都是当年某一边有意做的决定，不裁决就合并等于随机选边。

**为什么现在统一（推翻 I-059 旧决定的依据）：** 旧决定「不做统一抽象层」的
前提是三个 agent 的 hook 生命周期和承载方式差异太大。现在三边都能在写前、
写后、提交提示和停止时调用本地程序，并用退出码 2 阻断；Codex 还会给
`apply_patch`、Bash 和 MCP 提供可归一化的工具输入。Cursor 的第三方兼容层能把
Claude 事件和响应映射成 Cursor 事件，但需要用户开关和账户能力，所以正式接入
仍使用原生 `.cursor/hooks.json`。三边共享的是归一化后的策略决定，不是假设原始
配置或 JSON 完全相同；这使一份核心代码成为可行的小方案。

每条裁决格式：三边现状 → 裁决 → 理由。逐行可被人否决；否决即回到
/ccthink 重议。

## D1 存储格式

- **现状** — Claude、Cursor：YAML 单文档（`ideas/graph.yaml`），注释保留写回。
  Codex：JSON 一节点一文件（`.codex-companion/nodes/<id>.json`，文件名必须等于 id）。
- **裁决** — YAML 单文档。
- **理由** — 三分之二已在用；八个问题的回答是成段散文，YAML 的块标量比 JSON
  字符串适合人写人读；单文件才能整体做哈希、把批准绑到「这一版图」上
  （Codex 为此需要额外拼快照）；YAML 注释是人留给自己的东西，引擎写回时
  保留它们（JSON 没有注释）。一节点一文件利于并发写，但会把一次规划拆成
  多份难以整体复核的真相；共享单文件的并发风险由 D30 的摘要检查和原子写处理。

## D2 字段命名与形状

- **现状** — 同一概念三套名字：`expected` 对 `expected_result`；顶层
  `how`/`why_this_way` 对嵌套的 `implementation.how`/`implementation.why_this_way`；
  `code: [{file, symbol, lines: "12-48"}]` 对
  `code_refs: [{path, start_line, end_line, role}]`；
  `verify: {command, pass}` 或 `{manual, signed_off}` 对
  `verification: [{id, kind, plan, command, test_paths, status, evidence}]`；
  `future` 对 `future_use`。
- **裁决** — Claude/Cursor 的命名与形状（即上文「A node」一节），自动
  验证额外保留显式 `test_files`，供路径闸门和证据哈希使用。
- **理由** — 两边已用，改一边比改两边便宜；`lines: "12-48"` 一眼可读、
  好手写；`verification` 数组的「一个想法多个检查」能力与单节点原则相抵 ——
  一个想法一个验收，需要多个验收说明想法该拆。不能继续从命令字符串猜测试
  路径：含空格路径、参数和 glob 都会猜错，所以吸收 Codex 的显式测试路径，
  但压成一个 `test_files` 列表，不搬整套 verification 数组。

## D3 边的名字

- **现状** — Claude、Cursor：`needs`。Codex：`depends_on`。
- **裁决** — `needs`。
- **理由** — 两边已用；更短；和「前置」的中文语义直接对应。反向边
  （谁依赖我）三边都是派生的、不落盘 —— 保持一致。

## D4 状态集合

- **现状** — Claude、Cursor：4 个（`todo / doing / done / blocked`）。
  Codex：8 个（`draft / aligned / planned / approved / implementing / blocked /
  done / superseded`），带显式转移表，`aligned` 和 `approved` 只能由批准
  回执产生。
- **裁决** — 4 个。
- **理由** — Codex 多出来的状态把别处已有的事实重复编码进了状态机：
  `aligned`/`planned`/`approved` 等价于「批准文件存在 + 八问哪些填了」，
  两处真相必然漂移；`implementing` 就是 `doing`；`superseded` 就是本规范
  已有的「废弃想法保留 id、置 `blocked`、log 写明原因」。状态越少，
  一眼能判断的东西越多。

## D5 想法编号

- **现状** — Claude、Cursor：`I-NNN` 顺序编号，永不复用。Codex：自由小写
  slug（如 `align-intent`）。
- **裁决** — `I-NNN`。
- **理由** — 顺序号不需要起名，也就不会起错名；「永不复用」让历史引用
  永远有效（log 里提到的 I-014 永远指同一个想法）；slug 的可读性由
  `name` 字段承担，编号不必可读。

## D6 终点（endpoints）

- **现状** — Claude、Cursor：图顶层有 `endpoints` 列表，`check` 对
  「通不到任何终点的想法」发孤儿警告。Codex：没有这个概念，也没有孤儿检测。
- **裁决** — 保留 endpoints 与孤儿警告。
- **理由** — 「这个想法通不到任何终点」是 check 能给人的最有价值的警告
  之一：它要么是死工作，要么是缺了一个终点的证据。Codex 侧没有它的原因
  没有留下记录，找不到反对它的论据。

## D7 批准机制

- **现状** — Claude：批准绑定图内容的 sha256（前 12 位），只有人在
  UserPromptSubmit 事件里发一条整条内容就是「批准」的消息才写入
  `.approved`；`.approved` 文件本身被守卫写保护；图改一个字批准即失效。
  Cursor：没有强制的批准机制（只有提示词层面的约定）。Codex：五个批准
  关卡（intent / decomposition / plan / red-waiver / manual-check），每个
  关卡一次性随机口令（`APPROVE CC-XXXXXXXX`）、待批文件与回执文件、
  内容快照绑定。
- **裁决** — 两个常规关卡：`decomposition` 绑定三问、节点名称和边；`plan`
  绑定完整八问、路径和验证。另保留只在需要时出现的 `red-waiver` 与
  `manual-check`。每次请求产生一次性 challenge，由真实 `UserPromptSubmit`
  消费；内容改变或 challenge 用过即失效。
- **理由** — 一次全图批准太晚，不能证明人看过拆分；五次常规批准又太重。
  两次正好对应 workflow 已经存在的两个真实停点，并保留 Codex 对意外先绿和
  人工验收的证据。批准是内容绑定的 review receipt，不编码进四个工作状态。

## D8 测试先行的强制方式

- **现状** — Claude：R3 规则 —— 想法的测试文件不存在，就不准写它的实现
  文件（只查存在性）。Cursor：无强制（提示词约定）。Codex：完整的
  RED→GREEN 证据链 —— 实现前必须有失败的测试运行记录（含退出码与输出
  尾部），测试文件哈希变了证据作废，意外先绿需要人批 red-waiver。
- **裁决** — 保留 RED→GREEN 证据，但压成每个想法一个小 runtime 文件：
  RED 记录退出码与 `test_files` 哈希；产品写入后 GREEN 过期；`done` 需要
  当前 GREEN。测试意外先绿时走一次 `red-waiver`。
- **理由** — 共同基座的承诺是三边现有保证不回退。仅检查「测试文件存在」
  无法区分真实失败测试和空文件，也会把 Codex 已经能证明的测试顺序丢掉。
  runtime 是生成证据，不是第二份需求状态；四个工作状态仍保持不变。

## D9 守卫崩溃时的方向

- **现状** — Claude：放行（fail-open；代码注释留了理由：a guard that
  crashes must never block work，逃生口 `AIDEV_GUARD=off`）。Cursor：拦下
  （fail-closed，两层保险：hooks.json 的 failClosed 标志 + 脚本 catch 里
  deny；为什么与 Claude 侧相反，没有留下记录）。Codex：混合 —— 写前/
  提示/结束三个钩子拦下，写后记录钩子放行。
- **裁决** — 会阻止副作用的 `PreToolUse`、批准处理和生命周期 `Stop` 失败时
  拦下；已经发生副作用的 `PostToolUse` 记录失败时放行并警告。提供明确、
  可审计的逃生口，见 D25。
- **理由** — 写前崩溃放行会造成不可逆的越界写，Cursor 与 Codex 已经避免了
  这一点；写后记录崩溃再拦也撤不回修改，只会把工作流卡死。按事件区分，既不
  把守卫 bug 伪装成安全，也不把记录器 bug 放大成全仓库停工。

## D10 图归谁、三个 agent 是否共享状态

- **现状** — 三边共享同一条认领约定（裸名空闲就用裸名并写 `agent:` 键，
  被占就加后缀，选择一次固定），但对「存在裸名文件、里面却没有 `agent:`
  键」的裁定不同：Claude 当成别人的；Cursor 当成自己的（为迁移历史遗留
  文件而设的特例）；Codex 对无 agent 字段但 schema 匹配的 project.json
  也当成自己的。
- **裁决** — 新基座只有一份项目级 `ideas/graph.yaml`，不含 `agent:`；三个
  agent 共用图、日志、批准和证据。旧后缀图与 Codex JSON 状态只读，必须由
  显式 `migrate` 选择或合并，安装器绝不自动猜胜者。
- **理由** — 后缀避免覆盖，却制造三份需求真相，无法实现「在三个 agent 之间
  接手同一个项目」。共同 workflow 的状态应属于项目；并发冲突由原子写和内容
  摘要解决，而不是靠复制整张图解决。

## D11 八个问题的措辞

- **现状** — Claude：短版（如「预期结果是什么」）。Cursor：长版（如
  「当这个想法实现了之后要如何验证这个想法就是我想要的预期结果」），且
  自己内部三处（规范、命令输出、网页）互不一致。Codex：编号小节标题。
- **裁决** — Claude 短版；唯一来源是本文件「The eight questions」那张表，
  引擎与渲染引用它，不另写。
- **理由** — 措辞分叉是这次盘点里最直观的漂移证据：连问题本身长什么样
  都有三个版本。裁短版是因为短的好在图和卡片里排版，语义无损。

## D12 扫描覆盖的证明方式

- **现状** — Claude：`.scan-todo` 清单 + R7 规则（只有真实的 Read 事件
  才划掉一行）+ `.scanignore` 排除；清单文件本身被守卫写保护。Cursor：
  无机制（agent 自报读了多少）。Codex：coverage.json 记每文件 sha256 与
  reviewed 时间，但 `reviewed` 是 agent 可调用的命令行子命令。
- **裁决** — Claude 的真实 Read 事件划除，加上 Codex 的内容哈希。文件只有
  被 Read hook 看见且当前哈希未变才算已读；变化后自动回到未读。
- **理由** — Read 事件防自报，哈希防「读完后文件变了还算读过」。两者解决
  不同漏洞，合在一起仍只是一份清单，不需要 Codex 的可手调 `reviewed` 命令。

## D13 修改记录的形式

- **现状** — Claude、Cursor：`ideas/log.md` 人读散文、只追加，另在节点内
  有 `log:` 数组（原因放在想法旁边）。Codex：单文件 NDJSON 事件流，
  节点内无记录。
- **裁决** — Claude/Cursor 版。
- **理由** — 记录是给人读的；「原因要放在想法旁边，放远了就没人读」是
  这套工具自己的存在理由之一。NDJSON 对机器友好，但这个仓库里没有任何
  机器消费者 —— 为不存在的读者优化是反向裁决。

## D14 安装与分发

- **现状** — Claude：install.ts 复制五个命令文件（引擎共享不复制）+
  安装注册表 + `--status`/`--update` 逐字节比对（先归一化换行）。Cursor：
  install.ts 有 copy/link/global/plugin 四种模式，无注册表。Codex：无
  安装器（手动 plugin 市场流程）。
- **裁决** — 一个插件根目录同时放三家的小 manifest，共享同一套标准 Skill、
  引擎和守卫；平台只保留 hook 配置。`install.ts` 负责本地开发、旧安装迁移和
  `--status/--update`，测试必须注入临时注册表，不能读取真实安装清单。
- **理由** — Claude、Cursor、Codex 都已经有 Skill/Plugin 分发层，继续生成
  三套命令文件是在复制协议。原生插件更新负责正式分发；保留注册表只为本机
  现有七个绝对路径安装平滑迁移，不让测试或普通构建改到其它仓库。

## D15 hook 的拦截协议

- **现状** — Claude：退出码 2 + stderr。Cursor：stdout 上的
  `{"permission": "deny"}` JSON。Codex：两种混用（写前钩子输出 Claude 的
  hookSpecificOutput JSON，提示/结束钩子输出 decision/block JSON）。
- **裁决** — 规则核心只返回 `{allow, reason, context}`。入口先把事件归一化，
  出口再按当前事件编码；写前拒绝同时给结构化 JSON 与退出码 2，Stop 使用
  各家支持的 continuation JSON。平台映射是几行函数，不复制规则。
- **理由** — 写前退出码 2 是最大公约数，但 Stop 的含义和 JSON 形状不同；
  把传输协议混进规则会让同一个判断出现三处分支。共享的是决定，不是假装
  三家的每一个 wire field 都相同。

## D16 没有想法认领的产品文件，默认放行还是拒绝

- **现状** — Claude 对未被 `code` 命中的文件放行；Cursor 与 Codex 严格模式
  默认拒绝，只允许当前实现想法声明的产品和测试路径。
- **裁决** — 严格模式默认拒绝；图、日志和明确的 workflow 状态文件走专门规则。
- **理由** — 默认放行意味着漏写一个 `code.file` 就绕过整个 workflow。路径缺口
  应在计划阶段显露，而不是在实现时被当成自由区。

## D17 什么时候可以进入 doing

- **现状** — Claude 的 `set` 不检查八问、前置或批准；Cursor 检查 expected、
  how、verify、code.file、前置完成；Codex 还要求有效 plan approval。
- **裁决** — `todo → doing` 必须八问计划字段齐全、decomposition 与 plan 批准
  当前有效、所有 `needs` 已 done、路径与其它 doing 想法不冲突。
- **理由** — 这些条件都是机器可判定的现有事实；只在提示词里提醒会让图的
  拓扑序和审批在真正写代码时失效。

## D18 是否允许多个想法同时 doing

- **现状** — Claude 没限制；Cursor 允许多个但拒绝文件重叠；Codex 只有一个
  active node。
- **裁决** — 允许多个互不重叠的 doing 想法；守卫按目标路径找到所属想法。
- **理由** — 这保留并行实现能力，同时吸收 Cursor 的冲突保护。全局单 active
  会无谓禁止无关工作；重叠文件并行则无法可靠归属和验证。

## D19 状态转移表

- **现状** — Claude/Cursor 基本允许任意 `set`，只对 doing/done 补条件；Codex
  有完整八状态转移表。
- **裁决** — 四状态的小转移表：`todo → doing|blocked`，`doing → done|blocked`，
  `blocked → todo|doing`，`done → blocked`；其它转换拒绝并要求写明原因。
- **理由** — 状态少不等于没有生命周期。显式小表阻止跳过实现直接 done，也
  保留已完成行为回归后重新打开的真实路径。

## D20 标 done 时是否真的验证

- **现状** — Claude 只检查 verify 字段存在；Cursor 可选择运行命令，`--force`
  可跳过；Codex 要求当前 GREEN、测试哈希和语义记录都未过期。
- **裁决** — `done` 永远要求当前 GREEN 或有效 manual-check receipt，并要求
  最新变更已有语义记录；agent 没有 `--force`。
- **理由** — 不执行的 verify 只是散文。紧急人工放行走内容绑定的 waiver，
  不能留一个 agent 随手可用的永久后门。

## D21 Shell 写入是否经过闸门

- **现状** — Claude/Cursor 的写闸门 matcher 不覆盖 Bash/Shell，脚本和重定向
  能绕过文件工具；Codex 严格模式拦常见 shell mutation 和脚本解释器写入。
- **裁决** — Bash/Shell 进入同一写前策略；允许只读命令、声明的验证命令和
  companion CLI，无法可靠解析目标的 mutation 拒绝。
- **理由** — 只拦编辑工具却放行 `>`、脚本和包管理器，不是路径范围控制。
  规则是 guardrail 而非沙箱，但不能保留最显眼的旁路。

## D22 三家 hook 输入如何归一化

- **现状** — Claude 主要给 `file_path`；Cursor 工具有 path/filePath/uri 等名字；
  Codex `apply_patch` 在 `tool_input.command` 里携带一个或多个补丁路径，MCP 又是
  任意参数对象。
- **裁决** — 入口归一化为 `{event, tool, paths[], operations[], prompt, cwd}`；
  Claude、Cursor、Codex 各一小段纯映射，并共享同一组 fixture 测试。
- **理由** — 官方兼容只保证事件能触发，不保证原始工具参数长得一样。先归一化
  才能让后面的规则真正只有一份。

## D23 写前无法确定目标路径时怎么办

- **现状** — Claude 放行；Cursor 返回 no file path 并拒绝；Codex 严格模式拒绝
  无法解析的写目标或不完整 patch。
- **裁决** — 可能写入但目标未知时拒绝；只读、hosted tool 和明确不产生文件的
  调用不进入这条规则。
- **理由** — 严格路径范围下，unknown 不能等价于 allowed。分类必须基于工具
  能力和事件，不靠「没找到 file_path」这一条粗判断。

## D24 哪些文件和字段由 runtime 保护

- **现状** — Claude 保护 `.approved`、`.scan-todo` 和已有 status；Cursor 锁
  harness，但图和日志全可写；Codex 保护 active、approval、runtime、coverage、
  log 以及节点 identity/lifecycle 字段。
- **裁决** — `.runtime/`、`.scan-todo`、生成 HTML 与自动日志只能由 CLI/hook
  改；图的叙述、边和计划可编辑，已有 id/status 及 manual `signed_off` 只能走 CLI。
- **理由** — agent 能直接写出的证据不叫证据；同时不能把计划散文也锁死，否则
  Discuss/Plan 无法工作。

## D25 逃生口如何工作和记账

- **现状** — Claude 的 `AIDEV_GUARD=off` 静默放行；Cursor 可把图设为
  `enforce:false`；Codex 用受保护的 strict 配置，但没有统一的审计文案。
- **裁决** — 保留父进程环境变量 `AIDEV_GUARD=off` 作为最后逃生口；每个 hook
  都显示醒目警告并尽力追加 `guard.disabled` 记录。图内不设 agent 可改的开关。
- **理由** — 守卫 bug 不能把人永久锁住，但静默关闭会让之后的记录假装强制仍在。
  父进程环境变量需要人在启动工具前设置，普通子命令不能反向修改它。

## D26 批准机制的安全边界

- **现状** — Claude 的固定「批准」可重放，且手工调用 guard 可模拟事件；Cursor
  没有 receipt；Codex 的 challenge 一次性、快照绑定并记录 session/turn。
- **裁决** — 一次性 challenge + 内容摘要 + session/turn 元数据；receipt 文件
  受保护。文档明确它是行为护栏，不是防恶意进程的密码学证明。
- **理由** — challenge 防误重放，摘要防批完偷改；诚实写出边界比宣称 agent
  “绝对无法伪造”更可靠，真正的安全仍靠 hook trust、sandbox、Git 与 CI。

## D27 人工验证如何签字

- **现状** — Claude/Cursor 让人或 agent 填 `signed_off`；Codex 用
  manual-check challenge，由 prompt hook 写 evidence。
- **裁决** — 人工验证只能通过 manual-check challenge，CLI 将签字摘要写回图并
  保存 receipt；直接编辑已有 `signed_off` 被拒绝。
- **理由** — 一个 agent 能编辑的签名不能证明人看过结果。保留图中可读签字，
  同时让它能追溯到不可复用的用户响应。
- **未结的冲突（2026-08-31 记）** — Claude 侧新建了「在网页上给人工验证签字」
  （改动文件的 `sign` 操作，见「The change file」一节）。它产出的正是这条裁决
  要排除的那种签名：agent 也能造一份带 `sign` 的改动文件跑写回。
  它没有比 Claude 的现状更糟（今天直接编辑 yaml 就能写 `signed_off`），
  但它朝这条裁决定的方向走反了一步，是为了让人不必每签一次就绕出网页找 agent 代录。
  **和解的办法在这条裁决里已经写好了**：把网页那一步降级成「提出签字请求」，
  真正落进图的那一下仍然由不可复用的用户响应触发。这件事归批准机制那条想法，
  在它做完之前，网页签字的分量靠的是约定而不是机器 —— 写在这里，免得以后被当成
  已经解决了。

## D28 共享 CLI 的命令面

- **现状** — Claude 有 init/check/next/show/set/render/scan；Cursor 另有 paths、
  new、allow、log；Codex 另有 approval、run-check、status 和 lifecycle 命令。
- **裁决** — 基座提供 `paths init migrate new check status next show set allow scan
  render apply serve request-approval run-check log`；旧命令只做迁移期别名，
  不各留一套实现。`apply` 读改动文件把编辑写回图，`serve` 起本地服务把同一个信封
  接进同一个 `apply`；**会发编号的只有 `new` 和 `apply`，两者都必须从 `next_id`
  取号加一，不许算「最大编号加一」**（见「The file」一节的编号规则 —— Cursor 现行的
  `new` 正是被否掉的那种算法，迁进来时要改）。
- **理由** — `paths` 消除猜文件，`allow` 可在写前自检，approval/run-check 承载
  共同保证；`apply` / `serve` 是「改图即改项目」那条链在基座里的落点，没有它们
  「网页和写回之间的唯一接口」就没有消费者。其余命令覆盖完整 workflow，
  继续增加同义词没有价值。

## D29 扫描哪些文件，以及读后变化怎么办

- **现状** — Claude 使用 Git tracked + untracked + ignore 过滤；Cursor 自报范围；
  Codex 优先 Git tracked/unignored，记录二进制与内容哈希。
- **裁决** — Git 仓库扫描 tracked 与未忽略 untracked；非 Git 才遍历文件系统。
  vendor/generated/binary 明确列入 skipped 及原因；文本哈希变化后重新未读。
- **理由** — 只扫 tracked 会漏掉正在开发的新文件，只遍历会吞进依赖目录；
  skipped 必须可见，不能把「没读」包装成「不存在」。

## D30 写图、日志和 runtime 时如何防并发丢失

- **现状** — Claude 临时文件 rename，但扫描清单曾发生并发丢写；Cursor 有
  Windows rename 回退；Codex 原子 replace，一节点一文件降低冲突。
- **裁决** — 所有生成状态原子写；图 mutation 带读取时 digest，落盘前不一致就
  拒绝重放；append log 使用进程锁或单次原子追加；Windows 有显式 replace 回退。
- **理由** — 共享一张图后，静默 last-writer-wins 会丢人的计划。摘要冲突比重新
  引入每 agent 副本更小，也让冲突在发生处可见。

## D31 计划路径和测试路径的语法

- **现状** — Claude 精确匹配 code.file，并从命令字符串猜测试文件；Cursor 做
  后缀匹配和简单通配；Codex 使用受项目根约束的 glob target_paths/test_paths。
- **裁决** — 所有路径为项目相对 POSIX 路径，不得含 `..`；`code.file` 是精确
  文件，`verify.test_files` 支持精确路径与受限 glob。绝不从 command 猜路径。
- **理由** — 明示路径才能同时支持空格、多个测试和跨平台分隔符；根目录约束
  防止一个计划无意解锁项目外文件。

## D32 code 行号是否验证

- **现状** — Claude/Cursor 验证 done 的文件存在，但基本不验证 `lines`；Codex
  验证一基、闭区间且不超过文件长度。
- **裁决** — done 必须有可解析的 `start-end`，起点至少 1、终点不小于起点且
  不超过当前文件行数；纯文档或生成物节点可用 manual verify 明确豁免代码引用。
- **理由** — `/debug` 依赖精确引用；只验证文件存在会让过期行号继续被当成事实。

## D33 workflow 用命令副本还是共同 Skill

- **现状** — Claude 是五个 commands；Cursor 是五个 Agent Skills；Codex 是一个
  Skill 加 workflows reference。
- **裁决** — 共同基座保留五个标准 Agent Skills：onboard、discuss、build、debug、
  graph；共用正文和 references，各平台 manifest 直接指向同一目录，不生成改写版。
- **理由** — 三家都能承载 SKILL.md；Claude 的 commands 已是兼容旧入口。直接
  共享文件比「生成三份看起来一样的文件」少一层，也避免称谓和步骤再次漂移。

## D34 运行时与依赖如何分发

- **现状** — Claude 从绝对路径用 `npx tsx` 跑源码；Cursor 复制 TypeScript 并
  npm install；Codex 用无第三方依赖的 Python 脚本。三种方式的更新和前置不同。
- **裁决** — TypeScript 仍是唯一源码，发布时把引擎、yaml 解析和守卫打成一个
  `dist/companion.mjs`；运行只需 `node`，不调用 npx、不现场下载依赖。安装时先
  检查 Node，缺失就明确失败，不静默降级成另一套实现。
- **理由** — 单文件产物保留现有 TypeScript 基体，又消除目标仓库 npm install、
  绝对源码路径和网络依赖。为没有 Node 的环境另写 Python 副本会重新制造本次要
  消灭的漂移；真有需求时应增加独立打包目标，而不是第二套业务逻辑。

## 裁决之外：被弃用但值得记住的想法

这次明确不吸收的：Codex `code_refs.role`、一个想法多个 verification 对象、
八个工作状态、每 agent 一份图，以及 Cursor 的长期 `enforce:false` 图内开关。
被弃用实现保留在 git 历史；迁移完成并通过三边验收前，不删除任何旧引擎。
