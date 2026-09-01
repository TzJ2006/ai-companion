import { describe, it, expect } from "vitest";
import { claudeHooks, cursorHooks, codexHooks, ENGINE_RELATIVE } from "../../companion/manifests.js";

// I-097 — 三份只含 hook 接线的小清单，每家只写「哪个事件、调哪条命令」，命令都
// 指向同一个单文件产物。Claude 用 exec 形式加 ${CLAUDE_PROJECT_DIR} 占位符
// （官方对 Windows 的建议，也终结了「换台机器接线就断」的绝对路径问题）；
// Cursor 的关键拦截项 failClosed；Codex 的命令保持一行稳定字符串（信任绑定
// hook 定义哈希，产物更新不该触发重新信任）。裁决依据：D14/D15。
describe("companion platform manifests (I-097)", () => {
  const all = () => [claudeHooks(), cursorHooks(), codexHooks()] as const;

  it("no manifest carries an absolute path, a machine name, or an 'ask'", () => {
    for (const manifest of all()) {
      const text = JSON.stringify(manifest);
      expect(text).not.toMatch(/[A-Z]:[\\/]/);          // no drive letters
      expect(text).not.toMatch(/npx|tsx/);              // plain node only
      expect(text).not.toMatch(/"ask"/);
    }
  });

  it("claude: the four guard events plus SessionStart, exec form, placeholder path", () => {
    const hooks = claudeHooks() as Record<string, { matcher?: string; hooks: { command: string; args?: string[]; timeout?: number }[] }[]>;
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SessionStart"]) {
      expect(Object.keys(hooks), event).toContain(event);
    }
    const text = JSON.stringify(hooks);
    expect(text).toContain("${CLAUDE_PROJECT_DIR}");
    // exec form: command is the executable, the path travels in args
    for (const group of hooks["PreToolUse"]) {
      for (const h of group.hooks) {
        expect(h.command).toBe("node");
        expect(h.args?.join(" ")).toContain(ENGINE_RELATIVE);
      }
    }
    // shell commands are gated too, and Windows without git-bash speaks PowerShell
    const matchers = hooks["PreToolUse"].map((g) => g.matcher ?? "");
    expect(matchers.join("|")).toMatch(/Bash\|PowerShell/);
    expect(matchers.join("|")).toMatch(/mcp__/);
    // the 30-second UserPromptSubmit trap: an explicit, larger timeout
    const upsHooks = hooks["UserPromptSubmit"][0].hooks[0];
    expect(upsHooks.timeout ?? 0).toBeGreaterThanOrEqual(60);
  });

  it("cursor: version 1, native events, failClosed on the blocking ones, relative commands", () => {
    const manifest = cursorHooks() as { version: number; hooks: Record<string, { command: string; failClosed?: boolean }[]> };
    expect(manifest.version).toBe(1);
    for (const event of ["preToolUse", "beforeShellExecution", "beforeMCPExecution", "afterFileEdit", "beforeSubmitPrompt", "stop", "sessionStart"]) {
      expect(Object.keys(manifest.hooks), event).toContain(event);
    }
    for (const event of ["preToolUse", "beforeShellExecution", "beforeMCPExecution"]) {
      for (const entry of manifest.hooks[event]) {
        expect(entry.failClosed, `${event} 必须 failClosed`).toBe(true);
      }
    }
    for (const entries of Object.values(manifest.hooks)) {
      for (const entry of entries) {
        expect(entry.command.startsWith("node ")).toBe(true);
        expect(entry.command).toContain(ENGINE_RELATIVE);
        expect(entry.command).toContain("--platform=cursor");
      }
    }
  });

  it("codex: claude-shaped events, matcher covers apply_patch and mcp, one stable command string", () => {
    const manifest = codexHooks() as { hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> };
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"]) {
      expect(Object.keys(manifest.hooks), event).toContain(event);
    }
    const pre = manifest.hooks["PreToolUse"][0];
    expect(pre.matcher).toMatch(/apply_patch/);
    expect(pre.matcher).toMatch(/mcp__/);

    const commands = Object.values(manifest.hooks)
      .flat().flatMap((g) => g.hooks.map((h) => h.command));
    expect(new Set(commands).size).toBe(1);             // 信任哈希稳定：一条命令走天下
    expect(commands[0]).toContain("--platform=codex");
  });
});
