import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readWorklist, strike, doneFile, worklistFile } from "../../claude-companion/ideas.js";
import { SUBCOMMANDS, check, skippedFiles, scanIgnores, type Graph } from "../../companion/ideas.js";
import { normalizeCursor, normalizeCodex, sessionBriefing } from "../../companion/guard.js";
import { ENGINE_RELATIVE } from "../../companion/manifests.js";

// I-055 — 修复扫描清单被多个进程同时写入时会丢记录的问题。
//
// 症状：一轮里并行 Read 五个文件，hook 就并行跑了五个 guard 进程，
// 各自 readWorklist → filter → writeFileSync。后写的盖掉先写的，
// 于是文件真的读了、账本却说没读，而 R7 报出的数字反而不准。
//
// 修法是把「读—改—写」换成「只追加」：清单只写一次，另一个只追加的文件
// 记录谁被划掉了，「还剩哪些」变成两者的集合差。
//
// 这份测试的第一条必须真的起 N 个操作系统进程 —— 用线程或者顺序调用都测不到
// 那个 race，而「我们试了很多次都没坏」也不是保证。保证来自「追加是一次
// write 调用，操作系统给它定位」，所以测试要做的就是把它压出来。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = join(ROOT, "claude-companion", "ideas.ts").replaceAll("\\", "/");

let project: string;

/** 建一个临时项目，并给它一份 N 个文件的扫描清单。 */
function seed(files: string[]): void {
  mkdirSync(join(project, "ideas"), { recursive: true });
  for (const f of files) {
    mkdirSync(dirname(join(project, f)), { recursive: true });
    writeFileSync(join(project, f), "x");
  }
  writeFileSync(worklistFile(project), files.join("\n") + "\n");
}

beforeEach(() => { project = mkdtempSync(join(tmpdir(), "scan-race-")); });
afterEach(() => { rmSync(project, { recursive: true, force: true }); });

