import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { install, statusOf, updateAll } from "../../companion/install.js";
import { ENGINE_RELATIVE, ENGINE_DIR } from "../../companion/manifests.js";

// I-098 — 一条命令把共同基座装进任何仓库：单文件产物 + 三份接线 + 共用技能 +
// 图种子，装完当场对 Claude 接线冒烟（官方文档明说 hook 路径写错会静默失效，
// 所以必须当场验）。--status 逐字节对比（先归一化换行），--update 刷新过期。
// 测试一律注入临时注册表 —— 现有测试把临时目录写进真实名单的毛病到此为止。
describe("companion installer (I-098)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
  const REAL_REGISTRY = join(ROOT, "companion", ".installs.json");
  const dirs: string[] = [];
  let target: string;
  let registry: string;
  // 真实名单是这台机器上真实装过哪些仓库的记录 —— 它存不存在不归测试管。原来的
  // 断言是「真实名单必须不存在」，于是这台机器上第一次真安装就把整个套件染红。
  // 要证的从来只有一件事：这轮测试没往里写。所以先原样记下来，最后比对没变。
  let realRegistryBefore: string | null;

  beforeAll(() => {
    realRegistryBefore = existsSync(REAL_REGISTRY) ? readFileSync(REAL_REGISTRY, "utf8") : null;
    if (!existsSync(join(ROOT, "companion", "dist", "companion.mjs"))) {
      const built = spawnSync("node", [join(ROOT, "companion", "build.mjs")],
        { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
      expect(built.status).toBe(0);
    }
    target = mkdtempSync(join(tmpdir(), "install-"));
    dirs.push(target);
    registry = join(mkdtempSync(join(tmpdir(), "reg-")), "installs.json");
    dirs.push(join(registry, ".."));
  }, 180_000);
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("installs the artifact, three wirings, skills, and the graph seed — and the smoke test passes", { timeout: 120_000 }, () => {
    // 目标里已有别人的 hook 和一份自己的 settings —— 安装必须合并，不许清场
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(join(target, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(git status)"] },
      hooks: { PreToolUse: [{ matcher: "Foo", hooks: [{ type: "command", command: "my-other-tool" }] }] },
    }, null, 2));

    const result = install(target, { registryPath: registry });
    expect(result.smoke).toBe("pass");

    for (const rel of [
      ENGINE_RELATIVE,
      `${ENGINE_DIR}/FORMAT.md`,       // 规范就住在引擎旁边，跟着同一个常量走
      ".agents/skills/ccbuild/SKILL.md",
      ".agents/skills/ccthink/SKILL.md",
      ".claude/skills/ccscan/SKILL.md",
      ".cursor/hooks.json",
      ".codex/hooks.json",
      "ideas/graph.yaml",
      "ideas/.gitignore",
    ]) {
      expect(existsSync(join(target, rel)), rel).toBe(true);
    }

    const settings = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings)).toContain(ENGINE_RELATIVE);
    expect(JSON.stringify(settings)).toContain("my-other-tool");        // 别人的 hook 活着
    expect(settings.permissions.allow).toContain("Bash(git status)");   // 别人的配置活着
    expect(Object.keys(settings.hooks)).toContain("UserPromptSubmit");

    const cursor = JSON.parse(readFileSync(join(target, ".cursor", "hooks.json"), "utf8"));
    expect(cursor.hooks.preToolUse[0].failClosed).toBe(true);
    const codex = JSON.parse(readFileSync(join(target, ".codex", "hooks.json"), "utf8"));
    expect(JSON.stringify(codex)).toMatch(/apply_patch/);
  });

  it("installing twice is idempotent — one companion entry per event, not two", { timeout: 120_000 }, () => {
    install(target, { registryPath: registry });
    const settings = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
    const companionGroups = (settings.hooks.PreToolUse as unknown[])
      .filter((g) => JSON.stringify(g).includes(ENGINE_RELATIVE));
    expect(companionGroups.length).toBe(2);           // 写工具一组 + mcp 一组，装两次也还是两组
  });

  it("does not clobber an existing graph", { timeout: 120_000 }, () => {
    const graph = readFileSync(join(target, "ideas", "graph.yaml"), "utf8");
    writeFileSync(join(target, "ideas", "graph.yaml"), graph + "# 人的批注\n");
    install(target, { registryPath: registry });
    expect(readFileSync(join(target, "ideas", "graph.yaml"), "utf8")).toContain("# 人的批注");
  });

  it("status: current → stale after tampering → current again after update", { timeout: 120_000 }, () => {
    expect(statusOf(target).every((f) => f.state === "current")).toBe(true);

    writeFileSync(join(target, ".agents", "skills", "ccbuild", "SKILL.md"), "被改坏了\n");
    const after = statusOf(target);
    expect(after.find((f) => f.rel.includes("ccbuild"))?.state).toBe("stale");

    const refreshed = updateAll(registry);
    expect(refreshed.some((r) => r.refreshed.some((f) => f.includes("ccbuild")))).toBe(true);
    expect(statusOf(target).every((f) => f.state === "current")).toBe(true);
  });

  it("the registry is the injected one; the real registry is left exactly as it was", () => {
    const entries = JSON.parse(readFileSync(registry, "utf8")) as string[];
    expect(entries.some((e) => e.replaceAll("\\", "/") === target.replaceAll("\\", "/"))).toBe(true);
    const realNow = existsSync(REAL_REGISTRY) ? readFileSync(REAL_REGISTRY, "utf8") : null;
    expect(realNow, "真实安装名单一个字节都不该被测试碰到").toBe(realRegistryBefore);
    expect(realNow ?? "").not.toContain(target.replaceAll("\\", "/"));
  });
});

