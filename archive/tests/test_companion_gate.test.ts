import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  decideWrite, fileClash, isBuildReady, main, needsUnmet, runVerifyCommand, setStatus,
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

  // D31: code.file is one exact project-relative path. A suffix match would let
  // a single claimed path unlock every same-named file in the project.
  it("unlocks only the exact claimed path, not same-named files elsewhere", () => {
    const g = { enforce: true, ideas: [{ ...ready, status: "doing" }] };
    expect(decideWrite(g, "src/a.ts").allow).toBe(true);
    expect(decideWrite(g, "vendor/src/a.ts").allow).toBe(false);
    expect(decideWrite(g, "packages/cli/src/a.ts").allow).toBe(false);
  });

  // D31: the project-root constraint has to survive Windows drive letters --
  // `path.relative` reports another drive as an absolute path, never as `..`.
  it("denies paths outside the project root, including another Windows drive", () => {
    const g = { enforce: true, ideas: [{ ...ready, status: "doing" }] };
    const root = resolve(tmpdir());
    const otherDrive = root.slice(0, 1).toUpperCase() === "Z" ? "Y:" : "Z:";
    expect(decideWrite(g, `${otherDrive}/elsewhere/src/a.ts`, root).allow).toBe(false);
    expect(decideWrite(g, "../sibling/src/a.ts", root).allow).toBe(false);
    expect(decideWrite(g, "src/a.ts", root).allow).toBe(true);
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

// D31 migration: a graph written against the old lenient suffix rule can claim a
// bare file name. Exact matching unlocks nothing for such a claim, so the deny
// has to name the stale claim instead of reading as "no idea claims this file".
describe("stale claims from the old suffix rule", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function project() {
    const dir = mkdtempSync(join(tmpdir(), "gate-stale-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "");
    return dir;
  }

  it("says the claimed path does not exist, and names it", () => {
    const dir = project();
    const g = { enforce: true, ideas: [{ ...ready, status: "doing", code: [{ file: "a.ts" }] }] };
    const d = decideWrite(g, "src/a.ts", dir);
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("I-002:a.ts");
    expect(d.reason).toMatch(/不存在/);
    expect(d.reason).toMatch(/完整路径/);
  });

  it("still reads as an ordinary miss when every claim resolves", () => {
    const dir = project();
    const g = { enforce: true, ideas: [{ ...ready, status: "doing" }] };
    const d = decideWrite(g, "src/other.ts", dir);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/not in the doing idea/);
    expect(d.reason).not.toMatch(/不存在/);
  });
});

// D25: the graph must not carry a switch an agent can flip off. Turning the gate
// back ON is ordinary work; turning it OFF is the escape hatch, and the escape
// hatch is the parent-process env var a subcommand cannot set for its caller.
describe("enforce switch", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.AIDEV_GUARD;
  });

  function project(enforce: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "gate-enforce-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    const file = join(dir, "ideas", "graph.yaml");
    writeFileSync(file, `agent: cursor\nenforce: ${enforce}\nideas: []\n`);
    return { dir, file };
  }

  it("refuses to turn enforcement off from the CLI", () => {
    const { dir, file } = project(true);
    expect(main(["enforce", "off", "--project", dir])).not.toBe(0);
    expect(readFileSync(file, "utf8")).toMatch(/enforce: true/);
  });

  it("still turns enforcement back on, and that stays a one-word command", () => {
    const { dir, file } = project(false);
    expect(main(["enforce", "on", "--project", dir])).toBe(0);
    expect(readFileSync(file, "utf8")).toMatch(/enforce: true/);
  });

  it("leaves AIDEV_GUARD=off as the way through", () => {
    process.env.AIDEV_GUARD = "off";
    const d = decideWrite({ enforce: true, ideas: [] }, "src/a.ts");
    expect(d.allow).toBe(true);
    expect(d.reason).toMatch(/AIDEV_GUARD/);
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

  // D31: the live hook hands decideWrite whatever `path.relative` produced, so
  // the drive-letter escape has to be refused end to end, not just in the lib.
  it("denies a claimed file name reached from another drive or from outside", () => {
    const otherDrive = repo.slice(0, 1).toUpperCase() === "Z" ? "Y:" : "Z:";
    const crossDrive = run({
      tool_name: "Write",
      cwd: repo,
      tool_input: { path: `${otherDrive}\\elsewhere\\packages\\hook\\src\\snapshot.ts` },
    });
    expect(crossDrive.permission).toBe("deny");
    expect(crossDrive.user_message).toMatch(/项目根/);

    const shadowed = run({
      tool_name: "Write",
      cwd: repo,
      tool_input: { path: join(repo, "vendor", "packages", "hook", "src", "snapshot.ts") },
    });
    expect(shadowed.permission).toBe("deny");
  });

  it("extractWritePath only fires on write tools", () => {
    expect(isWriteTool("Read")).toBe(false);
    expect(extractWritePath("Write", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(extractWritePath("Read", { path: "src/a.ts" })).toBeNull();
  });
});

// The source itself is part of the deny message: gate-lib.mjs carried a UTF-8
// byte order mark, and the dash in two deny reasons had been mangled into a
// bare `?`, so the human reading the block saw a sentence with a hole in it.
describe("gate-lib source hygiene", () => {
  it("has no UTF-8 byte order mark", () => {
    const bytes = readFileSync(resolve("cursor-companion/gate-lib.mjs"));
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it("spells the dash in both deny reasons instead of a mojibake question mark", () => {
    const harness = decideWrite({ enforce: true, ideas: [] }, ".cursor/hooks/gate.mjs").reason;
    expect(harness).toContain("harness files are locked —");
    const idle = decideWrite({ enforce: true, ideas: [] }, "src/a.ts").reason;
    expect(idle).toContain("no idea is doing —");
  });
});

// SKIP_DIR anchored `.git` and `.cursor/companion` behind a second separator,
// which only a doubled slash could ever satisfy, so every write inside the git
// directory and inside the installed companion copy was logged as project work.
describe("record.mjs skip list", () => {
  const hook = resolve("cursor-companion/hooks/record.mjs");
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function record(cwd: string, rel: string) {
    const r = spawnSync(process.execPath, [hook], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({
        file_path: join(cwd, rel),
        edits: [{ old_string: "", new_string: "x\n" }],
      }),
    });
    expect(r.status).toBe(0);
  }

  it("records project code but not .git/ or .cursor/companion/", () => {
    const dir = mkdtempSync(join(tmpdir(), "rec-skip-"));
    dirs.push(dir);
    const log = join(dir, "ideas", "log.md");

    record(dir, ".git/COMMIT_EDITMSG");
    record(dir, ".cursor/companion/gate-lib.mjs");
    expect(existsSync(log)).toBe(false);

    record(dir, "src/a.ts");
    expect(readFileSync(log, "utf8")).toMatch(/file: src\/a\.ts/);
  });
});
