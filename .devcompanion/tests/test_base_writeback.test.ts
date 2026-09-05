import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyChanges, fingerprint, requestSignatures, applyApproval, requestApproval, load, graphPath,
} from "../../companion/ideas.js";

// B1 — 写回是网页和写回指令共用的唯一写入口，所以它写得进什么，就等于网页能
// 越过多少道门。四个口子各有一条测试：
// (1) D24 —— `set` 有字段白名单，改不到 status / verify / 任何生命周期字段；
// (2) D20 —— 信封里改不出 done，完成必须在有证据的地方做；
// (3) D27 —— `sign` 只是「请求签字」，签名由人回一次性口令时才落进图；
// (4) D19 —— 已完成的想法被改了行为字段退回 blocked，而不是绕过转移表跳到 doing。
// 后半段是从 claude 版的 test_ideas_apply.test.ts 搬过来的那些实打实的约束：
// 注释逐字保留、单行 needs、指纹锁、发号只增不减、坏图不落盘。

const TODAY = "2026-09-02";

/** 一张带注释、带分节标题、带单行 needs 的小图。 */
const yaml = `version: 1
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
    status: doing
    needs: [ I-001 ]
    what: >
      W2
    why: >
      Y2
    expected: >
      E2
    how: >
      H2
    why_this_way: >
      T2
    future: >
      F2
    code:
      - file: src/mid.ts
        symbol: mid
    verify: { command: "npx vitest run mid.test.ts", pass: "exit 0" }

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
    verify: { manual: "亲眼打开页面看一遍", signed_off: null }
`;

const envelope = (ops: unknown[], over: Record<string, unknown> = {}) =>
  ({ v: 1, project: "D:/p", baseDigest: fingerprint(yaml), ops, ...over });

const apply = (ops: unknown[], src = yaml) =>
  applyChanges(src, { v: 1, project: "D:/p", baseDigest: fingerprint(src), ops }, TODAY);

const ok = (ops: unknown[], src = yaml) => {
  const r = apply(ops, src);
  expect(r.ok, "本该成功却被拒：" + r.reason).toBe(true);
  return r.text!;
};

const blockOf = (text: string, id: string) => {
  const start = text.indexOf(`id: ${id}`);
  const rest = text.slice(start);
  const next = rest.indexOf("\n  - id:");
  return next < 0 ? rest : rest.slice(0, next);
};

const lineDiff = (before: string, after: string) => {
  const a = before.split("\n"), b = after.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
};

