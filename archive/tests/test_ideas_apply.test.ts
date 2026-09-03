import { describe, it, expect } from "vitest";
import { applyChanges, fingerprint } from "../../claude-companion/ideas.js";

// I-065 — 一条指令把改动文件写回想法图，注释原样保留。
//
// 核心是一个纯函数：收图的原文和一个信封，返回新的原文或者拒绝的理由，
// 全程不碰磁盘。命令行那一层只负责读文件、写文件、重渲染、记日志 ——
// 这样「写坏图」这件事在测试里就能穷举，不用真去改一个仓库。
//
// 三条保住 diff 的写法是在真实的图上量出来的，各有一条测试盯着：
// 转回文本不能带参数（带了会重排 1274/1301 行）、写前置要标成单行样式
// （直接塞数组会动 444 行）、删第一个想法时分节标题挂在整个序列上而不是那个节点上。

const TODAY = "2026-08-31";

/** 一张带注释、带分节标题、带单行 needs 的小图。 */
const yaml = `version: 1
agent: claude
project: fixture
endpoints: [ I-004 ]

ideas:

  # ─────────────────────────────────────────────
  # 地基
  # ─────────────────────────────────────────────
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: >
      W1
    why: >
      Y1
    expected: >
      E1
    how: >
      H1
    why_this_way: >
      T1
    code:
      - file: src/base.ts
        symbol: base
        lines: "1-20"
    verify: { command: "npx vitest run base.test.ts", pass: "exit 0" }
    future: >
      F1

  # 中间那一层
  - id: I-002
    name: "中间层"
    status: todo
    needs: [ I-001 ]
    what: >
      W2
    why: >
      Y2
    expected: >
      E2

  - id: I-003
    name: "另一条"
    status: todo
    needs: [ I-001 ]
    what: >
      W3

  - id: I-004
    name: "终点：做完了"
    status: todo
    needs: [ I-002, I-003 ]
    what: >
      W4
`;

const envelope = (ops: unknown[], over: Record<string, unknown> = {}) =>
  ({ v: 1, project: "D:/p", baseDigest: fingerprint(yaml), ops, ...over });

const ok = (ops: unknown[], src = yaml) => {
  const r = applyChanges(src, { v: 1, project: "D:/p", baseDigest: fingerprint(src), ops }, TODAY);
  expect(r.ok, "本该成功却被拒：" + r.reason).toBe(true);
  return r.text!;
};

const lineDiff = (before: string, after: string) => {
  const a = before.split("\n"), b = after.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
};

