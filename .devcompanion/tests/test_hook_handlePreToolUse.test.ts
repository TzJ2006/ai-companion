import { describe, it, expect } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { handlePreToolUse } from "../../packages/hook/src/pre-tool-use-guard.js";

async function setupActiveRoot(): Promise<string> {
  const root = join(tmpdir(), `ccplan-${randomUUID()}`);
  const dir = join(root, ".devcompanion");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".ccplan-active"), "");
  return root;
}

describe("handlePreToolUse", () => {
  it("does not block when ccplan is not active", () => {
    const root = join(tmpdir(), `ccplan-${randomUUID()}`);
    const result = handlePreToolUse(
      { tool_name: "Edit", tool_input: { file_path: "src/foo.ts" } },
      root
    );
    expect(result.blocked).toBe(false);
  });

  it("blocks Edit on non-ECL file when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Edit", tool_input: { file_path: "src/foo.ts" } },
      root
    );
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("planning mode");
  });

  it("allows Edit on ECL file when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Edit", tool_input: { file_path: "docs/ecl/feature.yaml" } },
      root
    );
    expect(result.blocked).toBe(false);
  });

  it("allows Read when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Read", tool_input: { file_path: "src/foo.ts" } },
      root
    );
    expect(result.blocked).toBe(false);
  });

  it("blocks Write on source file when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Write", tool_input: { file_path: "src/new.ts" } },
      root
    );
    expect(result.blocked).toBe(true);
  });

  it("blocks destructive Bash commands when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Bash", tool_input: { command: "rm -rf dist/" } },
      root
    );
    expect(result.blocked).toBe(true);
  });

  it("allows read-only Bash commands when active", async () => {
    const root = await setupActiveRoot();
    const result = handlePreToolUse(
      { tool_name: "Bash", tool_input: { command: "ls src/" } },
      root
    );
    expect(result.blocked).toBe(false);
  });
});
