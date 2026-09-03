import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { check, graphPath, load, render, usageLines, writeWorklist, type Graph } from "../../companion/ideas.js";
import { ENGINE_RELATIVE } from "../../companion/manifests.js";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// D32 第二轮：行号校验分两种毛病，严格程度不能一样。
//
// 一种是「记录漂了」：记录写下时是真的，后来别处**被允许的**改动把那个文件改短了。
// 这是文档漂移，不是图不合法 —— 而 R5 把 check 的每一条错误都变成「不许结束会话」，
// 所以把漂移判成错误，等于任何缩短文件的正常工作都会把会话锁死在一条跟这次改动
// 无关的已完成想法上。本仓库里已经真实发生过：I-041 记着 1-160，那个文件现在 21 行。
//
// 另一种是「记录本身就是假的」：`3-2`、`0-1`、`大概第三行` —— 任何文件怎么改都变不出
// 这种范围，它在被写下、想法被判 done 的那一刻就不成立。那才是错误。
describe("D32 line ranges: drift warns, an impossible record still errors", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "已完成的地基"
    status: done
    needs: []
    what: W1
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/base.ts
        symbol: base
        lines: "1-3"
    verify: { command: "npx vitest run t.test.ts", pass: "exit 0" }
`;

  const graphOf = () => parseDocument(yaml).toJSON() as Graph;
  const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
    event: "stop", cwd: dir, paths: [], ...over,
  });

  /** The file the done idea points at, at whatever length the test needs. */
  const writeBase = (lines: number) => {
    writeFileSync(join(dir, "src", "base.ts"), Array.from({ length: lines }, (_, i) => `const l${i} = ${i};`).join("\n") + "\n");
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "d32-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(graphPath(dir), yaml);
    writeBase(3);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a matching range on a done idea is neither an error nor a warning", () => {
    const result = check(graphOf(), dir);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).not.toMatch(/D32/);
  });

  it("a range left stale by a shortened file is a warning, not an error", () => {
    writeBase(1);                                  // 别处的正常改动把文件改短了
    const result = check(graphOf(), dir);
    expect(result.errors.join("\n")).not.toMatch(/D32/);
    expect(result.warnings.join("\n")).toMatch(/D32/);
    expect(result.warnings.join("\n")).toMatch(/1 行/);      // 现在有多少行
  });

  // 警告要能让人自己收尾：说清楚改哪个文件的哪一栏，再给出复核那一条命令。
  it("the stale-range warning says where to refresh the record and how to re-check", () => {
    writeBase(1);
    const warning = check(graphOf(), dir).warnings.find((w) => /D32/.test(w))!;
    expect(warning).toMatch(/ideas\/graph\.yaml/);
    expect(warning).toMatch(/lines/);
    // 复核那一条命令要是真能敲的：装好的仓库里没有 ideas.ts，入口是 ENGINE_RELATIVE。
    expect(warning).toContain(`${ENGINE_RELATIVE} check`);
    expect(warning).not.toMatch(/ideas\.ts/);
  });

  it("a stale range does not stop the session ending (R5 reads errors only)", () => {
    writeBase(1);
    writeFileSync(graphPath(dir), yaml);
    expect(decide(ev({}), dir).allow).toBe(true);
  });

  it("a range no file edit could ever produce is still an error", () => {
    for (const lines of ["大概第三行", "0-1", "3-2", "1-", "1-2,", "1-2,九"]) {
      const g = graphOf();
      g.ideas[0].code = [{ file: "src/base.ts", lines }];
      expect(check(g, dir).errors.join("\n"), lines).toMatch(/D32/);
    }
  });

  // 一个想法的代码本来就可能落在好几段互不相连的地方 —— 活账本里 I-063 是
  // 「731-742,1058-1207」（改动跨两个函数），I-076 是「591,740」（抽出来的函数
  // 加它的调用点，两个单行）。原来只认单个 start-end，把这六条真实记录判成错，
  // 直接把迁移卡死了。多段和单行都是合法写法；越界照样只是「文件后来变短了」的
  // 漂移，是警告不是错误。
  it("disjoint segments and bare single lines are legal, and only drift when out of range", () => {
    for (const lines of ["1-3", "1-2,3", "2", "1,2,3"]) {
      const g = graphOf();
      g.ideas[0].code = [{ file: "src/base.ts", lines }];
      expect(check(g, dir).errors.join("\n"), lines).not.toMatch(/D32/);
    }
    const g = graphOf();
    g.ideas[0].code = [{ file: "src/base.ts", lines: "1-2,900" }];
    expect(check(g, dir).errors.join("\n")).not.toMatch(/D32/);
    expect(check(g, dir).warnings.join("\n")).toMatch(/D32/);
  });

  it("an impossible range does stop the session ending", () => {
    writeFileSync(graphPath(dir), yaml.replace(`lines: "1-3"`, `lines: "3-2"`));
    const v = decide(ev({}), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/D32/);
  });
});

// D14/D28 第二轮：引擎报出来的每一条「你去跑这个」都得是装好的仓库里真能敲的命令。
//
// `ideas.ts` 只存在于本仓库的源码树里。装到别人仓库里的是单文件产物，入口写在
// manifests.ts 的 ENGINE_RELATIVE 上（D14/D34：路径只拼一处）。所以用法行、init
// 报错、扫描警告里那个 `ideas.ts` 是一条永远敲不通的指路 —— 而 D14 同时不许在别处
// 再抄一份那个路径，页面里那句写死的 "node .companion/companion.mjs apply" 正是
// 那种抄本：今天恰好和常量相等，改常量的那天就悄悄不相等了。
describe("D14: every command the engine prints names the installed entry point, from one constant", () => {
  let dir: string;
  const dirs: string[] = [];
  const SOURCE = readFileSync(resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts"), "utf8");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "d14-cmd-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("the usage text names the installed entry point, not ideas.ts", () => {
    const text = usageLines().join("\n");
    expect(text).toContain(ENGINE_RELATIVE);
    expect(text).not.toMatch(/ideas\.ts/);
  });

  it("the missing-graph error tells you a command you can actually run", () => {
    let message = "";
    try { load(graphPath(dir)); } catch (e) { message = String(e instanceof Error ? e.message : e); }
    expect(message).toContain(`${ENGINE_RELATIVE} init`);
    expect(message).not.toMatch(/ideas\.ts/);
  });

  it("the unfinished-scan warning tells you a command you can actually run", () => {
    writeWorklist(dir, ["src/a.ts", "src/b.ts"]);
    const g = { version: 1, endpoints: [], ideas: [] } as unknown as Graph;
    const warning = check(g, dir).warnings.find((w) => /扫描未完成/.test(w))!;
    expect(warning).toContain(`${ENGINE_RELATIVE} scan`);
    expect(warning).not.toMatch(/ideas\.ts/);
  });

  // D14 的另一半：不许有第二份。页面那句话必须由同一个常量拼出来。
  it("the rendered page builds its apply command from the constant, not a literal", () => {
    const g = { version: 1, endpoints: [], ideas: [] } as unknown as Graph;
    expect(render(g, "", dir)).toContain(`node ${ENGINE_RELATIVE} apply`);
    expect(SOURCE).not.toContain(ENGINE_RELATIVE);   // 源码里只剩 import 来的那一份
  });

  // 头注释曾经列着一份手抄的子命令表，比 SUBCOMMANDS 少了一半 —— 注释不会被测试
  // 打脸，所以它只能靠「别再抄」来保证不漂。
  it("the file header advertises no hand-copied subcommand list", () => {
    const header = SOURCE.slice(0, SOURCE.indexOf("\nimport "));
    expect(header).not.toMatch(/ideas\.ts/);
    expect(header).not.toMatch(/check \| next \| show/);
  });
});
