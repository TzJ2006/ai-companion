import { describe, it, expect } from "vitest";
import { getExecutionState } from "../../packages/exec/src/session-recovery.js";
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

describe("getExecutionState", () => {
  it("fresh graph: no-dep nodes are ready, rest are pending", () => {
    const graph = makeGraph([
      makeFn("A"),
      makeFn("B", ["A"]),
      makeFn("C"),
    ]);
    const state = getExecutionState(graph);
    expect(state.ready.map((n) => n.id).sort()).toEqual(["A", "C"]);
    expect(state.pending.map((n) => n.id)).toEqual(["B"]);
    expect(state.done).toHaveLength(0);
    expect(state.blocked).toHaveLength(0);
  });

  it("partially executed graph", () => {
    const graph = makeGraph([
      makeFn("A", [], "done"),
      makeFn("B", ["A"], "blocked"),
      makeFn("C", ["A"]),
      makeFn("D", ["B", "C"]),
    ]);
    const state = getExecutionState(graph);
    expect(state.done.map((n) => n.id)).toEqual(["A"]);
    expect(state.blocked.map((n) => n.id)).toEqual(["B"]);
    expect(state.ready.map((n) => n.id)).toEqual(["C"]);
    expect(state.pending.map((n) => n.id)).toEqual(["D"]);
  });

  it("all done", () => {
    const graph = makeGraph([
      makeFn("A", [], "done"),
      makeFn("B", ["A"], "done"),
    ]);
    const state = getExecutionState(graph);
    expect(state.done).toHaveLength(2);
    expect(state.ready).toHaveLength(0);
    expect(state.pending).toHaveLength(0);
    expect(state.blocked).toHaveLength(0);
  });
});
