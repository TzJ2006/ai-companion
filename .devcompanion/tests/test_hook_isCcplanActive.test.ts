import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { isCcplanActive } from "../../packages/hook/src/pre-tool-use-guard.js";

describe("isCcplanActive", () => {
  it("returns false when marker file does not exist", () => {
    const root = join(tmpdir(), `ccplan-${randomUUID()}`);
    expect(isCcplanActive(root)).toBe(false);
  });

  it("returns true when marker file exists", async () => {
    const root = join(tmpdir(), `ccplan-${randomUUID()}`);
    const dir = join(root, ".devcompanion");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".ccplan-active"), "");
    expect(isCcplanActive(root)).toBe(true);
  });
});
