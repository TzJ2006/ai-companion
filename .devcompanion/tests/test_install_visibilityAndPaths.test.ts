import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  GITIGNORE_MANAGED_START,
  applyManagedGitignore,
  managedGitignoreBlock,
} from "../../packages/history/src/managed-gitignore.ts";
import {
  detectRepoVisibility,
  parseGithubRemote,
} from "../../scripts/lib/detect-visibility.ts";
import { installAgentConfig } from "../../scripts/lib/install-agent-config.ts";
import { addTarget, pathKey, type Registry } from "../../scripts/lib/registry.ts";

const temporaryDirectories: string[] = [];
const aidevRoot = resolve(import.meta.dirname, "../..");

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "aidev-install-visibility-"));
  temporaryDirectories.push(directory);
  return directory;
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function gitignoreLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim());
}

function assertNoHostLeak(content: string, targetPath: string): void {
  const parentDir = resolve(targetPath, "..");
  for (const needle of [aidevRoot, parentDir]) {
    expect(content).not.toContain(needle);
    expect(content).not.toContain(needle.replace(/\\/g, "/"));
  }
  expect(content).not.toMatch(/\(\s*[A-Za-z]:[^)]*\/\*\*/);
}

function gitCheckIgnored(repoPath: string, relativePath: string): boolean {
  try {
    execFileSync("git", ["-C", repoPath, "check-ignore", "-q", relativePath], {
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return false;
    throw error;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("3a visibility-aware managed gitignore", () => {
  it("keeps .devcompanion/tests/ and replaces its managed block idempotently", () => {
    const publicGitignore = applyManagedGitignore("dist/\n.devcompanion/\n", "public");
    expect(publicGitignore).toContain(".devcompanion/*");
    expect(publicGitignore).toContain("!.devcompanion/tests/");
    expect(publicGitignore).toContain(".claude/settings.json");
    expect(gitignoreLines(publicGitignore)).not.toContain(".devcompanion/");
    expect(occurrences(publicGitignore, GITIGNORE_MANAGED_START)).toBe(1);
    expect(applyManagedGitignore(publicGitignore, "public")).toBe(publicGitignore);

    const leftoverBlanket = `dist/\n.devcompanion/\n\n${managedGitignoreBlock("init")}\n`;
    const replaced = applyManagedGitignore(leftoverBlanket, "public");
    expect(gitignoreLines(replaced)).not.toContain(".devcompanion/");
    expect(occurrences(replaced, GITIGNORE_MANAGED_START)).toBe(1);

    const privateGitignore = applyManagedGitignore(publicGitignore, "private");
    expect(privateGitignore).toContain(".devcompanion/queue/");
    expect(privateGitignore).toContain(".devcompanion/reports/");
    expect(privateGitignore).not.toContain(".claude/settings.json");
    expect(privateGitignore).not.toContain("!.devcompanion/tests/");
    expect(occurrences(privateGitignore, GITIGNORE_MANAGED_START)).toBe(1);
  });

  it("lets git check-ignore keep tests for public and private profiles", () => {
    for (const profile of ["public", "private"] as const) {
      const repoPath = makeTemporaryDirectory();
      execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
      writeFileSync(join(repoPath, ".gitignore"), applyManagedGitignore("", profile));
      mkdirSync(join(repoPath, ".devcompanion", "tests"), { recursive: true });
      mkdirSync(join(repoPath, ".devcompanion", "queue"), { recursive: true });
      writeFileSync(join(repoPath, ".devcompanion", "tests", "foo.test.ts"), "export {};\n");
      writeFileSync(join(repoPath, ".devcompanion", "queue", "events.jsonl"), "{}\n");
      writeFileSync(join(repoPath, ".devcompanion", "analysis.json"), "{}\n");

      expect(gitCheckIgnored(repoPath, ".devcompanion/tests/foo.test.ts")).toBe(false);
      expect(gitCheckIgnored(repoPath, ".devcompanion/queue/events.jsonl")).toBe(true);
      if (profile === "public") {
        expect(gitCheckIgnored(repoPath, ".devcompanion/analysis.json")).toBe(true);
        expect(gitCheckIgnored(repoPath, ".claude/settings.json")).toBe(true);
      } else {
        expect(gitCheckIgnored(repoPath, ".devcompanion/analysis.json")).toBe(false);
        expect(gitCheckIgnored(repoPath, ".claude/settings.json")).toBe(false);
      }
    }
  });

  it("lets an explicit visibility flag win and otherwise fails public-safe", () => {
    expect(parseGithubRemote("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubRemote("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });

    let calls = 0;
    const privateVisibility = detectRepoVisibility("ignored", {
      flag: "private",
      runCommand: () => {
        calls++;
        return null;
      },
    });
    expect(privateVisibility).toBe("private");
    expect(calls).toBe(0);

    const detectedPrivate = detectRepoVisibility("ignored", {
      runCommand: (command) =>
        command === "git" ? "git@github.com:owner/repo.git" : "true",
    });
    expect(detectedPrivate).toBe("private");
    expect(detectRepoVisibility("ignored", { runCommand: () => null })).toBe("public");

    const registry: Registry = { aidev_root: "", version: "0.1.0", targets: [] };
    const targetPath = makeTemporaryDirectory();
    addTarget(registry, targetPath, true, false, "both", detectedPrivate);
    addTarget(registry, targetPath, false, true, "claude", "public");
    expect(registry.targets).toHaveLength(1);
    expect(registry.targets[0].visibility).toBe("public");
    expect(registry.targets[0].enforce).toBe(false);
    if (process.platform === "win32") {
      expect(pathKey(registry.targets[0].path)).toBe(pathKey(targetPath));
    }
  });
});

describe("3b path-portable generated config", () => {
  it("installs path-free hooks, CLAUDE.md, and stubs with no parentDir grants", () => {
    const targetPath = makeTemporaryDirectory();
    const options = {
      targetPath,
      aidevRoot,
      enforce: true,
      includeCommands: true,
      agent: "both" as const,
      visibility: "public" as const,
    };

    installAgentConfig(options);
    installAgentConfig(options);

    const claudeSettingsPath = join(targetPath, ".claude", "settings.json");
    const codexHooksPath = join(targetPath, ".codex", "hooks.json");
    const claudeMdPath = join(targetPath, "CLAUDE.md");
    const claudeSettings = readFileSync(claudeSettingsPath, "utf8");
    const codexHooks = readFileSync(codexHooksPath, "utf8");
    const claudeMd = readFileSync(claudeMdPath, "utf8");
    const parsedSettings = JSON.parse(claudeSettings) as {
      permissions: { allow: string[] };
      hooks: { PostToolUse: unknown[]; PreToolUse: unknown[] };
    };

    expect(existsSync(join(targetPath, ".claude", "hooks", "aidev-hook.cjs"))).toBe(true);
    expect(existsSync(join(targetPath, ".codex", "aidev-hook.cjs"))).toBe(true);
    expect(claudeSettings).toContain(".claude/hooks/aidev-hook.cjs");
    expect(codexHooks).toContain(".codex/aidev-hook.cjs");
    expect(occurrences(claudeSettings, "aidev-hook.cjs")).toBe(2);
    expect(parsedSettings.hooks.PostToolUse).toHaveLength(1);
    expect(parsedSettings.hooks.PreToolUse).toHaveLength(1);
    expect(parsedSettings.permissions.allow).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\/\*\*/)]),
    );
    expect(claudeSettings).not.toMatch(/parentDir/);

    assertNoHostLeak(claudeSettings, targetPath);
    assertNoHostLeak(codexHooks, targetPath);
    assertNoHostLeak(claudeMd, targetPath);
    assertNoHostLeak(readFileSync(join(targetPath, ".claude", "hooks", "aidev-hook.cjs"), "utf8"), targetPath);
    assertNoHostLeak(readFileSync(join(targetPath, ".claude", "commands", "ccoverview.md"), "utf8"), targetPath);
    assertNoHostLeak(readFileSync(join(targetPath, ".agents", "skills", "ccoverview", "SKILL.md"), "utf8"), targetPath);

    const gitignore = readFileSync(join(targetPath, ".gitignore"), "utf8");
    expect(gitignore).toContain(".devcompanion/*");
    expect(gitignore).toContain("!.devcompanion/tests/");
    expect(gitignore).toContain(".claude/settings.json");
  });
});

