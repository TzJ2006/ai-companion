import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hook = join(import.meta.dirname, "../../cursor-companion/hooks/record.mjs");

function run(cwd: string, payload: object): void {
  const r = spawnSync(process.execPath, [hook], {
    cwd, input: JSON.stringify(payload), encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout || "{}")).toEqual({});
}

describe("record hook", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("appends a code change and skips the log file itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "rec-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export {}\n");
    run(dir, {
      file_path: join(dir, "src", "a.ts"),
      edits: [{ old_string: "", new_string: "export function f() {\n  return 1;\n}\n" }],
    });
    const log = join(dir, "ideas", "log.md");
    expect(existsSync(log)).toBe(true);
    const first = readFileSync(log, "utf8");
    expect(first).toMatch(/hook · code/);
    expect(first).toMatch(/file: src\/a\.ts/);

    run(dir, {
      file_path: log,
      edits: [{ old_string: "x", new_string: "y" }],
    });
    expect(readFileSync(log, "utf8")).toBe(first);
  });

  it("writes log.cursor.md when graph.yaml belongs to another agent", () => {
    const dir = mkdtempSync(join(tmpdir(), "rec-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), "agent: claude\nideas: []\n");
    writeFileSync(join(dir, "src", "a.ts"), "export {}\n");
    run(dir, {
      file_path: join(dir, "src", "a.ts"),
      edits: [{ old_string: "", new_string: "export const n = 1;\n" }],
    });
    expect(existsSync(join(dir, "ideas", "log.cursor.md"))).toBe(true);
    expect(existsSync(join(dir, "ideas", "log.md"))).toBe(false);
    expect(readFileSync(join(dir, "ideas", "log.cursor.md"), "utf8")).toMatch(/src\/a\.ts/);
  });
});
