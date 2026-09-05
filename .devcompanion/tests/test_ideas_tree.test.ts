import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { check, tally, applyChanges, fingerprint, type Graph } from "../../companion/ideas.js";

// The tree (FORMAT.md, "The tree"): `parent` names the idea this one sits
// under; no parent means top level. `check` reports a dangling parent and a
// parent cycle as errors — both break the page — and more than seven at one
// level as a warning: unreadable, not wrong. A flat graph is never nagged.
describe("the idea tree in the engine", () => {
  let dir: string;
  const dirs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tree-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const idea = (id: string, parent?: string, status = "todo") => `  - id: ${id}
    name: "想法 ${id}"
    status: ${status}
    needs: []${parent === undefined ? "" : `\n    parent: ${parent}`}
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
`;
  const graph = (text: string) => parseDocument(text).toJSON() as Graph;
  const head = "version: 1\nproject: p\nendpoints: [I-003]\n";
  const treeLines = (lines: string[]) => lines.filter((l) => /parent|顶层|子想法/.test(l));
  const many = (n: number, parent?: string) =>
    Array.from({ length: n }, (_, k) => idea(`I-${String(k + 1).padStart(3, "0")}`, parent)).join("");

  it("a parent that is not in the graph is an error naming both ids", () => {
    const text = head + "ideas:\n" + idea("I-001") + idea("I-002", "I-999") + idea("I-003", "I-001");
    const r = check(graph(text), dir);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/I-002/);
    expect(r.errors[0]).toMatch(/I-999/);
    expect(r.errors[0]).toMatch(/不是图里的想法/);
  });

  it("a parent cycle is one error that shows the loop", () => {
    const text = head + "ideas:\n" + idea("I-001", "I-002") + idea("I-002", "I-001") + idea("I-003");
    const r = check(graph(text), dir);
    const cycles = r.errors.filter((e) => /成环/.test(e));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatch(/I-001 → I-002 → I-001|I-002 → I-001 → I-002/);

    const self = head + "ideas:\n" + idea("I-001", "I-001") + idea("I-002") + idea("I-003");
    expect(check(graph(self), dir).errors.some((e) => /成环/.test(e) && /I-001 → I-001/.test(e))).toBe(true);
  });

  it("eight top-level ideas is a warning; seven is not", () => {
    const r8 = check(graph(head + "ideas:\n" + many(8)), dir);
    expect(r8.errors).toEqual([]);
    expect(r8.warnings.some((w) => /顶层有 8 个想法/.test(w))).toBe(true);
    const r7 = check(graph(head + "ideas:\n" + many(7)), dir);
    expect(treeLines(r7.warnings)).toEqual([]);
  });

  it("eight direct children under one idea is a warning that names the parent", () => {
    const text = head + "ideas:\n" + idea("I-100") + many(8, "I-100");
    const r = check(graph(text), dir);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /^I-100: 直接子想法 8 个/.test(w))).toBe(true);
  });

  it("a clean two-level tree and a flat graph both say nothing about the tree", () => {
    const tree = head + "ideas:\n" + idea("I-001") + idea("I-002", "I-001") + idea("I-003", "I-001");
    const flat = head + "ideas:\n" + idea("I-001") + idea("I-002") + idea("I-003");
    for (const text of [tree, flat]) {
      const r = check(graph(text), dir);
      expect(r.errors).toEqual([]);
      expect(treeLines(r.warnings)).toEqual([]);
    }
  });

  it("tally counts a group once", () => {
    const text = head + "ideas:\n" + idea("I-001", undefined, "done") + idea("I-002", undefined, "doing") + idea("I-003");
    const t = tally(graph(text).ideas);
    expect(t.total).toBe(3);
    expect(t.done).toBe(1);
    expect(t.by).toEqual({ todo: 1, doing: 1, done: 1, blocked: 0 });
    expect(tally([])).toEqual({ total: 0, done: 0, by: { todo: 0, doing: 0, done: 0, blocked: 0 } });
  });

  it("the write-back carries `parent` on a new idea and on a field edit, as one line", () => {
    const source = head + "ideas:\n" + idea("I-001") + idea("I-002", "I-001") + idea("I-003", "I-001");
    const r = applyChanges(source, {
      v: 1, baseDigest: fingerprint(source),
      ops: [
        { op: "add", tmp: "tmp:1", fields: { name: "新想法", what: "W", parent: "I-002" } },
        { op: "set", id: "I-003", field: "parent", old: "I-001", new: "I-002" },
      ],
    }, "2026-09-05");
    expect(r.ok, r.reason).toBe(true);
    const after = graph(r.text!);
    expect(after.ideas.find((i) => i.id === "I-003")?.parent).toBe("I-002");
    expect(after.ideas.find((i) => i.name === "新想法")?.parent).toBe("I-002");
    expect(r.text).toMatch(/^    parent: I-002$/m);            // a plain scalar, not a folded block
    expect(check(after, dir).errors).toEqual([]);
  });
});
