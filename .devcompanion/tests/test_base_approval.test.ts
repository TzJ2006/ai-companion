import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  load, graphPath, paths, requestApproval, applyApproval, validApproval, approvalSnapshot,
  type Graph,
} from "../../companion/ideas.js";

// I-090 — Codex 版批准机制进入共同基座：一次性口令绑定内容摘要，只有整条消息
// 就是「批准 CC-XXXXXXXX」的真实回复才消费得掉；回执由程序保管在 ideas/.runtime/。
// 裁决依据：D7（两道常规关卡）、D26（一次性 challenge + 内容摘要 + 元数据）、
// D27（人工验证只走 manual-check challenge）。
describe("companion approval machinery (I-090)", () => {
  let dir: string;
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");

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

  const loadGraph = () => load(graphPath(dir)).graph;
  const meta = { date: "2026-08-31", session_id: "sess-1", turn_id: "turn-1" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "appr-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 请求：一次性口令 + 内容摘要，落进 .runtime/pending/ ──────────────────

  it("requestApproval mints a CC-XXXXXXXX challenge bound to a content digest", () => {
    const r = requestApproval(dir, loadGraph(), "decomposition");
    expect(r.challenge).toMatch(/^CC-[A-F0-9]{8}$/);
    const pending = JSON.parse(readFileSync(join(paths(dir).runtime, "pending", `${r.challenge}.json`), "utf8"));
    expect(pending.gate).toBe("decomposition");
    expect(pending.snapshot).toBe(approvalSnapshot(loadGraph(), "decomposition"));
  });

  it("the two regular gates digest different things and live independently", () => {
    const g = loadGraph();
    expect(approvalSnapshot(g, "decomposition")).not.toBe(approvalSnapshot(g, "plan", ["I-002"]));
    requestApproval(dir, g, "decomposition");
    // 批了拆分，计划关卡不因此变有效
    const d = requestApproval(dir, g, "decomposition");
    applyApproval(dir, `批准 ${d.challenge}`, meta);
    expect(validApproval(dir, g, "decomposition")).toBe(true);
    expect(validApproval(dir, g, "plan", ["I-002"])).toBe(false);
  });

  // ── 消费：只有整条消息就是口令回复才算数 ─────────────────────────────────

  it("a token wrapped in prose consumes nothing", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "decomposition");
    expect(applyApproval(dir, `我觉得可以，批准 ${challenge} 吧`, meta)).toBeNull();
    expect(existsSync(join(paths(dir).runtime, "pending", `${challenge}.json`))).toBe(true);
  });

  it("approve consumes once: receipt written with provenance, replay fails", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "decomposition");
    const first = applyApproval(dir, `批准 ${challenge}`, meta);
    expect(first?.ok).toBe(true);

    const receipt = JSON.parse(readFileSync(join(paths(dir).runtime, "approvals", `${challenge}.json`), "utf8"));
    expect(receipt.decision).toBe("approved");
    expect(receipt.session_id).toBe("sess-1");
    expect(receipt.turn_id).toBe("turn-1");
    expect(receipt.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);

    const second = applyApproval(dir, `批准 ${challenge}`, meta);
    expect(second?.ok).toBe(false);
    expect(second?.reason).toMatch(/已用|不存在/);
  });

  it("REJECT writes a rejected receipt and grants nothing", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "decomposition");
    const r = applyApproval(dir, `REJECT ${challenge}`, meta);
    expect(r?.ok).toBe(true);
    expect(r?.decision).toBe("rejected");
    expect(validApproval(dir, loadGraph(), "decomposition")).toBe(false);
  });

  // ── 内容漂移：改一个字，口令作废、批准失效 ───────────────────────────────

  it("editing the reviewed content voids the pending challenge", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", ["I-002"]);
    const file = graphPath(dir);
    writeFileSync(file, readFileSync(file, "utf8").replace("how: H2", "how: H2改"));
    const r = applyApproval(dir, `批准 ${challenge}`, meta);
    expect(r?.ok).toBe(false);
    expect(existsSync(join(paths(dir).runtime, "pending", `${challenge}.json`))).toBe(false); // 自毁
  });

  it("validApproval re-derives on every use — drift after approval invalidates it", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", ["I-002"]);
    expect(applyApproval(dir, `APPROVE ${challenge}`, meta)?.ok).toBe(true);
    expect(validApproval(dir, loadGraph(), "plan", ["I-002"])).toBe(true);

    const drifted = loadGraph();
    drifted.ideas.find((i) => i.id === "I-002")!.how = "改了实现思路";
    expect(validApproval(dir, drifted, "plan", ["I-002"])).toBe(false);
  });

  // ── 人工验收走同一条挑战链（D27） ────────────────────────────────────────

  it("manual-check: approval writes signed_off back into the graph", () => {
    const { challenge } = requestApproval(dir, loadGraph(), "manual-check", ["I-001"], { by: "张三" });
    const r = applyApproval(dir, `批准 ${challenge}`, meta);
    expect(r?.ok).toBe(true);
    const text = readFileSync(graphPath(dir), "utf8");
    expect(text).toContain(challenge);              // signed_off 里能追溯到口令
    const g = loadGraph();
    expect(g.ideas.find((i) => i.id === "I-001")!.verify!.signed_off).toBeTruthy();
  });

  it("manual-check refuses a node whose verify is not manual", () => {
    expect(() => requestApproval(dir, loadGraph(), "manual-check", ["I-002"])).toThrow(/manual|人工/);
  });

  // ── CLI 接线 ─────────────────────────────────────────────────────────────

  it("cli request-approval prints the challenge and how to answer it", { timeout: 60_000 }, () => {
    const r = spawnSync("npx", ["tsx", ENGINE, "request-approval", "--gate", "decomposition",
      "--project", dir, "--date", "2026-08-31"],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/CC-[A-F0-9]{8}/);
    expect(r.stdout).toMatch(/批准/);
    expect(readdirSync(join(paths(dir).runtime, "pending")).length).toBeGreaterThan(0);
  });
});
