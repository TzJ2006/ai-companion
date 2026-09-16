import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_RELATIVE } from "../../companion/manifests.js";

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

  const bodyOf = (name: string) => frontmatterOf(readFileSync(join(ROOT, name, "SKILL.md"), "utf8")).body;

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
      const body = bodyOf(name);
      expect(body).not.toMatch(/claude-companion|cursor-companion|codex-companion/);
      expect(body).not.toMatch(/[A-Z]:[\\/]/);                     // Windows 绝对路径
      expect(body).not.toMatch(/npx\s+tsx/);                       // 目标仓库不该需要 tsx
      // 平台专属安装目录也是平台专名：D14 的插件根目录是仓库根下的 .companion/，
      // D34 的产物是那里的单文件引擎，三家加载的是同一份正文。
      expect(body).not.toMatch(/\.(claude|cursor|codex)\//);
      // 中性引擎调用 —— 路径从 manifests.ts 的常量推导，技能正文写的字面量由这里钉在常量上（D14）。
      expect(body).toMatch(new RegExp("node " + ENGINE_RELATIVE.replace(/[.\/]/g, "\\$&")));
    });

    // H26 — 每条技能都要说清带参数和不带参数各是什么行为，否则「/ccfix I-014」
    // 这种调用没有定义。三家前身都写了这一节。
    it(`${name}: says what its arguments mean`, () => {
      const body = bodyOf(name);
      expect(body, `${name} 没有「## 参数」一节`).toMatch(/^## 参数$/m);
      expect(body, `${name} 没说不带参数时怎么办`).toMatch(/不带参数/);
    });
  }

  // H26 — 共同技能是三家正文的合并，不是重写：前身里的护栏逐条钉死回来。
  it("ccfix keeps the mismatch-review and give-up safeguards all three predecessors had", () => {
    const body = bodyOf("ccfix");
    expect(body).toMatch(/独立可见的消息/);   // 清单要真的送到人眼前
    expect(body).toMatch(/结束回合/);          // 送完就停，不许自己接着判谁对
    expect(body).toMatch(/一次只修一处/);      // 一批改动一起变绿说明不了什么
    expect(body).toMatch(/三次/);              // 三次修不好就交出去
    expect(body).toMatch(/blocked/);
    expect(body).toMatch(/git diff/);          // 临时插桩收工前拆干净
  });

  it("ccscan keeps the anti-fabrication rules", () => {
    const body = bodyOf("ccscan");
    expect(body).toMatch(/why_this_way: null/); // 找不到真实理由就写 null
    expect(body).toMatch(/真实行号/);            // D32：code 必须解析得到
    expect(body).toMatch(/绝不编造/);            // 没有测试就写 manual，不许发明命令
  });

  it("the workflow mechanics of the shared base are actually referenced", () => {
    expect(bodyOf("ccthink")).toMatch(/render/);                   // 交人看的是渲染出的图（I-146 后无口令）
    expect(bodyOf("ccthink")).not.toMatch(/request-approval --node/); // 计划批准门已拆（D7 修订）
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

// H27 — 规范说的必须是现在的代码，不是将来想要的代码。一条裁决写着「已经这样了」
// 而代码里没有，正是这次审计查出来的失效方式：下一个 agent 会当它是事实，然后
// 照着一个不存在的保证做事。所以这里的每一条断言都拿规范去比源码，而不是比另一
// 段散文。
describe("the spec is true about the engine as it stands (H27)", () => {
  const REPO = resolve(fileURLToPath(import.meta.url), "../../..");
  const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), "utf8");
  const spec = () => read("companion", "FORMAT.md");

  /** One 裁决 row: from its `## D<n>` heading to the next `## ` heading. */
  const row = (n: number) => {
    const text = spec();
    const start = text.search(new RegExp(`^## D${n}\\b`, "m"));
    expect(start, `裁决表里没有 D${n}`).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
  };

  /** One prose section, from its `## <title>` heading to the next one. */
  const section = (title: string) => {
    const text = spec();
    const start = text.indexOf(`## ${title}`);
    expect(start, `规范里没有「${title}」这一节`).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
  };

  it("the header names companion/ as the running engine, not claude-companion/", () => {
    const head = spec().slice(0, 1400);
    expect(head, "头部还在说权威引擎在 claude-companion/ 下运行").not.toMatch(/权威引擎仍在/);
    expect(head).toMatch(/companion\/ideas\.ts/);
    expect(head).toMatch(/companion\/guard\.ts/);
  });

  it("D27 records the sign operation as resolved, not as an open conflict", () => {
    const d27 = row(27);
    expect(d27, "D27 还挂着 2026-08-31 记下的未结冲突").not.toMatch(/未结的冲突/);
    expect(d27).toMatch(/sign/);
    expect(d27).toMatch(/manual-check/);
  });

  // 一条裁决要么已经是代码的行为，要么明说自己还没落地。审计查到的四条都曾
  // 用「基座提供 / 明确列入 / 必须验证」的完成时写着还没写的代码。
  for (const n of [28, 29, 31, 32]) {
    it(`D${n} states plainly what has landed and what has not`, () => {
      expect(row(n), `D${n} 没有「落地情况」一行`).toMatch(/\*\*落地情况/);
    });
  }

  it("D28's promised command surface is exactly the engine's own allowlist", () => {
    // 命令面只有一个出处：ideas.ts 里的 SUBCOMMANDS 表（D11/D28）。守卫那份
    // COMPANION_SUBCOMMANDS 已经不再手抄，改成 SUBCOMMANDS.map(([name]) => name) ——
    // 手抄的旧字面量正是漏掉了 `log`。所以这里对着引擎的表核 D28；守卫和引擎逐条
    // 对得上，由 test_base_guard_cli_surface 按行为压着。
    const table = /export const SUBCOMMANDS: \[name: string, args: string\]\[\] = \[([\s\S]*?)\n\];/
      .exec(read("companion", "ideas.ts"));
    expect(table, "ideas.ts 里找不到 SUBCOMMANDS 表").not.toBeNull();
    const offered = [...table![1].matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]).sort();
    expect(offered, "SUBCOMMANDS 表读出来是空的").not.toHaveLength(0);

    // 裁决那一句把命令面拆成两截写：反引号里一列，外加单独点名的 `log`。
    const promised = /基座提供 `([^`]+)`/.exec(row(28));
    expect(promised, "D28 没有用反引号列出命令面").not.toBeNull();
    const named = new Set(promised![1].trim().split(/\s+/));
    for (const [, extra] of row(28).matchAll(/另外再加一条 `([a-z-]+)`/g)) named.add(extra);
    expect([...named].sort()).toEqual(offered);

    // 「落地情况」把同一串又列了一遍，两处必须逐字一致。
    const landed = /一共\s*十八条\*\*：`([^`]+)`/.exec(row(28));
    expect(landed, "D28 的落地情况没有用反引号列出已落地的命令面").not.toBeNull();
    expect(landed![1].trim().split(/\s+/).sort()).toEqual(offered);
  });

  it("D14 carries the host-neutral engine path the installer actually writes", () => {
    const engine = /ENGINE_RELATIVE = "([^"]+)"/.exec(read("companion", "manifests.ts"));
    expect(engine, "manifests.ts 里找不到 ENGINE_RELATIVE").not.toBeNull();
    expect(row(14)).toContain(engine![1]);
  });

  it("D22 never names a normalized event kind the guard does not have", () => {
    const union = /event: ((?:"[a-z-]+"(?:\s*\|\s*)?)+);/.exec(read("companion", "guard.ts"));
    expect(union, "guard.ts 里找不到归一化事件的类型").not.toBeNull();
    const kinds = [...union![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    const d22 = row(22);
    const named = [...d22.matchAll(/`(pre-write|post-write|shell|prompt|stop|other|session|read)`/g)]
      .map((m) => m[1]);
    expect(named.length, "D22 一个归一化事件类型都没点名").toBeGreaterThan(0);
    for (const kind of named) {
      expect(kinds, `D22 说有 \`${kind}\` 这一类事件，guard.ts 的事件集合里没有它`).toContain(kind);
    }
  });

  it("D15 records how the session-start wiring behaves on all three platforms", () => {
    expect(row(15) + row(22)).toMatch(/SessionStart|sessionStart/);
  });

  it("the engine section shows the neutral path and does not oversell `check`", () => {
    const engine = section("The engine");
    expect(engine).toMatch(/node \.companion\/companion\.mjs check/);
    expect(engine, "`check` 不看红绿证据 —— 那道门在 set done 上（D20）")
      .not.toMatch(/done 必须有当前证据/);
  });

  it("the generated-files list names every path the engine's paths() returns", () => {
    const src = read("companion", "ideas.ts");
    const body = /export function paths\(projectDir: string\): CanonicalPaths \{([\s\S]*?)\n\}/.exec(src);
    expect(body, "ideas.ts 里找不到 paths()").not.toBeNull();
    const names = [...body![1].matchAll(/join\(ideas, "([^"]+)"\)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(4);
    const list = section("Generated files");
    for (const name of names) {
      expect(list, `生成文件清单里没有 ${name} —— 引擎会写它，人却在规范里找不到它`).toContain(name);
    }
  });

  it("D35 freezes claude-companion/ and says why", () => {
    const d35 = row(35);
    expect(d35).toMatch(/claude-companion/);
    expect(d35).toMatch(/冻结/);
    expect(d35, "热修同步是这条裁决的全部内容，必须写明").toMatch(/热修|hotfix/);
    expect(d35).toMatch(/二十秒|20 秒/);
  });
});