describe("companion 写回的四个口子（B1）", () => {
  // ── D24：set 的字段白名单 ───────────────────────────────────────────────
  // 没有白名单时，`set` 把 status 写成一个折叠标量，读回来是一个完全合法的
  // 状态 —— 一份改动文件就这样把想法标成了 done：没有转移表、没有证据、
  // 没有批准、没有一条记录。
  it("set 改不到 status：一份改动文件不能这样把想法标成 done", () => {
    const r = apply([{ op: "set", id: "I-002", field: "status", old: "doing", new: "done" }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/status/);
    expect(r.text).toBeUndefined();
  });

  it("set 改不到 verify：签字栏不能被当成一个普通字段写掉", () => {
    const r = apply([{
      op: "set", id: "I-004", field: "verify",
      old: "", new: "{ manual: 看过了, signed_off: 某人签的 }",
    }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/verify|字段/);
    expect(r.text).toBeUndefined();
  });

  it("set 改不到 log：记录只能由写回自己追加", () => {
    const r = apply([{ op: "set", id: "I-003", field: "log", old: "", new: "假记录" }]);
    expect(r.ok).toBe(false);
    expect(r.text).toBeUndefined();
  });

  it("白名单里的字段照常能改，新建的空卡片也照样能被填上名字", () => {
    const after = ok([
      { op: "add", tmp: "tmp:1", fields: { name: "", what: "", why: "", expected: "" } },
      { op: "set", id: "tmp:1", field: "name", old: "", new: "新想法" },
      { op: "set", id: "tmp:1", field: "what", old: "", new: "W5" },
    ]);
    expect(after).toContain("新想法");
    expect(after).toContain("W5");
  });

  // ── D20：信封里改不出 done ──────────────────────────────────────────────
  // 这条想法有 code、有 verify、状态就在 doing 上 —— 旧写法一路放行，因为
  // 它调 setStatus 时不带项目目录，绿灯那一关按设计被跳过，而写回是从 Bash
  // 里落盘的，守卫根本看不见。
  it("status 改不出 done —— 没有当前有效的 GREEN，网页就不能宣布完成", () => {
    const r = apply([{ op: "status", id: "I-002", from: "doing", to: "done" }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/GREEN|run-check/);
    expect(r.text).toBeUndefined();
  });

  it("其余状态照常走 setStatus 的那几道关", () => {
    // I-003 只答了一个问题，进不了 doing —— 带上项目目录，拦住它的就是就绪那一关。
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    dirs.push(dir);
    const r = applyChanges(yaml,
      envelope([{ op: "status", id: "I-003", from: "todo", to: "doing" }]), TODAY, dir);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cannot be doing|想清楚/);

    // 合法的那些照常能改，并且自动留一条记录。
    const after = ok([{ op: "status", id: "I-003", from: "todo", to: "blocked" }]);
    const block = blockOf(after, "I-003");
    expect(block).toMatch(/status: blocked/);
    expect(block).toMatch(new RegExp(TODAY));
  });

  // ── D27：sign 只提请求，不落签名 ────────────────────────────────────────
  it("sign 不写签字栏，只带出一条待签请求", () => {
    const r = apply([{ op: "sign", id: "I-004", who: "某人", words: "看过了，页面能点开" }]);
    expect(r.ok).toBe(true);
    expect(r.text).not.toContain("某人");
    expect(blockOf(r.text!, "I-004")).toMatch(/signed_off: null/);
    expect(r.signRequests).toEqual([{ id: "I-004", who: "某人", words: "看过了，页面能点开" }]);
  });

  it("sign 的三条拒绝理由照旧：不是人工验证、已经签过、名字或原话是空的", () => {
    expect(apply([{ op: "sign", id: "I-002", who: "某人", words: "验过了" }]).reason)
      .toMatch(/不是人工检查/);
    expect(apply([{ op: "sign", id: "I-004", who: "  ", words: "验过了" }]).reason)
      .toMatch(/名字/);
    expect(apply([{ op: "sign", id: "I-004", who: "某人", words: "   " }]).reason)
      .toMatch(/原话/);

    const signed = yaml.replace("signed_off: null", 'signed_off: "老王 2026-01-01 —— 看过了"');
    const r = applyChanges(signed,
      { v: 1, project: "D:/p", baseDigest: fingerprint(signed), ops: [{ op: "sign", id: "I-004", who: "某人", words: "我也看过了" }] },
      TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已经签过/);
  });

  // 请求发出去之后，真正把签字写进图的仍然只有人回口令那一下。
  it("请求变成一次性口令：人回口令，签字才落进图", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(graphPath(dir), yaml);

    const { graph } = load(graphPath(dir));
    const lines = requestSignatures(dir, graph, [{ id: "I-004", who: "某人", words: "看过了" }], TODAY);
    expect(lines).toHaveLength(1);
    const challenge = /CC-[0-9A-F]{8}/.exec(lines[0])![0];

    // 口令没被回答之前，图里一个字都没多。
    expect(readFileSync(graphPath(dir), "utf8")).toBe(yaml);

    expect(applyApproval(dir, `批准 ${challenge}`, { date: TODAY })?.ok).toBe(true);
    const after = readFileSync(graphPath(dir), "utf8");
    expect(after).toContain("某人");
    expect(after).toContain(challenge);
  });

  // ── D19：行为字段被改，退回 blocked ─────────────────────────────────────
  it("已完成的想法被改了行为字段，退回 blocked（不是绕过转移表跳到 doing）", () => {
    const after = ok([{ op: "set", id: "I-001", field: "how", old: "H1", new: "换个做法" }]);
    const block = blockOf(after, "I-001");
    expect(block).toMatch(/status: blocked/);
    expect(block).not.toMatch(/status: doing/);
    expect(block).toMatch(/log:/);
  });

  it("已完成的想法只改了不影响行为的字段，不退回", () => {
    const after = ok([{ op: "set", id: "I-001", field: "future", old: "F1", new: "以后还能这样用" }]);
    expect(blockOf(after, "I-001")).toMatch(/status: done/);
  });

  it("同一个想法上两个行为字段一起改，只退一次，不会撞上转移表", () => {
    const after = ok([
      { op: "set", id: "I-001", field: "how", old: "H1", new: "换个做法" },
      { op: "set", id: "I-001", field: "expected", old: "E1", new: "换个预期" },
    ]);
    const block = blockOf(after, "I-001");
    expect(block).toMatch(/status: blocked/);
    expect(block.match(/自动退回 blocked/g) ?? []).toHaveLength(1);
  });

  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
});

// ── D17：信封里的状态操作，走的必须是命令行 set 那同一批门 ──────────────────
// done 那条口子上一轮堵上了，doing 没有 —— 而 doing 才是解锁产品代码写入的那个
// 状态。写回调 setStatus 时不带项目目录，setStatus 里那两道人工批准（拆分、
// 计划）就整段跳过：一份改动文件从 Bash 里落盘，守卫看不见，想法就这样进了
// doing，没有任何人看过。
describe("写回里的 doing 和命令行 set 同门（D17）", () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** 一条八问答齐、前置也做完了的 todo —— 该进 doing 的，只差人点头。 */
  const readyYaml = `version: 1
project: fixture
endpoints: [ I-002 ]

ideas:

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
    future: >
      F1
    code:
      - file: src/base.ts
        symbol: base
    verify: { command: "npx vitest run base.test.ts", pass: "exit 0" }

  - id: I-002
    name: "接着做的那条"
    status: todo
    needs: [ I-001 ]
    what: >
      W2
    why: >
      Y2
    expected: >
      E2
    how: >
      H2
    why_this_way: >
      T2
    future: >
      F2
    code:
      - file: src/next.ts
        symbol: next
    verify: { command: "npx vitest run next.test.ts", pass: "exit 0" }
`;

  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-doing-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(graphPath(dir), readyYaml);
    return dir;
  };

  const toDoing = (dir?: string) => applyChanges(readyYaml, {
    v: 1, project: "fixture", baseDigest: fingerprint(readyYaml),
    ops: [{ op: "status", id: "I-002", from: "todo", to: "doing" }],
  }, TODAY, dir);

  it("没有人工批准，信封推不动 doing，而且话里点名去哪儿要批准", () => {
    const r = toDoing(project());
    expect(r.ok, "一个批准都没有，改动文件却把想法推进了 doing").toBe(false);
    expect(r.reason).toMatch(/request-approval --node I-002/);
    expect(r.text).toBeUndefined();
  });

  it("这个想法的批准齐了，同一份信封照常写得进去", () => {
    const dir = project();
    const { graph } = load(graphPath(dir));
    const { challenge } = requestApproval(dir, graph, "plan", ["I-002"], { by: "人", date: TODAY });
    expect(applyApproval(dir, `批准 ${challenge}`, { date: TODAY })?.ok).toBe(true);
    const r = toDoing(dir);
    expect(r.ok, "批准齐了却写不进去：" + r.reason).toBe(true);
    expect(blockOf(r.text!, "I-002")).toMatch(/status: doing/);
  });

  // 没有项目目录就没有地方读批准回执，所以这里只能拒 —— 和 done 那条一样的
  // 道理（D20 的注释里写着：拿不到项目目录的调用方必须自己拒）。
  it("拿不到项目目录时，doing 一律拒，而不是悄悄放行", () => {
    const r = toDoing(undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/项目目录|request-approval/);
    expect(r.text).toBeUndefined();
  });
});

