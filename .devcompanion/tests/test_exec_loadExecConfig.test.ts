import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadExecConfig } from "../../packages/exec/src/config.js";

describe("loadExecConfig", () => {
  it("returns default config when file does not exist", async () => {
    const root = join(tmpdir(), `exec-cfg-${randomUUID()}`);
    const config = await loadExecConfig(root);
    expect(config.maxConcurrency).toBe(3);
  });

  it("reads maxConcurrency from file", async () => {
    const root = join(tmpdir(), `exec-cfg-${randomUUID()}`);
    const dir = join(root, ".devcompanion");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "exec.json"), JSON.stringify({ maxConcurrency: 5 }));
    const config = await loadExecConfig(root);
    expect(config.maxConcurrency).toBe(5);
  });

  it("returns default for invalid maxConcurrency", async () => {
    const root = join(tmpdir(), `exec-cfg-${randomUUID()}`);
    const dir = join(root, ".devcompanion");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "exec.json"), JSON.stringify({ maxConcurrency: -1 }));
    const config = await loadExecConfig(root);
    expect(config.maxConcurrency).toBe(3);
  });
});