describe("I-055 并行划掉清单不丢记录", () => {
  // ── 正题：真的并发 ──────────────────────────────────────────────────────
  it("N 个进程同时划掉 N 个文件，清单恰好少 N 行", () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);
    seed(files);

    // 每个子进程自旋等到同一个墙钟时刻再动手，把它们挤进同一个瞬间。
    // 单纯依次 spawn 会被进程启动时间拉开，race 就压不出来。
    const helper = join(project, "strike-one.ts");
    writeFileSync(helper, `
      import { strike } from ${JSON.stringify(ENGINE)};
      const [projectDir, filePath, at] = process.argv.slice(2);
      while (Date.now() < Number(at)) { /* spin to the barrier */ }
      process.stdout.write(String(strike(projectDir, filePath)));
    `);

    const startAt = Date.now() + 1500;
    const kids = files.map((f) =>
      spawnSync(process.execPath, ["--import", "tsx", helper, project, join(project, f), String(startAt)],
        { cwd: ROOT, encoding: "utf8", timeout: 60_000 }));

    // 子进程必须真的跑起来了，否则这条测试什么也没测到。
    for (const [i, kid] of kids.entries()) {
      expect(kid.status, `子进程 ${i} 没能跑起来：${kid.stderr}`).toBe(0);
    }

    expect(readWorklist(project)).toEqual([]);            // 8 个全被划掉
    const struck = readFileSync(doneFile(project), "utf8").split("\n").filter(Boolean);
    expect(new Set(struck.map((s) => s.trim())).size).toBe(8);
    // 「不出现任何不是文件路径的行」—— 撕裂的半行会在这里现形。
    for (const line of struck) expect(files).toContain(line.trim());
  }, 90_000);

  // ── 返回值契约 ─────────────────────────────────────────────────────────
  // 裸的数字分不开「不在清单里」和「划掉了还剩 0」，而 guard 正按它分支。
  it("没有扫描在跑时返回 -1", () => {
    mkdirSync(join(project, "ideas"), { recursive: true });
    expect(strike(project, join(project, "src/thing.ts"))).toBe(-1);
  });

  it("文件不在清单里时返回 -1", () => {
    seed(["src/a.ts"]);
    expect(strike(project, join(project, "src/other.ts"))).toBe(-1);
  });

  it("划掉了就返回这次快照的剩余数，最后一个返回 0", () => {
    seed(["src/a.ts", "src/b.ts"]);
    expect(strike(project, join(project, "src/a.ts"))).toBe(1);
    expect(strike(project, join(project, "src/b.ts"))).toBe(0);
  });

  // 「已经划过了」和「划掉了还剩 0」是两件事：前者什么也没发生，守卫不该再记一条
  // 日志（同一个文件被 Read 两次不该刷屏）；后者是真的划掉了最后一个。
  // 这条契约是 I-046 定的，现存的 guard 测试压着它，只追加的改法不许把它弄丢。
  it("同一个文件划两次，第二次什么也不做", () => {
    seed(["src/a.ts", "src/b.ts"]);
    expect(strike(project, join(project, "src/a.ts"))).toBe(1);
    expect(strike(project, join(project, "src/a.ts"))).toBe(-1);
    expect(readWorklist(project)).toEqual(["src/b.ts"]);   // 剩余数也没被算少
  });

  // 追加式记录里可能出现半行（断电、磁盘满）。它只该匹配不上任何东西，
  // 不该让整份记录作废，也不该让某个文件凭空变成已读。
  it("已读记录里的垃圾行只是匹配不上，不影响剩余计算", () => {
    seed(["src/a.ts", "src/b.ts"]);
    // 那个 NUL 写成 \u0000 转义，不是真的 NUL 字节：源码里只要躺着一个 NUL，
    // git 就把整份文件判成二进制，从此这份文件的 diff 谁也看不见。运行时拼出来的
    // 仍是同一行带 NUL 的坏记录，断言一个字没变。
    appendFileSync(doneFile(project), "src/a.t\u0000half\n");
    expect(readWorklist(project)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  // ── --reset 必须同时清掉已读记录 ────────────────────────────────────────
  // 不清的话，下一次 --reset 会把所有文件都算成已读 —— R7 就此静默失效。
  it("scan --reset 重建清单时把已读记录一起清掉", () => {
    seed(["src/a.ts", "src/b.ts"]);
    strike(project, join(project, "src/a.ts"));
    expect(readWorklist(project)).toEqual(["src/b.ts"]);

    execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "claude-companion", "ideas.ts"),
      "scan", "--reset", "--project", project], { cwd: ROOT, encoding: "utf8" });

    // 重建之后一个都还没读。剩余数等于清单长度，不是 0。
    const left = readWorklist(project);
    expect(left.length).toBeGreaterThan(0);
    expect(left).toContain("src/a.ts");
    // 已读记录必须真的空了 —— 只看剩余数的话，一份陈旧的已读记录
    // 会在下一次 --reset 之后才发作，而那时已经查不出是谁干的。
    const done = existsSync(doneFile(project)) ? readFileSync(doneFile(project), "utf8") : "";
    expect(done.trim()).toBe("");
  }, 60_000);

  // ── 一次性迁移 ─────────────────────────────────────────────────────────
  it("从旧格式迁移：此前已读的算已读，清单里的残缺行消失", () => {
    seed(["src/a.ts", "src/b.ts", "src/c.ts"]);
    // 旧格式：.scan-todo 里只剩没读的，而且被并发写坏留下了一行残缺内容。
    writeFileSync(worklistFile(project), "src/c.ts\nn\n");
    expect(existsSync(doneFile(project))).toBe(false);

    execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "claude-companion", "ideas.ts"),
      "scan", "--project", project], { cwd: ROOT, encoding: "utf8" });

    const left = readWorklist(project);
    expect(left).toContain("src/c.ts");        // 还没读的仍然没读
    expect(left).not.toContain("n");           // 残缺行被对账丢掉
    expect(left).not.toContain("src/a.ts");    // 此前已读的算已读
    expect(left).not.toContain("src/b.ts");
  }, 60_000);

  // ── 已读记录不能被 agent 自己写 ──────────────────────────────────────────
  // R7 的全部理由就是「划掉必须由真的 Read 产生」。多一个可写的文件，
  // 就多一条 agent 自己写「我读过了」的路。
  it("已读记录进了 ideas/.gitignore", () => {
    const ignore = readFileSync(join(ROOT, "ideas", ".gitignore"), "utf8");
    expect(ignore).toMatch(/\.scan-done/);
  });
});

