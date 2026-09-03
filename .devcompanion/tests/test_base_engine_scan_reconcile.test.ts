import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  readWorklist, strike, doneFile, worklistFile, listProjectFiles,
  reconcileWorklist, worklistDone,
} from "../../companion/ideas.js";

// H7 — 扫描清单只在第一次 `scan` 时建一次，之后再没跟真实文件列表对过账。
// 「已读」是拿活文件数减清单剩余数算出来的，所以清单建好之后新增的文件
// 一个都没被读过，却全被算成读过了。R7 存在的唯一理由就是让这个数字没法
// 自报（D12），而它当时是假的。
//
// 裁决依据：D29（扫的是现在真实存在的文件，包括还没提交的新文件）
// 与 D12（读过的证明来自真实 Read 划掉的那一行，不是减法）。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = join(ROOT, "companion", "ideas.ts");

let project: string;

/** 跑一次真的 `ideas.ts scan`，返回它打印出来的东西。 */
function scan(...extra: string[]): string {
  const r = spawnSync("npx", ["tsx", ENGINE, "scan", "--project", project, "--n", "0", ...extra],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
  expect(r.status, `scan 没跑起来：${r.stderr}`).toBe(0);
  return r.stdout;
}

/** 清单文件里现在写着哪些路径（曾经在清单上的全部文件）。 */
function checklist(): string[] {
  return readFileSync(worklistFile(project), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

function write(rel: string, text: string): void {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), text);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "scan-reconcile-"));
  write("src/a.ts", "a");
  write("src/b.ts", "b");
});
afterEach(() => { rmSync(project, { recursive: true, force: true }); });

describe("H7 扫描清单每次都跟真实文件列表对账", () => {
  it("清单建好之后新出现的文件算未读，不算已读", () => {
    scan();                                              // 清单：a、b
    strike(project, join(project, "src/a.ts"));
    strike(project, join(project, "src/b.ts"));

    write("src/c.ts", "c");                              // 第一次扫描之后才有的文件
    const out = scan();

    expect(readWorklist(project)).toEqual(["src/c.ts"]);  // 没读过，就得在剩余里
    expect(out).toContain("已读 2/3");                    // 不是 3/3
    expect(out).not.toContain("全部读完");
  }, 120_000);

  it("对账不会把真读过的文件重新变成未读", () => {
    scan();
    strike(project, join(project, "src/a.ts"));
    const before = readFileSync(doneFile(project), "utf8");

    write("src/c.ts", "c");
    scan();

    // 划掉的记录一行不少，a 也不会重新出现在剩余里。
    expect(readFileSync(doneFile(project), "utf8")).toContain(before.trim());
    expect(readWorklist(project)).not.toContain("src/a.ts");
    expect(readWorklist(project).sort()).toEqual(["src/b.ts", "src/c.ts"]);
  }, 120_000);

  it("新出现的文件单独报出来，人一眼能看见扫描不完整了", () => {
    scan();
    strike(project, join(project, "src/a.ts"));
    strike(project, join(project, "src/b.ts"));

    write("src/c.ts", "c");
    const out = scan();

    expect(out).toMatch(/新出现/);
    expect(out).toContain("src/c.ts");
  }, 120_000);

  // 上面四条走的是真的命令行；这一条直接压函数，把「已读是数出来的、不是减出来的」
  // 单独钉住 —— 清单和文件树一旦不一致，减法给出的正是那个假数字。
  it("已读的数目数的是真被划掉的那些，清单跟文件树不一致时也不虚报", () => {
    reconcileWorklist(project, listProjectFiles(project));   // 清单：a、b
    strike(project, join(project, "src/a.ts"));
    expect(worklistDone(project)).toBe(1);

    write("src/c.ts", "c");
    const { added, removed } = reconcileWorklist(project, listProjectFiles(project));

    expect(added).toEqual(["src/c.ts"]);
    expect(removed).toEqual([]);
    expect(worklistDone(project)).toBe(1);                   // 不是 2：c 没人读过
    expect(readWorklist(project).sort()).toEqual(["src/b.ts", "src/c.ts"]);
  });

  it("消失的文件从清单上掉下去，不再拖着总数", () => {
    scan();
    expect(checklist()).toContain("src/b.ts");

    rmSync(join(project, "src/b.ts"));
    const out = scan();

    expect(checklist()).toEqual(["src/a.ts"]);
    expect(out).toContain("已读 0/1");
  }, 120_000);
});
