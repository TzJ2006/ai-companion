import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryStore } from "../../packages/history/src/store.ts";
import {
  GITIGNORE_MANAGED_START,
  applyManagedGitignore,
} from "../../packages/history/src/managed-gitignore.ts";

describe("3a HistoryStore.ensureGitignore", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "history-store-gitignore-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("writes the tests-preserving pattern instead of blanket .devcompanion/", async () => {
    const store = new HistoryStore(projectRoot);
    await store.init();
    const gitignore = await readFile(join(projectRoot, ".gitignore"), "utf8");
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());
    expect(gitignore).toContain(".devcompanion/*");
    expect(gitignore).toContain("!.devcompanion/tests/");
    expect(lines).not.toContain(".devcompanion/");
    expect(gitignore).not.toContain(".claude/settings.json");
  });

  it("does not fight an installer-managed public block", async () => {
    const gitignorePath = join(projectRoot, ".gitignore");
    await writeFile(gitignorePath, applyManagedGitignore("dist/\n", "public"));
    const before = await readFile(gitignorePath, "utf8");

    const store = new HistoryStore(projectRoot);
    await store.init();

    const after = await readFile(gitignorePath, "utf8");
    expect(after).toBe(before);
    expect(after).toContain(".claude/settings.json");
    expect(after.split(GITIGNORE_MANAGED_START).length - 1).toBe(1);
  });
});
