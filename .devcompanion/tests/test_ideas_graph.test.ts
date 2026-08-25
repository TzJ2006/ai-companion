import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import {
  check, frontier, findCycle, orphans, dependents, render, setStatus, load,
  graphPath, agentName, nameIsTaken,
  type Graph,
} from "../../claude-companion/ideas.js";
import { install, installHooks, statusOf, updateAll } from "../../claude-companion/install.js";
import { resolve } from "node:path";

// The idea-graph engine. Format: claude-companion/FORMAT.md
describe("idea graph", () => {
  let dir: string;
  const dirs: string[] = [];

  // A minimal well-formed graph: I-001 → I-002 → I-003 (the endpoint).
  const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-003]
ideas:
  - id: I-001
    name: "地基"
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
        lines: "1-20"
    verify: { command: "npx vitest run t.test.ts", pass: "exit 0" }
  - id: I-002
    name: "中间层"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/mid.ts
        symbol: mid
    verify: { command: "npx vitest run m.test.ts", pass: "exit 0" }
  - id: I-003
    name: "终点"
    status: todo
    needs: [I-002]
    what: W3
    why: Y3
    expected: E3
    how: H3
    why_this_way: T3
    future: F3
`;

  const graphOf = (text = yaml) => parseDocument(text).toJSON() as Graph;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ideas-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const base = 1;\n");
    writeFileSync(join(dir, "src", "mid.ts"), "export const mid = 2;\n");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("passes a well-formed graph", () => {
    const { errors, warnings } = check(graphOf(), dir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("frontier is todo ideas whose prerequisites are all done", () => {
    // I-002's only prerequisite is done; I-003 still waits on I-002.
    expect(frontier(graphOf()).map((i) => i.id)).toEqual(["I-002"]);
  });

  it("reports both edge directions", () => {
    const g = graphOf();
    expect(g.ideas[1].needs).toEqual(["I-001"]);
    expect(dependents(g, "I-002")).toEqual(["I-003"]);
    expect(dependents(g, "I-003")).toEqual([]);
  });

  it("catches a cycle", () => {
    const g = graphOf();
    g.ideas[0].needs = ["I-003"];
    expect(findCycle(g).length).toBeGreaterThan(0);
    expect(check(g, dir).errors.join()).toMatch(/cycle/);
  });

  it("catches an unknown prerequisite and a duplicate id", () => {
    const g = graphOf();
    g.ideas[1].needs = ["I-999"];
    g.ideas[2].id = "I-001";
    const { errors } = check(g, dir);
    expect(errors.join()).toMatch(/needs unknown idea "I-999"/);
    expect(errors.join()).toMatch(/duplicate id/);
  });

  it("refuses a done idea with no code or no verify", () => {
    const g = graphOf();
    g.ideas[2].status = "done";                    // I-003 has neither
    const { errors } = check(g, dir);
    expect(errors.join()).toMatch(/done but no `code`/);
    expect(errors.join()).toMatch(/done but no `verify`/);
  });

  it("refuses a done idea whose code file does not exist", () => {
    const g = graphOf();
    g.ideas[0].code = [{ file: "src/ghost.ts", lines: "1-2" }];
    expect(check(g, dir).errors.join()).toMatch(/code file not found — src\/ghost\.ts/);
  });

  it("requires a human signature before a manual check counts as done", () => {
    const g = graphOf();
    g.ideas[1].verify = { manual: "看起来对不对" };
    g.ideas[1].status = "done";
    expect(check(g, dir).errors.join()).toMatch(/signed_off/);

    g.ideas[1].verify.signed_off = "zt 2026-08-24";
    expect(check(g, dir).errors.join()).not.toMatch(/signed_off/);
  });

  it("warns about unanswered questions and dead-end ideas", () => {
    const g = graphOf();
    delete g.ideas[2].why_this_way;
    g.ideas.push({ id: "I-009", name: "孤儿", status: "todo", needs: [] });
    const { warnings } = check(g, dir);
    expect(warnings).toContain("I-003: unanswered — why_this_way");
    expect(orphans(g)).toContain("I-009");
    expect(warnings.join()).toMatch(/I-009: no endpoint depends on this/);
  });

  it("set writes status + a log entry, and keeps comments", () => {
    const file = join(dir, "graph.yaml");
    writeFileSync(file, `# keep me\n${yaml}`);
    const { doc, graph } = load(file);
    setStatus(doc, graph, "I-002", "doing", { by: "ccbuild", note: "started", date: "2026-08-24" });
    writeFileSync(file, String(doc));

    const after = readFileSync(file, "utf8");
    expect(after).toMatch(/# keep me/);
    const reloaded = load(file).graph;
    expect(reloaded.ideas[1].status).toBe("doing");
    expect(reloaded.ideas[1].log?.[0]).toMatchObject({ by: "ccbuild", note: "started" });
  });

  it("set refuses done without code + verify", () => {
    const { doc, graph } = (() => {
      const file = join(dir, "g2.yaml");
      writeFileSync(file, yaml);
      return load(file);
    })();
    expect(() => setStatus(doc, graph, "I-003", "done", { date: "2026-08-24" }))
      .toThrow(/cannot be done without `code`/);
  });

  it("renders names in the graph and all 8 answers in the detail", () => {
    const html = render(graphOf());
    expect(html).toContain('["地基"]');                    // graph shows names only
    expect(html).toContain('click n_I_001 call nodeClick("I-001")');
    expect(html).toContain("n_I_001 --> n_I_002");         // prerequisite arrow
    for (const label of ["是什么", "为什么有这个想法", "预期结果", "如何实现",
      "为什么这样实现", "代码在哪", "如何验证", "未来怎么用"]) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(html).toContain("src/base.ts:1-20");
    expect(html).toContain("尚未实现");                     // I-003 has no code yet
  });

  // Pan/zoom is behaviour, verified live in a browser; what a unit test can
  // lock is that the wiring it depends on is actually emitted.
  it("renders a pan/zoom viewport with its controls", () => {
    const html = render(graphOf());
    expect(html).toContain('<div class="viewport"><div class="canvas">');
    for (const action of ["out", "in", "fit", "reset"]) {
      expect(html).toContain(`data-zoom="${action}"`);
    }
    expect(html).toContain('class="zoom-level"');
    expect(html).toMatch(/addEventListener\("wheel"/);
    expect(html).toMatch(/addEventListener\("pointermove"/);
    expect(html).toMatch(/Math\.min\(1,/);          // fit shrinks, never enlarges
    expect(html).toMatch(/await mermaid\.run/);     // fit runs after the diagram exists
  });

  // Zoom must resize the SVG itself. A CSS scale() on the wrapper rasterises
  // the layer once and stretches that bitmap — which is what looked blurry.
  it("zooms by resizing the SVG, never by scaling a layer", () => {
    const html = render(graphOf());
    expect(html).toMatch(/n\.svg\.style\.width = n\.w \* k \+ "px"/);
    expect(html).toMatch(/viewBox\.baseVal/);                     // natural size from the viewBox
    expect(html).toMatch(/transform = `translate\(\$\{tx\}px, \$\{ty\}px\)`/);
    // The wrapper transform must carry translation only.
    const script = html.slice(html.indexOf("<script"));
    expect(script).not.toMatch(/transform\s*=\s*`[^`]*scale\(/);
  });

  it("detail links both to prerequisites and to dependents", () => {
    const html = render(graphOf());
    const card = html.slice(html.indexOf('id="I-002"'));
    const body = card.slice(0, card.indexOf("</section>"));
    expect(body).toMatch(/前置想法[\s\S]*data-goto="I-001"/);
    expect(body).toMatch(/它是这些想法的前置[\s\S]*data-goto="I-003"/);
  });

  // A repo can host several agents' companions. Claim the plain name when it is
  // free; take an agent-suffixed one when somebody else already has it.
  describe("filename claiming", () => {
    const ideasDir = () => join(dir, "ideas");

    it("takes the plain name when nothing is there", () => {
      expect(nameIsTaken(dir)).toBe(false);
      expect(graphPath(dir)).toBe(join(ideasDir(), "graph.yaml"));
      expect(agentName(dir, ".approved")).toBe(".approved");
      expect(agentName(dir, "log.md")).toBe("log.md");
    });

    it("keeps the plain name when the graph there is ours", () => {
      mkdirSync(ideasDir(), { recursive: true });
      writeFileSync(join(ideasDir(), "graph.yaml"), yaml);   // fixture carries agent: claude
      expect(nameIsTaken(dir)).toBe(false);
      expect(graphPath(dir)).toBe(join(ideasDir(), "graph.yaml"));
    });

    it("suffixes everything when another agent holds the plain name", () => {
      mkdirSync(ideasDir(), { recursive: true });
      writeFileSync(join(ideasDir(), "graph.yaml"), "version: 1\nagent: cursor\nideas: []\n");
      expect(nameIsTaken(dir)).toBe(true);
      expect(graphPath(dir)).toBe(join(ideasDir(), "graph.claude.yaml"));
      expect(agentName(dir, ".approved")).toBe(".approved.claude");   // dotfile: appended
      expect(agentName(dir, "log.md")).toBe("log.claude.md");         // extension: inserted
    });

    it("an unmarked plain graph counts as someone else's — never clobber it", () => {
      mkdirSync(ideasDir(), { recursive: true });
      writeFileSync(join(ideasDir(), "graph.yaml"), "version: 1\nideas: []\n");
      expect(nameIsTaken(dir)).toBe(true);
    });

    it("once suffixed, stays suffixed even if the plain name frees up", () => {
      mkdirSync(ideasDir(), { recursive: true });
      writeFileSync(join(ideasDir(), "graph.claude.yaml"), yaml);
      expect(nameIsTaken(dir)).toBe(true);   // no plain file at all, but ours is suffixed
      expect(graphPath(dir)).toBe(join(ideasDir(), "graph.claude.yaml"));
    });

    it("install seeds the ownership marker, so the choice does not flip", () => {
      install(dir);
      expect(readFileSync(graphPath(dir), "utf8")).toMatch(/^agent: claude$/m);
      const first = graphPath(dir);
      expect(graphPath(dir)).toBe(first);   // stable on the next resolve
    });
  });

  // Installing into a repo that another tool already writes commands into must
  // not clobber that tool's files.
  it("install seeds a graph but refuses to overwrite a command it does not own", () => {
    const commands = join(dir, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, "ccgraph.md"), "someone else's command\n");

    expect(install(dir).skipped).toContain("ccgraph.md");
    expect(readFileSync(join(commands, "ccgraph.md"), "utf8")).toBe("someone else's command\n");
    expect(readFileSync(graphPath(dir), "utf8")).toMatch(/ideas: \[\]/);
    // Per-machine state stays out of git; the graph and the log stay in.
    const ignored = readFileSync(join(dir, "ideas", ".gitignore"), "utf8");
    expect(ignored).toMatch(/\.scan-todo/);
    expect(ignored).toMatch(/\.approved/);
    expect(ignored).not.toMatch(/graph\.yaml|log\.md/);

    // --force is the explicit opt-in, and it rewrites the companion path.
    install(dir, true);
    const after = readFileSync(join(commands, "ccgraph.md"), "utf8");
    expect(after).toMatch(/ideas\.ts check/);
    expect(after).not.toMatch(/(?<!\/)claude-companion\/ideas\.ts/);   // rewritten to absolute
  });

  // Command files are copies and copies go stale. The engine is not copied, so
  // it never does — this only has to keep the five command files honest.
  describe("keeping installs up to date", () => {
    it("reports current / stale / missing / foreign per command file", () => {
      install(dir);
      expect(Object.values(statusOf(dir))).toEqual(
        Array(Object.keys(statusOf(dir)).length).fill("current"));

      const commands = join(dir, ".claude", "commands");
      writeFileSync(join(commands, "ccfix.md"), readFileSync(join(commands, "ccfix.md"), "utf8") + "\ndrift\n");
      rmSync(join(commands, "ccbuild.md"));
      writeFileSync(join(commands, "ccgraph.md"), "someone else's command\n");

      const report = statusOf(dir);
      expect(report["ccfix.md"]).toBe("stale");
      expect(report["ccbuild.md"]).toBe("missing");
      expect(report["ccgraph.md"]).toBe("foreign");
      expect(report["ccscan.md"]).toBe("current");
    });

    it("does not call a file stale just because the line endings differ", () => {
      // Windows git hands out CRLF sources while installs are LF. Comparing raw
      // bytes would mark every install stale forever and make --status useless.
      install(dir);
      const file = join(dir, ".claude", "commands", "ccscan.md");
      const text = readFileSync(file, "utf8");
      writeFileSync(file, text.replaceAll("\r\n", "\n"));            // installed as LF
      expect(statusOf(dir)["ccscan.md"]).toBe("current");
      writeFileSync(file, text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));  // and as CRLF
      expect(statusOf(dir)["ccscan.md"]).toBe("current");
    });

    it("updateAll refreshes only what drifted, and leaves foreign files alone", () => {
      install(dir);
      const commands = join(dir, ".claude", "commands");
      writeFileSync(join(commands, "ccfix.md"), "stale\n// ideas.ts\n");
      writeFileSync(join(commands, "ccgraph.md"), "someone else's command\n");

      const result = updateAll().find((r) => r.target === resolve(dir));
      expect(result?.changed).toEqual(["ccfix.md"]);
      expect(statusOf(dir)["ccfix.md"]).toBe("current");
      expect(readFileSync(join(commands, "ccgraph.md"), "utf8")).toBe("someone else's command\n");
    });
  });

  it("registers the guard on three events, keeps other tools' hooks, and is idempotent", () => {
    const settingsPath = join(dir, ".claude", "settings.json");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "node other-tool.js" }] }],
      },
    }));

    installHooks(dir, "/companion");
    installHooks(dir, "/companion");   // twice — must not accumulate

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const commandsOf = (event: string) =>
      (settings.hooks[event] ?? []).flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));

    expect(settings.permissions.allow).toEqual(["Read"]);              // untouched
    expect(commandsOf("PostToolUse")).toContain("node other-tool.js"); // the other tool survives
    for (const event of ["PreToolUse", "PostToolUse", "Stop"]) {
      expect(commandsOf(event).filter((c: string) => c.includes("guard.ts"))).toHaveLength(1);
    }
    expect(settings.hooks.Stop[0].matcher).toBeUndefined();            // Stop takes no matcher
  });
});
