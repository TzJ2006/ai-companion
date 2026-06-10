import { describe, it, expect } from "vitest";
import { getReadyNodes } from "../../packages/exec/src/session-recovery.js";
import type { DagGraph, FnNode } from "../../packages/exec/src/types.js";

function makeFn(id: string, depends_on: string[] = [], status: FnNode["status"] = "pending"): FnNode {
  return {
    id,
    name: id,
    parent: "MOD-001",
    visibility: "public",
    description: "",
    input_interface: [],
    output_interface: { type: "void", error_cases: [] },
    side_effects: [],
    dependencies: [],
    constraints: [],
    test_cases: [],
    depends_on,
    enables: [],
    output: { file: `${id}.ts`, symbol: id },
    verify: { command: "echo ok", pass_condition: "exit 0" },
    status,
  };
}

function makeGraph(nodes: FnNode[]): DagGraph {
  const edges = new Map<string, string[]>();
  for (const n of nodes) edges.set(n.id, n.depends_on);
  return { nodes, edges };
}

describe("getReadyNodes", () => {
  it("returns nodes with no deps when all pending", () => {
    const graph = makeGraph([
      makeFn("A"),
      makeFn("B", ["A"]),
    ]);
    const ready = getReadyNodes(graph);
    expect(ready.map((n) => n.id)).toEqual(["A"]);
  });

  it("returns dependent node when dep is done", () => {
    const graph = makeGraph([
      makeFn("A", [], "done"),
      makeFn("B", ["A"]),
    ]);
    const ready = getReadyNodes(graph);
    expect(ready.map((n) => n.id)).toEqual(["B"]);
  });

  it("returns empty when dep is blocked", () => {
    const graph = makeGraph([
      makeFn("A", [], "blocked"),
      makeFn("B", ["A"]),
    ]);
    const ready = getReadyNodes(graph);
    expect(ready).toHaveLength(0);
  });

  it("returns empty when all done", () => {
    const graph = makeGraph([
      makeFn("A", [], "done"),
      makeFn("B", ["A"], "done"),
    ]);
    const ready = getReadyNodes(graph);
    expect(ready).toHaveLength(0);
  });
});
