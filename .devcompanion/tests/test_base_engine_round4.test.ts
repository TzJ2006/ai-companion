import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  load, graphPath, requestApproval, applyApproval, decideProductWrite,
  isChainedCommand, chainedCommandRefusal, runCheck,
} from "../../companion/ideas.js";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// Round 4 — the test-file branch of decideProductWrite used to be the one
// authorization that rested on graph prose alone: `verify.test_files` is
// editable by design (the graph rule guards only status and signed_off), so an
// agent could append ANY path — the guard's own source, the engine, the host
// config — to some doing idea and then write that file freely. D8 says the
// failing test is the legal FIRST move (no RED required), but "first move"
// never meant "unreviewed list". The plan snapshot (D7) already covers
// `verify`, so a current plan approval means a human saw that exact file list,
// and appending a path self-destructs the approval. D17 already requires a
// plan approval before an idea may reach doing at all, so the sanctioned loop
// pays nothing for this.
describe("companion round-4: test_files is not a self-issued write permit (D7/D8/D17)", () => {
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

  const meta = { date: "2026-09-02" };
  const loadGraph = () => load(graphPath(dir)).graph;
  const ev = (over: Partial<NormalizedEvent>): NormalizedEvent =>
    ({ event: "pre-write", tool: "Edit", cwd: dir, ...over });

  /** 人真的回了一句「批准 CC-…」—— D17 要求开工前就有这一步。 */
  const approvePlan = (id = "I-001") => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", [id]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
  };

  /** An ordinary graph edit — exactly what an agent is allowed to do to prose. */
  const appendTestFile = (path: string) => {
    const file = join(dir, "ideas", "graph.yaml");
    writeFileSync(file, readFileSync(file, "utf8")
      .replace("test_files: [ tests/a.test.txt ]", `test_files: [ tests/a.test.txt, ${path} ]`));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "round4-"));
    dirs.push(dir);
    for (const sub of ["ideas", "tests", "src", "companion"]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert\n");
    writeFileSync(join(dir, "companion", "guard.ts"), "// the guard itself\n");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── the hole ─────────────────────────────────────────────────────────────

  // 2026-09-16（I-146）：认领就是写的许可 —— 路径先写进图（D16），写进去了就能写。
  // 守卫能拿八问来核对的只有第六、七问的路径；批准这道门已经拆了。
  it("a path appended to a doing idea's test_files becomes writable, and the guard agrees", () => {
    expect(decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt")).allow).toBe(true);
    expect(decideProductWrite(dir, loadGraph(), join(dir, "companion", "guard.ts")).allow).toBe(false);

    appendTestFile("companion/guard.ts");

    const v = decideProductWrite(dir, loadGraph(), join(dir, "companion", "guard.ts"));
    expect(v.allow, v.reason).toBe(true);
    expect(decide(ev({ paths: [join(dir, "companion", "guard.ts")] }), dir).allow).toBe(true);
    expect(decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt")).allow).toBe(true);
  });

  it("no plan approval at all: the idea's own declared test file is writable", () => {
    const v = decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt"));
    expect(v.allow, v.reason).toBe(true);
  });

  it("re-approving the amended plan is the only way in — and then a human really saw the path", () => {
    appendTestFile("companion/guard.ts");
    approvePlan();                                  // 人看了改过的清单才签
    expect(decideProductWrite(dir, loadGraph(), join(dir, "companion", "guard.ts")).allow).toBe(true);
  });

  // ── the sanctioned loop must still work ──────────────────────────────────

  it("no approval, no RED anywhere: both the test file and the implementation file are writable", () => {
    const v = decideProductWrite(dir, loadGraph(), join(dir, "tests", "a.test.txt"));
    expect(v.allow, v.reason).toBe(true);
    expect(decide(ev({ paths: [join(dir, "tests", "a.test.txt")] }), dir).allow).toBe(true);
    // 2026-09-16（I-146）：实现文件不再等 RED —— 先红后绿是 ccbuild 的建议，done 才查绿（D20）。
    expect(decideProductWrite(dir, loadGraph(), join(dir, "src", "a.ts")).allow).toBe(true);
    // 没人认领的文件照旧拒（D16）。
    expect(decideProductWrite(dir, loadGraph(), join(dir, "src", "unclaimed.ts")).allow).toBe(false);
  });

  it("does not over-block: the ledger stays writable and an ordinary graph edit still passes", () => {
    expect(decideProductWrite(dir, loadGraph(), join(dir, "ideas", "log.md")).allow).toBe(true);
    expect(decideProductWrite(dir, loadGraph(), join(dir, "ideas", "graph.yaml")).allow).toBe(true);
    expect(decide(ev({ paths: [graphPath(dir)], edit: { old_string: "W", new_string: "W2" } }), dir).allow).toBe(true);
  });
});

// ── one rule, one definition (D11) ─────────────────────────────────────────
// The chained-command screen answers the same question at two doors: the guard
// refuses to HONOUR a declared `verify.command` that carries a second command,
// and `run-check` refuses to SPAWN one. D11 allows a rule exactly one
// implementation, and two copies that agree today are precisely how the three
// engines forked — nothing was watching the moment they stopped agreeing.
// The engine owns both halves of this rule (the predicate `isChainedCommand`
// and the words `chainedCommandRefusal`) because guard.ts imports ideas.ts and
// not the other way round. While guard.ts still carries its own
// `CHAINED_COMMAND`, this suite pins the two copies to the same answer on every
// metacharacter; the moment the guard imports the engine's predicate instead,
// the same suite starts demanding that no second definition come back.
describe("companion round-4: the chained-command rule has one definition (D11/D21/D28)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
  const guardSource = readFileSync(join(ROOT, "companion", "guard.ts"), "utf8");

  /** Turn the TEXT of a regex literal into a live RegExp. */
  const asRegExp = (literal: string) => {
    const end = literal.lastIndexOf("/");
    return new RegExp(literal.slice(1, end), literal.slice(end + 1));
  };

  /** The guard's OWN chained-command definition, if it still has one: the
   *  constant its declared-verify door tests, plus any constant whose name says
   *  "chain" — a rename must not hide the second copy. */
  type OwnRule = { name: string; decl: string; literal: string; re: RegExp };
  const guardOwnChainRule = (source: string): OwnRule | null => {
    const names: string[] = [];
    const use = /declared\s*&&\s*([A-Za-z_$][\w$]*)\.test\(\s*command\s*\)/.exec(source);
    if (use) names.push(use[1]);
    for (const m of source.matchAll(/const\s+([A-Za-z_$][\w$]*CHAIN[\w$]*)\s*=/gi)) names.push(m[1]);
    for (const name of new Set(names)) {
      const decl = new RegExp(
        String.raw`const\s+${name}\s*=\s*(/(?:\\.|\[[^\]]*\]|[^/\\\r\n])+/[a-z]*)\s*;`).exec(source);
      if (decl) return { name, decl: decl[0], literal: decl[1], re: asRegExp(decl[1]) };
    }
    return null;
  };

  /** Does the guard take the rule from the engine instead of restating it? */
  const usesEngineRule = /\bisChainedCommand\b|\bchainedCommandRefusal\b/.test(guardSource);

  /** One sample per metacharacter the rule turns on, plus the ordinary verify
   *  commands it must keep letting through. Any narrowing OR widening of one
   *  copy shows up here as a disagreement. */
  const CORPUS = [
    "a; b", "a && b", "a || b", "a | b", "a & b", "a > out.txt", "a < in.txt",
    "a 2>&1", "a\nb", "a\rb", "a $(b)", "a `b`", "a;", "npx vitest run | head -5",
    "npx vitest run", "npx vitest run --dir .devcompanion/tests",
    "node checker.cjs", "pytest -q tests/a_test.py", "npm run test:unit",
    "npx vitest run --exclude '**/x.test.ts'", "cargo test -- --nocapture",
  ];

  it("the engine exports the whole rule — predicate and words — under one name", () => {
    expect(typeof isChainedCommand).toBe("function");
    expect(typeof chainedCommandRefusal).toBe("function");
    expect(chainedCommandRefusal({ id: "I-001", name: "想法" }, "node checker.cjs")).toBeNull();
    const refusal = chainedCommandRefusal({ id: "I-001", name: "想法" }, "node checker.cjs && rm -rf tmp");
    expect(refusal).toMatch(/D21\/D28/);
    expect(refusal).toContain("I-001");
  });

  it("guard and engine give the same answer on every metacharacter", () => {
    const own = guardOwnChainRule(guardSource);
    if (usesEngineRule) {
      // Single source reached: the second definition must not come back.
      expect(own, `guard.ts 既调引擎的谓词，又留着自己的 ${own?.name} —— 两份定义就是 D11 拦的那种漂移`)
        .toBeNull();
      return;
    }
    // Still two copies. They may not differ by one character.
    expect(own, "guard.ts 里既找不到引擎的谓词，也找不到它自己那份串联判断").not.toBeNull();
    for (const sample of CORPUS) {
      expect(own!.re.test(sample), `「${sample}」`).toBe(isChainedCommand(sample));
    }
  });

  it("the divergence detector is not vacuous: a narrowed copy is caught", () => {
    // Mutate the guard's REAL declaration where it still has one, so the check
    // is proven against the shape actually in the file rather than a mock; once
    // the duplicate is gone there is nothing left to mutate but the shape it had.
    const own = guardOwnChainRule(guardSource);
    const diverged = own
      ? guardSource.replace(own.decl, own.decl.replace(own.literal, "/[;]/"))
      : "const CHAINED_COMMAND = /[;]/;\nif (declared && CHAINED_COMMAND.test(command)) {}\n";
    expect(diverged).not.toBe(guardSource);         // the mutation really landed

    const drifted = guardOwnChainRule(diverged);
    expect(drifted).not.toBeNull();
    expect(drifted!.re.source).toBe("[;]");
    const disagreements = CORPUS.filter((s) => drifted!.re.test(s) !== isChainedCommand(s));
    expect(disagreements).toContain("a && b");
  });

  // ── the same question asked of both doors, with no source parsing at all ──

  describe("both doors, one verdict", () => {
    let dir: string;
    const dirs: string[] = [];
    const meta = { date: "2026-09-02" };

    const graphYaml = (command: string) => `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "带验证命令的想法"
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
      command: "${command}"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

    /** Plant the command in the graph and let a human really approve the plan. */
    const plant = (command: string) => {
      writeFileSync(join(dir, "ideas", "graph.yaml"), graphYaml(command));
      const graph = load(graphPath(dir)).graph;
      const { challenge } = requestApproval(dir, graph, "plan", ["I-001"]);
      expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
      return load(graphPath(dir)).graph;
    };

    const shell = (command: string): NormalizedEvent => ({ event: "shell", tool: "Bash", command, cwd: dir });

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "round4-chain-"));
      dirs.push(dir);
      for (const sub of ["ideas", "tests", "src"]) mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, "tests", "a.test.txt"), "assert\n");
    });
    afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

    // One sample per metacharacter, so a copy narrowed by a single class is
    // caught here too — with no source parsing, purely on what the doors do.
    // The approval is REAL and current, which is the point: it is what makes a
    // diverged guard say yes, and no approval buys a chain at either door.
    for (const command of [
      "node a.cjs && node b.cjs", "node a.cjs; node b.cjs", "node a.cjs | tee log.txt",
      "node a.cjs > out.txt", "node a.cjs < in.txt", "node a.cjs $(id)", "node a.cjs `id`",
    ]) {
      it(`refused at the guard door AND at run-check, approval or not: ${command}`, () => {
        const graph = plant(command);                 // 人批过这条计划了
        const verdict = decide(shell(command), dir);
        expect(verdict.allow).toBe(false);
        expect(verdict.reason, `守卫拦下了，但理由不是串联：${verdict.reason}`).toMatch(/第二条命令/);
        expect(() => runCheck(dir, graph, "I-001", "red")).toThrow(/第二条命令/);
      });
    }

    it("does not over-block: the same idea's single-command verify still runs at both doors", () => {
      const command = "node checker.cjs";
      const graph = plant(command);

      expect(decide(shell(command), dir).allow, decide(shell(command), dir).reason).toBe(true);
      expect(chainedCommandRefusal(graph.ideas[0], command)).toBeNull();
      // 图和账本照旧可写 —— 这条规则只管 verify.command 的形状。
      expect(decideProductWrite(dir, graph, join(dir, "ideas", "log.md")).allow).toBe(true);
    });
  });
});
