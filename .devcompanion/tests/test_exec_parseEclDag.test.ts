import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseEclDag } from "../../packages/exec/src/parse-ecl-dag.js";
import { EclParseError } from "../../packages/exec/src/types.js";

const tmpDir = join(tmpdir(), `ecl-test-${randomUUID()}`);

async function writeEcl(content: string): Promise<string> {
  await mkdir(tmpDir, { recursive: true });
  const path = join(tmpDir, `test-${randomUUID()}.yaml`);
  await writeFile(path, content, "utf-8");
  return path;
}

const validEcl = `
ecl_version: "2.0"
feature: "test"
status: "phase-9-approved"
functions:
  - id: FN-001
    name: funcA
    parent: MOD-001
    depends_on: []
    enables: [FN-002]
    output:
      file: src/a.ts
      symbol: funcA
    verify:
      command: npx vitest run a.test.ts
      pass_condition: exit 0
    status: pending
  - id: FN-002
    name: funcB
    parent: MOD-001
    depends_on: [FN-001]
    enables: []
    output:
      file: src/b.ts
      symbol: funcB
    verify:
      command: npx vitest run b.test.ts
      pass_condition: exit 0
    status: pending
  - id: FN-003
    name: funcC
    parent: MOD-002
    depends_on: [FN-001]
    enables: []
    output:
      file: src/c.ts
      symbol: funcC
    verify:
      command: npx vitest run c.test.ts
      pass_condition: exit 0
    status: pending
`;

describe("parseEclDag", () => {
  it("parses valid ECL with 3 FNs", async () => {
    const path = await writeEcl(validEcl);
    const graph = await parseEclDag(path);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.get("FN-001")).toEqual([]);
    expect(graph.edges.get("FN-002")).toEqual(["FN-001"]);
    expect(graph.edges.get("FN-003")).toEqual(["FN-001"]);
  });

  it("throws on missing file", async () => {
    await expect(parseEclDag("/nonexistent.yaml")).rejects.toThrow(EclParseError);
  });

  it("throws on ECL with no functions", async () => {
    const path = await writeEcl("ecl_version: '2.0'\nfeature: test\n");
    await expect(parseEclDag(path)).rejects.toThrow("no functions section");
  });

  it("throws on invalid depends_on reference", async () => {
    const ecl = `
functions:
  - id: FN-001
    name: a
    depends_on: [FN-999]
    output: { file: a.ts, symbol: a }
    verify: { command: test, pass_condition: exit 0 }
    status: pending
`;
    const path = await writeEcl(ecl);
    await expect(parseEclDag(path)).rejects.toThrow("unknown FN: FN-999");
  });
});
