import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// I-095 — 五条工作流写成三家都能加载的标准技能文件（agentskills.io 规范），
// 正文只有一份，住在 companion/skills/。目录名就是命令名（cc 前缀，人已批准
// 偏离 D33 的短名，裁决更新写回 companion/FORMAT.md）。
// 三条铁律：frontmatter 只用规范字段、正文无平台专名和绝对路径、
// 引擎调用一律是中性的 node 调用。
describe("companion shared skills (I-095)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../../companion/skills");
  const NAMES = ["ccscan", "ccthink", "ccbuild", "ccfix", "ccgraph"];

  const SPEC_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

  const frontmatterOf = (text: string) => {
    expect(text.startsWith("---\n"), "frontmatter 必须从文件第一个字节开始（BOM 都不行）").toBe(true);
    const end = text.indexOf("\n---", 4);
    expect(end).toBeGreaterThan(0);
    const head = text.slice(4, end);
    const fields = new Map<string, string>();
    for (const line of head.split("\n")) {
      const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (m) fields.set(m[1], m[2]);
    }
    return { fields, body: text.slice(end + 4) };
  };

  it("all five skill directories exist, and nothing else", () => {
    expect(readdirSync(ROOT).sort()).toEqual([...NAMES].sort());
  });

  for (const name of NAMES) {
    it(`${name}: spec-only frontmatter, name matches the directory`, () => {
      const file = join(ROOT, name, "SKILL.md");
      expect(existsSync(file)).toBe(true);
      const { fields } = frontmatterOf(readFileSync(file, "utf8"));

      expect(fields.get("name")).toBe(name);                       // 目录名=命令名
      expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)).toBe(true);    // 规范命名
      const description = fields.get("description") ?? "";
      expect(description.length).toBeGreaterThan(20);
      expect(description.length).toBeLessThanOrEqual(1024);
      for (const key of fields.keys()) {
        expect(SPEC_FIELDS.has(key), `${name} 用了规范之外的 frontmatter 字段 ${key}`).toBe(true);
      }
      expect(fields.has("disable-model-invocation"), "Claude Code 对这个字段有未修的缺陷，先不用").toBe(false);
    });

    it(`${name}: body is platform-neutral — no product names, no absolute paths, no npx tsx`, () => {
      const { body } = frontmatterOf(readFileSync(join(ROOT, name, "SKILL.md"), "utf8"));
      expect(body).not.toMatch(/claude-companion|cursor-companion|codex-companion/);
      expect(body).not.toMatch(/[A-Z]:[\\/]/);                     // Windows 绝对路径
      expect(body).not.toMatch(/npx\s+tsx/);                       // 目标仓库不该需要 tsx
      expect(body).toMatch(/node .claude\/companion\/companion\.mjs/); // 中性引擎调用
    });
  }

  it("the workflow mechanics of the shared base are actually referenced", () => {
    const bodyOf = (name: string) => frontmatterOf(readFileSync(join(ROOT, name, "SKILL.md"), "utf8")).body;
    expect(bodyOf("ccthink")).toMatch(/request-approval/);         // 两道关卡
    expect(bodyOf("ccbuild")).toMatch(/run-check/);                // RED→GREEN
    expect(bodyOf("ccbuild")).toMatch(/--phase red/);
    expect(bodyOf("ccscan")).toMatch(/migrate/);                   // 旧图迁移入口
    expect(bodyOf("ccgraph")).toMatch(/\bpaths\b/);                // 不猜路径
  });

  it("FORMAT.md records the cc-prefix naming decision superseding D33's short names", () => {
    const spec = readFileSync(resolve(ROOT, "..", "FORMAT.md"), "utf8");
    expect(spec).toMatch(/ccscan/);
    expect(spec).toMatch(/ccbuild/);
  });
});
