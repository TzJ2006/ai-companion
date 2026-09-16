# The idea graph — format（共同基座规范）

本文件是所有 companion 的唯一规范：Claude、Cursor、Codex，以及未来接入的任何
agent。2026-08-29 起，概念性调整只改这一份，三边实现跟随本文件。
三套实现之间发现的每一处分歧，都在文末的「分歧裁决表」里逐条裁决 ——
每一行都有三边现状、裁决和理由，没有一条是「就这样吧」。

**迁移状态（2026-09-02）**：引擎、守卫、三家接线和安装器都已经在本目录 ——
`companion/ideas.ts`、`companion/guard.ts`、`companion/manifests.ts`、
`companion/install.ts`，发布出去的是单文件产物 `companion/dist/companion.mjs`。
本文件描述的就是这几份代码。

**代码搬完了，本文件写下的事情还没有全部落地 —— 这份清单要和下面的裁决表对得上，
所以逐条列出，不写「只剩一件」：**

1. **本条从前写错了：本检出装着守卫，而且在跑。** 2026-09-05 曾按用户要求把本仓库和
   这台机器上其它仓库里的全部安装卸载归档，当天又装了回来 —— 三份接线
   （`.claude/settings.json` 的五个 hook 事件、`.cursor/hooks.json`、
   `.codex/hooks.json`）、两处技能副本（`.claude/skills/`、`.agents/skills/` 各五个）、
   单文件产物 `.companion/companion.mjs` 和它旁边的 `FORMAT.md`，今天都在位。所以
   本文件描述的守卫行为在这个检出里今天是生效的 —— 它真的拦命令。装和卸都是显式
   动作（`npx tsx companion/install.ts <目标仓库>`），不会自动发生。`archive/` 现在
   是个空目录，没有 `archive/retired-20260905/` 这个去向。这一条不是一处未落地的
   缺口，留在第 1 位只是不打乱下面的编号。
2. Cursor 收不到读文件事件（接线缺 `beforeReadFile`）—— 见 D22。
3. 旧命令一个别名都没建 —— 见 D28。
4. `verify.test_files` 的受限通配符没做，今天只做精确比对 —— 见 D31。
5. 「纯文档或生成物节点用人工验证豁免代码引用」没做 —— 见 D32。
6. `check` 还不校验 `verify.command` 是不是单条命令（守卫和 `run-check` 两扇门都
   在执行前拦，图却照收）—— 见 D21。

`claude-companion/FORMAT.md` 曾是一份被同时手改的孪生规范，一度冻结成一块指路牌，
2026-09-05 随 `claude-companion/` 整个目录一起**删除**，只留在 git 历史里：它那三条
和本文件相反的规则 —— 人手写 `signed_off`、验证不写显式测试路径、裸名被占就按
agent 加后缀各存一份图 —— 一律以本文件的 D27、D2、D10 为准。今天没有任何技能或
命令文件按名字指着它：技能只说「读引擎旁边的 FORMAT.md」，也就是
`.companion/FORMAT.md`；别的仓库里若还留着旧命令文件，那条路径现在指空了。

One canonical file holds project intent: `ideas/graph.yaml`. Runtime evidence,
approval receipts, scan progress, logs, and rendered HTML are generated beside
it; they never become a second source of intent.