describe("I-065 把改动文件写回想法图", () => {
  // ── 最硬的那条约束 ──────────────────────────────────────────────────────
  it("改一个字段：注释和没动过的部分逐字保留", () => {
    const after = ok([{ op: "set", id: "I-002", field: "what", old: "W2", new: "新的说明" }]);
    expect(after).toContain("# 地基");
    expect(after).toContain("# 中间那一层");
    expect(after).toContain("新的说明");
    expect(after).not.toContain("W2");        // 旧值真的没了，不是被追加在后面
    // 只该动那一处。带参数转回文本会重排整份文件，这条就是盯着它的。
    expect(lineDiff(yaml, after)).toBeLessThan(4);
  });

  it("什么都不改时，转回来的文本逐字节等于原文", () => {
    expect(ok([])).toBe(yaml);
  });

  // 直接把数组塞进去会把单行的 needs: [ I-001 ] 变成三行列表，
  // 后面每一行都跟着挪位置 —— 在真实的图上实测是 444 行 vs 1 行。
  it("加一条前置：单行写法保住，不会把整份文件挤走", () => {
    const after = ok([{ op: "link", from: "I-003", to: "I-002" }]);
    expect(after).toMatch(/needs: \[ ?I-001, ?I-003 ?\]/);
    expect(lineDiff(yaml, after)).toBe(1);
  });

  it("断一条前置", () => {
    const after = ok([{ op: "unlink", from: "I-003", to: "I-004" }]);
    expect(after).toMatch(/needs: \[ ?I-002 ?\]/);
    expect(lineDiff(yaml, after)).toBe(1);
  });

  // ── 乐观锁 ─────────────────────────────────────────────────────────────
  it("指纹对不上，整体拒绝，一个字都不改", () => {
    const r = applyChanges(yaml, envelope([{ op: "set", id: "I-002", field: "what", old: "W2", new: "x" }],
      { baseDigest: "000000000000" }), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/指纹|改过/);
    expect(r.text).toBeUndefined();
  });

  it("版本号不认识，整体拒绝，而且排在指纹检查前面", () => {
    const r = applyChanges(yaml, envelope([], { v: 99, baseDigest: "000000000000" }), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/版本/);        // 先报版本，不是先报指纹
  });

  it("同一个改动文件应用第二次会被拒 —— 图已经不是当初那张了", () => {
    const ops = [{ op: "set", id: "I-002", field: "what", old: "W2", new: "新的说明" }];
    const once = ok(ops);
    const again = applyChanges(once, envelope(ops), TODAY);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/指纹|改过/);
  });

  // ── 坏图不落盘 ─────────────────────────────────────────────────────────
  it("应用之后校验不过，整体放弃，不返回任何新文本", () => {
    // I-002 还被 I-004 依赖着，删掉它会让 I-004 指向不存在的想法。
    const r = applyChanges(yaml, envelope([{ op: "remove", id: "I-002" }]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.text).toBeUndefined();
  });

  // ── 发编号 ─────────────────────────────────────────────────────────────
  it("临时号换成真编号，引用它的边一起换", () => {
    const after = ok([
      { op: "add", tmp: "tmp:1", fields: { name: "新想法", what: "W", why: "Y", expected: "E" } },
      { op: "link", from: "I-001", to: "tmp:1" },
    ]);
    expect(after, "改动文件里还留着临时号").not.toContain("tmp:");
    expect(after).toContain("I-005");                     // 最大是 I-004，所以发 I-005
    expect(after).toMatch(/needs: \[ ?I-001 ?\]/);
  });

  it("图里还没有取号计数器时，初值算成「出现过的最大编号 + 1」", () => {
    expect(yaml).not.toContain("next_id");
    const after = ok([{ op: "add", tmp: "tmp:1", fields: { name: "新", what: "W", why: "Y", expected: "E" } }]);
    expect(after).toMatch(/next_id: 6/);                  // 发掉 I-005，计数器停在 6
    // 这份文件是给人读的：计数器该待在顶上那几个键旁边，
    // 不该被追加到几百行想法的最后面。
    expect(after.indexOf("next_id")).toBeLessThan(after.indexOf("ideas:"));
  });

  it("计数器只增不减：删掉编号最大的想法，下一个新建也不复用它", () => {
    const first = ok([{ op: "add", tmp: "tmp:1", fields: { name: "甲", what: "W", why: "Y", expected: "E" } }]);
    expect(first).toContain("I-005");
    const second = ok([
      { op: "remove", id: "I-005" },
      { op: "add", tmp: "tmp:1", fields: { name: "乙", what: "W", why: "Y", expected: "E" } },
    ], first);
    expect(second).toContain("I-006");                    // 不是又一个 I-005
    expect(second).not.toContain("甲");
  });

  it("还剩没换掉的临时号，整体拒绝", () => {
    // link 指向一个从来没有 add 过的临时号。
    const r = applyChanges(yaml, envelope([{ op: "link", from: "tmp:9", to: "I-002" }]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/临时号|tmp/);
  });

  // ── 改动文件不能凭空造出「已完成」 ────────────────────────────────────
  it("新建的想法一律是 todo，payload 里的状态、记录和签字被剥掉", () => {
    const after = ok([{
      op: "add", tmp: "tmp:1",
      fields: {
        name: "伪造的", what: "W", why: "Y", expected: "E",
        status: "done", log: [{ date: "2020-01-01", note: "假的" }],
        verify: { manual: "假", signed_off: "假签名" },
      },
    }]);
    expect(after).toContain("伪造的");
    expect(after).not.toContain("假签名");
    expect(after).not.toContain("假的");
    const block = after.slice(after.indexOf("伪造的"));
    expect(block).toMatch(/status: todo/);
  });

  // ── 改了行为的已完成想法要退回去重走流程 ──────────────────────────────
  // guard 对已完成想法的代码文件直接放行，不降级的话，改了图之后
  // 那些代码就能不经批准被改。
  it("已完成的想法被改了行为字段，自动降回 doing 并留下记录", () => {
    const after = ok([{ op: "set", id: "I-001", field: "how", old: "H1", new: "换个做法" }]);
    const block = after.slice(after.indexOf("id: I-001"), after.indexOf("id: I-002"));
    expect(block).toMatch(/status: doing/);
    expect(block).toMatch(/log:/);
  });

  it("已完成的想法只改了不影响行为的字段，不降级", () => {
    const after = ok([{ op: "set", id: "I-001", field: "future", old: "F1", new: "以后还能这样用" }]);
    const block = after.slice(after.indexOf("id: I-001"), after.indexOf("id: I-002"));
    expect(block).toMatch(/status: done/);
  });

  // ── 删除 ───────────────────────────────────────────────────────────────
  it("删掉第一个想法时，挂在它上面的分节标题不会变成孤儿", () => {
    // I-001 被 I-002 和 I-003 依赖，先把两条边断掉再删。
    const after = ok([
      { op: "unlink", from: "I-001", to: "I-002" },
      { op: "unlink", from: "I-001", to: "I-003" },
      { op: "remove", id: "I-001" },
    ]);
    expect(after, "分节标题跟着被删掉的想法一起没了").toContain("# 地基");
    expect(after).not.toContain('name: "地基"');
  });

  it("删掉还被别人依赖的想法，拒绝", () => {
    const r = applyChanges(yaml, envelope([{ op: "remove", id: "I-001" }]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/依赖|I-002|I-003/);
  });

  // ── 状态 ───────────────────────────────────────────────────────────────
  it("改状态走既有的证据校验：没有 code/verify 的想法不能被标 done", () => {
    const r = applyChanges(yaml, envelope([{ op: "status", id: "I-003", from: "todo", to: "done" }]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/code|verify/);
  });

  it("合法的状态改动会自动留一条记录", () => {
    const after = ok([{ op: "status", id: "I-002", from: "todo", to: "doing" }]);
    const block = after.slice(after.indexOf("id: I-002"), after.indexOf("id: I-003"));
    expect(block).toMatch(/status: doing/);
    expect(block).toMatch(new RegExp(TODAY));
  });

  // ── 顺序 ───────────────────────────────────────────────────────────────
  // 按旧下标写会把改动落到错误的想法上。先改字段、后删节点，每个结构操作后
  // 重建快照，这条测试就是盯着那个静默污染。
  it("同一批里既删想法又改别的想法的字段，改动落在正确的想法上", () => {
    const after = ok([
      { op: "set", id: "I-004", field: "what", old: "W4", new: "终点的新说明" },
      { op: "unlink", from: "I-003", to: "I-004" },
      { op: "remove", id: "I-003" },
    ]);
    const block = after.slice(after.indexOf("id: I-004"));
    expect(block).toContain("终点的新说明");
    expect(after).not.toContain('name: "另一条"');
  });
});
