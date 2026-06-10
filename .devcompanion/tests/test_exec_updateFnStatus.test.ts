import { describe, it, expect } from "vitest";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { updateFnStatus } from "../../packages/exec/src/status-manager.js";

const eclContent = `# Header
ecl_version: "2.0"
feature: "test"
status: "phase-10-implementing"

functions:
  - id: FN-001
    name: funcA
    depends_on: []
    output:
      file: src/a.ts
      symbol: funcA
    verify:
      command: npx vitest run a.test.ts
      pass_condition: exit 0
    status: pending
  - id: FN-002
    name: funcB
    depends_on: [FN-001]
    output:
      file: src/b.ts
      symbol: funcB
    verify:
      command: npx vitest run b.test.ts
      pass_condition: exit 0
    status: pending
`;

describe("updateFnStatus", () => {
  it("updates FN-001 status to done", async () => {
    const dir = join(tmpdir(), `ecl-status-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "test.yaml");
    await writeFile(path, eclContent);

    await updateFnStatus(path, "FN-001", "done");

    const updated = await readFile(path, "utf-8");
    expect(updated).toContain("status: done");
    expect(updated).toContain("# Header");
    expect(updated).toContain("FN-002");
  });

  it("throws when FN not found", async () => {
    const dir = join(tmpdir(), `ecl-status-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "test.yaml");
    await writeFile(path, eclContent);

    await expect(updateFnStatus(path, "FN-999", "done")).rejects.toThrow("FN not found");
  });
});
