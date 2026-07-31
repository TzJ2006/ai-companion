import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getChangedFilePaths } from "../../packages/hook/src/tool-event.js";
import { handlePostToolUse } from "../../packages/hook/src/index.js";
import { handlePreToolUse } from "../../packages/hook/src/pre-tool-use-guard.js";

const CODEX_PATCH = `*** Begin Patch
*** Update File: packages/core/src/app.ts
@@
-old
+new
*** Add File: docs/ecl/change.yaml
+feature: change
*** Delete File: notes.txt
*** Update File: packages/core/src/old-name.ts
*** Move to: packages/core/src/new-name.ts
@@
*** End Patch`;

describe("Codex apply_patch hook adapter", () => {
  it("extracts and normalizes every path from a Codex patch", () => {
    const root = join(tmpdir(), "codex-hook-root");
    expect(getChangedFilePaths({
      tool_name: "apply_patch",
      tool_input: { command: CODEX_PATCH },
      cwd: root,
    })).toEqual([
      join(root, "packages/core/src/app.ts"),
      join(root, "docs/ecl/change.yaml"),
      join(root, "notes.txt"),
      join(root, "packages/core/src/old-name.ts"),
      join(root, "packages/core/src/new-name.ts"),
    ]);
  });

  it("records all supported files from a Codex patch", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-hook-record-"));
    try {
      mkdirSync(join(root, ".devcompanion"));
      handlePostToolUse(JSON.stringify({
        tool_name: "apply_patch",
        tool_input: { command: CODEX_PATCH },
        cwd: root,
      }));

      const events = readFileSync(join(root, ".devcompanion", "queue", "events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events).toHaveLength(4);
      expect(events.map((event) => event.file_path)).toEqual([
        join(root, "packages/core/src/app.ts"),
        join(root, "docs/ecl/change.yaml"),
        join(root, "packages/core/src/old-name.ts"),
        join(root, "packages/core/src/new-name.ts"),
      ]);
      expect(events.every((event) => event.tool === "apply_patch")).toBe(true);
      expect(events[1].file_level).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks an apply_patch source edit while ccplan is active", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-hook-guard-"));
    try {
      mkdirSync(join(root, ".devcompanion"));
      mkdirSync(join(root, ".devcompanion", ".ccplan-active"), { recursive: true });
      // A marker is a file in production; a directory is still sufficient for existsSync.
      const result = handlePreToolUse({
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch" },
        cwd: root,
      }, root);
      expect(result.blocked).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an apply_patch that changes only an ECL YAML file", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-hook-ecl-"));
    try {
      mkdirSync(join(root, ".devcompanion", ".ccplan-active"), { recursive: true });
      const result = handlePreToolUse({
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Update File: docs/ecl/change.yaml\n*** End Patch" },
        cwd: root,
      }, root);
      expect(result.blocked).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
