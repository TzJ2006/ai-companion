import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { install, updateAll } from "../../companion/install.js";
import { ENGINE_RELATIVE } from "../../companion/manifests.js";

// H14 —— --update 必须是一次真正的重装，不是一次抄文件。
// 接线是 merge 进宿主配置的，不是复制过去的文件，所以逐字节对比永远看不见它过期；
// 产物是打出来的，不重打就只是把上一次的旧引擎再抄一遍。两种过期都不出声：目标仓库
// 照旧跑着昨天的守卫，命令行还说"已是最新"（D34：缺前置就明确失败，不静默降级）。
// 另外两件打包卫生：根 .gitignore 的 dist/ 把 companion/dist 一起吞了，新克隆没有
// 产物就装不了；ideas/.gitignore 少了 .runtime/ 和 changes.json，而安装器只在文件
// 不存在时才写它，装过一次的仓库永远补不上。
describe("companion installer safety (H14)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
  const BUNDLE = join(ROOT, "companion", "dist", "companion.mjs");
  const dirs: string[] = [];
  let registry: string;

  const freshTarget = () => {
    const dir = mkdtempSync(join(tmpdir(), "install-safety-"));
    dirs.push(dir);
    return dir;
  };

  beforeAll(() => {
    if (!existsSync(BUNDLE)) {
      const built = spawnSync("node", [join(ROOT, "companion", "build.mjs")],
        { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
      expect(built.status).toBe(0);
    }
    registry = join(mkdtempSync(join(tmpdir(), "reg-safety-")), "installs.json");
    dirs.push(join(registry, ".."));
  }, 180_000);
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("--update re-merges the three wirings — a drifted hook comes back, foreign hooks survive", { timeout: 180_000 }, () => {
    const target = freshTarget();
    install(target, { registryPath: registry });

    // 模拟"清单变了"：装过之后接线里少了一个事件（新增事件、改过的命令串，效果一样）。
    const settingsFile = join(target, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as
      { hooks: Record<string, unknown[]> };
    delete settings.hooks["SessionStart"];
    settings.hooks["PreToolUse"] = [{ matcher: "Foo", hooks: [{ type: "command", command: "my-other-tool" }] }];
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

    const cursorFile = join(target, ".cursor", "hooks.json");
    const cursor = JSON.parse(readFileSync(cursorFile, "utf8")) as
      { hooks: Record<string, unknown[]> };
    delete cursor.hooks["stop"];
    writeFileSync(cursorFile, JSON.stringify(cursor, null, 2) + "\n");

    const results = updateAll(registry);
    const mine = results.find((r) => r.target.replaceAll("\\", "/") === target.replaceAll("\\", "/"));
    expect(mine, "更新结果里必须有这个目标").toBeTruthy();
    expect(mine!.hooksAdded.length, "--update 必须重新合并接线").toBeGreaterThan(0);

    const after = JSON.parse(readFileSync(settingsFile, "utf8")) as
      { hooks: Record<string, unknown[]> };
    expect(Object.keys(after.hooks), "掉了的事件必须补回来").toContain("SessionStart");
    expect(JSON.stringify(after.hooks["SessionStart"])).toContain(ENGINE_RELATIVE);
    expect(JSON.stringify(after.hooks["PreToolUse"]), "别人的 hook 一条不动").toContain("my-other-tool");

    const cursorAfter = JSON.parse(readFileSync(cursorFile, "utf8")) as
      { hooks: Record<string, unknown[]> };
    expect(Object.keys(cursorAfter.hooks)).toContain("stop");
  });

  it("--update rebuilds the artifact instead of shipping yesterday's engine", { timeout: 180_000 }, () => {
    const target = freshTarget();
    install(target, { registryPath: registry });

    const before = statSync(BUNDLE).mtimeMs;
    updateAll(registry);
    expect(statSync(BUNDLE).mtimeMs, "产物必须重打，否则装过的仓库全在跑旧引擎").toBeGreaterThan(before);
    // 重打完才抄：目标里的引擎跟刚打出来的产物逐字节一致。
    expect(readFileSync(join(target, ENGINE_RELATIVE), "utf8")).toBe(readFileSync(BUNDLE, "utf8"));
  });

  it("install repairs an existing ideas/.gitignore instead of leaving it stale", { timeout: 120_000 }, () => {
    const target = freshTarget();
    mkdirSync(join(target, "ideas"), { recursive: true });
    writeFileSync(join(target, "ideas", ".gitignore"), "# 我自己加的\ngraph.html\nnotes.txt\n");

    // 预演还是一个字节都不写 —— 补齐也算写。
    const dry = install(target, { registryPath: registry, dryRun: true });
    expect(dry.installed).toContain("ideas/.gitignore");
    expect(readFileSync(join(target, "ideas", ".gitignore"), "utf8")).not.toContain(".runtime/");

    install(target, { registryPath: registry });

    const ignore = readFileSync(join(target, "ideas", ".gitignore"), "utf8");
    expect(ignore, "人写的行一个字都不动").toContain("# 我自己加的");
    expect(ignore).toContain("notes.txt");
    for (const line of [".approved", ".scan-todo", ".scan-done", ".runtime/", "changes.json"]) {
      expect(ignore, `缺的行必须补上：${line}`).toContain(line);
    }
    // 补齐是追加，不是重写：已经在里面的行不该出现第二遍。
    expect(ignore.split("\n").filter((l) => l.trim() === "graph.html").length).toBe(1);
  });

  // H15/D10 —— 安装器必须每次都问引擎，而不是"只在 ideas/graph.yaml 不存在时才问"。
  // 最要命的那一种旧图恰恰占着规范名字本身（带 agent: 印记），那时文件是存在的，
  // 于是引擎早就认得出来的那条指路话根本没人去取：装下去三家守卫全指着一张不描述这个
  // 项目的图判每一次写。这就是本仓库自己 —— 一次预演打印了完整安装计划，只字未提。
  const STAMPED_GRAPH = `version: 1
agent: claude
project: fixture
endpoints: []
ideas: []
`;
  const CLEAN_GRAPH = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "地基"
    status: todo
    needs: []
`;

  it("refuses to install onto a legacy graph parked on ideas/graph.yaml (H15/D10)", { timeout: 120_000 }, () => {
    const target = freshTarget();
    mkdirSync(join(target, "ideas"), { recursive: true });
    writeFileSync(join(target, "ideas", "graph.yaml"), STAMPED_GRAPH);

    // 预演不抛，但必须把那条指路话摆出来 —— 否则人看到的还是一份"一切正常"的计划。
    const dry = install(target, { registryPath: registry, dryRun: true });
    expect(dry.canonicalLegacy, "预演必须说出规范名字被旧图占着").toBeTruthy();
    expect(dry.canonicalLegacy!).toMatch(/agent: claude/);
    expect(dry.canonicalLegacy!).toMatch(/graph\.claude\.yaml/);   // 人该把它改成什么名字
    expect(dry.canonicalLegacy!).toMatch(/migrate/);               // 改完名跑什么

    // 真装必须拒绝，而且拒绝在写第一个字节之前。
    let refusal = "";
    try { install(target, { registryPath: registry }); }
    catch (error) { refusal = error instanceof Error ? error.message : String(error); }
    expect(refusal, "带 agent: 印记的规范图必须拦住安装").toMatch(/graph\.claude\.yaml/);
    expect(refusal).toMatch(/migrate/);
    expect(existsSync(join(target, ENGINE_RELATIVE)), "拒绝时一个字节都没写").toBe(false);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
    expect(readFileSync(join(target, "ideas", "graph.yaml"), "utf8"),
      "改名是人的决定，安装器不动这个文件").toBe(STAMPED_GRAPH);
  });

  it("a real project graph on the canonical name installs exactly as before", { timeout: 120_000 }, () => {
    const target = freshTarget();
    mkdirSync(join(target, "ideas"), { recursive: true });
    writeFileSync(join(target, "ideas", "graph.yaml"), CLEAN_GRAPH);

    const result = install(target, { registryPath: registry });
    expect(result.canonicalLegacy, "干净的项目图不是旧图").toBeUndefined();
    expect(result.seedSkipped).toBeUndefined();
    expect(result.smoke).toBe("pass");
    expect(existsSync(join(target, ENGINE_RELATIVE))).toBe(true);
    expect(readFileSync(join(target, "ideas", "graph.yaml"), "utf8"), "已有的图不被覆盖").toBe(CLEAN_GRAPH);
  });

  it("packaging hygiene: the bundle is committable, machine-local state is not", () => {
    // exit 0 = 被忽略，exit 1 = 没被忽略（git check-ignore 的约定）。
    const ignored = (rel: string) =>
      spawnSync("git", ["check-ignore", "-q", rel], { cwd: ROOT, timeout: 30_000 }).status === 0;

    // 新克隆必须自带产物，否则 install 第一步就报"先构建产物"，而构建要 npm install。
    expect(ignored("companion/dist/companion.mjs"), "companion/dist 不能被 dist/ 一起吞掉").toBe(false);
    // 机器本地的东西反过来，一条都不该进版本库。
    expect(ignored("companion/.installs.json"), "安装名单是绝对路径，只属于这台机器").toBe(true);
    expect(ignored("ideas/.runtime/approvals/x.json"), "批准回执是程序保管的证据（D24）").toBe(true);
    expect(ignored("ideas/changes.json"), "改动导出是过路文件").toBe(true);
  });
});
