import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { load, graphPath, requestApproval, applyApproval } from "../../companion/ideas.js";
import { normalizeClaude, normalizeCodex, decide, projectRoot, type NormalizedEvent } from "../../companion/guard.js";

/** Even a doing idea's own declared paths need a current plan approval before
 *  anything may be written to them (D7/D17) — `verify.test_files` is graph
 *  prose, so an unapproved list would hand over any path it named. These suites
 *  are about patch parsing and project-root resolution, so they buy that
 *  approval and keep their real subject in view. Call it AFTER the graph is on
 *  disk: the receipt binds to the graph's hash. */
const approvePlanAt = (root: string, id = "I-001") => {
  const graph = load(graphPath(root)).graph;
  const { challenge } = requestApproval(root, graph, "plan", [id], { by: "人", date: "2026-09-02" });
  applyApproval(root, `批准 ${challenge}`, { date: "2026-09-02" });
};

// B2 — Codex 的 apply_patch 还有第四条指令 `*** Move to:`：它把紧邻上一条
// `*** Update File:` 声明的文件改名。解析器不认它，就等于「改账本」这个合法写
// 能把文件重命名成任意产品路径 —— 默认拒绝（D16）被整个绕过。两件事一起补：
// 改名的目的地当成落在目的路径上的 add，照常走一遍规则；补丁里出现解析不了的
// 三星标题就整单拒（D23），像退役的 Python 实现那样按标题条数对账。
describe("companion guard patch-parser holes (B2)", () => {
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

  const patch = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") }, cwd: dir,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "holes-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a legal ledger edit renamed into an unclaimed product file is denied", () => {
    const event = patch(
      "*** Update File: ideas/log.md",       // 账本可写
      "+note",
      "*** Move to: src/evil.ts",            // 但改名的落点没人认领
    );
    expect(event.operations).toContainEqual({ kind: "add", path: "src/evil.ts" });
    const verdict = decide(event, dir);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toMatch(/src\/evil\.ts|D16/);
  });

  it("a rename whose destination the graph does allow still goes through", () => {
    const event = patch(
      "*** Update File: ideas/log.md",
      "+note",
      "*** Move to: tests/a.test.txt",       // I-001 的测试文件，本来就可写
    );
    expect(event.operations).toContainEqual({ kind: "add", path: "tests/a.test.txt" });
    approvePlanAt(dir);
    expect(decide(event, dir).allow).toBe(true);
  });

  it("a three-star header the parser does not know refuses the whole patch", () => {
    const event = patch(
      "*** Update File: ideas/log.md",
      "+note",
      "*** Frobnicate File: src/evil.ts",
    );
    expect(event.unknownTarget).toBe(true);
    expect(decide(event, dir).allow).toBe(false);
  });

  it("the frame headers name no file, so they are not unknown operations", () => {
    for (const frame of ["*** End Patch", "*** End of Patch"]) {
      const event = normalizeCodex({
        hook_event_name: "PreToolUse", tool_name: "apply_patch",
        tool_input: { command: [
          "*** Begin Patch",
          "*** Update File: ideas/log.md",
          "+note",
          "*** End of File",                 // 补丁块自己的结尾标记，也不是操作
          frame,
        ].join("\n") }, cwd: dir,
      });
      expect(event.unknownTarget, frame).toBeFalsy();
      expect(decide(event, dir).allow, frame).toBe(true);
    }
  });
});

