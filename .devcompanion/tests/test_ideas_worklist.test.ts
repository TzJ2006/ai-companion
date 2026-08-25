import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { readWorklist, writeWorklist, pruneWorklist } from "../../claude-companion/ideas.js";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "../..");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const IDEAS = pathToFileURL(join(ROOT, "claude-companion/ideas.ts")).href;

// The scan worklist is written by one hook process per Read. Parallel Reads in
// one message mean parallel hook processes, each doing read → filter → write on
// the same file. Without a lock the writes race: strikes come back to life
// (last writer wins) and a reader can catch a half-written file, leaving a
// corrupt残行 that no Read can ever cross off. See claude-companion/ideas.ts.
describe("scan worklist under concurrency", () => {
  let dir: string;
  const dirs: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worklist-"));
    dirs.push(dir);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("parallel strikes lose nothing and corrupt nothing", { timeout: 60_000 }, async () => {
    const WORKERS = 4, EACH = 50;
    const files = Array.from({ length: WORKERS * EACH }, (_, n) => `src/f${n}.ts`);
    writeWorklist(dir, files);

    // Each worker strikes an interleaved slice, so neighbours in the file are
    // owned by different processes and every write overlaps someone else's.
    // The ready/go files are a barrier: all four compile and load first, then
    // start their strike loops at the same moment — no barrier, no overlap,
    // and a race test that never races proves nothing.
    const driver = join(dir, "driver.ts");
    writeFileSync(driver, `
      import { writeFileSync, existsSync } from "node:fs";
      import { strike } from ${JSON.stringify(IDEAS)};
      const [dir, idxS] = process.argv.slice(2);
      const idx = Number(idxS);
      writeFileSync(\`\${dir}/ready-\${idx}\`, "");
      while (!existsSync(\`\${dir}/go\`)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
      for (let i = 0; i < ${EACH}; i++) strike(dir, \`\${dir}/src/f\${i * ${WORKERS} + idx}.ts\`);
    `);

    let spawnError: unknown = null;
    const workers = Promise.all(Array.from({ length: WORKERS }, (_, i) =>
      run(TSX, [driver, dir, String(i)]))).catch((e) => { spawnError = e; });
    while (Array.from({ length: WORKERS }, (_, i) => `ready-${i}`).some((f) => !existsSync(join(dir, f)))) {
      if (spawnError) throw spawnError;   // a worker died before the barrier — don't wait forever
      await new Promise((r) => setTimeout(r, 20));
    }
    writeFileSync(join(dir, "go"), "");
    await workers;
    if (spawnError) throw spawnError;

    // Every file was struck exactly once, so a correct ledger is empty. Any
    // survivor is a lost update; any line not in the original list is corruption.
    expect(readWorklist(dir)).toEqual([]);
  });

  // A line that matches no project file can never be struck: Read on a
  // nonexistent path errors before the hook fires, and R7 forbids hand edits.
  // Pruning against listProjectFiles() is the one legal way out.
  it("prune drops lines no Read can ever strike, and keeps everything else", () => {
    writeWorklist(dir, ["src/a.ts", "ift", "src/gone.ts", "SRC/B.TS"]);
    const dropped = pruneWorklist(dir, ["src/a.ts", "src/b.ts"]);
    expect(dropped).toEqual(["ift", "src/gone.ts"]);
    // strike matches case-insensitively, so a case-differing line is strikeable — keep it.
    expect(readWorklist(dir)).toEqual(["src/a.ts", "SRC/B.TS"]);
  });

  it("prune touches nothing when no scan is running", () => {
    expect(pruneWorklist(dir, ["src/a.ts"])).toEqual([]);
    expect(existsSync(join(dir, "ideas"))).toBe(false);
  });

  it("scan reports and cleans the debris without losing progress", () => {
    // Not a git repo, so listProjectFiles walks. b.ts was already read and
    // struck; "ift" is the tail a pre-lock write race left behind.
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "");
    writeFileSync(join(dir, "src/b.ts"), "");
    writeWorklist(dir, ["src/a.ts", "ift"]);

    const out = execFileSync(TSX, [join(ROOT, "claude-companion/ideas.ts"), "scan", "--project", dir],
      { encoding: "utf8" });
    expect(out).toMatch(/清掉 1 个.*残行.*ift/);
    expect(out).toMatch(/已读 1\/2/);                       // 残行不再把进度算负
    expect(readWorklist(dir)).toEqual(["src/a.ts"]);        // 真正欠着的读一个不少
  });
});
