import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addIdea, appendProjectLog, byId, check, dependents, findCycle, frontier,
  load, nextId, orphans, render, save, setStatus, type Graph,
} from "../../cursor-companion/ideas.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "idea-graph-"));
}

function writeGraph(dir: string, yaml: string): string {
  const file = join(dir, "graph.yaml");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, yaml);
  return file;
}

const sample = `version: 1
project: demo
overview: a demo
endpoints: [I-003]
ideas:
  - id: I-001
    name: 基础解析
    status: done
    what: parse
    why: need it
    expected: ast
    how: tree-sitter
    why_this_way: already in repo
    future: everything else
    code:
      - file: graph.yaml
        symbol: load
        lines: "1-4"
    verify: { command: "true", pass: "exit 0" }
  - id: I-002
    name: 归因
    status: todo
    needs: [I-001]
    what: attribute hunks
  - id: I-003
    name: 报告
    status: todo
    needs: [I-002]
    what: html
`;

describe("idea graph", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function setup(yaml = sample): { dir: string; file: string; graph: Graph } {
    const dir = tmp();
    dirs.push(dir);
    writeFileSync(join(dir, "graph.yaml"), yaml); // code ref resolves
    const file = writeGraph(dir, yaml);
    return { dir, file, ...load(file) };
  }

  it("finds the frontier as todo ideas whose needs are done", () => {
    const { graph } = setup();
    expect(frontier(graph).map((i) => i.id)).toEqual(["I-002"]);
  });

  it("lists dependents the other way", () => {
    const { graph } = setup();
    expect(dependents(graph, "I-001")).toEqual(["I-002"]);
    expect(dependents(graph, "I-002")).toEqual(["I-003"]);
    expect(dependents(graph, "I-003")).toEqual([]);
  });

  it("detects a cycle", () => {
    const { graph } = setup(`version: 1
ideas:
  - id: I-001
    name: a
    needs: [I-002]
  - id: I-002
    name: b
    needs: [I-001]
`);
    expect(findCycle(graph).join(" → ")).toMatch(/I-001/);
  });

  it("reports orphans when an idea feeds no endpoint", () => {
    const { graph } = setup(`version: 1
endpoints: [I-001]
ideas:
  - id: I-001
    name: end
  - id: I-002
    name: stray
`);
    expect(orphans(graph)).toEqual(["I-002"]);
  });

  it("refuses done without code and verify", () => {
    const { dir, graph } = setup();
    const r = check(graph, dir);
    expect(r.errors.some((e) => e.includes("I-003") || e.includes("unanswered"))).toBe(false);
    graph.ideas[0].code = [];
    graph.ideas[0].status = "done";
    const bad = check(graph, dir);
    expect(bad.errors.some((e) => e.includes("done but no `code`"))).toBe(true);
  });

  it("allocates the next I-NNN and never reuses", () => {
    const { graph } = setup();
    expect(nextId(graph)).toBe("I-004");
  });

  it("setStatus preserves yaml comments", () => {
    const dir = tmp();
    dirs.push(dir);
    const file = writeGraph(dir, `version: 1
ideas:
  - id: I-001
    name: keep   # do not eat
    status: todo
    what: x
    why: y
    expected: z
    how: h
    why_this_way: w
    future: f
    code:
      - file: graph.yaml
        lines: "1-2"
    verify: { command: "true", pass: "exit 0" }
`);
    const { doc, graph } = load(file);
    setStatus(doc, graph, "I-001", "done", { date: "2026-08-24", by: "idea-build", note: "ok" });
    save(file, doc);
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/do not eat/);
    expect(text).toMatch(/status: done/);
  });

  it("addIdea appends I-NNN", () => {
    const dir = tmp();
    dirs.push(dir);
    const file = writeGraph(dir, sample);
    const { doc, graph } = load(file);
    const id = addIdea(doc, graph, { name: "新节点", needs: ["I-003"] });
    expect(id).toBe("I-004");
    save(file, doc);
    const again = load(file).graph;
    expect(byId(again).get("I-004")?.name).toBe("新节点");
    expect(byId(again).get("I-004")?.needs).toEqual(["I-003"]);
  });

  it("render shows names only on the graph and eight questions plus edges on the card", () => {
    const { graph } = setup();
    const html = render(graph);
    expect(html).toContain('["基础解析"]');
    expect(html).toContain('call nodeClick("I-001")');
    const mermaid = html.match(/<pre class="mermaid">([\s\S]*?)<\/pre>/)?.[1] ?? "";
    expect(mermaid).toContain("基础解析");
    expect(mermaid).not.toContain("这个想法是什么");
    expect(html).toContain("这个想法是什么");
    expect(html).toContain("前置想法");
    expect(html).toContain("它是这些想法的前置");
    expect(html).toContain("id=\"I-002\"");
  });

  it("appendProjectLog is append-only", () => {
    const dir = tmp();
    dirs.push(dir);
    const log = join(dir, "log.md");
    appendProjectLog(log, { date: "2026-08-24", by: "idea-build", ideas: ["I-001"], files: ["a.ts"], note: "first" });
    appendProjectLog(log, { date: "2026-08-24", by: "idea-debug", note: "second" });
    const text = readFileSync(log, "utf8");
    expect(text).toMatch(/Append-only/);
    expect(text).toMatch(/first[\s\S]*second/);
    expect(existsSync(log)).toBe(true);
  });
});
