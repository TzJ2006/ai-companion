import { describe, it, expect } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { buildSubagentContext } from "../../packages/exec/src/build-subagent-context.js";
import type { DagGraph, FnNode } from "../../packages/exec/src/types.js";

function makeFn(id: string, depends_on: string[] = [], status: FnNode["status"] = "pending"): FnNode {
  return {
    id,
    name: id,
    parent: "MOD-001",
    visibility: "public",
    description: `Implementation of ${id}`,
    input_interface: [{ name: "input", type: "string", source: "parameter" }],
    output_interface: { type: "string", error_cases: [] },
    side_effects: [],
    dependencies: [],
    constraints: ["Must be fast"],
    test_cases: [],
    depends_on,
    enables: [],
    output: { file: `src/${id}.ts`, symbol: id },
    verify: { command: `npx vitest run ${id}.test.ts`, pass_condition: "exit 0" },
    status,
  };
}

function makeGraph(nodes: FnNode[]): DagGraph {
  const edges = new Map<string, string[]>();
  for (const n of nodes) edges.set(n.id, n.depends_on);
  return { nodes, edges };
}

const eclWithModules = `
ecl_version: "2.0"
feature: test
modules:
  - id: MOD-001
    name: "Test Module"
    entry_point: "index.ts"
    public_interface:
      - name: "funcA"
        signature: "(x: string) => string"
        description: "Does A"
functions:
  - id: FN-001
    name: funcA
    parent: MOD-001
    depends_on: []
    output: { file: src/a.ts, symbol: funcA }
    verify: { command: echo ok, pass_condition: exit 0 }
    status: done
  - id: FN-002
    name: funcB
    parent: MOD-001
    depends_on: [FN-001]
    output: { file: src/b.ts, symbol: funcB }
    verify: { command: echo ok, pass_condition: exit 0 }
    status: pending
`;

describe("buildSubagentContext", () => {
  it("builds context with completed deps", async () => {
    const dir = join(tmpdir(), `ecl-ctx-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const eclPath = join(dir, "test.yaml");
    await writeFile(eclPath, eclWithModules);

    const graph = makeGraph([
      makeFn("FN-001", [], "done"),
      makeFn("FN-002", ["FN-001"]),
    ]);

    const ctx = await buildSubagentContext("FN-002", graph, eclPath);
    expect(ctx.fn.id).toBe("FN-002");
    expect(ctx.completedDeps).toHaveLength(1);
    expect(ctx.completedDeps[0].fnId).toBe("FN-001");
    expect(ctx.moduleInterface).not.toBeNull();
    expect(ctx.moduleInterface!.name).toBe("Test Module");
  });

  it("throws when FN not found", async () => {
    const graph = makeGraph([makeFn("FN-001")]);
    await expect(
      buildSubagentContext("FN-999", graph, "/nonexistent.yaml")
    ).rejects.toThrow("FN not found");
  });

  it("builds context with empty completedDeps for leaf node", async () => {
    const dir = join(tmpdir(), `ecl-ctx-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const eclPath = join(dir, "test.yaml");
    await writeFile(eclPath, eclWithModules);

    const graph = makeGraph([makeFn("FN-001")]);
    const ctx = await buildSubagentContext("FN-001", graph, eclPath);
    expect(ctx.completedDeps).toHaveLength(0);
  });
});
