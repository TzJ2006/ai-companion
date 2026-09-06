import { afterEach, beforeAll, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MODULE = join(ROOT, "companion", "coordination.ts");
const ENGINE = join(ROOT, "companion", "ideas.ts");
let api: typeof import("../../companion/coordination.js");
const dirs: string[] = [];
const children: ChildProcess[] = [];
const runtime = () => { const dir = mkdtempSync(join(tmpdir(), "coord-messages-")); dirs.push(dir); return dir; };

beforeAll(async () => {
  expect(existsSync(MODULE), "共享消息与短锁尚未实现").toBe(true);
  api = await import(MODULE);
});
afterEach(async () => {
  await Promise.all(children.splice(0).map(p => new Promise<void>(done => {
    if (p.exitCode !== null || p.signalCode !== null) return done();
    p.once("exit", () => done()); p.kill();
  })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// IPC is a barrier: all workers reach the same point before any begins writing.
function worker(body: string, dir: string, data: unknown = {}) {
  const p = spawn(process.execPath, ["--import", "tsx", "-e",
    `const api=require(process.argv[1]);const dir=process.argv[2];const data=JSON.parse(process.argv[3]);
     process.send('ready');process.once('message',()=>{try{${body}
     process.disconnect();}catch(e){console.error(e);process.exit(1);}});`, MODULE, dir, JSON.stringify(data)],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  children.push(p);
  let stderr = ""; p.stderr!.on("data", b => stderr += b);
  const ready = new Promise<void>((ok, no) => { p.once("message", () => ok()); p.once("error", no); });
  const exit = new Promise<void>((ok, no) => {
    p.once("error", no);
    p.once("exit", code => code === 0 ? ok() : no(new Error(`worker ${code}: ${stderr}`)));
  });
  // A killed holder is intentional; callers still observe unexpected worker failures.
  void exit.catch(() => {});
  return { p, ready, exit };
}

it("simultaneous long messages survive, with unique order and idempotent retries", async () => {
  const dir = runtime();
  const sessions = Array.from({ length: 4 }, (_, i) => api.joinSession(dir, "同一种助手", `join-${i}`).session);
  const text = "中文消息\n".repeat(400);
  const jobs = sessions.map(session => worker(`
    for(let i=0;i<8;i++) api.appendEvent(dir,{type:'say',session:data.session,text:data.text},data.session+'-'+i);
    api.appendEvent(dir,{type:'say',session:data.session,text:data.text},data.session+'-0');`, dir, { session, text }));
  await Promise.all(jobs.map(j => j.ready));
  jobs.forEach(j => j.p.send("go"));
  await Promise.all(jobs.map(j => j.exit));
  const events = api.readEvents(dir);
  expect(events.map(e => e.seq)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
  expect(events.filter(e => e.request.type === "say").map(e => e.request.text)).toEqual(Array(32).fill(text));
  expect(new Set(sessions).size).toBe(4);
  expect(() => api.appendEvent(dir, { type: "say", session: sessions[0], text: "changed" }, `${sessions[0]}-0`)).toThrow(/request|请求/);
}, 30_000);

it("join retries preserve identity, and each inbox advances only on explicit ack", () => {
  const dir = runtime();
  const a = api.joinSession(dir, "A", "join-a");
  expect(api.joinSession(dir, "A", "join-a")).toEqual(a);
  const b = api.joinSession(dir, "B", "join-b");
  api.appendEvent(dir, { type: "say", session: a.session, text: "请 B 留意接口" }, "message");
  const page = api.readInbox(dir, a.session, { limit: 2 });
  expect(page.events).toHaveLength(2);
  expect(api.readInbox(dir, a.session, { limit: 2 })).toEqual(page);
  api.acknowledge(dir, a.session, page.lastSeq, "ack-a");
  expect(api.readInbox(dir, a.session).events.map(e => e.request.type)).toEqual(["say"]);
  expect(api.readInbox(dir, b.session).events).toHaveLength(3);
  api.acknowledge(dir, a.session, 1, "older-ack");
  expect(api.readInbox(dir, a.session).events).toHaveLength(1);
  expect(() => api.acknowledge(dir, a.session, 1000, "future-ack")).toThrow(/序号|sequence/);
  expect(() => api.readInbox(dir, "unknown")).toThrow(/会话|session/);
});

it("validates requests and persisted records before changing the journal", () => {
  const dir = runtime(); const a = api.joinSession(dir, "A", "join-a");
  const journal = join(dir, "coord", "events.jsonl"); const before = readFileSync(journal);
  const bad = [
    { type: "say", session: a.session, text: "你".repeat(3000) },
    { type: "say", session: "unknown", text: "消息" },
    { type: "say", session: a.session, text: "x", extra: true },
    { type: "ack", session: a.session, upto: -1 },
    { type: "say", session: a.session, text: { command: "execute" } },
  ];
  for (const request of bad) expect(() => api.appendEvent(dir, request as never, "bad")).toThrow();
  expect(readFileSync(journal)).toEqual(before);
  expect(() => api.readInbox(dir, a.session, { limit: 0 })).toThrow();
  expect(() => api.withProjectLock(dir, () => { throw new Error("callback failed"); })).toThrow("callback failed");
  expect(existsSync(join(dir, "coord", "write.lock"))).toBe(false);
});

it("repairs only an incomplete tail, never silently skips damaged committed records", () => {
  const dir = runtime(); const a = api.joinSession(dir, "A", "join-a");
  const journal = join(dir, "coord", "events.jsonl"); const first = readFileSync(journal, "utf8");
  appendFileSync(journal, '{"partial":"中');
  expect(api.readEvents(dir)).toHaveLength(1);
  api.appendEvent(dir, { type: "say", session: a.session, text: "恢复后的消息" }, "after-tail");
  expect(api.readEvents(dir)).toHaveLength(2);
  expect(readFileSync(journal, "utf8").startsWith(first)).toBe(true);
  const damaged = first + '{invalid}\n' + first;
  writeFileSync(journal, damaged);
  expect(() => api.appendEvent(dir, { type: "say", session: a.session, text: "不能写" }, "bad-middle")).toThrow();
  expect(readFileSync(journal, "utf8")).toBe(damaged);
  const duplicate = first + first;
  writeFileSync(journal, duplicate);
  expect(() => api.readEvents(dir)).toThrow(/序号|sequence/);
});

it("a paused live holder never expires, and a killed holder needs explicit recovery", async () => {
  const dir = runtime(); api.joinSession(dir, "A", "join-a");
  const holder = worker(`api.withProjectLock(dir,()=>{
    process.send('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);
  });`, dir);
  await holder.ready;
  const locked = new Promise<void>(done => holder.p.once("message", () => done()));
  holder.p.send("go"); await locked;
  const lock = join(dir, "coord", "write.lock");
  const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
  utimesSync(lock, new Date(0), new Date(0));
  expect(() => api.withProjectLock(dir, () => { throw new Error("must not enter"); }, { timeoutMs: 60 })).toThrow(/busy|占用/);
  expect(() => api.recoverLock(dir, owner.token, "检查过了", true)).toThrow(/存活|running|active/);
  holder.p.kill(); await holder.exit.catch(() => {});
  expect(existsSync(lock)).toBe(true);
  expect(() => api.recoverLock(dir, owner.token, "检查过了", false)).toThrow(/停止|stopped/);
  expect(() => api.recoverLock(dir, "different-owner", "检查过了", true)).toThrow(/owner|持有者/);
  api.recoverLock(dir, owner.token, "旧进程已结束，全部协调写入已停止", true);
  expect(existsSync(lock)).toBe(false);
  api.withProjectLock(dir, () => {});
}, 15_000);

it("the actual CLI works without an idea graph and rejects unknown options", async () => {
  const dir = runtime();
  const run = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((ok, no) => {
    const p = spawn(process.execPath, ["--import", "tsx", ENGINE, "coord", ...args, "--project", dir], { cwd: ROOT });
    children.push(p); let out = "", err = "";
    p.stdout.on("data", b => out += b); p.stderr.on("data", b => err += b);
    p.once("error", no); p.once("exit", code => ok({ code, out, err }));
  });
  const joined = await run(["join", "--label", "助手 A", "--request", "join-a"]);
  expect(joined.code, joined.err).toBe(0);
  const session = JSON.parse(joined.out).session;
  expect((await run(["say", "--session", session, "--text", "正在处理消息功能", "--request", "say-1"])).code).toBe(0);
  const inbox = await run(["inbox", "--session", session]);
  expect(JSON.parse(inbox.out).events).toHaveLength(2);
  expect((await run(["say", "--session", session, "--text", "x", "--typo", "y"])).code).not.toBe(0);
  expect(existsSync(join(dir, "ideas", "graph.yaml"))).toBe(false);
}, 15_000);