Every idea in a project is one node. Every prerequisite is one arrow. A node may
sit under another node (`parent`): that is containment — a tree, at most seven
wide at any level, so a reader opens the project one layer at a time (see "The
tree") — not a second relation between ideas, and it carries no phase vocabulary.
There is no second document. If it isn't in this file, it isn't tracked.

## A node

```yaml
- id: I-014
  name: "追踪每一次修改落在哪个函数上"   # 一句人话 — see "How to write the graph" below
  status: todo                    # todo | doing | done | blocked
  needs: [I-003, I-008]           # prerequisites — the only dependency edge
  parent: I-002                   # the idea this sits under; absent = top level

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
  *（落地情况 2026-09-02：`new`（`addIdea`）和 `apply`（`applyChanges`）都已经
  从 `next_id` 取号加一，字段缺失时按上面这条规则一次性算出初值再写进图。旧图里
  没有这个字段是正常的，第一次发号就会补上。）*
- **`endpoints`** are the terminal deliverables. Everything else exists to reach
  one of them. An idea that reaches no endpoint is either dead work or evidence
  of a missing endpoint — `check` will tell you which ideas those are.
- **The graph must be acyclic.** A cycle means two ideas are actually one idea.
  Merge them, keep the lower id, log the merge.
- **The frontier** — `todo` ideas whose `needs` are all `done` — is your
  next-actions list. It falls out of the data; there is no separate TODO file.

## The tree

每个想法可以归在另一个想法下面：`parent` 填上一级想法的编号，没有 `parent` 的就是
顶层。这样整张图就是一棵树，人从顶层的几个想法读起，点进哪一个，就只看它下面那一层。

```yaml
ideas:
  - id: I-107
    name: 记录格式                # 顶层想法：没有 parent
    what: 定下一个想法要回答哪八个问题，并写出读写这些想法的程序。
    ...
  - id: I-041
    parent: I-107                 # 归在「记录格式」下面
    ...
```

- **`parent` 是包含，不是先后。** 先后关系只有 `needs` 一种，两者互不代替：一个想法
  可以 `needs` 别的顶层想法下面的某个想法，页面上会把它画成一条跨页的前置链接。
- **每一层最多七个。** 顶层最多七个想法，任何一个想法直接下面最多七个子想法。多了就
  再分一层，不要往下加。少于七个不凑数。
- **`check` 的四条规则。** `parent` 指向不存在的编号是错误；`parent` 成环（含指向
  自己）是错误 —— 两样都会让页面丢想法。顶层超过七个、某个想法的直接子想法超过七个，
  是警告 —— 不好读，但不算错。没有 `parent` 的想法什么都不报：顶层本来就没有。
- **页面。** 一个 HTML 文件，按地址里的 `#编号` 切页：首页只有顶层想法的依赖图和一行
  一个的精简卡片；点进一个想法，页面顶部是它自己的八问，下面是它子想法的依赖图和精简
  卡片；再点进去是下一层。每个想法的完整卡片只出现在它自己的页面上。依赖图只画同一页
  的兄弟之间的 `needs`，跨页的前置在卡片里以链接出现。

### 顶层想法的名称和「是什么」怎么写

四条规矩。顶层想法是打开网页的人读到的第一行字，也是把这张图发给别人看时对方读到的
第一行字。

1. **名称是一个短名字，`what` 是一句动词开头的话，说清这一步做完之后这个项目多了
   什么能力。** 写「能做什么了」，不写「里面装了哪些东西」。
   - 对：「让人直接在网页上改这张图，改完自动写回项目文件。」
   - 错：「网页编辑相关的十个想法。」
2. **不用任何缩写。**
3. **不用任何需要读过这个仓库才懂的词。** 一个从没打开过这个项目的人，读完顶层这几行
   就该知道它在做什么。项目内部的黑话、模块名、直接搬过来的外语词，都不算数。
4. **给写图的人分类用的筐，不算一个顶层想法。**

### 第四条为什么要单独说 —— 一个真实的反例

本仓库自己的图里曾有三个这样的筐：「已知缺陷」「终点」「阅读顺序」。
照搬成顶层想法会长成这样：

```
已知缺陷（2 个子想法，做完 2 个）
终点（3 个子想法，做完 0 个）
阅读顺序（2 个子想法，做完 1 个）
```

读的人会当场卡住：**「阅读顺序」是这个项目要做的一件事吗？**

不是。它是写图的人给自己分的类。「已知缺陷」同样不是，它是个随时会冒出东西的筐；
「终点」是「什么算做完」的定义，不是做的过程。三个都通不过第 1 条 ——
它们说不出「做完之后项目多了什么能力」。

这三个筐里的想法，各自归到它们真正服务的那个顶层想法下面去：修引擎缺陷的归
「记录格式」，修强制层缺陷的归「强制执行」，终点归到它收尾的那一个。

**来历。** 这一节的前身是「分步概览」（`steps` / `step`，I-082/I-085/I-087，
2026-09-03 落地）：一个顶层的步骤列表加每个想法上的一个标签，只有一层，页面上也没画。
2026-09-05 按用户要求改成可以逐层点开的树，`steps` / `step` 两个字段删除，原来的
五个步骤变成五个顶层想法（I-107 到 I-111）。

## The change file

人在网页上改一轮图，改动记在一个**信封**里。信封是编辑界面和写回之间的唯一接口 ——
将来换一种编辑界面（别的 agent 的网页、命令行），只要产出同样的信封就能接上同一条链路。

信封有两条送出去的路，装的是同一个东西：有本地服务时走一次请求，没有时落成
`ideas/changes.json` 让人搬过去。**建成情况（2026-09-02）：都已建成。**
信封、写回指令（`apply`）和本地服务（`serve`）都在基座里，两条路最后走的是同一个
`applyChanges` —— 它是一个纯函数，输入是（图的文本，信封），输出是新文本或者一句
拒绝的理由，磁盘由命令行去碰。

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
| `sign` | `id` `who` `words` | 请求给人工验证签字（写回不落签字，只发口令） |

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
- **`sign` 只提出请求，写回不落签字（D27）。** `applyChanges` 把每一个 `sign`
  带出来当作请求，`requestSignatures` 把它变成一次 manual-check 一次性口令；
  `verify.signed_off` 要等人整条消息回一句「批准 CC-XXXXXXXX」，才由
  `applyApproval` 写进图，写的那句话指向回执文件。三种情况写回当场拒绝：那个想法的
  验证不是人工检查、名字或原话是空的、签字栏已经有值（谁能推翻别人的签字是另一件
  要先想清楚的事，暂不覆盖）。
  签的是**一句话**而不是一个勾：勾只能记下「有人点过」，一句话记下的是这个人对
  这件具体事情的判断 —— 而人工验证之所以要人签，正是因为机器判断不了。网页上写的
  原话跟着口令一起显示给人看，让人签的时候看见自己要签的是哪一句。
  两道门今天都关着：一个 agent 可以自己写一份带 `sign` 的改动文件，但写不出人的
  那一句回答；手改图里已有的 `signed_off` 也会被守卫拦下（`ruleGraphEdit` 比对
  改动前后的签字栏）。
- **网页改不出 `done`，也改不到生命周期字段。** `status` 里 `to: done` 整体拒绝：
  完成要有当前有效的 GREEN 证据，而证据在磁盘上，纯函数的写回读不到它（D20）。
  `set` 只认名称、六段散文和 `parent`（`name` `what` `why` `expected` `how`
  `why_this_way` `future` `parent` —— `parent` 是编号不是散文，按一行原样写）——
  `status`、`verify`、`code`、`log` 是生命周期，只走命令行（D24）。
  一个例外方向：改了已完成想法的行为字段（`what` `expected` `how` `why_this_way`
  `verify`），那个想法自动退回 `blocked`，测试先行和人工批准对它重新生效。
- **临时号会出现在五个位置**：`set` 和 `status` 的 `id`、`link` 和 `unlink` 的
  `from` / `to`，以及 `parent` 的值 —— `set` 一个想法的 `parent` 为 `tmp:N`，或新建想法
  的 `fields.parent`（I-129，2026-09-06：从前只换前四处，「新建一层、把几个想法归进去」
  一次写回就做不到）。写回发放真编号时这五处要一起替换，漏一处就等于剩下一个没人认领的
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
守卫同时挂在编辑工具和 Bash 上（D21），但改动文件不在受保护文件之列、`apply` 又是
放行的引擎子命令，所以一个 agent 完全可以自己写一份改动文件再跑写回；
挡住这条路是批准机制的事，不是这个格式的事。

## Generated files

下面这份清单的**前七条**就是引擎里 `paths()` 返回的七个字段 —— `graph`、`html`、
`log`、`worklist`、`done`、`approved`、`runtime`；`paths` 子命令把这七条原样打印
出来，谁都不必猜文件名。

**第八条是例外，写明白而不是假装没有：** `ideas/changes.json` 不在 `paths()` 里。
`apply` 在没被指定文件名时自己拼一次（`join(IDEAS_DIR(projectDir), "changes.json")`），
归档名再由它改后缀得到，所以 `paths` 打印不出它，`paths()` 也就还不是唯一发路径的
地方。要么把它并进 `paths()` 让那句话成真，要么这段脚注就得一直留着 —— 两条路都行，
唯独不能再写「这份清单和 `paths()` 是同一份东西」。

```
ideas/graph.yaml     ← the only thing you edit
ideas/graph.html     ← generated by `render`, never hand-edit
ideas/log.md         ← append-only record of every change
ideas/.scan-todo     ← 扫描清单：`scan` 写一次，写的是曾经在清单上的全部文件
ideas/.scan-done     ← 只追加：每一次真实的 Read 划掉一行（路径 + 内容哈希）
ideas/.approved      ← 旧的整图批准回执。新的批准都在 .runtime/ 下，这个名字今天
                       只保留写保护，引擎不再写它
ideas/.runtime/      ← 每个想法的红绿证据（<id>.json）；只由命令行和 hook 产生，
                       只属于这台机器。2026-09-10 之前的口令（pending/）和回执
                       （approvals/）也在这里，引擎继续读它们，不再往这里写
ideas/approvals/     ← 一次性口令（pending/）和批准回执（receipts/）；**进 git**，
                       让一处检出请的批准能在另一处回答、回执再回来（I-138）；
                       和 .runtime/ 一样只由命令行和 hook 产生
ideas/changes.json   ← 没有本地服务时，编辑界面下载出来的改动文件；写回成功后
                       改名成 changes.applied-<日期>.json，被拒时原样不动
```

**The graph belongs to the project, not to an agent.** Claude, Cursor, and Codex
all read and write the same `ideas/graph.yaml`; this is what makes handoff real.
Legacy `graph.claude.yaml`, `graph.cursor.yaml`, and Codex JSON state remain
read-only until an explicit migration chooses or merges them. The installer
never guesses which legacy graph wins.

## The engine

```bash
node .companion/companion.mjs check      # 校验：编号唯一、无环、done 有 code 和 verify、
                                         #   code 指的文件真的存在、扫描清单还剩几个
node .companion/companion.mjs next       # 前沿：现在可以做哪些想法
node .companion/companion.mjs show I-014 # 一个想法的全部内容 + 前置 + 后继
node .companion/companion.mjs set I-014 doing --by build --note "..."
node .companion/companion.mjs render     # → ideas/graph.html
```

**`check` 只校验图自己说不说得通，它不看红绿证据。** 「完成前必须有当前有效的
GREEN」那道门在 `set <id> done` 上（D20），不在 `check` 上 —— 图是意图，证据在
`ideas/.runtime/` 下，一张图搬到别的机器上、证据没跟过去，它照样应该校验得过。
`check` 的完整清单就是上面注释里那几条，加上「通不到任何终点」和「八问没答」
这类警告。

**引擎在哪：** 装进目标仓库之后是 `.companion/companion.mjs` —— D14 的宿主中立
插件根目录，加上 D34 的单文件产物；技能正文一律只写这一种写法。在本仓库的源码
检出里，同一份代码是 `companion/dist/companion.mjs`（`node companion/build.mjs`
打出来的），源码入口是 `npx tsx companion/ideas.ts`。

每条命令都接 `--project <dir>`（默认当前目录）。`--file <path>`（默认
`ideas/graph.yaml`）**只有九条只读命令接**：`check`、`next`、`show`、`log`、
`status`、`render`、`allow`、`paths`、`scan`。**其余命令会改状态，只认项目
自己那张图**，`--file` 指到别处一律拒绝并退出 2 —— 批准口令和红绿证据都记在
项目图名下（走 `paths(projectDir)`，从不走 `--file`），让写命令跟着 `--file`
跑，就会造出「对着一张图发口令、对着另一张图作答」的东西（D10：项目只有一张图）。
`paths` prints every resolved canonical and generated path; no command selects
state by agent name.
`paths`、`init`、`migrate`、`scan` 在图还不存在时也能跑 —— 它们正是用来把图弄
出来的；其余命令先加载图，加载不了就报错退出。

源码和发布产物都只有一份。三个 agent 的 hook 都用子进程调同一个
`dist/companion.mjs`；语言和传输差异停在入口/出口映射，不进入规则核心。

## Why this shape

One node type instead of four levels, because you asked "所有的想法都会变成一个个
模块" — modules, not a taxonomy. One edge type, because "A 是 B 的前置" is the
only relation you named; `parent` (2026-09-05) is not a second relation — it says
where an idea is filed so the page can be read one layer at a time, and puts
nothing between A and B that `needs` does not. Eight fields, because those are the eight questions you
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
- **补充（2026-09-05）** — `parent` 不是边。它是包含关系（这个想法归在哪个想法
  下面），只决定页面上从哪一层点进去看到它；先后关系仍然只有 `needs` 一种。

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
- **裁决（2026-09-05 修订）** — 一道常规关卡 `plan`，按想法绑内容：摘要盖住这个
  想法自己的 `name`、`parent`、`needs` 和八问，其中 `code` 只到 `file` 和 `symbol`
  （不含 `lines`），`verify` 不含 `signed_off`。`status`、`log`、别的想法，都不在
  摘要里。一条口令可以点名几个想法，人回一句就都批了；回执里每个想法各存一份摘要，
  各自有效、各自失效，没有继承。另保留只在需要时出现的 `red-waiver` 与
  `manual-check`。每次请求产生一次性 challenge，由真实 `UserPromptSubmit` 消费；
  口令用过一次即失效，被批的内容改了即失效；不按时间失效，不按会话失效。
- **理由** — 原来的 `decomposition` 关卡绑整张图的名称、边和前三问，任何一个想法
  新建、改名、改前三问都让它作废，四天里重批了六次，人不知道自己在批什么。`lines`
  是 ccbuild 实现完写回的，`signed_off` 是签字口令写回的，两样进摘要的结果是
  「实现完就把刚批的计划作废」。批准的意思是「这个目标和这份方案我看过了」，内容
  不变就一直有效 —— 这才是人对「批准」两个字的理解。批准仍是内容绑定的 review
  receipt，不编码进四个工作状态。
- **落地** — 回执格式 v2：`{ v: 2, gate, snapshots: { "I-101": "…" } }`。v1 回执
  （`node_ids` + 一份 `snapshot`）不再被读，2026-09-05 随归档搬走。
- **修订（2026-09-16，I-146）：`plan` 关卡不再是任何一道门的条件。** 用了十一天的
  真实感受是：每一个小想法都要口令，改一个字口令就作废，加一行文档和改守卫核心一样贵。
  人对「守卫」的期待其实只有一句 —— 检查写的东西和八问是否一致；而 hook 没有模型，
  能机器判定的一致只有第六问的 `code.file` 和第七问的 `verify.test_files`，那正是
  D16 的认领检查，本来就在。所以：`set doing` 不再要批准（D17 修订）、写文件不再重查
  批准、`run-check` 和守卫放行声明的 verify.command 也不再看批准（D21/D28 的「必须是
  一条命令」照旧）。放弃的是「代理写代码之前一定有人看过计划」这条硬保证，换成软的：
  人随时打开渲染出的网页看，不对就 `set <id> todo` 叫停。`request-approval`、
  `ideas/approvals/`、`POST /approve` 和 `manual-check` 签字全部保留 —— 手工验收
  「结果对不对」仍由人一句话定，那不是批计划；`red-waiver` 随 D8 修订一起失去用处，
  命令留着不删，等确认没人想念再清。D26 的安全边界原样：批准从来就是行为护栏，不是
  防恶意进程的证明，拆掉它没有让任何原本靠 hook trust、sandbox、Git 与 CI 守的东西变弱。

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
- **修订（2026-09-16，I-146）：RED 不再挡在实现之前。** 写实现文件不再要求先有一次
  失败记录，`run-check --phase green` 也不再等 red。留下的是 D20：`done` 必须有当前
  有效的 GREEN，实现每改一笔、测试每变一次都要重跑。放弃的是「测试真的先于实现」这条
  证据 —— 代理可能先写实现再顺着实现补测试。之所以还是拆：对改配色、整理脚本、清洗数据
  这类想法，「先写会失败的测试」经常是硬凑，代理为了过闸写一条必败的空测试，闸形同虚设
  只剩麻烦。先红后绿从此是 ccbuild 的建议做法，红记录照样能留、照样会记，只是不再拦人。

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
- **插件根目录定在哪（2026-09-02 补裁，已落地）** — 目标仓库根下的
  `.companion/`，引擎是 `.companion/companion.mjs`，规范文件跟着引擎装在
  `.companion/FORMAT.md`（技能正文说的「读引擎旁边的 FORMAT.md」就是它）。
  这个相对路径在 `manifests.ts` 里写成一个常量 `ENGINE_RELATIVE`，引擎、守卫、
  安装器和三份接线都读它；五条技能正文是 Markdown，读不了常量，写的是字面量，由
  `test_base_skills` 把那个字面量钉在常量上。理由有两条：`.claude/` 里放
  一个 Cursor 和 Codex 也要跑的文件，在只用其中一家的仓库里就是一个没人认领的
  目录；更要紧的是接线指错路径的后果不对称 —— Cursor 那边 failClosed（整个仓库
  被拒），Codex 那边 node 退出 1 被当成「失败但不阻断」（每一次写都无人看管地
  通过）。一个常量只写一处，才不会出现某次搬家之后有一半接线还指着旧地方。
- **技能文件是复制两份，不是指同一个目录（已落地，与 D33 的措辞有出入）** —
  安装器把每个 `SKILL.md` 同时写进 `.agents/skills/<名字>/` 和
  `.claude/skills/<名字>/`。理由写在 `install.ts` 里：Windows 上没开开发者模式时
  git 会把符号链接签出成一个文本文件，一条静默坏掉的技能比两份靠 `--update`
  保持同步的相同文件更糟。两份内容逐字相同，不是「生成改写版」，D33 反对的是后者。

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
- **落地情况（2026-09-02）** — 已落地。规则核心产出的是
  **`{allow, reason, warn, message}` 四个字段**（`guard.ts` 里的 `Verdict`），
  三个 `normalizeX` 入口、三个 `encodeX` 出口也全在 `companion/guard.ts` 里：写前
  拒绝同时给 `hookSpecificOutput` JSON 和退出码 2；Cursor 读的是 stdout 上的扁平
  permission 对象，退出码永远 0；Codex 的 Stop 走 `{decision:"block"}`，而它的
  PreToolUse **只发 allow/deny 不发 ask** —— Codex 把 ask 当成 hook 失败，然后把
  工具跑掉，发 ask 等于静默放行。
  **第四个字段 `message` 是说给人听的话，不是裁决**（批准回执、会话简报），
  只在**放行**时出现；送到哪儿由各家 `encode` 决定：Claude 和 Codex 写 stdout
  （退出码 0 时宿主把它读进会话），Cursor 的 prompt 事件包进 `agent_message`、
  session 事件包进 `additional_context`。**规则核心和守卫入口都不许自己往 stdout
  打字** —— 直接打印的那一版把纯文本打在了 Cursor 的 JSON 前面，一条流上出现两份
  文档，Cursor 一份也读不出来。「话走哪条线」是出口的事，规则只管把话交出来。
- **会话开始事件（2026-09-02 定案并落地）** — 三家接线都有一个会话开始钩子，
  作用是把 `status` 的状态表送进上下文，让每次会话一开始就知道图长什么样。
  当初的两种读法，取的是第一种：**给规则核心加一类 `session` 事件，由守卫自己
  产出简报**。落地的样子是 `guard.ts` 里的 `sessionBriefing()` —— 它不重写一份
  状态文案，而是就地调 `status` 并把它打印的内容捕获下来（第二份同样的文案就是
  第二份要跟着改的东西，见 D22）；图还不存在或读不动时返回空，**打开一次会话
  永远不该是失败的那一件事**。三家的会话开始钩子都归一成 `session`，规则核心对它
  一律放行（简报是一条消息，不是一次裁决），消息由各家的 `encode` 放到自己宿主
  读得到的地方。
  **三家已经一致了（2026-09-02 照代码复核）**：`manifests.ts` 里 Claude 的
  `SessionStart`、Cursor 的 `sessionStart`、Codex 的 `SessionStart` 调的都是
  `guard`，走的都是上面这条共用路径，简报只有 `sessionBriefing()` 一个出处。
  Claude 那条从前直接调 `status` 子命令、绕开守卫，已经改掉；本文件从前记的
  「只有 Claude 还绕开守卫」今天不成立，别再照抄。绕开的代价当时还多一条：那条
  路是唯一见不到 D9 的 —— 守卫读不动图时会安静地开会话，裸的 `status` 子命令
  会把一串报错甩在人脸上。

## D16 没有想法认领的产品文件，默认放行还是拒绝

- **现状** — Claude 对未被 `code` 命中的文件放行；Cursor 与 Codex 严格模式
  默认拒绝，只允许当前实现想法声明的产品和测试路径。
- **裁决** — 严格模式默认拒绝；图、日志和明确的 workflow 状态文件走专门规则。
- **理由** — 默认放行意味着漏写一个 `code.file` 就绕过整个 workflow。路径缺口
  应在计划阶段显露，而不是在实现时被当成自由区。

## D17 什么时候可以进入 doing

- **现状** — Claude 的 `set` 不检查八问、前置或批准；Cursor 检查 expected、
  how、verify、code.file、前置完成；Codex 还要求有效 plan approval。
- **裁决** — `todo → doing` 必须八问计划字段齐全、该想法的 plan 批准当前有效、
  所有 `needs` 已 done、路径与其它 doing 想法不冲突。
- **理由** — 这些条件都是机器可判定的现有事实；只在提示词里提醒会让图的
  拓扑序和审批在真正写代码时失效。
- **修订（2026-09-16，I-146）：去掉「plan 批准当前有效」这一条。** `todo → doing` 只看
  三件图里的事实：八问计划字段齐全、所有 `needs` 已 done、路径与其它 doing 想法不冲突。
  `apply` 写回里的 doing 也不再因为拿不到项目目录而拒 —— 三个条件都在图里，不需要回执
  目录。理由见 D7 修订。

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
- **落地情况（2026-09-02，照 `guard.ts` 现在的代码逐句重读过）** — 已落地，
  `ruleShell` 一共五道，按一条命令遇到它们的顺序。**这道闸门在本条写下之后被重写过，
  本条却没跟着改**，所以下面每一句都重新对着代码核了一遍；核不上的地方直接写「本条
  从前写错了」，不留着一份既不描述代码、也不描述裁决的散文。
  **第一道：当前 `doing` 想法自己声明的 `verify.command`。逐字相同只是入场券，
  不是放行** —— `verify.command` 是图里的散文，而图是故意留给 agent 写的，只比对
  字面等于「想跑什么就先写进图里再跑」，那就是把下面三道闸全套上一个 verify 字段
  当外衣。所以这道闸压着两条，本文件从前一条都没写：
  **（一）声明的那条命令必须真的只是一条命令。** 里面出现分号、与号、管道、
  重定向、换行或命令替换（引擎的 `isChainedCommand`），**当场拒绝**，而且是出声拒绝，不是
  悄悄跳过去落到后面几道里碰运气 —— 图里正摆着一条要人去看的东西，闷着不说等于
  把它藏起来。
  **（二）这个想法的 plan 关卡必须有当前有效的人工批准**
  （`validApproval(projectDir, graph, "plan", id)`，D7）。plan 的快照盖住
  `verify`，所以改一个字批准就作废 —— 这条自毁正是这道闸敢原样放行一条命令的全部
  依据。**没批准不等于拒绝**：命令掉进下面三道，按一条普通命令判，该放的照样放；
  真被下面某一道拦下时，说给人听的理由会换成「拦住它的不是命令本身，是这个想法的
  方案还没有当前有效的人工批准」，并把 `request-approval --node <编号>`
  写出来，原本挡住它的那条规则收在括号里 —— 报一个正则的名字，只会把人支去重写一条
  图里已经写好的命令（D7/D28）。
  **第二道：受认可的调用 —— 引擎 CLI。**
  `COMPANION_CLI` 要的形状是「`node` / `tsx` / `npx tsx` + 引擎路径 + 一个子命令」，
  子命令取自白名单 `COMPANION_SUBCOMMANDS`；**这份白名单不再是手抄的第二份命令面，
  而是从引擎自己那张命令表读出来的**（D11/D28 —— 手抄的那份漏过 `log`，于是引擎自己
  建议的命令被守卫拦下）。子命令这一段是**可选**的（一个都不写就是打印用法），也可以
  换成 `help / --help / -h / --version / -v / -V`。
  **这道闸放行一段尾随的只读管道 —— 本条从前写的「中间不许夹带管道」是错的**，
  引擎自己的拒绝语里正写着「后面可以接一段只读的管道（`| head`、`| less`、
  `| Select-Object` …）」。判法是把整条命令按 `|` 切开：头一段必须是那条受认可的调用，
  后面每一段都必须是**惰性段**（`inertStage`）—— 不点名引擎文件、不命中写文件招数、
  也不是管道右边收程序的运行时（`PIPED_RUNTIME`）。放行的理由是这样一段本来单独站着也该
  放行，它没从白名单借到任何东西。**不是管道的分隔符照旧拒绝**：`;`、`&&` 和换行开的
  是一条新命令，跟前面那条引擎调用只有相邻关系。另有一条整条命令级的前置：
  `SMUGGLED_TAIL`（换行、`$(`、反引号）沾上一个，这道闸整个不开。
  **按身份认路径，不按名字认**：文件名对、位置不对（往可写的账本目录 `ideas/`
  里丢一个 `companion.mjs` 再跑它）当场拒绝，而且明说是位置不对，不是让人对着一句
  「命令被拒」反复重打（D26/D28）。
  **本条从前还记着一份「受认可的安装/打包入口」名单（`companion/install.ts`、
  `companion/build.mjs`、两个旧仓库的 `install.ts`）—— 那份名单已经删掉了（I-144）。**
  它存在的唯一理由是从前挂在第五道后面的解释器墙会把本仓库自己的安装器和打包入口一起拦下，得按精确
  路径放回来；墙拆了，豁免就没有对象。今天 `node companion/build.mjs` 放行，是因为**跑一个
  脚本本来就放行**，不是因为它在某张名单上 —— 留着那份名单只会让规范说假话：说
  `scripts/install.ts` 被拒而 `companion/install.ts` 获准，而事实是两个都照跑。
  **第三道：点名了引擎文件（`ENGINE_MENTION`）、却不是上面那种调用的命令。**
  **这道闸的问法已经倒过来，本条从前记的那份「只读动词清单」（`cat`、`grep`、
  `git diff/show/log` …）作废** —— 代码把那份枚举本身称作 bug：它漏掉的拼法
  （`git --no-pager diff`、PowerShell 的 `gc` / `sls`、`awk`、`md5sum`）全是普通正确的
  活，而在这个仓库里引擎就是产品，看引擎是最平常的一件事。现在问的不是「这是不是人
  读文件的一种办法」，而是「这一段是在跑引擎，还是在写引擎」；**其余动词，不管有没有
  被谁列过名，一律算在看，不拦**。不算看的只有两类：
  **（一）`ENGINE_INVOCATION`** —— 引擎站在程序的位置上（命令头，或前面只隔着
  launcher / 解释器和它们的旗标）。这正是 D26 立得住的那个形状，第二道是唯一一扇门。
  引擎文件名认得 `claude-` / `cursor-` 前缀（`claude-companion/ideas.ts` 也是
  `ENGINE_PATHS` 上的遗留引擎路径），并且另有一条 **`NESTED_ENGINE_INVOCATION`** 管一层
  嵌套：`bash -c "node …/companion.mjs guard"` 里引擎文件不站在路径的位置上，上面那条形状
  认不出来。**这两处都是 I-144 拆掉解释器墙时暴露出来的真口子** —— 从前它们被墙顺手挡着，
  墙一走就是通的，而通的那一头正是手跑 hook 入口。嵌套那条要求解释器后面至少有一个旗标，
  为的是不误伤 `npx tsx companion/ideas.ts check` 和 `cat companion/guard.ts`；它买来的过堵
  也明写：`node -e "console.log('companion/guard.ts')"` 这种只打印路径的一行流一样被拒 ——
  从一个字符串里分不出「提到」和「调用」，而拒错一次只是重打，漏一次是伪造批准。
  再往深的嵌套（base64、变量、`sh -c sh -c`）照旧走得过去，R6 早就把这句话说在明处了。
  **（二）`ENGINE_WRITE` —— 本条从前完全没写的一类拒绝**：这一道自己点名的写引擎
  动词 —— `find <引擎文件> -delete/-exec`、`truncate`、`dd`、`shred`、`patch`、
  `Clear-Content`。**本条从前写的「这些都是写文件招数里没有的动词、只在点名引擎的
  时候问」已经不成立**：后五个已经抬进写文件招数那张表（`MUTATING_HEAD`），点不点名
  引擎都拦（`truncate -s 0 notes.md` 一样被拒）；它们还留在这里，只是让先跑的这一道
  说自己的话 ——「你在改引擎」比「这个词写文件」更贴。这一行今天还多加的只剩 `find`，
  而它正是不能抬进去的那个：每个动词都锚在命令头上，抬进去会把
  `find . -name '*.ts' -exec grep -l x {} +` 这种搜索一起拒掉，而
  `rg patch companion/guard.ts` 是在 grep 一个词。
  这道闸**逐段问**，不整行问：前面一个只读动词只替自己担保，不替挂在它后面的东西
  担保 —— `cat notes.md; ./companion/dist/companion.mjs guard` 还是 D26 要拦的那个
  形状。只有出现命令替换（`$(` 或反引号）时整行一起判 —— 替换把一整条命令藏在参数
  里，切不开 —— **而且这一行只要点名了引擎，就直接按「调用」拒**，不再问它站在哪个
  位置上。这道闸判成「只是在看」的，第五道照样接着问。
  **`guard` 和 hook 入口故意不在子命令白名单里，因此从 shell 里够不着** —— 手工跑一次
  hook 入口，等于自己造一个事件、给自己签一次批准。**D26 说批准是行为护栏而不是
  密码学证明，能成立的前提就是这一条**：那句「手工调用 guard 可以模拟事件」是
  Claude 旧实现的现状，不是共同基座的现状。
  **第四道：受保护的账本证据（`protectedTargetRefusal`）—— 按写到哪拦，不按命令头上
  那个词拦。** 批准回执 `ideas/.approved`、两份扫描清单、生成的网页、想法图、
  `ideas/.runtime/` 下的运行期证据，以及迁移用的旧图，只能由 CLI 和 hook 写（D24）。
  命令头不在只读动词表（`LOOKING_HEAD`）上时，它的参数逐个问一遍；重定向目标不管
  命令头是谁都问 —— `cat x > ideas/.approved` 前面在读、后面在写；**再加第三遍，
  按子串问整个命令段（`mentionedLedger`，I-143）** —— 账本路径藏在一个参数**内部**也算，
  `node -e "require('fs').writeFileSync('ideas/.approved', …)"` 那条路径写在一段带引号的
  代码里，整个参数解析出来什么都不是。这一遍是 I-144 拆墙的前置：从前挡住那一行的是解释器
  墙，不是这道闸。匹配要落在路径**边界**上，所以 `ideas/graph.yaml.bak`、
  `ideas/.approved-old` 是另外的文件，照旧能写。它的天花板也写在明处：字符串拼接
  （`'ideas/.appro'+'ved'`）、base64、变量、嵌套 `sh -c` 都绕得过 —— 这是 R6 那句
  「挡的是顺手跳过，不是铁了心要绕过去的 agent」，真要做成边界得靠隔离，不是更长的正则。
  落在这几份上就
  拒绝，动词是什么一概不问。**它必须独立于下面那张写文件招数表存在**，理由正是上面
  「理由」那句「规则是 guardrail 而非沙箱」的反面兜底：动词表漏一个拼法（`busybox
  cp`、谁都没列过的那个），就等于让 agent 自己写批准回执、自己给自己签批准
  （D23/D26）。第二道那段尾随管道的惰性段（`inertStage`）也拿它判。
  **第五道（也是最后一道）：写文件招数（`mutatingShell`，动词表 `MUTATING_HEAD`），命中就拒绝。**
  写文件招数这一族是：`rm` / `mv` / `cp` / `tee` / `touch` 那一家（各自锚在命令开头或
  一个分隔符后面）、`sed -i` 与 `perl -i`、写盘的 git 子命令（`apply` `checkout`
  `clean` `commit` `merge` `mv` `reset` `restore` `revert`，并且认得夹在中间的
  `git -C <目录>` 这类全局旗标）、包管理器的 `install` / `remove` / `update`、
  PowerShell 的 `Set-Content` / `Out-File` / `New-Item` …、下载器（`curl` / `wget` /
  `rsync` / `iwr` …，**`scp` 从前在这一族里，I-144 起不在了** —— 往远端拷文件是这台机器上
  真实的工作方式，代价（它确实也能把文件拉回来落地）被明确接受；`rsync` 留着，因为这次放开
  只点了 `scp`），以及 `>` / `>>` 重定向。**今天这一族按命令头逐段问**（`mutatingShell`
  先用 `shellCommands` 把整行切出每一个程序名站的位置 —— 分隔符、命令替换，以及
  `sudo` / `xargs` 这类 hand-off 词后面 —— 再拿 `MUTATING_HEAD` 逐个问头），和第三道
  一样逐段，而且切得更细：**参数里出现过的词不算写**，`rg -n touch
  companion/guard.ts`、`rg "Set-Content|Out-File" guard.ts`、`git diff
  rename-plan.md` 都照常放行。整行问的只剩兜底的 `REDIRECT` —— 重定向落地的是文件，
  头上站谁都一样。第二道的管道分段也调它判惰性段。**写文件招数没有例外。**
  **从前这里还有第六层：解释器墙（`INTERPRETER`）。I-144 把它整条删掉了 ——
  这一屏从此只有五道，本条从前写的「然后 INTERPRETER」和那份豁免名单都作废。**
  它拦的是「把程序交给一个运行时」这个动作本身：代码旗标（`-c` / `--eval` / `-enc` …）、
  按扩展名认出来的脚本、命令头上带任何操作数的解释器（`bash setup`、`deno run patch.ts`）、
  heredoc 与输入重定向，以及管道右边的 `… | bash`。删它的理由写在 I-144 里：在这台机器上
  conda 环境跑 python、跑脚本就是干活的方式，而「名单」是墙的错误形状 —— 这句话本来就写在
  `MUTATING_HEAD` 自己的注释里，业界对 denylist 脆弱性的测量也是同一个结论：名单里一旦有
  任何能跑别人代码的东西，参数检查就是表演。
  **它的代价必须和它一起记下来，否则上面那几道会被读成比实际更强**：`python -c
  "open('src/a.ts','w')…"`、`bash -c "cp /tmp/evil src/a.ts"`、`pwsh -Command Remove-Item
  src/a.ts` 现在都放行 —— 也就是说**写文件招数那一道只认命令头上那个词，前面加一个解释器
  就绕过去了**。产品文件真正在守卫下被判的那条路是编辑工具（按想法图判），shell 这一侧从
  设计上一直只是护栏而非沙箱。**账本（第四道）和引擎调用（第二、三道）不吃这一招**：前者按
  路径认，`bash -c "cp /tmp/forged ideas/.approved"` 照拒；后者有 `NESTED_ENGINE_INVOCATION`。
  这两条各有测试锁着，因为它们是批准机制还立得住的全部理由。
- **和「裁决」那两句对不上的两处，两种读法都写下来，不替人选（2026-09-02）** —
  **（一）裁决说「允许只读命令」，代码却把下载器整族算作写。** 一条只把网页打到 stdout
  的 `curl` / `iwr` 也被拒。代码把代价说出口了：落地成文件的 fetch 就是写，而读一个网页
  是 agent 自己的抓取工具的活，不是 shell 写入的活。另一种读法是裁决的字面 —— 只读就
  该放，真要拦的是 `-o` 和重定向那一段。
  **（二）裁决说「无法可靠解析目标的 mutation 拒绝」，读起来是「解析得出目标就按路径
  判」；代码里没有这一支。** 命中写文件招数就拒，哪怕目标正是当前 `doing` 想法认领的
  文件（`cp a.ts b.ts` 一律拒，不看路径）。支持代码这一读的是本条的「理由」那句 ——
  规则是 guardrail 而非沙箱；一条 shell 命令能碰几个目标没有上限，逐个解析等于自己写
  一个 shell 解析器。两种读法都立得住，需要人裁一次；裁定之前，代码是现状。
- **引擎侧的同一道闸也落地了，但落在 `run-check`，不是 `check`（2026-09-02 读代码
  确认）** — `ideas.ts` 里的 `verifyCommandRefusal()` 在真要执行之前，把守卫问过的
  那两条**原样再问一遍**：串了第二条命令就拒绝（任何批准都买不到它 —— 人批的是
  一条命令），plan 没有当前有效的人工批准也不跑。
  **为什么非补这一道不可**：`run-check` 自己就在守卫的引擎白名单上，它把
  `verify.command` 交给 shell 去跑 —— 也就是说，守卫当着 agent 的面拒掉的那条命令，
  绕道引擎就能跑起来。两扇门，同一个问题，各问各的。
  **`check` 仍然不看 `verify.command` 长什么形状**：一条串起来的验证命令写进图是
  收得下的，只在两扇门任何一扇要跑它的时候才被拦。想让它在写进图的当场就报错，
  是另一件还没做的事（见开头的未落地清单第 6 条）。
  **那份重复已经去掉了（2026-09-02 照代码复核）**：`guard.ts` 里再没有自己的
  `CHAINED_COMMAND`，那道闸调的是引擎导出的 `chainedCommandRefusal`（谓词
  `isChainedCommand` 在它里面），判断和拒绝语都只剩一个出处，两扇门一份定义。
  `test_base_engine_round4` 里「一个判断、一份定义」那一组盯着它不许回来：只要
  `guard.ts` 引用了引擎那两个名字，这组测试就要求文件里再也找不到第二份串联判断的
  定义 —— 名字里带 chain 的常量，和那道闸自己拿去 `test(command)` 的那个常量，
  都算第二份，所以换个名字也藏不住。本条从前记的「两份同样的正则，哪天会漂开」
  已经不成立，别再照抄。

## D22 三家 hook 输入如何归一化

- **现状** — Claude 主要给 `file_path`；Cursor 工具有 path/filePath/uri 等名字；
  Codex `apply_patch` 在 `tool_input.command` 里携带一个或多个补丁路径，MCP 又是
  任意参数对象。
- **裁决** — 入口归一化为 `{event, tool, paths[], operations[], prompt, cwd}`；
  Claude、Cursor、Codex 各一小段纯映射，并共享同一组 fixture 测试。
- **理由** — 官方兼容只保证事件能触发，不保证原始工具参数长得一样。先归一化
  才能让后面的规则真正只有一份。
- **落地情况（2026-09-02）** — 已落地，归一化后的形状是
  `{event, tool, paths[], operations[], command, urls[], prompt, cwd, edit, patchText,
  unknownTarget, stop_hook_active, session_id, turn_id}`。后加的两个字段各有出处：
  `patchText` 是补丁类工具的原文（`apply_patch` 这种工具带不出「改完长什么样」，
  逐行读补丁是守卫唯一能看见的后像，见 D24）；`stop_hook_active` 是「这次 stop
  本身就是 stop 钩子引起的」，没有它，Stop 规则会把自己无限重放一遍
  （Cursor 那边由 `loop_count > 0` 映射成同一个意思）。
  `event` 一共九类：`pre-write`、`post-write`、`read`、`shell`、`prompt`、
  `session`、`stop`、`fetch`、`other` —— 这九个名字是全集，别在别处发明第十个。
  `fetch` 是最后进来的一类（R8/I-104）：调用里点名的网址，或是在当前那一页里跑
  脚本的工具，都归一化成它，随它进形状的是 `urls[]`；判它的 `ruleFetch` 拒掉整个
  回环地址族 —— serve 起的那一页上人做的动作是这套工具里唯一还算数的人工授权，
  agent 够得着那一页，那个授权就等于零。别把它当成越界代码删掉。三段纯映射
  各自处理：Claude 的 `file_path`、Cursor 的五种路径拼法（`path` / `filePath` /
  `uri` / `notebook_path` …）、Codex `apply_patch` 里的整份补丁（`Add/Update/
  Delete File:` 三种头，外加 `Move to:` 改名 —— 改名按目的地上的一次新增单独判，
  否则一次合法的账本编辑可以被改名成任意产品文件）。认不出的补丁头一律拒绝。
- **读文件是自己的一类事件（2026-09-02 落地）** — D12 那条「只有真实的 Read 才划得掉
  扫描清单一行」，此前靠的是 `runGuard` 里的一个特例：归一化成 `other` 之后，再回头
  看原始事件是不是 Claude 的 `PostToolUse` + `Read`。**那个特例已经没有了**，取而代之
  的是三家归一化器各自产出的第一类 `read` 事件：Claude 的 `PostToolUse` + 读工具、
  Cursor 的 `beforeReadFile`、Codex 的 `PostToolUse` + 读工具（Codex 的读前事件不算，
  那时还没读到任何东西）。规则核心对 `read` 一律放行 —— 划清单是一次副作用，从来
  不是一次裁决 —— 划的动作在守卫入口按归一化后的类型做，不再认哪一家的原始事件名。
  **今天还差的是接线，而且只差一家（2026-09-02 照代码复核）**：`manifests.ts` 里的
  matcher 已经不是三处手抄的字符串，而是从一张工具名表拼出来的（`READ_TOOLS`、
  `SHELL_TOOLS`、三家各自的写工具、`apply_patch`、MCP 前缀）；Claude 的 `PostToolUse`
  和 Codex 的 `PostToolUse` 都带上了 `READ_TOOLS`，**这两家真的收得到读事件**。
  本文件从前照抄过一句 Codex 的写后 matcher 原文 —— 只列写工具、`apply_patch`、
  MCP 前缀和 `Bash`，不含 `Read` 的那一句。**它在代码里已经不存在了**，这里也不再
  抄一遍：抄下来的 matcher 字面量正是会漂的那种东西，而且那一句连 `Bash` 都不该
  待在写后事件上（拦 shell 是写前的事，写后只剩划清单）。要看 matcher 长什么样，
  去读 `manifests.ts` 里那张表，别读这份文件。
  **仍然收不到读事件的是 Cursor**：`normalizeCursor` 早就认得 `beforeReadFile`
  并产出 `read` 事件，但 `cursorHooks()` 里没有这一项，事件根本不会发过来 ——
  规则备好了，线没接上。所以现状是**三家规则一致、两家接线到位**，D12 的机器保证
  要等 Cursor 这一条接线补上才真的三家都有。既别把这条写成「已经三家都在划清单」，
  也别再写成「只有 Claude 一家」。

## D23 写前无法确定目标路径时怎么办

- **现状** — Claude 放行；Cursor 返回 no file path 并拒绝；Codex 严格模式拒绝
  无法解析的写目标或不完整 patch。
- **裁决** — 可能写入但目标未知时拒绝；只读、hosted tool 和明确不产生文件的
  调用不进入这条规则。
- **理由** — 严格路径范围下，unknown 不能等价于 allowed。分类必须基于工具
  能力和事件，不靠「没找到 file_path」这一条粗判断。

## D24 哪些文件和字段由 runtime 保护

- **现状** — Claude 保护 `.approved`、`.scan-todo`、`.scan-done` 和已有 status
  （前三个在 `claude-companion/guard.ts` 的同一张表里，写它们一律 exit 2）；Cursor 锁
  harness，但图和日志全可写；Codex 保护 active、approval、runtime、coverage、
  log 以及节点 identity/lifecycle 字段。
- **裁决** — `.runtime/`、`.scan-todo`、生成 HTML 与自动日志只能由 CLI/hook
  改；图的叙述、边和计划可编辑，已有 id/status 及 manual `signed_off` 只能走 CLI。
- **理由** — agent 能直接写出的证据不叫证据；同时不能把计划散文也锁死，否则
  Discuss/Plan 无法工作。
- **带不出改动后的内容，就不许写图（2026-09-02 落地，刻意的关门）** — 图这一份
  文件走 `ruleGraphEdit`：它把「改之前」和「改之后」两份文本都解析成字段表，比对
  `status` 和 `signed_off` 有没有被动过。这要求守卫拿得到改动后的内容。拿不到时
  分两种走法：平台给了补丁原文（`patchText`）就逐行读补丁，只增删叙述的照常放行；
  **补丁原文也没有的，整次写图当场拒绝** —— 也就是说，notebook 类编辑工具和一切
  Model Context Protocol 写工具**改不了图，连只改散文也不行**。
  这是**故意关的门，不是漏掉的一块**，别顺手把它改回放行：`status` 和 `signed_off`
  只走命令行（本条 + D27），而一次看不见内容的写，没法证明自己没碰这两栏 ——
  这正是 D23「严格模式下 unknown 不等于 allowed」同一句话用在内容上。
  代价是明的、也是可绕的：拿一个带得出改动内容的编辑工具去改叙述，改状态用
  `set`，人工验收签字走 `request-approval --gate manual-check`。
- **口令和回执进 git（2026-09-10 落地，I-138）** — 上面说 `.runtime/` 只能由
  CLI/hook 改，那一条不变；变的是一次性口令和批准回执**不再住在 `.runtime/`**，
  搬到了进 git 的 `ideas/approvals/`（`pending/` 和 `receipts/`），保护规则原样跟
  过去（`decideProductWrite` 对它和对 `.runtime/` 一样拒绝，守卫的标签是「口令和
  批准回执」）。为什么要进 git：口令在人的电脑上由 `request-approval` 生成，批准
  要在一台常开机器的门户上回（D36 的带外例外），回执又要回到人的电脑给 `set doing`
  看 —— 三处只有 git 相通。口令文件里只有关卡和内容指纹，`request-approval` 本来
  就把它们全文打在终端上，没有秘密。测试红绿证据**不搬**：那是这台机器跑过测试的
  证据，搬到别处就不是证据了。旧位置只读兼容：`.runtime/approvals/` 里已有的回执
  继续算数，`.runtime/pending/` 里已有的口令继续能回，新的回执一律写进新目录。

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
- **落地情况（2026-09-09，I-105）：维持原判，多了一条证据和一段例外。** 新证据是
  2026-09-05 的实测（见 D36）：本地页面上 agent 驱动的一次点击和人手点的没有任何
  可测的区别，所以「口令只能由人在对话里回」不是保守，是本地场景下唯一成立的落点。
  例外只有一种：带外的、有自己登录的宿主转发人的原话（D36 三条条件），那时凭证
  和登录密钥都在 agent 够不到的地方。四种形同虚设的情况列在 D36 的理由里。
- **落地情况（2026-09-10，I-139）：例外的入口建成。** `serve` 多一个 `POST /approve`，
  只在环境变量 `AIDEV_APPROVE_SECRET` 设了才存在（没设就 404，本机双击打开的那份
  不多一个口子）；请求体是 `{secret, words}`，`secret` 用定长比较，不对就 403、
  什么都不消费；对了就把 `words` 原样交给 `applyApproval` —— 同一条正则、同一个
  漂移检查、同一个一次性文件，回执里 `session_id` 写 `serve`。凭证不进页面、不进
  响应、不进标准输出（第二行只说「批准入口已开」）。宿主那边的登录和转发在
  LifeCopilotBeta（其想法图 I-012、I-013）。

## D27 人工验证如何签字

- **现状** — Claude/Cursor 让人或 agent 填 `signed_off`；Codex 用
  manual-check challenge，由 prompt hook 写 evidence。
- **裁决** — 人工验证只能通过 manual-check challenge，CLI 将签字摘要写回图并
  保存 receipt；直接编辑已有 `signed_off` 被拒绝。
- **理由** — 一个 agent 能编辑的签名不能证明人看过结果。保留图中可读签字，
  同时让它能追溯到不可复用的用户响应。
- **落地情况（2026-09-02）：曾经的冲突已经结了。** 2026-08-31 这里记过一处未结
  冲突：网页上的 `sign` 操作会写出一个 agent 也造得出来的签名。收场用的正是这条
  裁决本来就写好的办法 —— 把网页那一步降级成「提出签字请求」：
  `applyChanges` 不写 `signed_off`，只把请求带出来；`requestSignatures` 把每一条
  变成一次 manual-check 一次性口令；签字由人的那一句回答经 `applyApproval` 写进
  图，写的内容里带着口令和回执文件的位置。手改图里已有的 `signed_off` 也被守卫
  拦下了（`ruleGraphEdit` 比对改动前后的签字栏）—— 那句「`signed_off` 不在守卫的
  保护范围里」的旧记录，今天已经不成立。
- **落地情况（2026-09-09，I-105）：再次维持。** 三天后「让页面上点一下就算签字」
  被重新提出，这次的答案和证据写在 D36：本地页面分不出人和自动化，签字仍只走
  manual-check 口令；网页上的 `sign` 操作仍然只是提出请求。带外登录的宿主转发人的
  原话（D36 的例外）走的也是同一句口令、同一个 `applyApproval`，不是第二条签字路。

## D28 共享 CLI 的命令面

- **现状** — Claude 有 init/check/next/show/set/render/scan；Cursor 另有 paths、
  new、allow、log；Codex 另有 approval、run-check、status 和 lifecycle 命令。
- **裁决** — 基座提供 `paths init migrate new check status next show set allow scan
  render apply serve request-approval run-check coord`，另外再加一条 `log`（把修改记录
  读出来）；旧命令只做迁移期别名，
  不各留一套实现。`apply` 读改动文件把编辑写回图，`serve` 起本地服务把同一个信封
  接进同一个 `apply`；**会发编号的只有 `new` 和 `apply`，两者都必须从 `next_id`
  取号加一，不许算「最大编号加一」**（见「The file」一节的编号规则 —— Cursor 现行的
  `new` 正是被否掉的那种算法，迁进来时要改）。
- **理由** — `paths` 消除猜文件，`allow` 可在写前自检，approval/run-check 承载
  共同保证；`apply` / `serve` 是「改图即改项目」那条链在基座里的落点，没有它们
  「网页和写回之间的唯一接口」就没有消费者。其余命令覆盖完整 workflow，
  继续增加同义词没有价值。
- **落地情况（更新于 2026-09-06）** — 上面裁决里的每一条都已落地，**连同 `log` 一共
  十八条**：`paths init migrate scan new check status next show log set allow
  render apply serve request-approval run-check coord`。`coord` 提供会话注册、消息、阅读确认和短锁恢复；
  文件认领和宿主写前约束尚待后续想法实现。`log` 把想法自带的那份只追加
  修改记录读出来（`log I-014`、不带编号走全图、`--n` 只看最后几条），已经有测试
  压着。这十八条的唯一出处是 `ideas.ts` 里的 `SUBCOMMANDS` 表，**用法文字由它
  生成，不再手抄** —— 手抄的那一版早就漂了，一条专门用来说明「有哪些命令」的
  消息，自己漏掉了 `migrate`、`run-check` 和 `request-approval` 三条。
- **还没落地** — 「旧命令只做迁移期别名」仍然没有：一个别名都没建，旧命令直接
  不认识，会打印用法然后退出 2。
- **那处不一致已经补上（2026-09-02）** — 守卫里的 `COMPANION_SUBCOMMANDS` 白名单
  （D21 那道 shell 闸门用它决定放行哪些引擎调用）曾经是手抄的第二份命令面，只有
  十六条，缺的正是 `log`；于是「命令确实存在，守卫却拦下它」真的发生过 —— 连引擎
  自己那句「旧图只想看看：check / next / show / log … 加 `--file` 照常可用」的提示，
  照做也会撞墙。修法按这条裁决要求的方向落了地，而且比「把 `log` 补进去」更彻底：
  白名单不再手抄，改成 `SUBCOMMANDS.map(([name]) => name)`，直接从引擎那张表读出来，
  两处再也漂不开。今天 `node .companion/companion.mjs log` 照常放行，
  `test_base_guard_cli_surface` 逐条压着「引擎有的命令，守卫都放行」。

## D29 扫描哪些文件，以及读后变化怎么办

- **现状** — Claude 使用 Git tracked + untracked + ignore 过滤；Cursor 自报范围；
  Codex 优先 Git tracked/unignored，记录二进制与内容哈希。
- **裁决** — Git 仓库扫描 tracked 与未忽略 untracked；非 Git 才遍历文件系统。
  vendor/generated/binary 明确列入 skipped 及原因；文本哈希变化后重新未读。
- **理由** — 只扫 tracked 会漏掉正在开发的新文件，只遍历会吞进依赖目录；
  skipped 必须可见，不能把「没读」包装成「不存在」。
- **落地情况（2026-09-02）** — 已落地：Git 仓库走
  `git ls-files -z --cached --others --exclude-standard`（`-z` 是必须的 —— 不加它
  git 会把带非 ASCII 的路径转义成八进制，那些文件永远匹配不上一次 Read），不是
  Git 仓库才遍历文件系统；二进制和依赖目录按一条固定的模式滤掉，另外还认
  `ideas/.scanignore` 里的路径前缀；读过的文件记内容哈希，文件改了就自动回到未读。
  **那份带原因的 skipped 清单也已落地。** 跳过的判断集中在一个 `skipReason()`：
  `listProjectFiles` 拿它筛掉，`skippedFiles()` 拿同一个函数把剩下的那批连同各自
  原因列出来 —— 一份判断，两个方向，不会出现「滤掉的和列出来的对不上」。
  `scan` 每一次都报「跳过 N 个文件」，加 `--skipped` 就逐条打印路径和原因。
  这一条至此从约定变成了机器保证，理由正是裁决里那句「skipped 必须可见」——
  报告说不出名字的跳过，就是「没读」披着「不存在」的皮。

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
- **落地情况（2026-09-02）** — 已落地两半。
  一、`verify.test_files` 是一个显式字段，引擎从头到尾没有一处从 `verify.command`
  的字符串里猜路径；路径比较在 Windows 上不分大小写、斜杠反斜杠都当同一个。
  二、**路径本身的校验也已落地**：`check` 里的 `badPlanPath()` 拒绝绝对路径
  （`/x`、`//主机/共享/x`、`C:/x` 三种写法都算）和任何 `..` 段，`code.file`
  **每一种状态都查**（写进计划的那一刻就是错的，不是等谁去写它的时候才是错的），
  `verify.test_files` 的每一条同样查，两处都是 `check` 的错误而不是警告。
  从前一条 `../../somewhere/x.ts` 会被原样收下 —— 它解锁不了那个文件（写闸门比的是
  项目相对路径，对不上就还是拒绝），但图里会留下一条没人拦的假路径，而 /ccfix
  把图当事实读。
  **仍未落地：受限通配符。** `test_files` 今天只做精确比对，裁决里说的
  「支持精确路径与受限 glob」还只兑现了前半句。

## D32 code 行号是否验证

- **现状** — Claude/Cursor 验证 done 的文件存在，但基本不验证 `lines`；Codex
  验证一基、闭区间且不超过文件长度。
- **裁决** — done 必须有可解析的 `start-end`，起点至少 1、终点不小于起点且
  不超过当前文件行数；纯文档或生成物节点可用 manual verify 明确豁免代码引用。
- **理由** — `/debug` 依赖精确引用；只验证文件存在会让过期行号继续被当成事实。
- **落地情况（2026-09-02）：行号校验已落地。** `check` 里的 `badLineRange()`
  解析 `start-end`，要求 start 至少是 1、end 不小于 start、end 不超过那个文件
  **现在**有多少行（末尾那个换行是上一行的结尾，不另起一个空行）。`lines` 是按逗号
  分开的若干段，每段写成 `start-end` 或一个裸行号（`12` 就是 `12-12`）—— 一个想法的
  代码本来就可能落在几段互不相连的地方，活账本里 `1714-1727,1819,1874` 就是合法的；
  哪一段这两种形状都写不成（比如 `12–40`、`1-2,`）当场就是不合格。它只在 done 的想法、
  且这条 `code` 真的写了 `lines`、且文件读得出来时问 —— 文件不存在另有一条错误
  管，读不出来就不猜。done 而一个 `lines` 都没写，仍是一条警告。
  **严格程度已经分成两档了（2026-09-02 照代码复核）**：`badLineRange()` 返回的是
  `impossible` 还是 `stale`，`check` 照这个分流。
  **`impossible` 是错误** —— 有哪一段既写不成 `start-end` 也写不成裸行号
  （`12–40`、`1-2,`、「大概第三行」）、start 小于 1、end 小于 start。任何文件改动都
  变不出这种范围：它在被标 done 的
  那一刻就已经是假的，是对「这活干完了」的谎报。
  **`stale` 是警告** —— 范围本身读得通、当初也对得上，只是文件被别处正当的改动
  改短了，end 超出了现在的行数。这是完成品上的记录过期，不是图不成立；而 R5 会把
  `check` 的每一条错误变成「这次会话不许结束」，把过期判成错误，等于让任意一次
  合法的删行改动被一个不相干的 done 想法扣住整个会话。警告照样报得清清楚楚，
  还带着怎么刷新的那一句 —— 降级的是拦不拦人，不是说不说。
  **仍未落地：**「纯文档或生成物节点可用 manual verify 明确豁免代码引用」那一句
  没有对应的判断 —— done 依旧一律要求 `code`，不看 verify 是不是人工检查。
  ccscan 和 ccfix 的正文里那句「行号必须是真实行号」现在背后有代码了，不再只是
  给 agent 的规矩。

## D33 workflow 用命令副本还是共同 Skill

- **现状** — Claude 是五个 commands；Cursor 是五个 Agent Skills；Codex 是一个
  Skill 加 workflows reference。
- **裁决** — 共同基座保留五个标准 Agent Skills；共用正文和 references，各平台
  manifest 直接指向同一目录，不生成改写版。
  **命名修订（2026-09-01，人批准）**：技能目录名定为 ccscan、ccthink、ccbuild、
  ccfix、ccgraph，取代本条初裁的 onboard/discuss/build/debug/graph 短名。
  依据：三家都拿技能目录名当命令名（/build 这种通用词必撞车），且用户肌肉记忆
  已是 cc 前缀；Agent Skills 规范要求 name 与目录同名，此名即命令名。
  **正文是合并不是重写（2026-09-02 修订）**：共同技能的正文由三家前身合并而来，
  前身里的护栏逐条保留，删任何一条都要在本表留痕。至少包括：ccfix 的「不一致
  清单必须作为独立可见的消息交给人并结束回合」「一次只修一处、分别验证」「三次
  修不好转 blocked」「收工前拆掉临时插桩」；ccscan 的「找不到真实理由就写
  `why_this_way: null` 并列进报告」「`code` 必须解析到真实文件和真实行号」
  「绝不编造不存在的验证命令」；以及每条技能都要有的「参数」一节（带编号、带
  开关、不带参数各是什么行为）。正文里的引擎入口一律写成
  `node .companion/companion.mjs`：D14 的插件根目录 + D34 的单文件产物，
  正文中不出现 `.claude/`、`.cursor/`、`.codex/` 这类平台专属目录。
- **理由** — 三家都能承载 SKILL.md；Claude 的 commands 已是兼容旧入口。直接
  共享文件比「生成三份看起来一样的文件」少一层，也避免称谓和步骤再次漂移。
  统一正文的代价是容易在压缩时顺手删掉只有一家写过的护栏 —— 那些护栏正是三家
  各自踩过坑才加上的，所以把它们钉进裁决，而不是留给下一次改写时的判断。

## D34 运行时与依赖如何分发

- **现状** — Claude 从绝对路径用 `npx tsx` 跑源码；Cursor 复制 TypeScript 并
  npm install；Codex 用无第三方依赖的 Python 脚本。三种方式的更新和前置不同。
- **裁决** — TypeScript 仍是唯一源码，发布时把引擎、yaml 解析和守卫打成一个
  `dist/companion.mjs`；运行只需 `node`，不调用 npx、不现场下载依赖。安装时先
  检查 Node，缺失就明确失败，不静默降级成另一套实现。
- **理由** — 单文件产物保留现有 TypeScript 基体，又消除目标仓库 npm install、
  绝对源码路径和网络依赖。为没有 Node 的环境另写 Python 副本会重新制造本次要
  消灭的漂移；真有需求时应增加独立打包目标，而不是第二套业务逻辑。

## D35 `claude-companion/` 冻结

- **现状** — 两份引擎从同一分钟起就是两份：`claude-companion/ideas.ts` 最后一次
  功能修复落在 2026-09-01 14:43:59，共同基座那次提交落在 14:44:19 —— 中间隔
  **二十秒**。也就是说「先在旧的上改，回头再同步过去」这件事，从基座存在的第一天
  起就没有发生过一次。旧目录当时还在跑：本仓库的 `.claude/settings.json` 里四个
  hook 调的还是 `claude-companion/guard.ts`，所以它那时删不得。今天不是这样了 ——
  五个 hook 事件调的都是 `.companion/companion.mjs guard --platform=claude`，
  `claude-companion/` 整个目录在磁盘上和索引里都已经没有。
- **裁决** — `claude-companion/` 冻结。除了热修（hotfix），任何改动都不落进这个
  目录；一次热修当天必须同步进 `companion/` 里对应的那份文件，两边一起改、一起
  跑测试，不留「等有空再同步」。新功能、新裁决、新测试一律只进 `companion/`。
  `claude-companion/FORMAT.md` 已经先一步冻结成一块指路牌（见本文件开头）。
  解冻只有一种方式，就是它消失 —— **这件事已经做完了**：本仓库自己的 hook 全部换到
  `.companion/companion.mjs`（五个事件），整个目录也已删除。本条自此只剩存档价值。
  （从前这里写着「今天没有任何想法认领」，并把换线记成 I-074 —— 图里 I-073 是
  Cursor 接入、I-074 是 Codex 接入，那是记错了。）
- **理由** — 两份跑得起来的引擎意味着两份行为，而守卫的每一条规则的输出都是
  「拒绝」：两份规则不一致时，人看到的要么是一次讲不出道理的拒绝，要么是更糟的
  ——一次本该拦住的放行。二十秒的分叉已经把话说完了：双份维护不是一个会被执行的
  承诺，写下来也不会。当时留着目录是因为现网还指着它，禁止在上面继续开发是因为
  每多改一次，那次换线要比对的东西就多一份。换线已经做完，目录也已删除。

## D36 网页上的一次动作凭什么算人做的（I-105）

- **现状** — 页面上的动作今天不产生任何机器可验证的「来自人」的证据。三样现有的
  东西一样都不算：`serve` 的令牌是进程级的、不作废，`GET /` 不校验就把它明文写进
  页面（拿到令牌等于能访问这个端口）；两步确认是同一条路由跑两遍，脚本连发两次
  效果相同；信封的 `baseDigest` 是乐观锁，证明新鲜度，不证明来源。
- **裁决** — 页面上的动作只能**发起**，不能**落地**；批准的唯一落点是人在对话里
  亲手打的那一句（`applyApproval`，由 `UserPromptSubmit` 喂进来）。**带外的例外**
  （2026-09-09 补，I-139 的前提）：一个有自己登录的宿主（例如 LifeCopilotBeta 的
  门户）在人过了登录之后，把人的那句原话连同一份凭证转给本地小服务的批准入口
  （`POST /approve`），这算人做的，条件三条缺一不可 —— 凭证只经环境变量交给小服务，
  不出现在页面、标准输出和记录里；宿主的登录不是 agent 能拿到的东西（密钥不进
  仓库、不进 agent 能读的文件）；回执只由引擎写，宿主不生成、不改写。三条里任何
  一条不成立，就退回本行原判。
- **理由** — 本地服务分不出人和自动化，这是实测，不是推论。2026-09-05 在本机
  做的实验，任何人可以照着重跑：用浏览器自动化（agent 驱动的浏览器）点一下页面
  上的按钮，页面里读到 `event.isTrusted === true`、
  `navigator.userActivation.isActive === true`、`navigator.webdriver === false`，
  和人手点的一模一样，所以「只有用户激活才会发」的那个请求头也会照发。再记一条
  外部事实：浏览器调试协议的虚拟安全密钥默认把「人在场」模拟成真
  （WebAuthn 虚拟认证器的 `automaticPresenceSimulation` 默认为 `true`），所以
  指纹、面容和硬件密钥这条路同样是死的 —— 它们看起来最像答案，不写清为什么不行，
  下一轮一定会有人再提一次。唯一结构上成立的办法是带外的第二处，这就是上面那段
  例外存在的原因：宿主的登录是 agent 拿不到的东西，而本地页面上的一切它都拿得到。
  收益账也要写下：网页直接批准想省的九成，I-102 和 I-103 已经给了（内容送到人
  眼前，人不再盲批），本地场景真正被省掉的只剩「抄一次口令」；用一次抄写换一整条
  新的信任链，不划算 —— 所以本地页面维持原判，只有带外登录的宿主才走例外。
  这套东西形同虚设的四种情况，也要写在人看得见的地方：逃生开关 `AIDEV_GUARD=off`
  打开；守卫看不见的出口（I-104 和 I-106 补的正是这一类）；守卫自己在归一化那一步
  崩掉；以及人不看内容就粘口令 —— 这一条守卫一个字都管不着，它正是 I-102 存在的
  全部理由。为什么必须写下来：D27 在 2026-09-02 刚裁过同一件事，三天后又被重新
  提出来，说明「维持现状」的理由没有记在一个下次会被读到的地方。

## 裁决之外：被弃用但值得记住的想法

这次明确不吸收的：Codex `code_refs.role`、一个想法多个 verification 对象、
八个工作状态、每 agent 一份图，以及 Cursor 的长期 `enforce:false` 图内开关。
被弃用实现保留在 git 历史；迁移完成并通过三边验收前，不删除任何旧引擎。
