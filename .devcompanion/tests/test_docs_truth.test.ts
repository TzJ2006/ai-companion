import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codexHooks } from "../../companion/manifests.js";

// I-118 —— 仓库里的文字要说真话。这份测试锁的是 2026-09-06 扫描时查出的、最要紧的
// 几处失真：每一条都先问代码或磁盘的现状，再问文档有没有照着现状说。文档一旦退回
// 旧说法（「本检出没装守卫」「event 八类」「lines 必须 start-end」……），这里就红。
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("I-118 文档、规范、注释说的和代码一致", () => {
  it("本检出装着守卫：五个 hook 事件都指向 .companion/companion.mjs，文档不再说没装", () => {
    const hooks = JSON.parse(read(".claude/settings.json")).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(JSON.stringify(hooks)).toContain(".companion/companion.mjs");
    expect(existsSync(join(ROOT, ".companion/companion.mjs"))).toBe(true);
    expect(read("README.md")).not.toContain("not running its own guard");
    expect(read("CLAUDE.md")).not.toContain("nothing is installed here");
    expect(read("companion/FORMAT.md")).not.toContain("本检出当前没有装守卫");
  });

  it("规范开头的未落地清单：全文每一处「第 N 条」都指向存在的一条", () => {
    const spec = read("companion/FORMAT.md");
    const list = spec.slice(spec.indexOf("所以逐条列出"), spec.indexOf("`claude-companion/FORMAT.md` 曾是"));
    const count = (list.match(/^\d+\. /gm) ?? []).length;
    expect(count).toBeGreaterThan(0);
    for (const m of spec.matchAll(/未落地清单第 (\d+) 条/g)) {
      expect(Number(m[1]), `「未落地清单第 ${m[1]} 条」不存在，清单只有 ${count} 条`).toBeLessThanOrEqual(count);
    }
  });

  it("archive/ 是空的，文档不再说里面放着东西", () => {
    const entries = existsSync(join(ROOT, "archive")) ? readdirSync(join(ROOT, "archive")) : [];
    expect(entries).toEqual([]);
    expect(read("README.md")).not.toContain("`archive/` holds retired implementations");
    expect(read("CLAUDE.md")).not.toContain("are under `archive/`");
  });

  it("claude-companion/ 已删除，CLAUDE.md 和规范都不再把它当活目录", () => {
    expect(existsSync(join(ROOT, "claude-companion"))).toBe(false);
    expect(read("CLAUDE.md")).not.toContain("claude-companion");
    expect(read("companion/FORMAT.md")).not.toContain("现在删不得");
    expect(read("companion/FORMAT.md")).not.toContain("但这件事今天没有任何想法认领");
  });

  it("event 有九类、含 fetch，形状里有 urls[]", () => {
    const guard = read("companion/guard.ts");
    expect(guard).toMatch(/"fetch"/);
    expect(guard).toMatch(/urls\?: string\[\]/);
    const spec = read("companion/FORMAT.md");
    expect(spec).toContain("一共九类");
    expect(spec).not.toContain("一共八类");
    expect(spec).toContain("urls[]");
  });

  it("ruleShell 有五道闸，第四道是按写到哪拦的受保护账本证据", () => {
    const guard = read("companion/guard.ts");
    expect(guard).toContain("protectedTargetRefusal");
    expect(guard).not.toContain("MUTATING_SHELL");
    const spec = read("companion/FORMAT.md");
    expect(spec).toContain("一共五道");
    expect(spec).not.toContain("一共四道");
    expect(spec).toContain("protectedTargetRefusal");
    expect(spec).not.toContain("MUTATING_SHELL");
  });

  it("set 认 parent；lines 允许逗号分段和裸行号", () => {
    expect(read("companion/ideas.ts")).toMatch(/SET_FIELDS[^;]*"parent"/);
    const spec = read("companion/FORMAT.md");
    expect(spec).toContain("`parent`（`name` `what`");
    expect(spec).not.toContain("写不成 `start-end` 的（比如 `12`");
    expect(spec).toContain("裸行号");
  });

  it("Codex 的接线订阅了读，测试说明不再把它记成缺口", () => {
    const post = JSON.stringify(codexHooks().hooks.PostToolUse);
    expect(post).toContain("read_file");
    expect(read(".devcompanion/tests/test_base_contract.test.ts")).not.toContain("Codex 的读永远到不了守卫");
  });

  it("guard.ts 的注释不再说仓库还带着旧引擎、CLAUDE.md 还在教旧命令", () => {
    const guard = read("companion/guard.ts");
    expect(guard).not.toContain("pre-unification engines it still ships");
    expect(guard).not.toContain("CLAUDE.md still");
    expect(guard).not.toContain("this repository still ships");
  });

  it("安装副本的 FORMAT.md 和源码那份逐字相同", () => {
    expect(read(".companion/FORMAT.md")).toBe(read("companion/FORMAT.md"));
  });
});
