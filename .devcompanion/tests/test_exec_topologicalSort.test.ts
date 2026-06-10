import { describe, it, expect } from "vitest";
import { topologicalSort } from "../../packages/exec/src/topological-sort.js";
import { CycleDetectedError } from "../../packages/exec/src/types.js";
import type { DagGraph, FnNode } from "../../packages/exec/src/types.js";

function makeFn(id: string, depends_on: string[] = []): FnNode {
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
    status: "pending",
  };
}

function makeGraph(nodes: FnNode[]): DagGraph {
  const edges = new Map<string, string[]>();
  for (const n of nodes) edges.set(n.id, n.depends_on);
  return { nodes, edges };
}

describe("topologicalSort", () => {
  it("linear chain: A→B→C", () => {
    const graph = makeGraph([
      makeFn("A"),
      makeFn("B", ["A"]),
      makeFn("C", ["B"]),
    ]);
    const layers = topologicalSort(graph);
    expect(layers).toHaveLength(3);
    expect(layers[0].nodes.map((n) => n.id)).toEqual(["A"]);
    expect(layers[1].nodes.map((n) => n.id)).toEqual(["B"]);
    expect(layers[2].nodes.map((n) => n.id)).toEqual(["C"]);
  });

  it("diamond: A→B, A→C, B→D, C→D", () => {
    const graph = makeGraph([
      makeFn("A"),
      makeFn("B", ["A"]),
      makeFn("C", ["A"]),
      makeFn("D", ["B", "C"]),
    ]);
    const layers = topologicalSort(graph);
    expect(layers).toHaveLength(3);
    expect(layers[0].nodes.map((n) => n.id)).toEqual(["A"]);
    expect(layers[1].nodes.map((n) => n.id).sort()).toEqual(["B", "C"]);
    expect(layers[2].nodes.map((n) => n.id)).toEqual(["D"]);
  });

  it("all independent nodes → single layer", () => {
    const graph = makeGraph([makeFn("A"), makeFn("B"), makeFn("C")]);
    const layers = topologicalSort(graph);
    expect(layers).toHaveLength(1);
    expect(layers[0].nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("throws CycleDetectedError on cycle A→B→A", () => {
    const graph = makeGraph([makeFn("A", ["B"]), makeFn("B", ["A"])]);
    expect(() => topologicalSort(graph)).toThrow(CycleDetectedError);
  });

  it("cycle error includes involved node IDs", () => {
    const graph = makeGraph([makeFn("A", ["B"]), makeFn("B", ["A"])]);
    try {
      topologicalSort(graph);
    } catch (e) {
      const err = e as CycleDetectedError;
      expect(err.involvedNodes.sort()).toEqual(["A", "B"]);
    }
  });

  it("deterministic order for same-level nodes (lexicographic)", () => {
    const graph = makeGraph([makeFn("Z"), makeFn("A"), makeFn("M")]);
    const layers = topologicalSort(graph);
    expect(layers[0].nodes.map((n) => n.id)).toEqual(["A", "M", "Z"]);
  });
});
