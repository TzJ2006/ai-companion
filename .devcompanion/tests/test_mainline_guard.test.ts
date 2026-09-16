import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeClaude, decide, record, sessionBriefing, refusalKind } from "../../companion/guard.js";

// I-150 / I-151 / I-152 —— 工作主线的三件硬件：
//   Stop 只拦本次会话改过或影响到的想法上的错误，其余是历史提示，不拉只读会话去修图；
//   每条拒绝先说谁处理（自行处理 / 缺授权 / 能力受限 / 需人判断）；
//   会话开头只给进行中的想法和它的最近记录，不打整张表。
// 判据：D33「主线、拒绝分类与记录分档」。事件走真实的 normalize → decide，不手捏内部结构。

const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "在做的想法"
    status: doing
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/a.ts
    verify:
      command: "npx vitest run tests/a.test.ts"
      test_files: [ tests/a.test.ts ]
      pass: "exit 0"
    log:
      - { date: "2026-09-16", note: "目标：让 a 解析更快。已完成：读完。下一步：写实现。待决：暂无" }
  - id: I-002
    name: "历史上受阻、没写原因"
    status: blocked
    needs: []
    what: W
    why: Y
  - id: I-003
    name: "依赖 I-001、受阻没写原因"
    status: blocked
    needs: [I-001]
    what: W
    why: Y
  - id: I-004
    name: "可开工的待办"
    status: todo
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/d.ts
    verify: { command: "npx vitest run tests/d.test.ts", test_files: [ tests/d.test.ts ], pass: "exit 0" }
`;

describe("I-150 Stop 只拦本次影响范围", () => {
  let dir: string;
  const dirs: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mainline-"));
    dirs.push(dir);
    for (const sub of ["ideas", "src", "tests", ".companion"]) mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "src", "a.ts"), "// a\n");
    writeFileSync(join(dir, "src", "d.ts"), "// d\n");
    writeFileSync(join(dir, ".companion", "companion.mjs"), "// stub\n");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const stop = (session?: string) => decide(normalizeClaude({ hook_event_name: "Stop", cwd: dir, ...(session ? { session_id: session } : {}) }), dir);

  it("没有宿主身份：分不出谁的错，整张图的错误都拦（旧规则不变）", () => {
    const v = stop();
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-002/);
    expect(v.reason).toMatch(/I-003/);
  });

  it("只读会话：两个历史错误都不在影响范围内，放行并提示", () => {
    const v = stop("ro");
    expect(v.allow).toBe(true);
    expect(v.warn).toMatch(/历史错误/);
    expect(v.warn).toMatch(/I-002/);
    expect(v.warn).toMatch(/I-003/);
  });

  it("写过 src/a.ts 的会话：依赖 I-001 的 I-003 在范围内拦住，无关的 I-002 只算历史", () => {
    record(normalizeClaude({
      hook_event_name: "PostToolUse", tool_name: "Edit", cwd: dir, session_id: "w",
      tool_input: { file_path: join(dir, "src", "a.ts") },
    }), dir);
    const v = stop("w");
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-003/);
    expect(v.reason).not.toMatch(/I-002/);
    expect(v.reason).toMatch(/另有 1 个历史错误/);
  });

  it("引擎命令点名过 I-002 的会话：I-002 进影响范围，拦住", () => {
    const pre = decide(normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "Bash", cwd: dir, session_id: "e",
      tool_input: { command: "node .companion/companion.mjs show I-002" },
    }), dir);
    expect(pre.allow, pre.reason).toBe(true);
    const v = stop("e");
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-002/);
    expect(v.reason).not.toMatch(/I-003/);
  });
});

describe("I-151 每条拒绝先说谁处理", () => {
  let dir: string;
  const dirs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mainline-kind-"));
    dirs.push(dir);
    for (const sub of ["ideas", "src"]) mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const shell = (command: string) => decide(normalizeClaude({
    hook_event_name: "PreToolUse", tool_name: "Bash", cwd: dir, tool_input: { command },
  }), dir);

  it("提交归人 → 缺授权；没认领的文件 → 自行处理", () => {
    expect(shell("git commit -m x").reason).toMatch(/^【缺授权】/);
    const edit = decide(normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "Edit", cwd: dir,
      tool_input: { file_path: join(dir, "src", "zzz.ts"), old_string: "a", new_string: "b" },
    }), dir);
    expect(edit.allow).toBe(false);
    expect(edit.reason).toMatch(/^【自行处理】/);
  });

  it("分类只看理由文字：守卫禁止的路是能力受限，签字是需人判断", () => {
    expect(refusalKind("守卫看得见 agent 在驱动浏览器，冲着本地服务去的调用一律拦下（I-104）")).toBe("能力受限");
    expect(refusalKind("manual check — a human must fill `verify.signed_off` before done")).toBe("需人判断");
    expect(refusalKind("没有进行中的想法认领 src/x.ts（D16）")).toBe("自行处理");
  });

  it("箭头函数不是重定向：node -e 里的 => 照常放行", () => {
    expect(shell(`node -e "const f=(x)=>x*2; console.log(f(2))"`).allow).toBe(true);
  });
});

describe("I-152 会话开头只给当前工作", () => {
  it("进行中的想法带最近记录；受阻数和可开工数；不列整张表", () => {
    const dir = mkdtempSync(join(tmpdir(), "mainline-brief-"));
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    const text = sessionBriefing(dir)!;
    expect(text).toMatch(/I-001 \[doing\] 在做的想法/);
    expect(text).toMatch(/让 a 解析更快/);
    expect(text).toMatch(/受阻 2 个/);
    expect(text).toMatch(/可开工 1 个（I-004）/);
    expect(text).not.toMatch(/可开工的待办/);   // 整张表的名字不在这里，一条命令可查
    expect(text).toMatch(/需要人操作：无/);      // I-156：人先看这一行
    rmSync(dir, { recursive: true, force: true });
  });

  it("I-156：进行中且等人签字的想法列在「需要人操作」里，带申请口令的命令", () => {
    const dir = mkdtempSync(join(tmpdir(), "mainline-brief-manual-"));
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml.replace(
      'verify:\n      command: "npx vitest run tests/a.test.ts"\n      test_files: [ tests/a.test.ts ]\n      pass: "exit 0"',
      "verify: { manual: 打开页面看三条要点 }",
    ));
    const text = sessionBriefing(dir)!;
    expect(text).toMatch(/需要人操作：I-001 人工验收/);
    expect(text).toMatch(/request-approval --gate manual-check --node I-001/);
    rmSync(dir, { recursive: true, force: true });
  });
});
