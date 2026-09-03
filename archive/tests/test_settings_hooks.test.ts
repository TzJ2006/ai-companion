import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// I-056 — 清理掉指向已删除代码的过期 hook 配置。
//
// 这个仓库自己就是这套工作流的第一个使用者。它的 .claude/settings.json 里挂着
// 两条指向 packages/hook/dist/*.js 的 hook，而 packages/ 已经在 ca7e956 里被删了 ——
// 于是每次编辑都会起两个注定失败的进程。
//
// 这份测试读的是真实的 .claude/settings.json，不是夹具：它测的就是「本仓库的
// hook 配置没有指向不存在的文件」这一件事，换成夹具就什么也没测到。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS = join(ROOT, ".claude", "settings.json");

/** 每条 hook 命令：{ 事件名, 命令原文 }。 */
function hookCommands(): { event: string; command: string }[] {
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const out: { event: string; command: string }[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of (groups as any[]) ?? []) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.command === "string") out.push({ event, command: hook.command });
      }
    }
  }
  return out;
}

/**
 * 一条命令里「看起来是脚本」的那些词：去掉引号之后以 .js/.ts/.mjs/.cjs/.py 结尾。
 * `npx tsx "D:/.../guard.ts"` → `D:/.../guard.ts`；`node packages/hook/dist/index.js`
 * → `packages/hook/dist/index.js`。解释器本身（node / npx / tsx）不带这些后缀，
 * 所以不会被误当成脚本。
 */
const scriptTokens = (command: string): string[] =>
  command.split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter((t) => /\.(js|ts|mjs|cjs|py)$/.test(t));

describe("I-056 hook 配置不指向已删除的代码", () => {
  it("settings.json 存在且能解析", () => {
    expect(existsSync(SETTINGS), `没有 ${SETTINGS}`).toBe(true);
    expect(hookCommands().length, "一条 hook 都没有").toBeGreaterThan(0);
  });

  // 这条是这个想法的正题：每条 hook 命令里的脚本都必须真的在磁盘上。
  // 现在是红的 —— packages/hook/dist/index.js 和 pre-tool-use.js 都已经不存在了。
  it("每条 hook 命令指向的脚本文件都真实存在", () => {
    const missing: string[] = [];
    for (const { event, command } of hookCommands()) {
      for (const token of scriptTokens(command)) {
        // 绝对路径 resolve 会原样返回；相对路径按项目根解析。
        if (!existsSync(resolve(ROOT, token))) missing.push(`${event}: ${token}`);
      }
    }
    expect(missing, `这些 hook 指向不存在的文件：\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  // 没有这一条，把守卫整段删掉也能让上面那条变绿 ——
  // 一个「删干净就通过」的测试，正好奖励了这条想法最不该引发的那种失败。
  it("四个事件各自都还留着一条走 guard.ts 的 hook", () => {
    const commands = hookCommands();
    for (const event of ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"]) {
      const guarded = commands.filter((h) => h.event === event && h.command.includes("guard.ts"));
      expect(guarded.length, `${event} 上没有走 guard.ts 的 hook —— 守卫在这个事件上是关的`)
        .toBeGreaterThan(0);
    }
  });
});
