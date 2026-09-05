import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  load, graphPath, setStatus, isBuildReady, needsUnmet, fileClash, allowWrite, addIdea,
  requestApproval, applyApproval, runCheck,
  type Graph, type Idea,
} from "../../companion/ideas.js";

// I-089 — Cursor 版的开工检查进入共同引擎：想法没想清楚、前置没做完、文件和
// 别人重叠，就不许开工；new 从 next_id 取号；allow 是写前自检。
// 裁决依据：D17（doing 的机器判定条件）、D18（doing 可并行但文件不得重叠）、
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
    why: Y
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
    expect(isBuildReady(byId(g, "I-004"))).toMatch(/how/);
    const noVerify = { ...byId(g, "I-002"), verify: undefined } as Idea;
    expect(isBuildReady(noVerify)).toMatch(/verify/);
    const noCode = { ...byId(g, "I-002"), code: [] } as Idea;
    expect(isBuildReady(noCode)).toMatch(/code/);
    const noExpected = { ...byId(g, "I-002"), expected: undefined } as Idea;
    expect(isBuildReady(noExpected)).toMatch(/expected/);
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
  const trySet = (id: string, status: string) => {
    const { doc, graph } = load(graphPath(dir));
    setStatus(doc, graph, id, status as Idea["status"] & string, { date: "2026-08-31" });
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
    expect(() => trySet("I-004", "doing")).toThrow(/how/);
  });

  it("refuses doing when a prerequisite is not done, and names it", () => {
    expect(() => trySet("I-003", "doing")).toThrow(/I-002/);
  });

  it("refuses doing when the file overlaps another doing idea", () => {
    expect(() => trySet("I-006", "doing")).toThrow(/I-005/);
  });

  it("allows doing when ready, prerequisites done, no overlap — no project dir, no receipts to read", () => {
    expect(trySet("I-002", "doing")).toContain("status: doing");
  });

  // D17：开工要的是这个想法当前有效的计划批准（人看过它的八问）。缺了就点名该跑
  // 的那条命令，不让人猜。
  it("refuses doing with no approval, and names the plan command for this idea", () => {
    expect(() => trySetHere("I-002", "doing")).toThrow(/request-approval --node I-002/);
  });

  it("another idea's approval does not count — each idea is approved on its own", () => {
    approve(["I-003"]);
    expect(() => trySetHere("I-002", "doing")).toThrow(/request-approval --node I-002/);
  });

  it("allows doing once this idea's approval is current", () => {
    approve(["I-002"]);
    expect(trySetHere("I-002", "doing")).toContain("status: doing");
  });

  // 走 blocked 绕一圈也没用：闸门看的是「进入 doing」，不是上一个状态。
  it("refuses blocked → doing without the approval as well", () => {
    expect(() => trySetHere("I-007", "doing")).toThrow(/request-approval --node I-007/);
  });

  it("enforces the small transition table", () => {
    expect(() => trySet("I-002", "done")).toThrow(/todo.*done|转移/);   // 不许跳过 doing
    expect(() => trySet("I-001", "doing")).toThrow(/done.*doing|转移/); // done 只能回 blocked
    expect(() => trySet("I-005", "todo")).toThrow(/doing.*todo|转移/);
    expect(trySet("I-001", "blocked")).toContain("status: blocked");    // 回归了：合法
    expect(trySet("I-007", "doing")).toContain("status: doing");        // blocked → doing 合法
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
    delete (shared as { how?: string }).how;                 // doing 却没想清楚
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

  it("cli status shows where every idea is stuck; cli allow answers with an exit code", { timeout: 60_000 }, () => {
    const s = spawnSync("npx", ["tsx", ENGINE, "status", "--project", dir],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(s.status).toBe(0);
    const lines = s.stdout.split("\n");
    expect(lines.find((l) => l.includes("I-004"))).toMatch(/how/);      // 缺 how
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
