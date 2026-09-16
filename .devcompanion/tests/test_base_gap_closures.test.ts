import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  load, graphPath, writeWorklist, readWorklist, strike,
  requestApproval, applyApproval, runCheck, decideProductWrite,
} from "../../companion/ideas.js";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// I-099 — 裁决表已裁但没落地的三个口子：
// (1) D10：迁移输入（带 agent 后缀的旧图）只读，直接写被拒且理由指向 migrate；
// (2) D12：扫描划除记内容指纹，读过的文件内容一变自动回到未读；无指纹的存量
//     记录继续算已读，不惩罚旧数据；
// (3) allow 与守卫同源：decideProductWrite 一个函数答完认领、批准、失败记录
//     三层，守卫对产品文件的判决就是它。
describe("companion gap closures (I-099)", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "进行中的想法"
    status: doing
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/a.ts
    verify:
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const meta = { date: "2026-09-01" };
  const loadGraph = () => load(graphPath(dir)).graph;
  const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({ event: "pre-write", tool: "Edit", cwd: dir, ...over });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gaps-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert\n");
    writeFileSync(join(dir, "checker.cjs"), `process.exit(require("fs").existsSync("impl.flag") ? 0 : 1);\n`);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (1) 旧后缀图只读 ─────────────────────────────────────────────────────

  it("writes to legacy suffixed graphs are denied and point at migrate", () => {
    for (const name of ["graph.claude.yaml", "graph.cursor.yaml", "graph.codex.yaml"]) {
      const v = decide(ev({ paths: [join(dir, "ideas", name)] }), dir);
      expect(v.allow, name).toBe(false);
      expect(v.reason).toMatch(/migrate|只读/);
    }
    // 平名的项目图和日志照旧可写
    expect(decide(ev({ paths: [graphPath(dir)], edit: { old_string: "W", new_string: "W2" } }), dir).allow).toBe(true);
    expect(decide(ev({ paths: [join(dir, "ideas", "log.md")] }), dir).allow).toBe(true);
  });

  // ── (2) 内容指纹：读过的文件变了就回到未读 ───────────────────────────────

  it("an edited file drops back to unread; unchanged files stay read", () => {
    writeFileSync(join(dir, "notes.md"), "第一版\n");
    writeFileSync(join(dir, "stable.md"), "不变\n");
    writeWorklist(dir, ["notes.md", "stable.md"]);

    strike(dir, join(dir, "notes.md"));
    strike(dir, join(dir, "stable.md"));
    expect(readWorklist(dir)).toEqual([]);

    writeFileSync(join(dir, "notes.md"), "第二版 —— 内容变了\n");
    expect(readWorklist(dir)).toEqual(["notes.md"]);      // 变了的回到未读
  });

  it("legacy no-fingerprint strike records are grandfathered as read", () => {
    writeFileSync(join(dir, "old.md"), "老文件\n");
    writeWorklist(dir, ["old.md"]);
    appendFileSync(join(dir, "ideas", ".scan-done"), "old.md\n");   // 旧格式：只有路径
    expect(readWorklist(dir)).toEqual([]);
    writeFileSync(join(dir, "old.md"), "改了也不追责\n");
    expect(readWorklist(dir)).toEqual([]);                // 存量记录不惩罚
  });

  // ── (3) allow 与守卫同源 ─────────────────────────────────────────────────

  it("decideProductWrite answers all three layers, and the guard's verdict is the same function", () => {
    const file = join(dir, "src", "a.ts");

    // 2026-09-16（I-146）：批准和 RED 两层都拆了，剩下认领这一层（D16）。
    expect(decideProductWrite(dir, loadGraph(), file).allow).toBe(true);
    expect(decideProductWrite(dir, loadGraph(), join(dir, "src", "unclaimed.ts")).allow).toBe(false);

    // 守卫对同一文件的判决与 decideProductWrite 同源同答案
    for (const target of [file, join(dir, "src", "unclaimed.ts")]) {
      const direct = decideProductWrite(dir, loadGraph(), target);
      const viaGuard = decide(ev({ paths: [target] }), dir);
      expect(viaGuard.allow, target).toBe(direct.allow);
    }
  });

  // "From the very start" is about the RED, not about the approval: D8 lets the
  // failing test be the first move, so no evidence is required here. The plan
  // approval still is — `verify.test_files` is graph prose, and D17 already
  // spends that approval on the way into `doing`, so this costs the loop nothing.
  it("test files stay writable through decideProductWrite before any RED exists", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", ["I-001"]);
    applyApproval(dir, `批准 ${challenge}`, meta);
    expect(decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt")).allow).toBe(true);
  });

  it("a doing idea's declared test path is writable with no approval on file", () => {
    const v = decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt"));
    expect(v.allow, v.reason).toBe(true);
  });
});
