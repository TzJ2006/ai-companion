import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handlePostToolUse } from "../../packages/hook/src/index.js";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// FN MVP-HOOK-REC: edits to .yaml/.md must be RECORDED at file level (no AST
// parse), not dropped. .ts/.py must keep recording exactly as before. Every
// recorded event must carry the additive `five_questions` placeholder.
//
// Drives handlePostToolUse against a REAL temp project (with a .devcompanion
// marker so findProjectRoot resolves), then reads the JSONL queue file the
// hook writes to. No fs mocking — exercises the real writer/queue path.

describe("mvp_hook_recording (FN MVP-HOOK-REC)", () => {
  let projectRoot: string;
  let queueFile: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mvp-hook-rec-"));
    // marker so findProjectRoot stops here
    mkdirSync(join(projectRoot, ".devcompanion"), { recursive: true });
    queueFile = join(projectRoot, ".devcompanion", "queue", "events.jsonl");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function fire(toolName: string, relPath: string): void {
    const filePath = join(projectRoot, relPath);
    // create the file so the edit looks real (hook doesn't require it, but
    // keeps the scenario faithful)
    writeFileSync(filePath, "content\n");
    handlePostToolUse(
      JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } })
    );
  }

  function readEvents(): Array<Record<string, unknown>> {
    if (!existsSync(queueFile)) return [];
    return readFileSync(queueFile, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("records a .ts edit as exactly 1 event (no regression)", () => {
    fire("Edit", "app.ts");
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].file_path).toBe(join(projectRoot, "app.ts"));
    expect(events[0].tool).toBe("Edit");
    // AST-supported events are NOT flagged file_level
    expect(events[0].file_level).toBeUndefined();
    // additive placeholder present on every event
    expect(events[0]).toHaveProperty("five_questions");
    expect(events[0].five_questions).toBeNull();
  });

  it("now records a .yaml edit as exactly 1 file-level event", () => {
    fire("Write", "config.yaml");
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].file_path).toBe(join(projectRoot, "config.yaml"));
    expect(events[0].tool).toBe("Write");
    expect(events[0].file_level).toBe(true);
    expect(events[0]).toHaveProperty("five_questions");
    expect(events[0].five_questions).toBeNull();
  });

  it("now records a .md edit as exactly 1 file-level event", () => {
    fire("Edit", "README.md");
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].file_path).toBe(join(projectRoot, "README.md"));
    expect(events[0].file_level).toBe(true);
    expect(events[0]).toHaveProperty("five_questions");
    expect(events[0].five_questions).toBeNull();
  });

  it("still drops a truly unsupported extension (.txt)", () => {
    fire("Edit", "notes.txt");
    expect(readEvents()).toHaveLength(0);
  });
});
