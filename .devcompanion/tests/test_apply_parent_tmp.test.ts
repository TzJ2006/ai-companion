import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { applyChanges, fingerprint, type Graph } from "../../companion/ideas.js";

// I-129 —— 写回发真编号时，`parent` 字段值里的临时号也要换成真编号。
// 2026-09-06 分层时撞上：62 条 `set parent → tmp:N` 原样落进校验，整份被拒，只能分两步。
const head = "version: 1\nproject: p\nendpoints: [I-003]\n";
const idea = (id: string, parent?: string) => `  - id: ${id}
    name: "想法 ${id}"
    status: todo
    needs: []${parent === undefined ? "" : `\n    parent: ${parent}`}
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
`;
const source = head + "ideas:\n" + idea("I-001") + idea("I-002", "I-001") + idea("I-003", "I-001");
const graph = (text: string) => parseDocument(text).toJSON() as Graph;
const apply = (ops: unknown[]) =>
  applyChanges(source, { v: 1, baseDigest: fingerprint(source), ops }, "2026-09-06");

describe("I-129 写回：parent 值里的临时号跟着换成真编号", () => {
  it("add tmp:1 加 set I-003 parent → tmp:1，一次写回通过，parent 是新发的真编号", () => {
    const r = apply([
      { op: "add", tmp: "tmp:1", fields: { name: "中间层", what: "W", why: "Y", expected: "E" } },
      { op: "set", id: "I-003", field: "parent", old: "I-001", new: "tmp:1" },
    ]);
    expect(r.ok, r.reason).toBe(true);
    const after = graph(r.text!);
    const fresh = after.ideas.find((i) => i.name === "中间层")!;
    expect(fresh.id).toMatch(/^I-\d{3}$/);
    expect(after.ideas.find((i) => i.id === "I-003")?.parent).toBe(fresh.id);
    expect(r.text).not.toContain("tmp:");
  });

  it("新建想法自己的 fields.parent 指向另一个临时号，同样换掉", () => {
    const r = apply([
      { op: "add", tmp: "tmp:1", fields: { name: "上层", what: "W", why: "Y", expected: "E" } },
      { op: "add", tmp: "tmp:2", fields: { name: "下层", what: "W", why: "Y", expected: "E", parent: "tmp:1" } },
    ]);
    expect(r.ok, r.reason).toBe(true);
    const after = graph(r.text!);
    const upper = after.ideas.find((i) => i.name === "上层")!;
    expect(after.ideas.find((i) => i.name === "下层")?.parent).toBe(upper.id);
    expect(r.text).not.toContain("tmp:");
  });

  it("parent 指向没有任何 add 声明的临时号：整体拒绝，理由点名临时号", () => {
    const r = apply([{ op: "set", id: "I-003", field: "parent", old: "I-001", new: "tmp:7" }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/临时号/);
    expect(r.reason).toContain("tmp:7");
  });

  it("规范说临时号出现在五个位置，parent 算一个", () => {
    const spec = readFileSync(join(__dirname, "..", "..", "companion", "FORMAT.md"), "utf8");
    expect(spec).toContain("临时号会出现在五个位置");
    expect(spec).not.toContain("临时号会出现在四个位置");
  });
});
