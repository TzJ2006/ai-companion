import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  load, graphPath, setStatus, isBuildReady, needsUnmet, childrenUnfinished, fileClash, allowWrite, addIdea,
  requestApproval, applyApproval, runCheck, render,
  type Graph, type Idea,
} from "../../companion/ideas.js";

// I-089 — Cursor 版的开工检查进入共同引擎：想法没想清楚、前置没做完，就不许开工；
// 文件和别人重叠只记进 log（I-149，引用不等于占用）；new 从 next_id 取号；allow 是写前自检。
// 裁决依据：D17（doing 的机器判定条件）、D18（doing 可并行，写互斥按会话在写时核对）、
// D19（四状态小转移表）、D28（发号只走 next_id）。
describe("companion readiness checks (I-089)", () => {
  let dir: string;
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");

  // 八问齐全的想法长这样；缺哪问就从这上面删哪问。
  const full = (id: string, file: string, extra = "") => `  - id: ${id}
    name: "想法 ${id}"
    status: todo
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: ${file}
        symbol: s
    verify:
      command: "npx vitest run tests/${id}.test.ts"
      test_files: [ tests/${id}.test.ts ]
      pass: "exit 0"
${extra}`;

  const yaml = `version: 1
project: fixture
endpoints: [I-004]
ideas:
  - id: I-001
    name: "已完成的地基"
    status: done
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/base.ts
        symbol: base
        lines: "1-1"
    verify: { command: "npx vitest run tests/base.test.ts", test_files: [ tests/base.test.ts ], pass: "exit 0" }
${full("I-002", "src/mid.ts").replace("needs: []", "needs: [I-001]")}
${full("I-003", "src/other.ts").replace("needs: []", "needs: [I-002]")}
  - id: I-004
    name: "还没想清楚的终点"
    status: todo
    needs: [I-003]
    what: W
    expected: E
    code:
      - file: src/late.ts
    verify: { command: "npx vitest run tests/late.test.ts", test_files: [ tests/late.test.ts ], pass: "exit 0" }
${full("I-005", "src/shared.ts").replace("status: todo", "status: doing")
    .replace('command: "npx vitest run tests/I-005.test.ts"', 'command: "node nope.cjs"')}
${full("I-006", "src/shared.ts")}
${full("I-007", "src/free.ts").replace("status: todo", "status: blocked")}
`;

  const graphOf = () => parseDocument(yaml).toJSON() as Graph;
  const byId = (g: Graph, id: string) => g.ideas.find((i) => i.id === id)!;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ready-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── isBuildReady：缺哪问，原样说出来 ─────────────────────────────────────

  it("isBuildReady names the exact missing plan field", () => {
    const g = graphOf();
    expect(isBuildReady(byId(g, "I-002"))).toBeNull();
    expect(isBuildReady(byId(g, "I-004"))).toMatch(/why/);
    // I-153：短记录 —— what、why、code.file、verify 就能开工；其余四问由 check 提示。
    const short = { ...byId(g, "I-002"), expected: undefined, how: undefined, why_this_way: undefined, future: undefined } as Idea;
    expect(isBuildReady(short)).toBeNull();
    const noVerify = { ...byId(g, "I-002"), verify: undefined } as Idea;
    expect(isBuildReady(noVerify)).toMatch(/verify/);
    const noCode = { ...byId(g, "I-002"), code: [] } as Idea;
    expect(isBuildReady(noCode)).toMatch(/code/);
    const noWhy = { ...byId(g, "I-002"), why: undefined } as Idea;
    expect(isBuildReady(noWhy)).toMatch(/why/);
  });

  it("needsUnmet lists exactly the unfinished prerequisites", () => {
    const g = graphOf();
    expect(needsUnmet(byId(g, "I-002"), g)).toBeNull();       // I-001 是 done
    expect(needsUnmet(byId(g, "I-003"), g)).toMatch(/I-002/); // I-002 还是 todo
  });

  it("fileClash reports the other doing idea holding the same file", () => {
    const g = graphOf();
    expect(fileClash(byId(g, "I-006"), g)).toMatch(/I-005/);  // 都要写 src/shared.ts
    expect(fileClash(byId(g, "I-002"), g)).toBeNull();
    expect(fileClash(byId(g, "I-005"), g)).toBeNull();        // 自己不和自己撞
  });

  // ── set 的闸门：todo→doing 三道检查 + 两次批准 + 小转移表 ─────────────────

  // 纯单元用法：没有项目目录，就没有回执可读，只剩三道检查。
  // I-133：转成受阻要带一句原因，所以这里默认给一句；测试真想验证「没原因就拒」时传空串。
  const trySet = (id: string, status: string, because = "测试里的受阻原因") => {
    const { doc, graph } = load(graphPath(dir));
    setStatus(doc, graph, id, status as Idea["status"] & string, { date: "2026-08-31", because });
    return String(doc);
  };

  // 真实用法（命令行 set 就是这条）：带项目目录，D17 的批准闸门生效。
  const trySetHere = (id: string, status: string) => {
    const { doc, graph } = load(graphPath(dir));
    setStatus(doc, graph, id, status as Idea["status"] & string, { date: "2026-08-31" }, dir);
    return String(doc);
  };

  const approve = (nodes: string[]) => {
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", nodes);
    applyApproval(dir, `批准 ${challenge}`, { date: "2026-08-31" });
  };

  it("refuses doing when a plan field is missing, and says which", () => {
    expect(() => trySet("I-004", "doing")).toThrow(/why/);
  });

  it("refuses doing when a prerequisite is not done, and names it", () => {
    expect(() => trySet("I-003", "doing")).toThrow(/I-002/);
  });

  // 2026-09-16（I-149）：引用不等于占用。重叠不再挡开工，只把对方记进 log；
  // 真正的写互斥在写那一刻按会话核对（协作模式，见 test_coord_guard）。
  it("allows doing when the file overlaps another doing idea, and logs who else references it", () => {
    const g = parseDocument(trySet("I-006", "doing")).toJSON() as Graph;
    const six = byId(g, "I-006");
    expect(six.status).toBe("doing");
    const last = six.log?.at(-1)?.note ?? "";
    expect(last).toContain("I-005: src/shared.ts");
    expect(last).toContain("引用不等于占用");
  });

  it("allows doing when ready, prerequisites done, no overlap — no project dir, no receipts to read", () => {
    expect(trySet("I-002", "doing")).toContain("status: doing");
  });

  // D17：开工要的是这个想法当前有效的计划批准（人看过它的八问）。缺了就点名该跑
  // 的那条命令，不让人猜。
  // 2026-09-16（I-146）：进 doing 不再要人工批准 —— 八问齐、前置完、路径不冲突就行。
  it("allows doing with no approval on file at all", () => {
    expect(trySetHere("I-002", "doing")).toContain("status: doing");
  });

  it("an approval lying around changes nothing either way", () => {
    approve(["I-002"]);
    expect(trySetHere("I-002", "doing")).toContain("status: doing");
  });

  it("allows blocked → doing without an approval as well", () => {
    expect(trySetHere("I-007", "doing")).toContain("status: doing");
  });

  it("enforces the small transition table", () => {
    expect(() => trySet("I-002", "done")).toThrow(/todo.*done|转移/);   // 不许跳过 doing
    expect(() => trySet("I-001", "doing")).toThrow(/done.*doing|转移/); // done 只能回 blocked
    expect(() => trySet("I-005", "todo")).toThrow(/doing.*todo|转移/);
    expect(trySet("I-001", "blocked")).toContain("status: blocked");    // 回归了：合法
    expect(trySet("I-007", "doing")).toContain("status: doing");        // blocked → doing 合法
  });

  // I-133：受阻必须说清为什么；原因写进 blocked_because，离开受阻时字段跟着走。
  it("blocked needs a reason, stores it beside status, and drops it on the way out", () => {
    expect(() => trySet("I-001", "blocked", "")).toThrow(/reason|原因/);
    const blocked = trySet("I-001", "blocked", "等 I-009 的接口定下来");
    expect(blocked).toContain("blocked_because: 等 I-009 的接口定下来");
    // I-007 本来就是受阻的，走出去时字段该消失。
    const back = trySet("I-007", "doing");
    expect(back).not.toMatch(/I-007[\s\S]*?blocked_because/);
  });

  // ── new：发号只从 next_id 走 ─────────────────────────────────────────────

  it("addIdea takes the next_id when present, and never recycles a deleted number", () => {
    // 图里记着 next_id: 9 —— 哪怕现存最大编号只有 I-007（模拟 I-008 被删掉）。
    const text = yaml.replace("ideas:", "next_id: 9\nideas:");
    const doc = parseDocument(text);
    const graph = doc.toJSON() as Graph;
    const id = addIdea(doc, graph, "新想法", ["I-001"], "2026-08-31");
    expect(id).toBe("I-009");
    expect(String(doc)).toContain("next_id: 10");
  });

  it("addIdea initialises a missing next_id from the highest number ever used", () => {
    const doc = parseDocument(yaml);
    const graph = doc.toJSON() as Graph;
    const id = addIdea(doc, graph, "新想法", [], "2026-08-31");
    expect(id).toBe("I-008");
    const text = String(doc);
    expect(text).toContain("next_id: 9");
    // 计数器要放在顶层键那一段，不能吊在几百行想法之后。
    expect(text.indexOf("next_id:")).toBeLessThan(text.indexOf("ideas:"));
  });

  it("addIdea refuses an unknown prerequisite", () => {
    const doc = parseDocument(yaml);
    const graph = doc.toJSON() as Graph;
    expect(() => addIdea(doc, graph, "坏想法", ["I-999"], "2026-08-31")).toThrow(/I-999/);
  });

  // ── allow：写前自检，答案与守卫同源 ──────────────────────────────────────

  it("allowWrite allows files claimed by a ready doing idea, code and tests alike", () => {
    const g = graphOf();
    expect(allowWrite(g, dir, join(dir, "src", "shared.ts")).allow).toBe(true);
    expect(allowWrite(g, dir, join(dir, "tests", "I-005.test.ts")).allow).toBe(true);
  });

  it("allowWrite denies an unclaimed file with a reason", () => {
    const g = graphOf();
    const v = allowWrite(g, dir, join(dir, "src", "unclaimed.ts"));
    expect(v.allow).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it("allowWrite ignores a doing idea that is not build-ready", () => {
    const g = graphOf();
    const shared = g.ideas.find((i) => i.id === "I-005")!;
    delete (shared as { why?: string }).why;                 // doing 却连为什么都没写（I-153 后 how 不再是门）
    expect(allowWrite(g, dir, join(dir, "src", "shared.ts")).allow).toBe(false);
  });

  it("allowWrite always allows the ledger", () => {
    const g = graphOf();
    expect(allowWrite(g, dir, join(dir, "ideas", "graph.yaml")).allow).toBe(true);
  });

  // ── CLI 接线：new / allow / status 真跑一遍 ──────────────────────────────

  it("cli new prints the id and persists the counter", { timeout: 60_000 }, () => {
    const r = spawnSync("npx", ["tsx", ENGINE, "new", "命令行新想法", "--needs", "I-001",
      "--project", dir, "--date", "2026-08-31"],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("I-008");
    const text = readFileSync(join(dir, "ideas", "graph.yaml"), "utf8");
    expect(text).toContain("命令行新想法");
    expect(text).toContain("next_id: 9");
  });

  // I-153：小改动一条命令建好就能开工 —— what/why/code/verify 随 new 一起给。
  it("cli new with the short-record flags yields an idea that is ready at once", { timeout: 60_000 }, () => {
    const r = spawnSync("npx", ["tsx", ENGINE, "new", "改一行README",
      "--what", "把五个技能改成六个", "--why", "README 数错了", "--code", "README.md",
      "--verify", "vitest", "--parent", "I-001",
      "--project", dir, "--date", "2026-09-16"],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(r.status).toBe(0);
    const { graph } = load(graphPath(dir));
    const idea = graph.ideas.find((i) => i.name === "改一行README")!;
    expect(idea.parent).toBe("I-001");
    expect(idea.code?.[0]?.file).toBe("README.md");
    expect(idea.verify?.command).toBe("vitest");
    expect(isBuildReady(idea)).toBeNull();
  });

  it("cli status shows where every idea is stuck; cli allow answers with an exit code", { timeout: 60_000 }, () => {
    const s = spawnSync("npx", ["tsx", ENGINE, "status", "--project", dir],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(s.status).toBe(0);
    const lines = s.stdout.split("\n");
    expect(lines.find((l) => l.includes("I-004"))).toMatch(/why/);      // 缺 why
    expect(lines.find((l) => l.includes("I-003"))).toMatch(/I-002/);    // 在等 I-002
    expect(lines.find((l) => l.includes("I-002"))).toMatch(/READY/i);   // 现在就能做

    // I-099 起 allow 给出守卫的完整判决：能写 = 认领 + 计划批准 + 失败记录俱在。
    // H5 起还要那份测试文件真的在：没有测试可失败，红就不算红。
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "I-005.test.ts"), "// 会失败的测试\n");
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-005"]);
    applyApproval(dir, `批准 ${challenge}`, { date: "2026-08-31" });
    runCheck(dir, load(graphPath(dir)).graph, "I-005", "red");

    const ok = spawnSync("npx", ["tsx", ENGINE, "allow", "src/shared.ts", "--project", dir],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/allow/);
    const no = spawnSync("npx", ["tsx", ENGINE, "allow", "src/unclaimed.ts", "--project", dir],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(no.status).toBe(1);
    expect(no.stdout).toMatch(/deny/);
  });
});

// I-135 —— 完成一个父想法，要它的子想法先全部完成。这道门是 done 分支上的第五道，
// 只依赖图本身（parent 和 status 都在图里），所以不带项目目录的纯单元调用照样看得见它。
// 三条人批的裁决各由一组断言钉住：受阻的子想法算「没完成」；门只看直接子想法；
// 签字侧的那一道在 test_base_approval.test.ts 里。
describe("parent completion gate (I-135)", () => {
  const node = (id: string, status: string, parent?: string) =>
    `  - id: ${id}
    name: "想法 ${id}"
    status: ${status}
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
${parent ? `    parent: ${parent}\n` : ""}    code:
      - file: src/${id}.ts
        symbol: s
    verify: { command: "npx vitest run tests/${id}.test.ts", test_files: [ tests/${id}.test.ts ], pass: "exit 0" }
`;

  const tree = (...rows: string[]) => `version: 1
project: tree
endpoints: []
ideas:
${rows.join("")}`;

  // 纯单元用法：没有项目目录，GREEN 和批准两道门让开，剩下的正是这道新门。
  const move = (text: string, id: string, status: Idea["status"] & string) => {
    const doc = parseDocument(text);
    const graph = doc.toJSON() as Graph;
    setStatus(doc, graph, id, status, { date: "2026-09-07", because: status === "blocked" ? "测试里的受阻原因" : undefined });
    return (parseDocument(String(doc)).toJSON() as Graph).ideas.find((i) => i.id === id)!.status;
  };
  const graphOfTree = (text: string) => parseDocument(text).toJSON() as Graph;
  const pick = (g: Graph, id: string) => g.ideas.find((i) => i.id === id)!;

  it("refuses done while a direct child is unfinished, and names it", () => {
    const text = tree(node("I-010", "doing"), node("I-011", "done", "I-010"), node("I-012", "todo", "I-010"));
    expect(() => move(text, "I-010", "done")).toThrow(/I-012/);
  });

  // 点名要点全 —— find 而不是 filter 的实现只说得出第一个，人修完一个又撞一次墙。
  it("names every unfinished child, not just the first", () => {
    const text = tree(node("I-010", "doing"), node("I-011", "todo", "I-010"), node("I-012", "todo", "I-010"));
    expect(() => move(text, "I-010", "done")).toThrow(/I-011/);
    expect(() => move(text, "I-010", "done")).toThrow(/I-012/);
  });

  // 裁决一：这套格式里「废弃」的归宿就是保留编号、置受阻、写明原因 —— 那是「这件事
  // 没做」的记录。写成 status === "todo" 的实现会在这里放行，而本仓库的图上不会暴露。
  it("a blocked child blocks just as hard as a todo one", () => {
    const text = tree(node("I-010", "doing"), node("I-011", "blocked", "I-010"));
    expect(() => move(text, "I-010", "done")).toThrow(/I-011/);
  });

  // 裁决二：只看直接子想法。整棵子树都守住，靠的是每一层各自守住，不是这道门去遍历。
  it("looks at direct children only — an unfinished grandchild does not block", () => {
    const text = tree(
      node("I-010", "doing"), node("I-011", "done", "I-010"),
      node("I-012", "done", "I-010"), node("I-013", "todo", "I-012"),
    );
    expect(move(text, "I-010", "done")).toBe("done");
  });

  it("an idea with no children is untouched by the gate", () => {
    expect(move(tree(node("I-014", "doing")), "I-014", "done")).toBe("done");
  });

  // 门装在 done 分支里，不装在 setStatus 的入口 —— 一个被子想法挡住的父想法，
  // 仍然要能被标成受阻（D19 允许 doing → blocked）。
  it("the gate is on done only — doing → blocked still works with unfinished children", () => {
    const text = tree(node("I-010", "doing"), node("I-011", "todo", "I-010"));
    expect(move(text, "I-010", "blocked")).toBe("blocked");
  });

  it("childrenUnfinished names the open children, and is null when every direct child is done", () => {
    const open = graphOfTree(tree(node("I-010", "doing"), node("I-011", "todo", "I-010")));
    expect(childrenUnfinished(pick(open, "I-010"), open)).toMatch(/I-011/);

    const shut = graphOfTree(tree(node("I-010", "doing"), node("I-011", "done", "I-010")));
    expect(childrenUnfinished(pick(shut, "I-010"), shut)).toBeNull();

    // 没有子想法的想法：null，不是一句空话。
    expect(childrenUnfinished(pick(shut, "I-011"), shut)).toBeNull();
  });

  // 网页上的那一道。签字是人工验收想法唯一的关门方式，所以按钮必须和引擎同步 ——
  // 而且是灰掉、不是藏起来：控件凭空消失，人分不清那是规矩还是页面坏了。
  const manualNode = (id: string, status: string) =>
    `  - id: ${id}
    name: "想法 ${id}"
    status: ${status}
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/${id}.ts
        symbol: s
    verify: { manual: "打开页面亲眼看一遍", signed_off: null }
`;

  it("the page greys the sign button instead of hiding it, and says which child is holding it", () => {
    const open = graphOfTree(tree(manualNode("I-010", "doing"), node("I-011", "todo", "I-010")));
    const html = render(open);
    expect(html).toContain("人工签字");                       // 按钮还在，没被藏起来
    expect(html).toContain('<button class="sign-open" disabled>');
    expect(html).toMatch(/class="gate-why">[^<]*I-011/);      // 说清是谁挡着
    expect(html).not.toContain('data-sign="I-010"');          // 面板按这个属性开，打不开

    const shut = graphOfTree(tree(manualNode("I-010", "doing"), node("I-011", "done", "I-010")));
    const ok = render(shut);
    expect(ok).toContain('data-sign="I-010"');                // 子想法完成，同时解锁
    expect(ok).not.toContain('<button class="sign-open" disabled>');
  });

  // parent 指到图外的编号，页面把它当顶层；这道门必须用同一条规则，否则同一个想法
  // 在页面上和在闸门上归属不同。
  it("a parent id that is not in the graph attaches the idea to nobody", () => {
    const g = graphOfTree(tree(node("I-010", "doing"), node("I-011", "todo", "I-999")));
    expect(childrenUnfinished(pick(g, "I-010"), g)).toBeNull();
    expect(move(tree(node("I-010", "doing"), node("I-011", "todo", "I-999")), "I-010", "done")).toBe("done");
  });
});