// ── 反向漂移：裁决表不许把已经落地的东西写成「未落地」 ────────────────────────
//
// 这场审计要治的病是「规范和代码对不上」。第一轮修完之后，病换了个方向 ——
// 裁决表落后于代码，说没做的事代码里正跑着。这比多写一句废话严重：读规范的人
// 不会去用一个「还没有」的能力，而下一个人会照着规范把已经存在的东西再补做一遍。
//
// 每一条都先在代码里取证（能在进程里跑的就真的跑一次），再要求对应那一行不许说反话。
// 断言写成「不许出现这句旧话」而不是「必须出现这句新话」：措辞可以再改，
// 说反话不行。
describe("companion/FORMAT.md 的落地情况与代码一致", () => {
  const FORMAT = readFileSync(join(ROOT, "companion", "FORMAT.md"), "utf8");
  const ENGINE_SRC = readFileSync(join(ROOT, "companion", "ideas.ts"), "utf8");
  const GUARD_SRC = readFileSync(join(ROOT, "companion", "guard.ts"), "utf8");

  /** 一条裁决的正文：从 `## D28 …` 到下一个二级标题为止。 */
  const row = (d: string): string => {
    const start = FORMAT.search(new RegExp(`^## ${d} `, "m"));
    expect(start, `裁决表里没有 ${d}`).toBeGreaterThan(-1);
    const rest = FORMAT.slice(start + 3);
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
  };

  // ── D28 命令面 ───────────────────────────────────────────────────────────
  it("D28 列的命令面就是引擎真的答应的那一串，且不说 log 还没有", () => {
    const names = SUBCOMMANDS.map(([n]) => n);
    expect(names).toContain("log");                       // 取证：log 真的在
    const d28 = row("D28");
    for (const name of names) {
      expect(d28, `D28 没提 ${name}`).toContain(name);
    }
    expect(d28).not.toMatch(/`log` 子命令还没有/);
    // 数目要对得上。这里不能一见「十六」就判负 —— D28 现在是拿「曾经只有十六条、
    // 缺的正是 log」当已经补上的旧账记着（白名单改成从 SUBCOMMANDS 读，不再手抄）。
    // 要拦的只是「引擎的命令面只有十六条」这句把旧账说成现状的话。
    expect(d28).not.toMatch(/已落地的正是上面反引号里那十六条/);
    expect(SUBCOMMANDS.length).toBe(17);
    expect(d28).toMatch(/十七条/);
  });

  it("D28 不再说每条命令都能 --file：改状态的命令只认项目自己的图", () => {
    expect(ENGINE_SRC).toContain("READS_ANY_GRAPH");      // 取证：拒绝的那一段在
    expect(FORMAT).not.toMatch(/Every command takes `--file/);
  });

  // ── D22 归一化后的事件 ────────────────────────────────────────────────────
  it("D22 列的事件类型集合就是 guard.ts 里那个联合类型", () => {
    const union = /^\s*event:\s*("[a-z-]+"(?:\s*\|\s*"[a-z-]+")*);/m.exec(GUARD_SRC)?.[1] ?? "";
    const kinds = union.split("|").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect(kinds).toContain("read");                      // 取证：第七类、第八类真的在
    expect(kinds).toContain("session");
    const d22 = row("D22");
    for (const kind of kinds) expect(d22, `D22 没提 ${kind}`).toContain(kind);
    expect(d22).not.toMatch(/只有六类/);
    // 事件形状后来长出来的两个字段也要在表里。
    expect(d22).toContain("patchText");
    expect(d22).toContain("stop_hook_active");
  });

  it("D22 不再说读文件靠 runGuard 里的特例、只有 Claude 一家认得", () => {
    // 取证：另外两家的归一化器自己就产出 read 事件。
    expect(normalizeCursor({ hook_event_name: "beforeReadFile", file_path: "a.ts" }).event).toBe("read");
    expect(normalizeCodex({
      hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" },
    }).event).toBe("read");
    const d22 = row("D22");
    expect(d22).not.toMatch(/靠 `runGuard` 里的一个特例/);
    expect(d22).not.toMatch(/今天只有 Claude 一家/);
  });

  // ── D15 会话简报 ──────────────────────────────────────────────────────────
  it("D15 不再把会话简报记成未决：守卫自己产出简报，三家都归一成 session", () => {
    expect(typeof sessionBriefing).toBe("function");      // 取证：简报由守卫产出
    expect(normalizeCursor({ hook_event_name: "sessionStart" }).event).toBe("session");
    expect(normalizeCodex({ hook_event_name: "SessionStart" }).event).toBe("session");
    const d15 = row("D15");
    expect(d15).not.toMatch(/只落地了一半/);
    expect(d15).not.toMatch(/这两家今天接了线，但没有简报/);
    expect(d15).not.toMatch(/未决，两种读法都说得通，等人裁/);
  });

  // ── D29 跳过清单 ──────────────────────────────────────────────────────────
  it("D29 不再说带原因的 skipped 清单没落地", () => {
    expect(typeof skippedFiles).toBe("function");         // 取证：函数在
    expect(ENGINE_SRC).toContain("--skipped");            // 取证：命令开关也在
    expect(row("D29")).not.toMatch(/未落地：那份带原因的 skipped 清单/);
  });

  // ── D31 路径校验 ──────────────────────────────────────────────────────────
  it("D31 不再说路径校验没落地：check 真的拒绝出项目的路径", () => {
    const graph: Graph = {
      version: 1, endpoints: ["I-001"],
      ideas: [{
        id: "I-001", name: "一个计划里写了越界路径的想法", status: "todo",
        code: [{ file: "../../elsewhere/x.ts" }],
        verify: { command: "npx vitest run t.test.ts", test_files: ["/tmp/t.test.ts"] },
      }],
    };
    const { errors } = check(graph, ROOT);
    expect(errors.join("\n")).toMatch(/D31/);
    expect(errors.filter((e) => e.includes("D31")).length).toBe(2);   // code 和 test_files 各一条
    expect(row("D31")).not.toMatch(/未落地：路径本身的校验/);
  });

  // ── D32 行号校验 ──────────────────────────────────────────────────────────
  it("D32 不再说行号校验没落地：check 真的看得出过期行号", () => {
    const graph: Graph = {
      version: 1, endpoints: ["I-001"],
      ideas: [{
        id: "I-001", name: "一个行号早就超出文件长度的想法", status: "done",
        code: [{ file: "package.json", lines: "1-999999" }],
        verify: { command: "npx vitest run t.test.ts", test_files: ["t.test.ts"] },
      }],
    };
    // 错误还是警告是另一条正在改的裁决，这里只要求它真的被看见。
    const { errors, warnings } = check(graph, ROOT);
    expect([...errors, ...warnings].join("\n")).toMatch(/D32/);
    expect(row("D32")).not.toMatch(/落地情况（2026-09-02）：未落地/);
  });

  // ── 第一轮刻意造成、但还没写进表的两件事 ────────────────────────────────────
  it("D21 记下了子命令白名单，以及「点名引擎却不匹配白名单就拒绝」", () => {
    expect(GUARD_SRC).toContain("COMPANION_SUBCOMMANDS");
    expect(GUARD_SRC).toContain("ENGINE_MENTION");
    const d21 = row("D21");
    expect(d21).toMatch(/COMPANION_SUBCOMMANDS/);
    expect(d21).toMatch(/guard/);                         // guard/hook 入口不可达，是 D26 成立的前提
  });

  it("D24 记下了「带不出改动后内容的写图请求一律拒绝」是刻意的关门", () => {
    expect(GUARD_SRC).toContain("ruleGraphPatch");
    expect(row("D24")).toMatch(/带不出改动后的内容|post-image|后像/);
  });
});

// ── CLAUDE.md 说的这个仓库，必须就是这个仓库 ────────────────────────────────
//
// CLAUDE.md 是每个新会话开工之前当成事实读的第一份文件，它错一句，错的不是一行
// 文档，是后面每一次判断的前提。两个方向都会出事：说共同基座还没落地，人就会
// 把已经写好的东西再补做一遍；说共同基座已经在管这个仓库，人就会去改
// companion/ 然后奇怪为什么闸门一点没变 —— 真正在跑的还是 claude-companion。
//
// 每一条都先从真实的配置和代码里取证，再要求 CLAUDE.md 不说反话。
describe("CLAUDE.md 说的这个仓库就是这个仓库", () => {
  const CLAUDE = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const BASE_SRC = readFileSync(join(ROOT, "companion", "ideas.ts"), "utf8");
  const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

  /**
   * 含某个词的那些句子。按句子而不是按段落取：这份文件全是长条目，同一段里
   * 随便哪句话出现的词都会算进来，那样断言等于没断言。
   */
  const saying = (needle: string): string[] =>
    CLAUDE.split(/(?<=\.)\s+|\n/).filter((s) => s.includes(needle));

  /** settings.json 里每一条 hook 命令的原文。 */
  const hookCommands = (): string[] =>
    Object.values(SETTINGS.hooks ?? {}).flatMap((groups: any) =>
      (groups ?? []).flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command)));

  it("hooks 里只有那四条 legacy guard —— 不许再说挂着已退休的 packages/hook", () => {
    const commands = hookCommands();
    expect(commands.length).toBe(4);                       // 取证：四条，一条不多
    for (const c of commands) expect(c).toContain("claude-companion/guard.ts");
    expect(CLAUDE).not.toMatch(/packages\/hook/);
  });

  it("说清楚闸门是绝对机器路径挂进去的 legacy guard", () => {
    // 取证：命令里写的是这台机器上的绝对路径，不是仓库相对路径。
    for (const c of hookCommands()) expect(c).toMatch(/[A-Za-z]:\//);
    expect(saying("claude-companion/guard.ts").some((s) => /absolute/i.test(s))).toBe(true);
  });

  it("写出装机口 .companion/companion.mjs，同时说明干活的仓库一处都没装", () => {
    expect(ENGINE_RELATIVE).toBe(".companion/companion.mjs");            // 取证：装机口就是它
    expect(existsSync(join(ROOT, ENGINE_RELATIVE))).toBe(false);         // 取证：本仓库没装
    // 安装名单存不存在不归测试管 —— 它是这台机器的记录，被 .gitignore 挡在仓库外，
    // 而一次端到端演练本来就会把基座装进临时仓库、正当地写进名单。原来这里断言
    // 「名单必须不存在」，于是第一次真演练就把套件染红 —— 同样的毛病
    // test_base_install.test.ts 早就改过了，这条是漏网的最后一处。
    // 真正要守的是那句话的意思：你干活的仓库一个都没被基座接管。所以只查名单里
    // 有没有真仓库 —— 本仓库自己，或 D:/GitHub 下的兄弟仓库；临时目录不算。
    const REGISTRY = join(ROOT, "companion", ".installs.json");
    const registered: string[] = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, "utf8")) : [];
    const norm = (p: string) => p.replaceAll("\\", "/").toLowerCase();
    const workspace = norm(dirname(ROOT));                               // D:/GitHub
    const realRepos = registered.filter((e) => norm(e).startsWith(workspace + "/"));
    expect(realRepos, `安装名单里出现了真仓库，CLAUDE.md 就不能再说没接管：${realRepos.join(" ")}`)
      .toEqual([]);
    // 也别再把「名单不存在」写成事实 —— 那句话演练一次就假了。
    expect(CLAUDE).not.toMatch(/no `companion\/\.installs\.json`/);
    // 光提一句名字不算数：得说清楚它是「装进目标仓库之后」的那个入口。
    expect(saying(ENGINE_RELATIVE).some((s) => /install/i.test(s))).toBe(true);
    // 但不许因此写成本仓库已经切过去了：真正在跑的引擎和账本必须还写在文件里。
    expect(CLAUDE).toContain("claude-companion/guard.ts");
    expect(CLAUDE).toContain("ideas/graph.claude.yaml");
  });

  it("警告 ideas/graph.yaml 里躺着退休 Cursor 实现留下的旧图", () => {
    // 取证：那份图确实还在，而且写着自己属于 cursor。
    expect(readFileSync(join(ROOT, "ideas", "graph.yaml"), "utf8")).toMatch(/^agent:\s*cursor$/m);
    // 「别去新建它」是它还不存在时候的话，现在它在，说反了。
    expect(CLAUDE).not.toMatch(/Do not hand-create `ideas\/graph\.yaml`/);
    expect(saying("ideas/graph.yaml")
      .some((s) => /cursor/i.test(s) && /stale|retired/i.test(s))).toBe(true);
  });

  it("命令面：不再说每条子命令都能 --file，且列的就是引擎放行的那几条", () => {
    // 取证：拒绝的那一段在，白名单就是这几条。
    expect(BASE_SRC).toContain("READS_ANY_GRAPH");
    const names = (/const READS_ANY_GRAPH = \[([^\]]*)\]/.exec(BASE_SRC)?.[1] ?? "")
      .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect(names).toContain("paths");
    expect(CLAUDE).not.toMatch(/all subcommands accept `--file/);
    const listed = saying("--file").find((s) => names.every((n) => s.includes(n)));
    expect(listed, `CLAUDE.md 没有一句把 ${names.join(" ")} 都列全`).toBeTruthy();
  });
});