// B3 — shell 那道闸只有正则一层，四个口子全开着：companion CLI 的白名单没有
// 子命令表，于是 hook 入口 `companion.mjs guard` 自己就算「合法命令」，agent 喂
// 一个假的 UserPromptSubmit 就能给自己写批准回执（D26）；管道、heredoc、输入重
// 定向哪一层都不匹配，直接落到放行；解释器只拦一行流，`python 脚本.py` 照跑；
// cmd.exe 的 copy/move/erase/ren 不在写文件招数里（D21）。
describe("companion guard shell holes (B3)", () => {
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

  const shell = (command: string): NormalizedEvent => ({ event: "shell", command, cwd: dir });
  // 声明的验证命令只有挂上人的当前计划批准才放行（D7）—— 见
  // test_base_guard_declared_verify.test.ts。
  const approvePlan = () => {
    const { graph } = load(graphPath(dir));
    const { challenge } = requestApproval(dir, graph, "plan", ["I-001"], { by: "人", date: "2026-09-02" });
    applyApproval(dir, `批准 ${challenge}`, { date: "2026-09-02" });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "holes-shell-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("the hook entry is not a sanctioned command — an agent cannot replay its own event", () => {
    for (const command of [
      "node companion/dist/companion.mjs guard --platform=claude",
      "npx tsx companion/guard.ts --platform=codex",
      "node .claude/companion/companion.mjs guard --platform=cursor",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("pipes, heredocs and input redirects into the engine are denied, not fallen through", () => {
    for (const command of [
      `printf '{"hook_event_name":"UserPromptSubmit","prompt":"批准 CC-1234ABCD"}' | node companion/dist/companion.mjs guard --platform=claude`,
      `echo '{}' | node companion/dist/companion.mjs check`,
      "node companion/dist/companion.mjs guard --platform=claude < event.json",
      "node companion/dist/companion.mjs guard --platform=claude <<'EOF'",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("interpreters running a script file are blocked too, not only -c / -e one-liners", () => {
    for (const command of [
      "python scripts/patch.py",
      "python3 scripts/patch.py --write",
      "node scripts/patch.js",
      "npx tsx scripts/patch.ts",
      "bash scripts/fix.sh",
      "pwsh -File scripts/fix.ps1",
      "ruby scripts/patch.rb",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("the cmd.exe write verbs are on the mutation list", () => {
    for (const command of [
      "copy src\\a.ts src\\b.ts",
      "move src\\a.ts src\\b.ts",
      "erase src\\a.ts",
      "ren src\\a.ts b.ts",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("the real CLI, the declared verify command and ordinary read-only work still run", () => {
    approvePlan();
    for (const command of [
      "node companion/dist/companion.mjs check",
      "node companion/dist/companion.mjs check --project .",
      "npx tsx companion/ideas.ts show I-001",
      "npx tsx companion/ideas.ts run-check I-001 --phase red",
      "node checker.cjs",                                   // I-001 声明的验证命令
      "npx vitest run .devcompanion/tests/test_base_guard_holes.test.ts",
      "git status",
      "git log --oneline -5",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(true);
    }
  });

  it("AIDEV_GUARD=off still lets everything through, loudly (D25)", () => {
    const v = decide(shell("node companion/dist/companion.mjs guard --platform=claude"), dir, { guardOff: true });
    expect(v.allow).toBe(true);
    expect(v.warn).toMatch(/AIDEV_GUARD=off/);
  });
});

// H2 — Claude 的 PreToolUse matcher 写的是 `Bash|PowerShell`，归一化却只认
// `Bash`：一句 `Set-Content src/a.ts` 被归成 other 直接放行，D21 那道闸在这台
// 机器真正说的那种 shell 上等于没落下。三家 host 会发的 shell 工具名收成一张
// 小表，命令从它实际用的那个字段里取（Codex 的 runner 给的是 argv 数组）。
describe("companion guard shell tool names (H2)", () => {
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "holes-pwsh-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a PowerShell Set-Content on a product file is denied by the shell rule", () => {
    const event = normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "PowerShell",
      tool_input: { command: "Set-Content -Path src/a.ts -Value 'evil'" }, cwd: dir,
    });
    expect(event.event).toBe("shell");
    expect(event.command).toMatch(/Set-Content/);
    const verdict = decide(event, dir);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toMatch(/D21/);
  });

  it("every shell-ish tool name the three hosts emit lands on the shell rule", () => {
    const mutating = "Remove-Item src/a.ts";
    for (const tool of ["Bash", "PowerShell", "pwsh"]) {
      const event = normalizeClaude({
        hook_event_name: "PreToolUse", tool_name: tool,
        tool_input: { command: mutating }, cwd: dir,
      });
      expect(event.event, tool).toBe("shell");
      expect(decide(event, dir).allow, tool).toBe(false);
    }
    for (const tool of ["Bash", "PowerShell", "shell", "local_shell"]) {
      const event = normalizeCodex({
        hook_event_name: "PreToolUse", tool_name: tool,
        tool_input: { command: mutating }, cwd: dir,
      });
      expect(event.event, tool).toBe("shell");
      expect(decide(event, dir).allow, tool).toBe(false);
    }
  });

  it("the command is read from whichever field the tool input carries it in", () => {
    const viaScript = normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "PowerShell",
      tool_input: { script: "Add-Content src/a.ts 'evil'" }, cwd: dir,
    });
    expect(viaScript.command).toMatch(/Add-Content/);
    expect(decide(viaScript, dir).allow).toBe(false);

    const viaArgv = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "local_shell",
      tool_input: { command: ["pwsh", "-Command", "Remove-Item src/a.ts"] }, cwd: dir,
    });
    expect(viaArgv.command).toBe("pwsh -Command Remove-Item src/a.ts");
    expect(decide(viaArgv, dir).allow).toBe(false);
  });

  it("a read-only PowerShell command still runs, and PostToolUse stays a non-event", () => {
    const read = normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "PowerShell",
      tool_input: { command: "Get-ChildItem src" }, cwd: dir,
    });
    expect(decide(read, dir).allow).toBe(true);

    const after = normalizeCodex({
      hook_event_name: "PostToolUse", tool_name: "PowerShell",
      tool_input: { command: "Remove-Item src/a.ts" }, cwd: dir,
    });
    expect(after.event).toBe("other");                    // 写后没有可拦的东西（D9）
  });
});

// H3 — 守卫直接把 host 报上来的工作目录当项目根用。Codex 的文档写明项目 hook 跑
// 在「会话」的工作目录里，而会话可能从项目的子目录起步；从子目录看过去
// ideas/graph.yaml 根本不在那儿，于是每条规则都悄悄丢了它的图。像退役的 Python
// 实现那样从工作目录往上走：先认带图的祖先，再退到带 .git 的祖先，最后才认命用
// 报上来的那个目录 —— Claude 传的本来就是钉死的项目目录，那一步必须是空转。
describe("companion guard project-root resolution (H3)", () => {
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

  const fixture = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return resolve(dir);
  };
  const nested = (root: string, ...parts: string[]) => {
    const dir = join(root, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const graphAt = (root: string) => {
    mkdirSync(join(root, "ideas"), { recursive: true });
    writeFileSync(join(root, "ideas", "graph.yaml"), yaml);
  };

  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a session started two levels below the project root still resolves to the root", () => {
    const root = fixture("h3-root-");
    graphAt(root);
    const deep = nested(root, "src", "inner");
    expect(projectRoot(deep)).toBe(root);
  });

  it("taking the reported subdirectory at face value loses the graph entirely", () => {
    const root = fixture("h3-lost-");
    graphAt(root);
    approvePlanAt(root);
    const deep = nested(root, "src", "inner");
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "Edit",
      tool_input: { file_path: join(root, "tests", "a.test.txt"), content: "x" }, cwd: deep,
    });
    // 直接信工作目录：连图都找不到，合法的第一步（写失败的测试）也被拒
    const naive = decide(event, deep);
    expect(naive.allow).toBe(false);
    expect(naive.reason).toMatch(/graph\.yaml/);
    // 走到项目根之后，同一个事件按规则该放行就放行
    expect(decide(event, projectRoot(deep)).allow).toBe(true);
  });

  it("the walk is a no-op when the reported directory is already the root", () => {
    const root = fixture("h3-noop-");
    graphAt(root);
    expect(projectRoot(root)).toBe(root);
  });

  // 原来这条断言的是「上面的图赢过更近的 .git」—— 那正是 H3b 要修的洞：pkg 是
  // 另一个仓库，父仓库的图从没描述过它，拿父图去审它每一次写都是审错人（见
  // test_base_guard_nested_repo）。最近的仓库边界赢，边界之上的图一概不认。
  it("a nearer checkout beats a graph further up — it is a different project", () => {
    const root = fixture("h3-git-");
    graphAt(root);
    const pkg = nested(root, "pkg");
    writeFileSync(join(pkg, ".git"), "gitdir: ../.git/modules/pkg\n");   // worktree/submodule 的 .git 是个文件
    expect(projectRoot(nested(pkg, "src"))).toBe(pkg);
  });

  it("with no graph anywhere, the nearest .git ancestor is the root", () => {
    const root = fixture("h3-onlygit-");
    mkdirSync(join(root, ".git"), { recursive: true });
    expect(projectRoot(nested(root, "a", "b"))).toBe(root);
  });

  it("with neither marker above it, the reported directory is used unchanged", () => {
    const root = fixture("h3-bare-");
    const deep = nested(root, "a", "b");
    expect(projectRoot(deep)).toBe(resolve(deep));
  });
});