// 下面这些是从 claude 版 test_ideas_apply.test.ts 搬过来的：基座之前一条都没有。
describe("companion 写回的本分（自 I-065 移植）", () => {
  // ── 最硬的那条约束 ──────────────────────────────────────────────────────
  it("改一个字段：注释和没动过的部分逐字保留", () => {
    const after = ok([{ op: "set", id: "I-002", field: "what", old: "W2", new: "新的说明" }]);
    expect(after).toContain("# 地基");
    expect(after).toContain("# 中间那一层");
    expect(after).toContain("新的说明");
    expect(after).not.toContain("W2");        // 旧值真的没了，不是被追加在后面
    expect(lineDiff(yaml, after)).toBeLessThan(4);
  });

  it("什么都不改时，转回来的文本逐字节等于原文", () => {
    expect(ok([])).toBe(yaml);
  });

  // 直接把数组塞进去会把单行的 needs: [ I-001 ] 变成三行列表，后面每一行都跟着挪。
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
    expect(r.reason).toMatch(/版本/);
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
    expect(after).toContain("I-005");
    expect(after).toMatch(/needs: \[ ?I-001 ?\]/);
  });

  it("图里还没有取号计数器时，初值算成「出现过的最大编号 + 1」", () => {
    expect(yaml).not.toContain("next_id");
    const after = ok([{ op: "add", tmp: "tmp:1", fields: { name: "新", what: "W", why: "Y", expected: "E" } }]);
    expect(after).toMatch(/next_id: 6/);
    expect(after.indexOf("next_id")).toBeLessThan(after.indexOf("ideas:"));
  });

  it("计数器只增不减：删掉编号最大的想法，下一个新建也不复用它", () => {
    const first = ok([{ op: "add", tmp: "tmp:1", fields: { name: "甲", what: "W", why: "Y", expected: "E" } }]);
    expect(first).toContain("I-005");
    const second = ok([
      { op: "remove", id: "I-005" },
      { op: "add", tmp: "tmp:1", fields: { name: "乙", what: "W", why: "Y", expected: "E" } },
    ], first);
    expect(second).toContain("I-006");
    expect(second).not.toContain("甲");
  });

  it("还剩没换掉的临时号，整体拒绝", () => {
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
    expect(blockOf(after, "I-005")).toMatch(/status: todo/);
  });

  // ── 删除 ───────────────────────────────────────────────────────────────
  it("删掉第一个想法时，挂在它上面的分节标题不会变成孤儿", () => {
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

  // ── 顺序 ───────────────────────────────────────────────────────────────
  // 按旧下标写会把改动落到错误的想法上。
  it("同一批里既删想法又改别的想法的字段，改动落在正确的想法上", () => {
    const after = ok([
      { op: "set", id: "I-004", field: "what", old: "W4", new: "终点的新说明" },
      { op: "unlink", from: "I-003", to: "I-004" },
      { op: "remove", id: "I-003" },
    ]);
    expect(blockOf(after, "I-004")).toContain("终点的新说明");
    expect(after).not.toContain('name: "另一条"');
  });
});
