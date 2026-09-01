import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { install, statusOf, updateAll } from "../../companion/install.js";
import { ENGINE_RELATIVE } from "../../companion/manifests.js";

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

  beforeAll(() => {
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
      ".claude/companion/FORMAT.md",
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

  it("the registry is the injected one; the real registry file is never touched", () => {
    const entries = JSON.parse(readFileSync(registry, "utf8")) as string[];
    expect(entries.some((e) => e.replaceAll("\\", "/") === target.replaceAll("\\", "/"))).toBe(true);
    expect(existsSync(REAL_REGISTRY)).toBe(false);
  });
});