// 命令行本身也要能用。装进一个仓库的写法是 `install.ts <目标仓库>` —— 文档里的主用法，
// 也是六个仓库真正在跑的那一条。它曾经必进 usage 分支：--registry 缺席时 indexOf 答 -1，
// 而 -1 + 1 就是下标 0，正好是目标仓库自己，于是唯一的位置参数被当成"跟在 --registry
// 后面的路径"筛掉了。加上 --registry 反而好使，所以本地跑测试看不见。
// 现在只走一遍命令行：带值的旗标吃掉自己的值，别的一个不碰。
describe("companion installer command line", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
  const INSTALL_TS = join(ROOT, "companion", "install.ts");
  const REAL_REGISTRY = join(ROOT, "companion", ".installs.json");
  const dirs: string[] = [];
  let registry: string;
  let realRegistryBefore: string | null;

  // 只有注入了临时名单的那一条允许真装；其余全是 --dry-run 或早早失败的，
  // 一个字节都不会落到真实安装名单里。
  const run = (...argv: string[]) =>
    spawnSync("npx", ["tsx", INSTALL_TS, ...argv],
      { encoding: "utf8", cwd: ROOT, timeout: 180_000, shell: process.platform === "win32" });

  const freshTarget = () => {
    const dir = mkdtempSync(join(tmpdir(), "install-cli-"));
    dirs.push(dir);
    return dir;
  };

  beforeAll(() => {
    realRegistryBefore = existsSync(REAL_REGISTRY) ? readFileSync(REAL_REGISTRY, "utf8") : null;
    if (!existsSync(join(ROOT, "companion", "dist", "companion.mjs"))) {
      const built = spawnSync("node", [join(ROOT, "companion", "build.mjs")],
        { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
      expect(built.status).toBe(0);
    }
    registry = join(mkdtempSync(join(tmpdir(), "reg-cli-")), "installs.json");
    dirs.push(join(registry, ".."));
  }, 180_000);
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("the primary form `install.ts <target>` really installs — no --registry needed", { timeout: 180_000 }, () => {
    const target = freshTarget();
    const out = run(target, "--registry", registry);
    expect(out.stderr ?? "", "主用法不该掉进 usage 分支").not.toContain("usage:");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("守卫冒烟 pass");
    expect(existsSync(join(target, ENGINE_RELATIVE)), "引擎必须真写进去").toBe(true);
  });

  it("the primary form works without an explicit registry, and with --dry-run", { timeout: 120_000 }, () => {
    const target = freshTarget();
    const out = run(target, "--dry-run");        // 没有 --registry：正是踩坏的那条路
    expect(out.stderr ?? "").not.toContain("usage:");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(`装进 ${target}`);
    expect(out.stdout).toContain("预演");
    expect(existsSync(join(target, ENGINE_RELATIVE)), "预演一个字节都不写").toBe(false);
  });

  it("without --dry-run and without --registry the target still reaches install()", { timeout: 120_000 }, () => {
    // 真装会污染真实安装名单，所以拿一个不存在的目标证同一件事：位置参数确实到了
    // install() 手里 —— 报的是"目标不存在"，不是 usage。
    const missing = join(tmpdir(), "install-cli-does-not-exist-9f3a");
    const out = run(missing);
    expect(out.stderr ?? "").not.toContain("usage:");
    expect(out.stderr).toContain("目标不存在");
    expect(out.status).toBe(1);
  });

  it("a value-taking flag eats its own value and never a positional", { timeout: 120_000 }, () => {
    const target = freshTarget();
    const regFile = join(freshTarget(), "somewhere", "installs.json");
    for (const argv of [
      ["--registry", regFile, target, "--dry-run"],   // 旗标在前
      [target, "--registry", regFile, "--dry-run"],   // 旗标在后
      ["--dry-run", "--registry", regFile, target],   // 夹在中间
    ]) {
      const out = run(...argv);
      expect(out.stderr ?? "", argv.join(" ")).not.toContain("usage:");
      expect(out.status, argv.join(" ")).toBe(0);
      expect(out.stdout, "目标必须是目标，不能是 --registry 的那个路径")
        .toContain(`装进 ${target}`);
      expect(out.stdout).not.toContain(`装进 ${regFile}`);
    }
    expect(existsSync(regFile), "预演不写名单").toBe(false);
  });

  it("--uninstall keeps its own positional, and no run here touched the real registry", { timeout: 120_000 }, () => {
    const target = freshTarget();
    const out = run("--uninstall", target, "--dry-run");
    expect(out.stderr ?? "").not.toContain("usage:");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(`从 ${target} 卸载`);

    const realNow = existsSync(REAL_REGISTRY) ? readFileSync(REAL_REGISTRY, "utf8") : null;
    expect(realNow, "真实安装名单一个字节都不该被测试碰到").toBe(realRegistryBefore);
  });
});
