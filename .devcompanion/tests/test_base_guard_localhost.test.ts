import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, normalizeClaude } from "../../companion/guard.js";

// I-104 —— 守卫看得见 agent 在驱动浏览器。
//
// 发现的经过（2026-09-05，本机实测）：PreToolUse 只把三类调用送进判断 —— 编辑类、
// shell 类、以及「看得出在写文件」的 MCP 调用。剩下的一律归成 other，走 decideInner
// 的 default 分支直接放行（guard.ts:1510 的注释原话是 "a read-shaped MCP call is not
// ours to block"）。浏览器工具三样都不沾：navigate 只带一个网址、点击只带坐标、
// 在页面里执行脚本只带一段文本。
//
// 于是前门和后门是两个待遇：shell 那边下载器整族早就被当写文件动词拦掉了
// （guard.ts 的 MUTATING_HEAD 里 curl|wget|iwr|Invoke-RestMethod…），连一个只往标准
// 输出打字的只读 curl 都一并拒绝；而 agent 打开浏览器、导航到 127.0.0.1 上的本地
// 服务、在页面里跑一段 fetch，一路畅通。
//
// 实测记录（同日，同一台机器，用的就是本会话手里的浏览器工具）：驱动出来的一次点击，
// 页面读到 isTrusted 为真、navigator.userActivation.isActive 为真、navigator.webdriver
// 为假 —— 和人手点的一模一样。所以「页面上放一个有权力的按钮」这件事，只要 agent
// 够得着那一页，那个权力就等于零。
//
// 这一条定的性质：**按目标认，不按工具名认**。人让 agent 上网是正常工作，
// 被拦的只有冲着本机服务去的那一下。护栏不是沙箱 —— 它把「顺手就能做到」变成
// 「必须明确绕过」，不是让它不可能（D26）。
describe("companion guard sees the agent driving a browser (I-104)", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "进行中的想法"
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
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const mcp = (tool: string, input: Record<string, unknown>) =>
    normalizeClaude({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd: dir });

  const deniesUrl = (url: string, tool = "mcp__browser__navigate") => {
    const v = decide(mcp(tool, { url }), dir);
    expect(v.allow, `${url} 应该被拦下`).toBe(false);
    return v;
  };
  const allowsUrl = (url: string, tool = "mcp__browser__navigate") => {
    const v = decide(mcp(tool, { url }), dir);
    expect(v.allow, `${url} 不该被拦 —— ${v.reason ?? ""}`).toBe(true);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guard-local-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 拦：冲着本机服务去的那一下 ───────────────────────────────────────────

  it("a browser call pointed at the local service is refused, and says why", () => {
    const v = deniesUrl("http://127.0.0.1:4173/");
    expect(v.reason).toMatch(/本机|本地|回环/);        // 说清拦的是什么
    expect(v.reason).toMatch(/护栏|不是沙箱/);          // 诚实的边界，写在拒绝语里
  });

  it("every spelling of the loopback host, and any port", () => {
    // serve 有 --port，端口写死人一加参数规则就漏；守卫和服务是两个进程，
    // 守卫没有可靠办法知道服务此刻跑在哪个端口上 —— 所以拦整个回环族。
    for (const url of [
      "http://127.0.0.1:4173/",
      "http://127.0.0.1:9999/changes",
      "http://localhost:4173/",
      "http://LocalHost:31337/",
      "http://[::1]:4173/",
      "http://127.9.9.9:8080/",          // 127/8 整段都是回环
      "https://localhost/",              // 没写端口也算
    ]) deniesUrl(url);
  });

  it("judged by target, not by tool name — any tool at all", () => {
    // 按名字枚举浏览器既漏掉各家不同命名的接入，又拦不住一个叫别的名字的工具。
    deniesUrl("http://127.0.0.1:4173/", "mcp__anything__at_all");
    deniesUrl("http://127.0.0.1:4173/", "mcp__some_vendor__open_page");
  });

  it("a loopback address under any url-ish key, not just `url`", () => {
    for (const key of ["url", "uri", "href", "link", "endpoint"]) {
      const v = decide(mcp("mcp__x__go", { [key]: "http://127.0.0.1:4173/" }), dir);
      expect(v.allow, `${key} 这一栏里的回环地址也要认出来`).toBe(false);
    }
  });

  // ── 放：人让 agent 上网是正常工作 ────────────────────────────────────────

  it("the open web is untouched — refusing it would be worse than not refusing at all", () => {
    // 这一条已经被 test_base_guard_shell_targets.test.ts:231 钉过一次，
    // 在这里再钉一次：新规则最容易犯的错就是把它打红。
    allowsUrl("https://example.com/a/b");
    allowsUrl("https://docs.anthropic.com/");
    allowsUrl("http://192.168.1.10:8080/");     // 局域网不是本机
  });

  it("hosts that merely LOOK like loopback are not loopback", () => {
    // 一个 includes("127.0.0.1") 或 includes("localhost") 的草率实现会在这里全红。
    allowsUrl("https://127.0.0.1.evil.example/");
    allowsUrl("https://mylocalhost.example/");
    allowsUrl("https://localhost.evil.example/panel");
    allowsUrl("https://example.com/?next=http://127.0.0.1:4173/");
  });

  it("a read-shaped MCP call that names no url is still not ours to block", () => {
    expect(decide(mcp("mcp__db__query", { sql: "select 1" }), dir).allow).toBe(true);
    expect(decide(mcp("mcp__weather__forecast", { location: "Paris" }), dir).allow).toBe(true);
  });

  it("a value that is not a url at all does not crash the screen", () => {
    // 判不出来的东西按原样放行 —— 守卫崩了不能把人锁在外面（I-047）。
    for (const url of ["", "не-url", "://///", "http://", "javascript:void(0)"]) {
      expect(() => decide(mcp("mcp__x__go", { url }), dir)).not.toThrow();
    }
  });

  // ── 在页面里执行脚本：判不了目标，只能按名字认，代价如实写下来 ───────────

  it("running script inside a page is refused on its own, separate reason", () => {
    const v = decide(mcp("mcp__Claude_Browser__javascript_tool",
      { action: "javascript_exec", text: "await fetch('/changes',{method:'POST'})" }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/脚本/);
    // 和网址那条不是同一个理由 —— 这条判不了目标，必须说明白它按名字认。
    expect(v.reason).toMatch(/名字|判不出|看不见/);
  });

  it("…and that clause stays narrow: an ordinary tool is not caught by it", () => {
    expect(decide(mcp("mcp__db__query", { sql: "select 1" }), dir).allow).toBe(true);
    expect(decide(mcp("mcp__notes__evaluate_grade", { student: "a" }), dir).allow).toBe(true);
  });
});
