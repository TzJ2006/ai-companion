import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { check, tally, applyChanges, fingerprint, type Graph } from "../../companion/ideas.js";

// I-085 — the engine knows the step overview (FORMAT.md, "The step overview"):
// a top-level `steps` list and a `step` on each idea. `check` reports it in two
// tiers on purpose: a step nobody declared is an error (a certain typo that
// makes the page under-count); an unassigned idea, a step count outside three
// to seven, or an empty step is a warning; a graph with no `steps` at all is
// left alone. The write-back accepts `step` on new ideas and on field edits.
describe("step overview in the engine (I-085)", () => {
  let dir: string;
  const dirs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "steps-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const idea = (id: string, step?: string, status = "todo") => `  - id: ${id}
    name: "想法 ${id}"
    status: ${status}
    needs: []${step === undefined ? "" : `\n    step: ${step}`}
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
`;
  const steps = (names: string[]) =>
    `steps:\n${names.map((n) => `  - name: ${n}\n    blurb: 做完这一步项目就能${n}。\n`).join("")}`;
  const graph = (text: string) => parseDocument(text).toJSON() as Graph;
  const head = "version: 1\nproject: p\nendpoints: [I-003]\n";
  const stepLines = (lines: string[]) => lines.filter((l) => /步|step/.test(l));

  it("an idea assigned to a step nobody declared is an error", () => {
    const text = head + steps(["甲", "乙", "丙"]) + "ideas:\n" + idea("I-001", "甲") + idea("I-002", "丁") + idea("I-003", "丙");
    const r = check(graph(text), dir);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/I-002/);
    expect(r.errors[0]).toMatch(/丁/);
    expect(r.errors[0]).toMatch(/不存在的步骤/);
  });

  it("with steps declared, an unassigned idea is a warning that names it", () => {
    const text = head + steps(["甲", "乙", "丙"]) + "ideas:\n" + idea("I-001", "甲") + idea("I-002") + idea("I-003", "丙");
    const r = check(graph(text), dir);
    expect(r.errors).toEqual([]);
    const about = stepLines(r.warnings);
    expect(about.some((w) => /I-002/.test(w) && /没有归/.test(w))).toBe(true);
    expect(about.some((w) => /乙/.test(w) && /一个想法都没有/.test(w))).toBe(true);
  });

  it("fewer than three or more than seven steps is a warning, not an error", () => {
    const two = head + steps(["甲", "乙"]) + "ideas:\n" + idea("I-001", "甲") + idea("I-002", "乙") + idea("I-003", "甲");
    const r2 = check(graph(two), dir);
    expect(r2.errors).toEqual([]);
    expect(r2.warnings.some((w) => /三到七/.test(w))).toBe(true);

    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const many = head + steps(eight) + "ideas:\n" + idea("I-001", "a") + idea("I-002", "b") + idea("I-003", "c");
    const r8 = check(graph(many), dir);
    expect(r8.errors).toEqual([]);
    expect(r8.warnings.some((w) => /三到七/.test(w))).toBe(true);
  });

  it("a graph with no steps at all says nothing about steps", () => {
    const text = head + "ideas:\n" + idea("I-001") + idea("I-002") + idea("I-003");
    const r = check(graph(text), dir);
    expect(r.errors).toEqual([]);
    expect(stepLines(r.warnings)).toEqual([]);
  });

  it("a fully assigned graph with three to seven steps is clean", () => {
    const text = head + steps(["甲", "乙", "丙"]) + "ideas:\n" + idea("I-001", "甲") + idea("I-002", "乙") + idea("I-003", "丙");
    const r = check(graph(text), dir);
    expect(r.errors).toEqual([]);
    expect(stepLines(r.warnings)).toEqual([]);
  });

  it("tally counts a group once, for the legend and the overview alike", () => {
    const text = head + "ideas:\n" + idea("I-001", undefined, "done") + idea("I-002", undefined, "doing") + idea("I-003");
    const t = tally(graph(text).ideas);
    expect(t.total).toBe(3);
    expect(t.done).toBe(1);
    expect(t.by).toEqual({ todo: 1, doing: 1, done: 1, blocked: 0 });
    expect(tally([])).toEqual({ total: 0, done: 0, by: { todo: 0, doing: 0, done: 0, blocked: 0 } });
  });

  it("the write-back carries `step` on a new idea and on a field edit, as one line", () => {
    const source = head + steps(["甲", "乙", "丙"]) + "ideas:\n" + idea("I-001", "甲") + idea("I-002", "乙") + idea("I-003", "丙");
    const r = applyChanges(source, {
      v: 1, baseDigest: fingerprint(source),
      ops: [
        { op: "add", tmp: "tmp:1", fields: { name: "新想法", what: "W", step: "乙" } },
        { op: "set", id: "I-001", field: "step", old: "甲", new: "丙" },
      ],
    }, "2026-09-03");
    expect(r.ok, r.reason).toBe(true);
    const after = graph(r.text!);
    expect(after.ideas.find((i) => i.id === "I-001")?.step).toBe("丙");
    expect(after.ideas.find((i) => i.name === "新想法")?.step).toBe("乙");
    expect(r.text).toMatch(/^    step: 丙$/m);            // a plain scalar, not a folded block
    expect(check(after, dir).errors).toEqual([]);
  });
});