describe("3c existing-target migration", () => {
  it("replaces old parentDir permissions and is idempotent on reinstall", () => {
    const targetPath = makeTemporaryDirectory();
    const parentDir = resolve(targetPath, "..").replace(/\\/g, "/");
    const oldHook = `node "${aidevRoot.replace(/\\/g, "/")}/packages/hook/dist/index.js"`;
    mkdirSync(join(targetPath, ".claude"), { recursive: true });
    writeFileSync(
      join(targetPath, ".claude", "settings.json"),
      `${JSON.stringify({
        permissions: {
          allow: [
            "Read",
            `Read(${parentDir}/**)`,
            `Glob(${parentDir}/**)`,
            `Grep(${parentDir}/**)`,
          ],
        },
        hooks: {
          PostToolUse: [{
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: oldHook }],
          }],
        },
      }, null, 2)}\n`,
    );
    writeFileSync(join(targetPath, ".gitignore"), ".devcompanion/\n");

    const options = {
      targetPath,
      aidevRoot,
      enforce: true,
      includeCommands: false,
      agent: "both" as const,
      visibility: "public" as const,
    };
    installAgentConfig(options);
    installAgentConfig(options);

    const claudeSettings = readFileSync(join(targetPath, ".claude", "settings.json"), "utf8");
    const gitignore = readFileSync(join(targetPath, ".gitignore"), "utf8");
    const parsedSettings = JSON.parse(claudeSettings) as {
      permissions: { allow: string[] };
      hooks: { PostToolUse: unknown[]; PreToolUse: unknown[] };
    };

    expect(claudeSettings).not.toContain(`${parentDir}/**`);
    expect(claudeSettings).not.toContain("packages/hook/dist/");
    expect(parsedSettings.permissions.allow.some((rule) => rule.includes("/**"))).toBe(false);
    expect(parsedSettings.hooks.PostToolUse).toHaveLength(1);
    expect(parsedSettings.hooks.PreToolUse).toHaveLength(1);
    expect(gitignoreLines(gitignore)).not.toContain(".devcompanion/");
    expect(occurrences(gitignore, GITIGNORE_MANAGED_START)).toBe(1);

    installAgentConfig({ ...options, visibility: "private" });
    const privateGitignore = readFileSync(join(targetPath, ".gitignore"), "utf8");
    expect(privateGitignore).toContain(".devcompanion/queue/");
    expect(privateGitignore).not.toContain(".claude/settings.json");
    expect(occurrences(privateGitignore, GITIGNORE_MANAGED_START)).toBe(1);
  });
});
