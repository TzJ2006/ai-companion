import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// CLAUDE.md 是每个新会话开工之前当成事实读的第一份文件。它错一句，错的不是一行
// 文档，是后面每一次判断的前提 —— 而且两个方向都会出事：说共同基座还没接管，人
// 就会把已经做完的事再做一遍；说它接管了而其实没有，人就会以为有一道闸门在兜底，
// 然后在没有兜底的地方放手做事。后面这一种真的发生过：这份文件曾经断言批准回执
// agent 造不出来，而对着当时真正在跑的那个守卫，一条命令就造出来了。
//
// 所以每一条都先从真实的配置、目录和代码里取证，再要求 CLAUDE.md 不说反话。
// 这个测试替下了归档掉的 test_ideas_scan_concurrency.test.ts 里的同名一节 ——
// 那一节盯的是切换之前的事实，这一节盯的是切换之后的。
describe("CLAUDE.md 说的这个仓库就是这个仓库", () => {
  const CLAUDE = read("CLAUDE.md");
  const settings = JSON.parse(read(".claude", "settings.json")) as {
    hooks?: Record<string, { hooks?: { command?: string; args?: string[] }[] }[]>;
  };
  const hookCommands = Object.values(settings.hooks ?? [])
    .flat()
    .flatMap((entry) => entry.hooks ?? [])
    .map((h) => [h.command ?? "", ...(h.args ?? [])].join(" "));

  it("接线确实指着共同基座，而且一条旧接线都没剩下", () => {
    expect(hookCommands.length, "settings.json 里一条 hook 都没有").toBeGreaterThan(0);
    for (const command of hookCommands) {
      expect(command, `这条 hook 没指向共同基座：${command}`).toMatch(/companion\.mjs/);
      expect(command, `这条 hook 还指着已归档的旧实现：${command}`).not.toMatch(/claude-companion/);
    }
    // 取证之后才允许 CLAUDE.md 说这句话。
    expect(CLAUDE).toMatch(/\.companion\/companion\.mjs/);
  });

  it("旧实现真的在 archive/ 里，而且根目录下没有第二份", () => {
    for (const old of ["claude-companion", "cursor-companion", "codex-companion"]) {
      expect(existsSync(join(ROOT, "archive", old)), `archive/${old} 不在`).toBe(true);
      expect(existsSync(join(ROOT, old)), `${old}/ 还留在根目录，CLAUDE.md 却说它归档了`).toBe(false);
    }
  });

  it("图归项目，不归 agent —— 迁移真的做完了", () => {
    const graph = read("ideas", "graph.yaml");
    expect(graph, "ideas/graph.yaml 还带着 agent: 键，说明迁移没做完").not.toMatch(/^agent:/m);
    expect(graph).toMatch(/^next_id:/m);
  });

  // 这一条是有血的教训：npm test 曾经会重装并改写六个不相关仓库的
  // .claude/settings.json，而文档把它当成日常命令写着。现在危险的那个文件在
  // archive/tests/ 里、在测试目录之外，所以命令安全了 —— 但只要有人把它搬回来，
  // 危险就跟着回来。这条测试就是那个搬回来的动作的绊线。
  it("npm test 跑的范围里没有那个会往别的仓库里装东西的测试", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.test).toMatch(/--dir\s+\.devcompanion\/tests/);
    expect(existsSync(join(ROOT, ".devcompanion", "tests", "test_ideas_graph.test.ts")))
      .toBe(false);
  });

  it("不再留着切换之前那几句已经变成假话的断言", () => {
    for (const stale of [
      /installed in no repository/i,
      /installed nowhere/i,
      /no `companion\/\.installs\.json`/,
      /frozen legacy guard/i,
      /cannot forge the approval/i,
    ]) {
      expect(CLAUDE, `CLAUDE.md 里还留着切换前的说法：${stale}`).not.toMatch(stale);
    }
  });
});
