import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import {
  load, graphPath, paths, requestApproval, applyApproval, validApproval, approvalSnapshot,
  decideProductWrite, render, type Graph,
} from "../../companion/ideas.js";

// I-138 —— 口令和回执进 git：request-approval 在一处检出写 ideas/approvals/pending/，
// 人在另一处检出回答，回执落在 ideas/approvals/receipts/，再回到第一处，set doing 的门认它。
// 旧目录 ideas/.runtime/{pending,approvals} 只读兼容；守卫把新目录当程序保管的证据（D24）。
describe("approvals travel through git (I-138)", () => {
  const dirs: string[] = [];
  const yaml = `version: 1
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "要人亲眼验收的想法"
    status: todo
    needs: []
    what: W1
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/base.ts
    verify: { manual: "打开页面亲眼看一遍", signed_off: null }
  - id: I-002
    name: "自动验证的想法"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/mid.ts
    verify: { command: "npx vitest run tests/mid.test.ts", test_files: [ tests/mid.test.ts ], pass: "exit 0" }
`;
  const meta = { date: "2026-09-10", session_id: "sess-1", turn_id: "turn-1" };

  /** One checkout: a project dir holding the fixture graph. */
  const checkout = () => {
    const dir = mkdtempSync(join(tmpdir(), "trk-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(graphPath(dir), yaml);
    return dir;
  };
  /** "git pull": the tracked approvals directory of `from` lands in `to`. */
  const pull = (from: string, to: string) => {
    rmSync(paths(to).approvals, { recursive: true, force: true });
    if (existsSync(paths(from).approvals)) cpSync(paths(from).approvals, paths(to).approvals, { recursive: true });
  };
  const graphOf = (dir: string) => load(graphPath(dir)).graph;
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("paths() names the tracked directory: ideas/approvals, not under .runtime", () => {
    const dir = checkout();
    const rel = (p: string) => p.slice(dir.length + 1).replaceAll("\\", "/");
    expect(rel(paths(dir).approvals)).toBe("ideas/approvals");
    expect(rel(paths(dir).runtime)).toBe("ideas/.runtime");
  });

  it("request in A, answer in B, receipt back in A: the plan gate opens in A", () => {
    const a = checkout(), b = checkout();
    const { challenge } = requestApproval(a, graphOf(a), "plan", ["I-002"]);
    expect(existsSync(join(paths(a).approvals, "pending", `${challenge}.json`))).toBe(true);
    expect(existsSync(join(paths(a).runtime, "pending", `${challenge}.json`))).toBe(false);

    pull(a, b);                                            // B sees the challenge
    const r = applyApproval(b, `批准 ${challenge}`, meta);
    expect(r?.ok).toBe(true);
    expect(existsSync(join(paths(b).approvals, "receipts", `${challenge}.json`))).toBe(true);
    expect(existsSync(join(paths(b).approvals, "pending", `${challenge}.json`))).toBe(false);

    pull(b, a);                                            // A sees the receipt
    expect(validApproval(a, graphOf(a), "plan", "I-002")).toBe(true);

    const drifted = graphOf(a);
    drifted.ideas.find((i) => i.id === "I-002")!.how = "改了";
    expect(validApproval(a, drifted, "plan", "I-002")).toBe(false);   // still bound to content
  });

  it("a manual-check signature written in B points at the tracked receipt", () => {
    const a = checkout(), b = checkout();
    const { challenge } = requestApproval(a, graphOf(a), "manual-check", ["I-001"], { by: "张三" });
    pull(a, b);
    expect(applyApproval(b, `批准 ${challenge}`, meta)?.ok).toBe(true);
    const signed = graphOf(b).ideas.find((i) => i.id === "I-001")!.verify!.signed_off ?? "";
    expect(signed).toContain(`ideas/approvals/receipts/${challenge}.json`);
    expect(signed).not.toContain(".runtime");
  });

  it("legacy receipts and pending challenges under .runtime/ still count (read-only compat)", () => {
    const dir = checkout();
    const g = graphOf(dir);
    const legacyReceipts = join(paths(dir).runtime, "approvals");
    mkdirSync(legacyReceipts, { recursive: true });
    writeFileSync(join(legacyReceipts, "CC-OLD00002.json"), JSON.stringify({
      v: 2, challenge: "CC-OLD00002", gate: "plan", decision: "approved",
      snapshots: { "I-002": approvalSnapshot(g, "I-002") },
    }));
    expect(validApproval(dir, g, "plan", "I-002")).toBe(true);

    const legacyPending = join(paths(dir).runtime, "pending");
    mkdirSync(legacyPending, { recursive: true });
    writeFileSync(join(legacyPending, "CC-0DD00003.json"), JSON.stringify({
      v: 2, challenge: "CC-0DD00003", gate: "plan", snapshots: { "I-001": approvalSnapshot(g, "I-001") },
    }));
    expect(applyApproval(dir, "批准 CC-0DD00003", meta)?.ok).toBe(true);
    expect(existsSync(join(legacyPending, "CC-0DD00003.json"))).toBe(false);       // consumed
    expect(readdirSync(join(paths(dir).approvals, "receipts"))).toContain("CC-0DD00003.json"); // new receipts go to the tracked dir
  });

  it("the guard treats ideas/approvals/ as program-kept evidence (D24)", () => {
    const dir = checkout();
    const g = parse(yaml) as Graph;
    for (const rel of ["ideas/approvals", "ideas/approvals/receipts/CC-00000000.json", "ideas/approvals/pending/CC-00000000.json"]) {
      const v = decideProductWrite(dir, g, rel);
      expect(v.allow, rel).toBe(false);
      expect(v.reason).toMatch(/D24/);
    }
    expect(decideProductWrite(dir, g, "ideas/log.md").allow).toBe(true);   // the ledger stays editable
  });

  it("the home page's pending panel reads the tracked directory", () => {
    const dir = checkout();
    const g = graphOf(dir);
    const { challenge } = requestApproval(dir, g, "plan", ["I-002"]);
    const html = render(g, readFileSync(graphPath(dir), "utf8"), dir);
    expect(html).toContain(challenge);
  });
});
