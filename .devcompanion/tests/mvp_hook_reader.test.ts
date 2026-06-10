import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handlePostToolUse } from "../../packages/hook/src/index.js";
import { readEvents } from "../../packages/hook/src/read-events.js";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// FN MVP-HOOK-READER: the PostToolUse hook writes a JSONL audit trail; this
// asserts the matching reader (`readEvents`) is not write-only. Drives the
// real `handlePostToolUse` writer against a temp project (a .devcompanion
// marker so findProjectRoot resolves), then reads events back by path. No fs
// mocking — exercises the real queue round-trip.

describe("mvp_hook_reader (FN MVP-HOOK-READER)", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mvp-hook-reader-"));
    // marker so findProjectRoot stops here
    mkdirSync(join(projectRoot, ".devcompanion"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function fire(toolName: string, relPath: string): string {
    const filePath = join(projectRoot, relPath);
    writeFileSync(filePath, "content\n");
    handlePostToolUse(
      JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } })
    );
    return filePath;
  }

  it("returns exactly the events recorded for the target path", () => {
    const appPath = fire("Edit", "app.ts");
    fire("Write", "other.ts");
    fire("Edit", "config.yaml");

    // readEvents derives the queue dir from the file's project root.
    const appEvents = readEvents(appPath);
    expect(appEvents).toHaveLength(1);
    expect(appEvents[0].file_path).toBe(appPath);
    expect(appEvents[0].tool).toBe("Edit");
    // shape sanity: additive placeholder survives the round-trip
    expect(appEvents[0].five_questions).toBeNull();
  });

  it("returns every event for a path edited more than once", () => {
    const appPath = fire("Write", "app.ts");
    fire("Edit", "app.ts");
    fire("Edit", "app.ts");
    fire("Edit", "noise.ts");

    const appEvents = readEvents(appPath);
    expect(appEvents).toHaveLength(3);
    expect(appEvents.every((e) => e.file_path === appPath)).toBe(true);
  });

  it("accepts an explicit queueDir for testability", () => {
    const appPath = fire("Edit", "app.ts");
    const queueDir = join(projectRoot, ".devcompanion", "queue");

    const events = readEvents(appPath, { queueDir });
    expect(events).toHaveLength(1);
    expect(events[0].file_path).toBe(appPath);
  });

  it("accepts an explicit projectRoot for testability", () => {
    const appPath = fire("Edit", "app.ts");

    const events = readEvents(appPath, { projectRoot });
    expect(events).toHaveLength(1);
    expect(events[0].file_path).toBe(appPath);
  });

  it("returns [] when the queue is missing (nothing recorded yet)", () => {
    // no fire(): the queue file never gets created
    const events = readEvents(join(projectRoot, "app.ts"));
    expect(events).toEqual([]);
  });

  it("returns [] for a path that has no recorded events", () => {
    fire("Edit", "app.ts");
    const events = readEvents(join(projectRoot, "never-touched.ts"));
    expect(events).toEqual([]);
  });
});
