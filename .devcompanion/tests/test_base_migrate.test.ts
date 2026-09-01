import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  load, graphPath, check, migrate,
  type Graph,
} from "../../companion/ideas.js";

// I-092 — 一条显式的迁移命令：三种旧格式（graph.claude.yaml / graph.cursor.yaml /
// Codex 的一节点一文件 JSON）搬进同一份 ideas/graph.yaml。多份旧图并存就停下让
// 人选，绝不自动挑赢家（D10）；转换不了的字段列成报告；旧文件一律原样保留。
describe("companion migrate (I-092)", () => {
  let dir: string;
  const dirs: string[] = [];

  const claudeLegacy = `version: 1
agent: claude
project: legacy-claude
endpoints: [I-002]
ideas:
  # 这行注释必须原样搬进新图
  - id: I-001
    name: "旧图的地基"
    status: done
    needs: []
    what: W1
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/base.ts
        lines: "1-1"
    verify: { command: "npx vitest run t.test.ts", pass: "exit 0" }
  - id: I-002
    name: "旧图的终点"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
`;

  const cursorLegacy = claudeLegacy
    .replace("agent: claude", "agent: cursor")
    .replace("project: legacy-claude", "project: legacy-cursor")
    .replace("旧图的地基", "光标版的地基");

  const codexNode = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    schema_version: "idea-node/v1",
    id,
    name: `节点 ${id}`,
    status: "aligned",
    depends_on: [],
    what: "W", why: "Y", expected_result: "E",
    implementation: { how: "H", why_this_way: "T", target_paths: ["src/x.py"] },
    code_refs: [{ path: "src/x.py", start_line: 1, end_line: 2, role: "impl" }],
    verification: [
      { id: "v1", kind: "automated", plan: "run it", command: "python -m unittest", test_paths: ["tests/test_x.py"], status: "pending", evidence: [] },
    ],
    future_use: "F",
    created_at: "2026-01-01",
    ...extra,
  }, null, 2);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migr-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const base = 1;\n");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 三种旧格式各迁一遍 ───────────────────────────────────────────────────

  it("migrates a claude-suffixed graph: plain file appears, agent key gone, comments kept, legacy untouched", () => {
    writeFileSync(join(dir, "ideas", "graph.claude.yaml"), claudeLegacy);
    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(true);

    const text = readFileSync(graphPath(dir), "utf8");
    expect(text).not.toMatch(/^agent:/m);
    expect(text).toContain("这行注释必须原样搬进新图");
    const { graph } = load(graphPath(dir));
    expect(check(graph, dir).errors).toEqual([]);
    expect(readFileSync(join(dir, "ideas", "graph.claude.yaml"), "utf8")).toBe(claudeLegacy);
  });

  it("migrates a cursor-suffixed graph the same way", () => {
    writeFileSync(join(dir, "ideas", "graph.cursor.yaml"), cursorLegacy);
    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(true);
    const { graph } = load(graphPath(dir));
    expect(graph.ideas.map((i) => i.id)).toEqual(["I-001", "I-002"]);
    expect(readFileSync(join(dir, "ideas", "graph.cursor.yaml"), "utf8")).toBe(cursorLegacy);
  });

  it("migrates codex node-per-file JSON: slugs become I-NNN, statuses fold to four, report lists what was lossy", () => {
    const nodes = join(dir, ".codex-companion", "nodes");
    mkdirSync(nodes, { recursive: true });
    writeFileSync(join(nodes, "align-intent.json"), codexNode("align-intent", { status: "implementing" }));
    writeFileSync(join(nodes, "build-core.json"), codexNode("build-core", {
      status: "superseded",
      depends_on: ["align-intent"],
      verification: [
        { id: "v1", kind: "automated", plan: "run it", command: "python -m unittest", test_paths: ["tests/test_x.py"], status: "pending", evidence: [] },
        { id: "v2", kind: "manual", plan: "亲眼看", status: "pending", evidence: [] },
      ],
    }));

    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(true);

    const { graph } = load(graphPath(dir));
    const ids = graph.ideas.map((i) => i.id);
    expect(ids).toEqual(["I-001", "I-002"]);
    const first = graph.ideas[0];
    expect(first.status).toBe("doing");                    // implementing → doing
    expect(first.expected).toBe("E");                      // expected_result → expected
    expect(first.how).toBe("H");                           // implementation.how → how
    expect(first.code?.[0]).toMatchObject({ file: "src/x.py", lines: "1-2" });
    expect(first.verify?.command).toBe("python -m unittest");
    expect(first.verify?.test_files).toEqual(["tests/test_x.py"]);
    const second = graph.ideas[1];
    expect(second.status).toBe("blocked");                 // superseded → blocked + 报告
    expect(second.needs).toEqual(["I-001"]);               // slug 引用同步改号

    const report = readFileSync(join(dir, "ideas", "migrate-report.md"), "utf8");
    expect(report).toContain("align-intent");              // 编号映射可追溯
    expect(report).toMatch(/superseded/);                  // 状态折叠列出来
    expect(report).toMatch(/verification|第二个验证|v2/);   // 丢掉的第二个验证列出来
    expect(report).toMatch(/role/);                        // 丢掉的 role 字段列出来
  });

  // ── 多份旧图：停下问人，绝不自动挑 ───────────────────────────────────────

  it("two legacy graphs side by side: refuse, write nothing, show the difference; --pick resolves", () => {
    writeFileSync(join(dir, "ideas", "graph.claude.yaml"), claudeLegacy);
    writeFileSync(join(dir, "ideas", "graph.cursor.yaml"), cursorLegacy);

    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/claude/);
    expect(r.reason).toMatch(/cursor/);
    expect(existsSync(graphPath(dir))).toBe(false);        // 一个字都没写

    const picked = migrate(dir, { date: "2026-09-01", pick: "cursor" });
    expect(picked.ok).toBe(true);
    expect(readFileSync(graphPath(dir), "utf8")).toContain("光标版的地基");
  });

  it("an existing plain graph.yaml means there is nothing to migrate onto", () => {
    writeFileSync(graphPath(dir), "version: 1\nproject: p\nideas: []\n");
    writeFileSync(join(dir, "ideas", "graph.claude.yaml"), claudeLegacy);
    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/graph\.yaml/);
    expect(readFileSync(graphPath(dir), "utf8")).toBe("version: 1\nproject: p\nideas: []\n");
  });

  it("no legacy sources at all: says so instead of inventing a graph", () => {
    const r = migrate(dir, { date: "2026-09-01" });
    expect(r.ok).toBe(false);
    expect(existsSync(graphPath(dir))).toBe(false);
  });

  it("dry-run reports without writing", () => {
    writeFileSync(join(dir, "ideas", "graph.claude.yaml"), claudeLegacy);
    const r = migrate(dir, { date: "2026-09-01", dryRun: true });
    expect(r.ok).toBe(true);
    expect(existsSync(graphPath(dir))).toBe(false);
    expect(existsSync(join(dir, "ideas", "migrate-report.md"))).toBe(false);
  });
});
