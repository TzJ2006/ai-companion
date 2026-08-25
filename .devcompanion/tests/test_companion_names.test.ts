import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT, agentName, decideWrite, graphPath, ledgerNames, main, nameIsTaken,
} from "../../cursor-companion/ideas.ts";

describe("agent-suffixed ledger names", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function project(): string {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    return dir;
  }

  it("uses the plain names when ideas/ is empty", () => {
    const dir = project();
    expect(nameIsTaken(dir)).toBe(false);
    expect(ledgerNames(dir)).toEqual({ graph: "graph.yaml", log: "log.md", html: "graph.html" });
    expect(graphPath(dir)).toBe(join(dir, "ideas", "graph.yaml"));
    expect(AGENT).toBe("cursor");
  });

  it("claims an unstamped leftover graph.yaml", () => {
    const dir = project();
    writeFileSync(join(dir, "ideas", "graph.yaml"), "version: 1\nideas: []\n");
    expect(nameIsTaken(dir)).toBe(false);
    expect(agentName(dir, "graph.yaml")).toBe("graph.yaml");
  });

  it("suffixes .cursor when graph.yaml belongs to another agent", () => {
    const dir = project();
    writeFileSync(join(dir, "ideas", "graph.yaml"), "version: 1\nagent: claude\nideas: []\n");
    expect(nameIsTaken(dir)).toBe(true);
    expect(ledgerNames(dir)).toEqual({
      graph: "graph.cursor.yaml",
      log: "log.cursor.md",
      html: "graph.cursor.html",
    });
  });

  it("keeps the suffix once graph.cursor.yaml exists", () => {
    const dir = project();
    writeFileSync(join(dir, "ideas", "graph.cursor.yaml"), "version: 1\nagent: cursor\nideas: []\n");
    expect(ledgerNames(dir).graph).toBe("graph.cursor.yaml");
  });

  it("init does not overwrite another agent's graph.yaml", () => {
    const dir = project();
    const other = "version: 1\nagent: claude\nideas: []\n";
    writeFileSync(join(dir, "ideas", "graph.yaml"), other);
    expect(main(["init", "--project", dir])).toBe(0);
    expect(readFileSync(join(dir, "ideas", "graph.yaml"), "utf8")).toBe(other);
    expect(existsSync(join(dir, "ideas", "graph.cursor.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "ideas", "graph.cursor.yaml"), "utf8")).toMatch(/agent: cursor/);
    expect(existsSync(join(dir, "ideas", "log.cursor.md"))).toBe(true);
  });

  it("paths prints the resolved ledger files", () => {
    const dir = project();
    writeFileSync(join(dir, "ideas", "graph.yaml"), "agent: codex\nideas: []\n");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => { lines.push(String(s)); };
    try { expect(main(["paths", "--project", dir])).toBe(0); }
    finally { console.log = orig; }
    const out = lines.join("\n");
    expect(out).toMatch(/graph\s+ideas\/graph\.cursor\.yaml/);
    expect(out).toMatch(/html\s+ideas\/graph\.cursor\.html/);
    expect(out).toMatch(/log\s+ideas\/log\.cursor\.md/);
  });

  it("the write-gate allows only this companion's ledger, not the other agent's", () => {
    const dir = project();
    writeFileSync(join(dir, "ideas", "graph.yaml"), "agent: claude\nideas: []\n");
    const g = { enforce: true, ideas: [] };
    expect(decideWrite(g, "ideas/graph.cursor.yaml", dir).allow).toBe(true);
    expect(decideWrite(g, "ideas/log.cursor.md", dir).allow).toBe(true);
    expect(decideWrite(g, "ideas/graph.yaml", dir).allow).toBe(false);
    expect(decideWrite(g, "ideas/log.md", dir).allow).toBe(false);
  });
});
