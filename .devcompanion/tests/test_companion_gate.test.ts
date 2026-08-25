import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  decideWrite, fileClash, isBuildReady, needsUnmet, runVerifyCommand, setStatus,
} from "../../cursor-companion/ideas.ts";
import { extractWritePath, isWriteTool } from "../../cursor-companion/gate-lib.mjs";

const ready = {
  id: "I-002",
  name: "x",
  status: "todo" as const,
  expected: "ok",
  how: "do it",
  verify: { command: "node -e process.exit(0)", pass: "exit 0" },
  code: [{ file: "src/a.ts" }],
  needs: ["I-001"],
};

const doneNeed = {
  id: "I-001",
  name: "base",
  status: "done" as const,
  expected: "e", how: "h",
  verify: { command: "node -e process.exit(0)" },
  code: [{ file: "src/base.ts" }],
};

describe("write-gate", () => {
  it("allows the ledger even with no doing idea", () => {
    const g = { enforce: true, ideas: [] };
    expect(decideWrite(g, "ideas/graph.yaml").allow).toBe(true);
    expect(decideWrite(g, "ideas/log.md").allow).toBe(true);
    expect(decideWrite(g, "src/a.ts").allow).toBe(false);
  });

  it("denies product code until a build-ready idea is doing", () => {
    const g = { enforce: true, ideas: [{ ...ready, status: "todo" }] };
    expect(decideWrite(g, "src/a.ts").allow).toBe(false);
    const doingIncomplete = { enforce: true, ideas: [{ ...ready, status: "doing", how: "" }] };
    expect(decideWrite(doingIncomplete, "src/a.ts").allow).toBe(false);
    const doing = { enforce: true, ideas: [{ ...ready, status: "doing" }] };
    expect(decideWrite(doing, "src/a.ts").allow).toBe(true);
    expect(decideWrite(doing, "src/other.ts").allow).toBe(false);
  });

  it("unlocks the verify command's test file", () => {
    const g = {
      enforce: true,
      ideas: [{
        ...ready, status: "doing",
        verify: { command: "npx vitest run tests/a.test.ts" },
      }],
    };
    expect(decideWrite(g, "tests/a.test.ts").allow).toBe(true);
  });

  it("honours enforce: false and exempt prefixes", () => {
    expect(decideWrite({ enforce: false, ideas: [] }, "src/a.ts").allow).toBe(true);
    expect(decideWrite({ enforce: true, exempt: ["cursor-companion/**"], ideas: [] }, "cursor-companion/ideas.ts").allow).toBe(true);
    expect(decideWrite({ enforce: true, exempt: ["cursor-companion/**"], ideas: [] }, "src/a.ts").allow).toBe(false);
  });

  it("locks harness hook files", () => {
    const d = decideWrite({ enforce: true, ideas: [] }, ".cursor/hooks/gate.mjs");
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/harness/);
  });

  it("isBuildReady / needsUnmet / fileClash", () => {
    expect(isBuildReady({ id: "I-1", name: "n" })).toMatch(/missing expected/);
    expect(isBuildReady(ready)).toBeNull();
    expect(needsUnmet(ready, { ideas: [doneNeed, ready] })).toEqual([]);
    expect(needsUnmet(ready, { ideas: [{ ...doneNeed, status: "todo" }, ready] })).toEqual(["I-001"]);
    expect(fileClash(
      { ...ready, id: "I-003", status: "doing" },
      { ideas: [{ ...ready, status: "doing" }, { ...ready, id: "I-003" }] },
    ).length).toBeGreaterThan(0);
  });
});

describe("setStatus gates", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function docOf(yaml: string) {
    const dir = mkdtempSync(join(tmpdir(), "gate-set-"));
    dirs.push(dir);
    const file = join(dir, "graph.yaml");
    writeFileSync(file, yaml);
    return { dir, file, doc: parseDocument(yaml), graph: parseDocument(yaml).toJSON() };
  }

  it("refuses doing when how/expected/verify/code are missing", () => {
    const { doc, graph } = docOf(`ideas:\n  - id: I-001\n    name: x\n    status: todo\n`);
    expect(() => setStatus(doc, graph, "I-001", "doing", { date: "2026-08-24" }))
      .toThrow(/cannot be doing/);
  });

  it("refuses doing when a need is not done", () => {
    const { doc, graph } = docOf(`ideas:
  - id: I-001
    name: base
    status: todo
  - id: I-002
    name: x
    status: todo
    needs: [I-001]
    expected: e
    how: h
    verify: { command: "node -e process.exit(0)" }
    code: [{ file: src/a.ts }]
`);
    expect(() => setStatus(doc, graph, "I-002", "doing", { date: "2026-08-24" }))
      .toThrow(/needs not done/);
  });

  it("runs verify.command on done and refuses a failing command", () => {
    const yaml = `ideas:
  - id: I-001
    name: x
    status: doing
    expected: e
    how: h
    verify: { command: "node -e process.exit(1)" }
    code: [{ file: src/a.ts }]
`;
    const { doc, graph, dir } = docOf(yaml);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "");
    expect(() => setStatus(doc, graph, "I-001", "done", { date: "2026-08-24" }, { runVerify: true, projectDir: dir }))
      .toThrow(/verify failed/);
  });

  it("runVerifyCommand passes on exit 0", () => {
    const r = runVerifyCommand("node -e process.exit(0)", process.cwd());
    expect(r.passed).toBe(true);
  });
});

describe("gate.mjs hook", () => {
  const hook = resolve("cursor-companion/hooks/gate.mjs");
  const repo = resolve(".");

  function run(payload: object) {
    const r = spawnSync(process.execPath, [hook], {
      cwd: repo, input: JSON.stringify(payload), encoding: "utf8",
    });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout || "{}");
  }

  it("allows ledger writes and denies product code with no doing idea", () => {
    const allow = run({
      tool_name: "Write",
      cwd: repo,
      tool_input: { path: join(repo, "ideas", "graph.yaml") },
    });
    expect(allow.permission).toBe("allow");

    const deny = run({
      tool_name: "StrReplace",
      cwd: repo,
      tool_input: { path: join(repo, "packages", "cli", "src", "main.ts") },
    });
    expect(deny.permission).toBe("deny");
    expect(deny.agent_message).toMatch(/blocked/i);

    const exempt = run({
      tool_name: "Write",
      cwd: repo,
      tool_input: { path: join(repo, "cursor-companion", "ideas.ts") },
    });
    expect(exempt.permission).toBe("allow");
  });

  it("extractWritePath only fires on write tools", () => {
    expect(isWriteTool("Read")).toBe(false);
    expect(extractWritePath("Write", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(extractWritePath("Read", { path: "src/a.ts" })).toBeNull();
  });
});