// ── 仓库卫生：三件没人做、但每一件都在悄悄说假话的小事 ──────────────────────
//
// 都不影响功能，所以一直排在后面；可它们坏的是「看得见」这件事本身 ——
// 行尾没定住，diff 里满是没人改过的行，真的改动就淹在里面；文件里混进一个
// NUL，git 把整份文件当二进制，从此它的 diff 谁也读不到；扫描排除表留着
// 一条早就被推翻的决定，扫描就永远走不到那两个正在被统一的目录。
describe("仓库卫生：行尾、二进制误判、扫描范围", () => {
  it(".gitattributes 定住行尾：文本归一化，批处理仍是 CRLF", () => {
    const file = join(ROOT, ".gitattributes");
    expect(existsSync(file), "仓库没有 .gitattributes，行尾随各人机器漂").toBe(true);
    const text = readFileSync(file, "utf8");
    // 一行把文本归一化（入库一律 LF），一行把批处理钉死 —— 批处理文件被
    // 转成 LF 之后 cmd.exe 会读坏，这是唯一必须留 CRLF 的一类。
    expect(text).toMatch(/^\*\s+text=auto\b/m);
    expect(text).toMatch(/^\*\.(bat|cmd)\b.*\beol=crlf\b/m);
  });

  it("测试源码里没有 NUL 字节 —— 有一个 git 就把整份文件当二进制", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => readFileSync(join(dir, f)).includes(0));
    expect(bad, `这些文件里有 NUL 字节，git 会当二进制：${bad.join(" ")}`).toEqual([]);
  });

  it(".scanignore 不再排除 codex/cursor —— 2026-08-29 起这两处已纳入统一范围（D29）", () => {
    const ignores = scanIgnores(ROOT);
    expect(ignores).not.toContain("codex-companion/");
    expect(ignores).not.toContain("cursor-companion/");
  });

  it(".scanignore 里的每一条都指向真的存在的路径（D29）", () => {
    // 排除一个不存在的目录不会报错，只会一直挂在表上，让人以为项目里
    // 还有那么一块地方不用读。表越旧，「排除了什么」就越不可信。
    for (const prefix of scanIgnores(ROOT)) {
      expect(existsSync(join(ROOT, prefix)), `.scanignore 排除了不存在的路径 ${prefix}`).toBe(true);
    }
  });
});
