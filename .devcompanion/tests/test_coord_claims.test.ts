import { afterEach, expect, it } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import * as api from "../../companion/coordination.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODULE = join(ROOT, "companion", "coordination.ts");
const dirs: string[] = [], children: ChildProcess[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "coord-claims-")); dirs.push(dir);
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src", "a.ts"), "a"); writeFileSync(join(dir, "src", "b.ts"), "b");
  const runtime = join(dir, "ideas", ".runtime");
  const a = api.joinSession(runtime, "A", "join-a").session, b = api.joinSession(runtime, "B", "join-b").session;
  return { dir, runtime, a, b };
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(p => new Promise<void>(done => {
    if (p.exitCode !== null || p.signalCode !== null) return done();
    p.once("exit", () => done()); p.kill();
  })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("two processes racing for one file have exactly one winner", async () => {
  const { dir, runtime, a, b } = setup();
  const jobs = [a, b].map(session => {
    const p = spawn(process.execPath, ["--import", "tsx", "-e", `
      const api=require(process.argv[1]);const input=JSON.parse(process.argv[2]);
      process.send('ready');process.once('message',()=>{
        try{const e=api.claimFiles(input.runtime,input.dir,input.session,['src/a.ts'],'实现功能',input.session+'-claim');
          process.send({ok:true,claimId:e.claimId});}
        catch(e){process.send({ok:false,error:e.message});}
        process.disconnect();});`, MODULE, JSON.stringify({ dir, runtime, session })],
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    children.push(p);
    const ready = new Promise<void>(ok => p.once("message", () => ok()));
    const answer = new Promise<{ ok: boolean; error?: string }>((ok, no) => {
      p.on("message", m => { if (typeof m === "object") ok(m as never); });
      p.once("error", no); p.once("exit", code => { if (code !== 0) no(new Error(`worker exited ${code}`)); });
    });
    return { p, ready, answer };
  });
  await Promise.all(jobs.map(j => j.ready)); jobs.forEach(j => j.p.send("go"));
  const results = await Promise.all(jobs.map(j => j.answer));
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.find(r => !r.ok)?.error).toMatch(/占用|claimed/);
  expect(api.readEvents(runtime).filter(e => e.request.type === "claim")).toHaveLength(1);
}, 15_000);

it("claims whole batches or nothing, and releases only the matching owner's claim", () => {
  const { dir, runtime, a, b } = setup();
  const first = api.claimFiles(runtime, dir, a, ["src/a.ts"], "修改 A", "a-claim");
  expect(api.claimFiles(runtime, dir, a, ["src/a.ts"], "修改 A", "a-claim")).toEqual(first);
  expect(() => api.claimFiles(runtime, dir, b, ["src/b.ts", "src/a.ts"], "一起改", "batch")).toThrow(/占用|claimed/);
  const second = api.claimFiles(runtime, dir, b, ["src/b.ts"], "修改 B", "b-claim");
  expect(second.claimId).not.toBe(first.claimId);
  expect(() => api.releaseClaim(runtime, b, first.claimId!, "越权", "bad-release")).toThrow(/持有者|owner/);
  api.releaseClaim(runtime, a, first.claimId!, "修改完成，已停止写入", "release-a");
  const third = api.claimFiles(runtime, dir, b, ["src/a.ts"], "接着改", "b-next");
  expect(third.claimId).not.toBe(first.claimId);
  expect(() => api.releaseClaim(runtime, a, first.claimId!, "旧消息", "stale-release")).toThrow(/认领|claim/);
});

it("canonical paths prevent aliases, protected paths and hard links from escaping ownership", () => {
  const { dir, runtime, a, b } = setup();
  symlinkSync(join(dir, "src"), join(dir, "alias"), process.platform === "win32" ? "junction" : "dir");
  const file = "src/a.ts";
  api.claimFiles(runtime, dir, a, [file], "修改 A", "a-claim");
  for (const alias of [join(dir, file), "alias/a.ts", "src/../src/a.ts"]) {
    expect(() => api.claimFiles(runtime, dir, b, [alias], "撞车", `alias-${Math.random()}`)).toThrow(/占用|claimed/);
  }
  if (process.platform === "win32") expect(() => api.claimFiles(runtime, dir, b, ["SRC/A.TS"], "撞车", "case")).toThrow(/占用|claimed/);
  for (const path of ["../outside.ts", dir, "src", ".git/index", "ideas/.runtime/coord/events.jsonl", "ideas/graph.yaml", "ideas/graph.html"]) {
    expect(() => api.canonicalTarget(dir, path)).toThrow();
  }
  linkSync(join(dir, "src", "b.ts"), join(dir, "src", "hard.ts"));
  expect(() => api.canonicalTarget(dir, "src/b.ts")).toThrow(/硬链接|hard link/);
  expect(() => api.canonicalTarget(dir, "src/hard.ts")).toThrow(/硬链接|hard link/);
  expect(api.canonicalTarget(dir, "alias/new.ts")).toBe("src/new.ts");
});

it("takeover is explicit, compares the old claim id, and records the new owner in one event", () => {
  const { dir, runtime, a, b } = setup();
  const first = api.claimFiles(runtime, dir, a, ["src/a.ts"], "原任务", "a-claim");
  expect(() => api.takeoverClaim(runtime, b, first.claimId!, "接管", false, "take")).toThrow(/停止|stopped/);
  const next = api.takeoverClaim(runtime, b, first.claimId!, "旧助手和写入已结束", true, "take");
  expect(next.claimId).not.toBe(first.claimId);
  expect(api.takeoverClaim(runtime, b, first.claimId!, "旧助手和写入已结束", true, "take")).toEqual(next);
  expect(() => api.takeoverClaim(runtime, a, first.claimId!, "过期请求", true, "old-take")).toThrow(/认领|claim/);
  expect(() => api.claimFiles(runtime, dir, a, ["src/a.ts"], "恢复旧任务", "old-resume")).toThrow(/占用|claimed/);
  const messages = api.readInbox(runtime, a).events;
  expect(messages.filter(e => e.request.type === "claim")).toHaveLength(1);
  expect(messages.filter(e => e.request.type === "takeover")).toEqual([next]);
  api.releaseClaim(runtime, b, next.claimId!, "完成交接", "release-b");
});

it("an invalid batch cannot change the journal, and CLI exposes claims without a second state file", () => {
  const { dir, runtime, a } = setup();
  const journal = join(runtime, "coord", "events.jsonl"), before = readFileSync(journal);
  expect(() => api.claimFiles(runtime, dir, a, ["src/a.ts", "../outside"], "错误范围", "bad")).toThrow();
  expect(() => api.claimFiles(runtime, dir, a, [], "没有文件", "empty")).toThrow();
  expect(readFileSync(journal)).toEqual(before);
  const output: string[] = []; const original = console.log;
  try {
    console.log = line => output.push(line);
    expect(api.coordMain(runtime, ["claim", "--session", a, "--files-json", '["src/a.ts"]', "--task", "命令认领", "--request", "cli-claim"])).toBe(0);
    const claimed = JSON.parse(output.pop()!);
    api.coordMain(runtime, ["status"]);
    const status = JSON.parse(output.pop()!);
    expect(status.claims).toEqual([{ claimId: claimed.claimId, session: a, files: ["src/a.ts"], task: "命令认领" }]);
  } finally { console.log = original; }
});
