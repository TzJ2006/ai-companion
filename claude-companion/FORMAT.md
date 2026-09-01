# The idea graph — format

One file holds everything: `ideas/graph.yaml`.

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

**When each is answered.** 1–5, 7 and 8 are answered *before* any code exists —
that is what makes an idea reviewable. Question 6 is answered twice: `file` and
`symbol` are the plan (where the code *will* go, decided by `/ccthink`), `lines`
are the truth (filled by `/ccbuild` once it exists). `/ccfix` compares the two.

**`verify` has two forms.** Prefer the first:

```yaml
verify: { command: "npx vitest run tests/x.test.ts", pass: "exit 0" }
verify: { manual: "打开报告，图里每个节点都能点开", signed_off: null }
```

A `manual` check can never be marked `done` by a machine. It stays open until a
human writes their name and the date into `signed_off`. That is the whole rule.

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
- **`next_id`** —— 只增不减的取号计数器。**发号只有一条路径：取这个数，然后加一。**
  网页只发 `tmp:1` 这样的临时号，真编号在写回时一次性发放并把所有引用到临时号的地方
  同步替换掉；替换完还剩任何一个临时号，整体拒绝落盘。
  **初值是一条规则，不是一个数**：图里还没有这个字段时，由写回一次性算成
  「这张图里出现过的最大编号 + 1」并写入，之后只由写回递增 —— 写死一个数迟早会
  和长出去的图对不上，然后重发已经用掉的编号。
  不让谁按当前图算「最大编号加一」，是因为**被删掉的编号谁都看不见**：
  删掉编号最大的那个想法之后，下一次新建就会拿到刚被删掉的那个号；
  两个人各自开着一份网页，也会同时算出同一个新编号，而合并之后没有人会发现。
  *（尚未落地：现有的图里都还没有这个字段，`init` 也还不写它 —— 它随写回指令一起到来。）*
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

人在网页上改一轮图，改动记在一个**信封**里。信封是网页和写回之间的唯一接口 ——
将来换一种编辑界面（别的 agent 的网页、命令行），只要产出同样的信封就能接上同一条链路。

信封有两条送出去的路，装的是同一个东西：有本地服务时走一次请求，没有时落成
`ideas/changes.json` 让人搬过去。**建成情况**：信封本身已经建好（网页现在就把它存进
浏览器草稿），提交按钮和写回指令还没有 —— 下面的格式是给它们两个用的。

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
| `remove` | `id` | 删掉一个想法 |
| `link` | `from` `to` | 给 `to` 加一条前置 `from` |
| `unlink` | `from` `to` | 把 `to` 的前置 `from` 去掉 |
| `sign` | `id` `who` `words` | 给人工验证签字 |

- **`v`** —— 格式版本。对不上就整体拒绝，不要试着「尽量读懂」：半懂的改动文件
  会把图写坏，而写坏图正是这套工具要防的事。
- **`baseDigest`** —— 页面被渲染时那张图的 12 位指纹，**原样带回，页面绝不自己算**。
  写回时拿它和当前图的指纹比，对不上说明图在人编辑期间被别的会话改过了，整体拒绝。
  指纹的算法和批准用的是同一个（换行先归一化，再取 sha256 前 12 位），
  所以 CRLF 签出的仓库不会误报「图被改过了」。
- **`add` 出来的想法是空的**，内容随后由一串 `set` 补上 —— 网页是先建一张空卡片、
  人再往里填。所以 `fields` 里几个键都在但都是空串，不要以为新建时内容就齐了。
- **`sign` 落成一句人话**，格式和手工录入的一致：
  `<名字> <日期> —— 人的原话：「<原话>」；在网页上签的`。三种情况写回会拒：
  那个想法的验证不是人工检查、名字或原话是空的、签字栏已经有值（谁能推翻别人的
  签字是另一件要先想清楚的事，暂不覆盖）。
  签的是**一句话**而不是一个勾：勾只能记下「有人点过」，一句话记下的是这个人对
  这件具体事情的判断 —— 而人工验证之所以要人签，正是因为机器判断不了。
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

最后一条边界，必须写明：**这个文件不是可信输入**。写回校验的是格式、指纹和图的
完整性，不是「改动来自人」—— 那道保证由批准机制提供，而批准只认人亲手发的消息。

## Generated files

```
ideas/graph.yaml     ← the only thing you edit
ideas/changes.json   ← 没有本地服务器时，网页提交下载出来的改动文件（有服务器时不落盘）
ideas/graph.html     ← generated by `ideas.ts render`, never hand-edit
ideas/log.md         ← append-only record of every change (requirement 5)
ideas/.approved      ← the graph hash a human signed off on
ideas/.scan-todo     ← files /ccscan still owes you a read of
```

**A repo can host more than one agent's companion.** Claude, Codex and Cursor
all want `ideas/graph.yaml`, and whoever writes second would destroy the first.
So the rule is **claim the plain name if it is free, suffix it if it is not**:

```
ideas/graph.yaml            free  → Claude takes it, and stamps `agent: claude` inside
ideas/graph.yaml            taken → Claude uses ideas/graph.claude.yaml
                                    and .approved.claude / .scan-todo.claude / log.claude.md
```

First to arrive keeps the clean name; nobody ever overwrites anybody. The choice
is made once and sticks, because the suffixed file existing is itself the answer.

The `agent:` key at the top of a graph is **not decoration** — it is how a graph
says whose it is. A plain `graph.yaml` with no `agent:` key is treated as
somebody else's, because assuming otherwise is how you clobber their work.

## The engine

```bash
npx tsx <companion>/ideas.ts check      # 校验：id 唯一、无环、done 的节点必须有 code+verify
npx tsx <companion>/ideas.ts next       # 前沿：现在可以做哪些想法
npx tsx <companion>/ideas.ts show I-014 # 一个想法的全部内容 + 前置 + 后继
npx tsx <companion>/ideas.ts set I-014 done --by ccbuild --note "..."
npx tsx <companion>/ideas.ts render     # → ideas/graph.html
```

Every command takes `--file <path>` (default `ideas/graph.yaml`) and
`--project <dir>` (default the current directory).

## Why this shape

One node type instead of four levels, because you asked "所有的想法都会变成一个个
模块" — modules, not a taxonomy. One edge type, because "A 是 B 的前置" is the
only relation you named. Eight fields, because those are the eight questions you
listed, in your order. Anything the format does not hold is something you did
not ask for, and adding it later costs one YAML key.
