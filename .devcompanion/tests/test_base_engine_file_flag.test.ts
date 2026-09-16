import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../companion/ideas.js";

// H9 — `--file` used to describe two different graphs at once: `set`, `new`,
// `apply` and `serve` wrote whatever it named (the suffixed legacy graphs
// included), while approval, migrate and the guard always used
// ideas/graph.yaml. D10 says the project owns exactly one graph, so the
// commands that change state now refuse any other file, and the read-only
// ones still accept it so a legacy graph stays inspectable.
describe("--file names one graph only (H9, D10)", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "地基"
    status: todo
    needs: []
  - id: I-002
    name: "终点"
    status: todo
    needs: [I-001]
`;

  // The legacy graph the base calls a read-only migration input (D10).
  const legacyText = `version: 1
agent: claude
project: legacy
endpoints: [I-999]
ideas:
  - id: I-999
    name: "旧图里的想法"
    status: todo
`;

  let legacy: string;

  /** Run the CLI in-process and keep everything it printed. */
  function run(args: string[]): { code: number; out: string } {
    const lines: string[] = [];
    const log = console.log, error = console.error;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { return { code: main(args), out: lines.join("\n") }; }
    finally { console.log = log; console.error = error; }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "base-file-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    legacy = join(dir, "ideas", "graph.claude.yaml");
    writeFileSync(legacy, legacyText);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── the commands that change state refuse any other graph ─────────────────

  it("set refuses a legacy graph and leaves it byte-for-byte alone", () => {
    const { code, out } = run(["set", "I-999", "blocked", "--file", legacy, "--project", dir, "--date", "2026-09-02"]);
    expect(code).not.toBe(0);
    expect(readFileSync(legacy, "utf8")).toBe(legacyText);
    expect(existsSync(join(dir, "ideas", "graph.claude.html"))).toBe(false);
    // The message has to say what to do instead: which graph is the project's,
    // and how to bring the old content across.
    expect(out).toContain("ideas/graph.yaml");
    expect(out).toContain("migrate");
  });

  it("new refuses a legacy graph", () => {
    const { code } = run(["new", "新想法", "--file", legacy, "--project", dir, "--date", "2026-09-02"]);
    expect(code).not.toBe(0);
    expect(readFileSync(legacy, "utf8")).toBe(legacyText);
  });

  // The bug that bit in practice: the challenge was minted from the graph
  // --file named, but applyApproval only ever reads ideas/graph.yaml, so the
  // one-time token could never be answered.
  it("request-approval refuses a legacy graph instead of minting an unanswerable challenge", () => {
    const { code } = run(["request-approval", "--gate", "plan", "--node", "I-999",
      "--file", legacy, "--project", dir, "--date", "2026-09-02"]);
    expect(code).not.toBe(0);
    const pending = join(dir, "ideas", "approvals", "pending");
    expect(existsSync(pending) ? readdirSync(pending) : []).toEqual([]);
  });

  it("naming the project graph explicitly still writes", () => {
    const { code } = run(["set", "I-001", "blocked", "--file", join(dir, "ideas", "graph.yaml"),
      "--project", dir, "--date", "2026-09-02"]);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, "ideas", "graph.yaml"), "utf8")).toContain("status: blocked");
  });

  // ── looking at a legacy graph still works ─────────────────────────────────

  it("check still validates whatever --file names", () => {
    const { code, out } = run(["check", "--file", legacy, "--project", dir]);
    expect(code).toBe(0);
    expect(out).toContain("1 ideas");
    expect(out).not.toContain("migrate");
  });

  it("show and next still read whatever --file names", () => {
    expect(run(["show", "I-999", "--file", legacy, "--project", dir]).out).toContain("旧图里的想法");
    expect(run(["next", "--file", legacy, "--project", dir]).out).toContain("I-999");
  });
});
