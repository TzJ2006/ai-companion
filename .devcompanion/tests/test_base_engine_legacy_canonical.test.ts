import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  check, migrate, findLegacySources, load, graphPath, main,
} from "../../companion/ideas.js";

// H15 — the canonical name can be occupied by a retired implementation's graph:
// `agent:` stamps a graph as one agent's file (D10), and `enforce:` / `exempt:`
// are the in-graph switches D24/D25 removed. Such a file used to be validated
// against rules it was never written for, so `check` buried the real problem
// under a pile of missing-file errors and `migrate` refused with a bare
// "already exists". Both must now say the one thing that is wrong and name the
// human step. The rename stays the human's call — the engine never moves it.
describe("a legacy graph parked on ideas/graph.yaml (H15, D10)", () => {
  let dir: string;
  const dirs: string[] = [];

  // Stamped `agent: cursor`, with `done` ideas pointing at files this project
  // does not have — the shape that produced the pile of unrelated errors.
  const legacyAtCanonical = `version: 1
agent: cursor
project: fixture
enforce: true
exempt:
  - cursor-companion/**
endpoints: [I-002]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    code:
      - file: cursor-companion/gone-a.ts
    verify: { command: "npx vitest run a.test.ts", pass: "exit 0" }
  - id: I-002
    name: "终点"
    status: done
    needs: [I-001]
    code:
      - file: cursor-companion/gone-b.ts
    verify: { command: "npx vitest run b.test.ts", pass: "exit 0" }
`;

  const projectGraph = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "地基"
    status: todo
    needs: []
`;

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
    dir = mkdtempSync(join(tmpdir(), "base-legacy-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── recognised as legacy, not validated as ours ───────────────────────────

  it("findLegacySources sees the bare graph.yaml stamped agent: cursor", () => {
    writeFileSync(graphPath(dir), legacyAtCanonical);
    const found = findLegacySources(dir);
    expect(found.map((s) => s.path.replaceAll("\\", "/"))).toEqual([graphPath(dir).replaceAll("\\", "/")]);
    expect(found[0].kind).toBe("cursor");
    expect(found[0].instruction).toMatch(/graph\.cursor\.yaml/);
  });

  it("check says the one thing that is wrong, not a pile of missing-file errors", () => {
    writeFileSync(graphPath(dir), legacyAtCanonical);
    const { errors } = check(load(graphPath(dir)).graph, dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/agent: cursor/);          // 说清是什么把它认出来的
    expect(errors[0]).toMatch(/graph\.cursor\.yaml/);    // 人该把它改成什么名字
    expect(errors[0]).toMatch(/migrate/);                // 改名之后跑什么
    expect(errors.join()).not.toMatch(/code file not found/);
  });

  it("the CLI check prints that one sentence and still fails", () => {
    writeFileSync(graphPath(dir), legacyAtCanonical);
    const { code, out } = run(["check", "--project", dir]);
    expect(code).toBe(1);
    expect(out).toMatch(/graph\.cursor\.yaml/);
    expect(out).toMatch(/migrate/);
    expect(out).toContain("1 errors");
  });

  it("the retired enforce:/exempt: keys give a graph away even with no agent: key", () => {
    writeFileSync(graphPath(dir), "version: 1\nproject: p\nenforce: true\nideas: []\n");
    const { errors } = check(load(graphPath(dir)).graph, dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/enforce/);
    expect(errors[0]).toMatch(/migrate/);
  });

  // ── migrate looks at the file before refusing ─────────────────────────────

  it("migrate offers the same instruction instead of a bare already-exists", () => {
    writeFileSync(graphPath(dir), legacyAtCanonical);
    const r = migrate(dir, { date: "2026-09-02", dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/graph\.cursor\.yaml/);
    expect(r.reason).toMatch(/migrate/);
    // 引擎绝不自己改名、自己动这个文件 —— 那是人的决定。
    expect(readFileSync(graphPath(dir), "utf8")).toBe(legacyAtCanonical);
    expect(existsSync(join(dir, "ideas", "graph.cursor.yaml"))).toBe(false);
  });

  // ── a normal project graph is untouched by all of this ────────────────────

  it("a normal project graph checks clean and is not called legacy", () => {
    writeFileSync(graphPath(dir), projectGraph);
    expect(check(load(graphPath(dir)).graph, dir).errors).toEqual([]);
    expect(findLegacySources(dir)).toEqual([]);
    const r = migrate(dir, { date: "2026-09-02", dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toMatch(/改名|rename/);
  });

  it("a suffixed legacy graph named by --file is still checked as itself", () => {
    writeFileSync(graphPath(dir), projectGraph);
    const suffixed = join(dir, "ideas", "graph.cursor.yaml");
    writeFileSync(suffixed, legacyAtCanonical);
    const { code, out } = run(["check", "--file", suffixed, "--project", dir]);
    expect(out).not.toMatch(/改名/);
    expect(code).toBe(1);                                  // 两个 done 想法的代码文件确实不在
    expect(out).toMatch(/code file not found/);
  });
});
