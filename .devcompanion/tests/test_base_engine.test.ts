import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  check, frontier, findCycle, orphans, dependents, render, setStatus, load,
  graphPath, paths, requestApproval, applyApproval,
  type Graph,
} from "../../companion/ideas.js";

// I-088 — the shared-base engine lives in companion/ and reads exactly ONE
// suffix-free project graph: ideas/graph.yaml. No agent-name file picking.
// Format: companion/FORMAT.md (D10: the graph belongs to the project).
describe("companion base engine (I-088)", () => {
  let dir: string;
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");

  const yaml = `version: 1
project: fixture
endpoints: [I-003]
ideas:
  # 地基那一层 —— 注释必须在写回后原样留下
  - id: I-001
    name: "地基"
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
        symbol: base
        lines: "1-1"
    verify: { command: "npx vitest run t.test.ts", pass: "exit 0" }
  - id: I-002
    name: "中间层"
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
        symbol: mid
    verify: { command: "npx vitest run m.test.ts", pass: "exit 0" }
  - id: I-003
    name: "终点"
    status: todo
    needs: [I-002]
    what: W3
    why: Y3
    expected: E3
    how: H3
    why_this_way: T3
    future: F3
`;

  // A decoy suffixed graph. The base engine must never read or write it.
  const decoy = `version: 1
agent: claude
project: decoy
ideas:
  - id: I-999
    name: "诱饵：后缀图里的想法"
    status: todo
`;

  const graphOf = (text = yaml) => parseDocument(text).toJSON() as Graph;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "base-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const base = 1;\n");
    writeFileSync(join(dir, "src", "mid.ts"), "export const mid = 2;\n");
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "ideas", "graph.claude.yaml"), decoy);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── one plain graph, no agent suffix ──────────────────────────────────────

  it("graphPath is always ideas/graph.yaml, even when a suffixed graph sits beside it", () => {
    expect(graphPath(dir).replaceAll("\\", "/")).toBe(join(dir, "ideas", "graph.yaml").replaceAll("\\", "/"));
  });

  it("load reads the plain graph, not the decoy", () => {
    const { graph } = load(graphPath(dir));
    expect(graph.ideas.map((i) => i.id)).toContain("I-001");
    expect(graph.ideas.map((i) => i.id)).not.toContain("I-999");
  });

  it("a graph with no agent: key is simply the project's graph", () => {
    const { graph } = load(graphPath(dir));
    expect((graph as Record<string, unknown>)["agent"]).toBeUndefined();
    expect(check(graph, dir).errors).toEqual([]);
  });

  // ── paths: print every canonical location, so nobody guesses filenames ────

  it("paths returns every canonical file location, all suffix-free", () => {
    const p = paths(dir);
    const rel = (v: string) => v.replaceAll("\\", "/").replace(dir.replaceAll("\\", "/") + "/", "");
    expect(rel(p.graph)).toBe("ideas/graph.yaml");
    expect(rel(p.html)).toBe("ideas/graph.html");
    expect(rel(p.log)).toBe("ideas/log.md");
    expect(rel(p.worklist)).toBe("ideas/.scan-todo");
    expect(rel(p.done)).toBe("ideas/.scan-done");
    expect(rel(p.approved)).toBe("ideas/.approved");
    expect(rel(p.runtime)).toBe("ideas/.runtime");
    for (const value of Object.values(p)) {
      expect(value).not.toMatch(/\.claude|\.cursor|\.codex/);
    }
  });

  it("paths accepts a backslashed project dir (Windows hook events)", () => {
    const backslashed = dir.replaceAll("/", "\\");
    const p = paths(backslashed);
    expect(p.graph.replaceAll("\\", "/")).toBe(join(dir, "ideas", "graph.yaml").replaceAll("\\", "/"));
  });

  // ── the ported engine still does its whole job ────────────────────────────

  it("check/frontier/cycle/orphans work on the plain graph", () => {
    const g = graphOf();
    expect(check(g, dir).errors).toEqual([]);
    expect(frontier(g).map((i) => i.id)).toEqual(["I-002"]);
    expect(findCycle(g)).toEqual([]);
    expect(orphans(g)).toEqual([]);
    expect(dependents(g, "I-001")).toEqual(["I-002"]);
  });

  // ── D31: a planned path may never leave the project ───────────────────────
  // 一条 `../../somewhere/x.ts` 解锁不了那个文件（写闸门比的是项目相对路径），
  // 但它会在图里留下一条没人拦的假路径 —— /ccfix 会把它当事实去读。

  it("check rejects a code path that leaves the project (D31)", () => {
    for (const bad of ["../outside/x.ts", "src/../../x.ts", "/etc/passwd", "C:/tmp/x.ts"]) {
      const g = graphOf();
      g.ideas[1].code = [{ file: bad }];
      expect(check(g, dir).errors.join("\n"), bad).toMatch(/D31/);
    }
  });

  it("check rejects a test path that leaves the project (D31)", () => {
    const g = graphOf();
    g.ideas[1].verify = { command: "npx vitest run m.test.ts", test_files: ["../elsewhere/m.test.ts"] };
    expect(check(g, dir).errors.join("\n")).toMatch(/D31/);
  });

  it("check leaves ordinary project-relative paths alone", () => {
    const g = graphOf();
    g.ideas[1].verify = { command: "npx vitest run m.test.ts", test_files: ["tests/m.test.ts"] };
    expect(check(g, dir).errors).toEqual([]);
  });

  // ── D32: a done idea's line range must be real ────────────────────────────
  // src/base.ts 只有一行。旧的夹具写着 1-20 并断言「没有错误」—— 那条断言本身
  // 就是这条裁决要拦的东西：过期行号正是 /ccfix 会当成事实去信的那一栏。
  // 严格程度分两档（见 test_base_engine_round2）：写不出来的范围是错误，
  // 被别处改动改短了的范围是警告 —— 后者是文档漂移，不该经 R5 卡住整个会话。

  it("check warns, but does not error, on a done line range the file outgrew (D32)", () => {
    const g = graphOf();
    g.ideas[0].code = [{ file: "src/base.ts", lines: "1-20" }];
    const { errors, warnings } = check(g, dir);
    expect(errors.join("\n")).not.toMatch(/D32/);
    expect(warnings.join("\n")).toMatch(/D32/);
    expect(warnings.join("\n")).toMatch(/1 行/);
  });

  it("check rejects an unreadable or backwards line range on a done idea (D32)", () => {
    for (const lines of ["大概第三行", "0-1", "3-2", "1-"]) {
      const g = graphOf();
      g.ideas[0].code = [{ file: "src/base.ts", lines }];
      expect(check(g, dir).errors.join("\n"), lines).toMatch(/D32/);
    }
  });

  it("check accepts a done line range that matches the file", () => {
    const g = graphOf();
    g.ideas[0].code = [{ file: "src/base.ts", lines: "1-1" }];
    expect(check(g, dir).errors).toEqual([]);
  });

  it("an unfinished idea's line range is not measured — that code is not written yet", () => {
    const g = graphOf();
    g.ideas[1].code = [{ file: "src/mid.ts", lines: "1-500" }];   // I-002 还是 todo
    expect(check(g, dir).errors).toEqual([]);
  });

  it("setStatus keeps comments and appends a log entry through the Document", () => {
    const file = graphPath(dir);
    const { doc, graph } = load(file);
    setStatus(doc, graph, "I-002", "doing", { by: "test", note: "开工", date: "2026-08-31" });
    writeFileSync(file, String(doc));

    const after = readFileSync(file, "utf8");
    expect(after).toContain("status: doing");
    expect(after).toContain("注释必须在写回后原样留下");
    expect(after).toContain("开工");
  });

  // The CLI `set` writes back to the PLAIN file, regenerates the PLAIN html,
  // and leaves the decoy byte-for-byte alone. One real subprocess proves it.
  it("cli set touches only the plain graph and plain html", () => {
    // D17：命令行的 set 带着项目目录，开工要这个想法当前有效的批准，先把它办掉。
    {
      const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-002"]);
      applyApproval(dir, `批准 ${challenge}`, { date: "2026-08-31" });
    }
    const r = spawnSync("npx", ["tsx", ENGINE, "set", "I-002", "doing",
      "--project", dir, "--by", "test", "--note", "开工", "--date", "2026-08-31"],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(r.status).toBe(0);

    expect(readFileSync(join(dir, "ideas", "graph.yaml"), "utf8")).toContain("status: doing");
    expect(existsSync(join(dir, "ideas", "graph.html"))).toBe(true);
    expect(existsSync(join(dir, "ideas", "graph.claude.html"))).toBe(false);
    expect(readFileSync(join(dir, "ideas", "graph.claude.yaml"), "utf8")).toBe(decoy);
  });

  it("cli paths prints every canonical path, suffix-free, without needing a graph", () => {
    const empty = mkdtempSync(join(tmpdir(), "base-empty-"));
    dirs.push(empty);
    const r = spawnSync("npx", ["tsx", ENGINE, "paths", "--project", empty],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
    expect(r.status).toBe(0);
    for (const name of ["ideas/graph.yaml", "ideas/graph.html", "ideas/log.md",
      "ideas/.scan-todo", "ideas/.scan-done", "ideas/.approved", "ideas/.runtime", "ideas/approvals"]) {
      expect(r.stdout).toContain(name);
    }
    expect(r.stdout).not.toMatch(/\.claude|\.cursor|\.codex/);
  });

  it("render output carries the ideas of the plain graph only", () => {
    const html = render(graphOf(), yaml, dir);
    expect(html).toContain("I-003");
    expect(html).not.toContain("I-999");
  });
});
