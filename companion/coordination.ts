// I-113: local, cooperative coordination. No graph imports: callers supply paths().runtime.
import {
  mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync,
  truncateSync, unlinkSync, rmdirSync, lstatSync, statSync, realpathSync,
} from "node:fs";
import { join, resolve, relative, dirname, basename, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

type Request =
  | { type: "join"; label: string; session?: string }
  | { type: "say"; session: string; text: string }
  | { type: "ack"; session: string; upto: number }
  | { type: "claim"; session: string; files: string[]; task: string }
  | { type: "release"; session: string; claimId: string; summary: string }
  | { type: "takeover"; session: string; claimId: string; reason: string; stopped: true };
export interface CoordEvent {
  v: 1;
  seq: number;
  requestId: string;
  session: string;
  request: Request;
  claimId?: string;
}
interface Claim { claimId: string; session: string; files: string[]; task: string }
interface Owner { token: string; pid: number; created: string }
const location = (runtime: string) => join(runtime, "coord");
const lockPath = (runtime: string) => join(location(runtime), "write.lock");
const journalPath = (runtime: string) => join(location(runtime), "events.jsonl");
const waitCell = new Int32Array(new SharedArrayBuffer(4));

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) {
    throw new Error(`${field} 必须是非空文本，最多 ${max} 字节`);
  }
  return value;
}
function identifier(value: unknown, field: string): string {
  const result = text(value, field, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(result)) throw new Error(`${field} 格式不正确`);
  return result;
}
function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${field} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value as number;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要 JSON 对象");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`不认识的字段 ${key}`);
}

function normalizeRequest(value: unknown): Request {
  const r = object(value);
  if (r.type === "join") {
    keys(r, ["type", "label", "session"]);
    return { type: "join", label: text(r.label, "label", 512),
      ...(r.session === undefined ? {} : { session: identifier(r.session, "session") }) };
  }
  if (r.type === "say") {
    keys(r, ["type", "session", "text"]);
    return { type: "say", session: identifier(r.session, "session"), text: text(r.text, "message", 8192) };
  }
  if (r.type === "ack") {
    keys(r, ["type", "session", "upto"]);
    return { type: "ack", session: identifier(r.session, "session"), upto: integer(r.upto, "序号") };
  }
  if (r.type === "claim") {
    keys(r, ["type", "session", "files", "task"]);
    if (!Array.isArray(r.files) || r.files.length < 1 || r.files.length > 100) throw new Error("认领需要 1 到 100 个文件");
    const files = [...new Set(r.files.map(f => text(f, "file", 4096)))].sort();
    if (files.some(f => f.includes("\0") || f.includes("\\") || f.startsWith("/") || f.split("/").some(s => !s || s === "." || s === ".."))) {
      throw new Error("认领记录必须使用规范的项目相对路径");
    }
    return { type: "claim", session: identifier(r.session, "session"), files, task: text(r.task, "task", 8192) };
  }
  if (r.type === "release") {
    keys(r, ["type", "session", "claimId", "summary"]);
    return { type: "release", session: identifier(r.session, "session"), claimId: identifier(r.claimId, "claimId"), summary: text(r.summary, "summary", 8192) };
  }
  if (r.type === "takeover") {
    keys(r, ["type", "session", "claimId", "reason", "stopped"]);
    if (r.stopped !== true) throw new Error("必须先停止旧助手及全部在途写入，再显式确认 stopped");
    return { type: "takeover", session: identifier(r.session, "session"), claimId: identifier(r.claimId, "claimId"), reason: text(r.reason, "reason", 8192), stopped: true };
  }
  throw new Error(`不认识的协调动作 ${String(r.type)}`);
}

function readOwner(runtime: string): Owner | null {
  try {
    const o = JSON.parse(readFileSync(join(lockPath(runtime), "owner.json"), "utf8"));
    identifier(o.token, "owner"); integer(o.pid, "pid", 1); text(o.created, "created", 100);
    return o;
  } catch { return null; } // A crash between mkdir and owner write requires explicit recovery too.
}

/** Sync callbacks only. Never hold this across a tool, test run, or network operation. */
export function withProjectLock<T>(runtime: string, work: () => T, opts: { timeoutMs?: number } = {}): T {
  const timeout = integer(opts.timeoutMs ?? 3000, "timeoutMs", 0, 30_000);
  mkdirSync(location(runtime), { recursive: true });
  const lock = lockPath(runtime);
  const deadline = performance.now() + timeout;
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (performance.now() >= deadline) {
        const owner = readOwner(runtime);
        throw new Error(`协调写入被占用 (busy)：${JSON.stringify(owner ?? { owner: "unreadable" })}；稍后重试。不会按超时抢锁。`);
      }
      Atomics.wait(waitCell, 0, 0, Math.min(20, Math.max(1, deadline - performance.now())));
    }
  }
  const owner: Owner = { token: randomUUID(), pid: process.pid, created: new Date().toISOString() };
  try { writeFileSync(join(lock, "owner.json"), JSON.stringify(owner), { flag: "wx" }); }
  catch (error) {
    // If the diagnostic write partially failed, keep the lock for explicit inspection.
    throw new Error(`已取得短锁但无法记录持有者，请停止协调写入后恢复：${String(error)}`);
  }
  try { return work(); }
  finally {
    if (readOwner(runtime)?.token !== owner.token) throw new Error("短锁持有者已改变，拒绝释放他人的锁");
    unlinkSync(join(lock, "owner.json"));
    rmdirSync(lock);
  }
}

/** Administrative recovery requires quiescence; it is not a concurrent lock-stealing API. */
export function recoverLock(runtime: string, expectedOwner: string, reason: string, allStopped: boolean): void {
  if (!allStopped) throw new Error("先停止全部协调写入进程，再显式确认 stopped");
  text(reason, "恢复原因", 8192);
  const owner = readOwner(runtime);
  if ((owner?.token ?? "unreadable") !== expectedOwner) throw new Error("短锁持有者 owner 已改变，请重新检查");
  if (owner) {
    try { process.kill(owner.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("无法确认原进程已停止，拒绝恢复");
      // ESRCH is only an additional check. The operator must also stop all competing writers.
      if (readOwner(runtime)?.token !== expectedOwner) throw new Error("短锁持有者 owner 已改变");
      unlinkSync(join(lockPath(runtime), "owner.json"));
      rmdirSync(lockPath(runtime));
      return;
    }
    throw new Error("原持有者进程仍存活 (active)，拒绝恢复");
  }
  try { unlinkSync(join(lockPath(runtime), "owner.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  rmdirSync(lockPath(runtime)); // Unexpected extra files are never recursively deleted.
}

/** A canonical file key, including files that have not been created yet. */
export function canonicalTarget(projectDir: string, file: string): string {
  text(file, "file", 4096);
  if (file.includes("\0")) throw new Error("路径不能包含空字符");
  const root = realpathSync(projectDir);
  let existing = resolve(root, file);
  const missing: string[] = [];
  for (;;) {
    try { lstatSync(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error("找不到路径的现有父目录");
      missing.unshift(basename(existing)); existing = parent;
    }
  }
  const actual = realpathSync(existing); // Broken links are rejected, not treated as missing files.
  const stat = statSync(actual);
  if ((!missing.length && !stat.isFile()) || (missing.length && !stat.isDirectory())) throw new Error("只认领文件，不认领目录或特殊文件");
  if (!missing.length && stat.nlink > 1) throw new Error("不支持硬链接 hard link 文件认领");
  const rel = relative(root, resolve(actual, ...missing));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("文件越出项目根目录");
  let key = rel.replaceAll("\\", "/");
  if (process.platform === "win32") key = key.toLowerCase();
  if (key === ".git" || key.startsWith(".git/") || key === "ideas/.runtime" || key.startsWith("ideas/.runtime/") || ["ideas/graph.yaml", "ideas/graph.html"].includes(key)) {
    throw new Error("内部状态和想法图不能长期认领，请使用对应更新命令");
  }
  return key;
}

interface State { sessions: Map<string, string>; cursors: Map<string, number>; claims: Map<string, Claim> }
function applyEvent(state: State, event: CoordEvent): void {
  const r = event.request;
  if ((r.type === "claim" || r.type === "takeover") !== (event.claimId !== undefined)) throw new Error("认领编号 claimId 与动作不匹配");
  if (r.type === "join") {
    if (r.session !== undefined && r.session !== event.session) throw new Error("会话绑定不匹配");
    const label = state.sessions.get(event.session);
    if (label !== undefined && (r.session === undefined || label !== r.label)) throw new Error("会话身份已注册，不能重新绑定");
    state.sessions.set(event.session, r.label);
  } else {
    if (r.session !== event.session || !state.sessions.has(event.session)) throw new Error("不认识的会话 session");
    if (r.type === "ack") {
      if (r.upto >= event.seq) throw new Error("确认序号 sequence 超过现有记录");
      state.cursors.set(event.session, Math.max(state.cursors.get(event.session) ?? 0, r.upto));
    }
    if (r.type === "claim") {
      for (const claim of state.claims.values()) {
        const shared = r.files.filter(f => claim.files.includes(f));
        if (shared.length) throw new Error(`文件被占用 (claimed)：${shared.join(", ")}；持有者 ${claim.session}；任务 ${claim.task}；claimId ${claim.claimId}`);
      }
      if (state.claims.has(event.claimId!)) throw new Error("认领编号 claimId 已使用");
      state.claims.set(event.claimId!, { claimId: event.claimId!, session: event.session, files: r.files, task: r.task });
    }
    if (r.type === "release" || r.type === "takeover") {
      const old = state.claims.get(r.claimId);
      if (!old) throw new Error("认领 claim 已释放或被接管，请读取最新状态");
      if (r.type === "release" && old.session !== event.session) throw new Error(`不是认领持有者 owner：${old.session}`);
      if (r.type === "takeover" && (event.claimId === r.claimId || state.claims.has(event.claimId!))) throw new Error("新的认领编号 claimId 已使用");
      state.claims.delete(r.claimId);
      if (r.type === "takeover") state.claims.set(event.claimId!, { ...old, claimId: event.claimId!, session: event.session });
    }
  }
}

// ponytail: replay is O(total events); add snapshots or SQLite when measured latency warrants it.
function replay(runtime: string): { events: CoordEvent[]; state: State; validBytes: number; totalBytes: number } {
  let bytes: Buffer;
  try { bytes = readFileSync(journalPath(runtime)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; bytes = Buffer.alloc(0); }
  const validBytes = bytes.lastIndexOf(10) + 1;
  const complete = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, validBytes));
  const state: State = { sessions: new Map(), cursors: new Map(), claims: new Map() };
  const events: CoordEvent[] = [];
  const requestIds = new Set<string>();
  for (const line of complete ? complete.slice(0, -1).split("\n") : []) {
    if (Buffer.byteLength(line) + 1 > 65536) throw new Error("协调记录超过 64 KiB");
    const raw = object(JSON.parse(line));
    keys(raw, ["v", "seq", "requestId", "session", "request", "claimId"]);
    if (raw.v !== 1) throw new Error("不认识的协调记录版本");
    if (raw.seq !== events.length + 1) throw new Error("协调记录序号 sequence 损坏");
    const event: CoordEvent = { v: 1, seq: raw.seq as number,
      requestId: identifier(raw.requestId, "requestId"), session: identifier(raw.session, "session"),
      request: normalizeRequest(raw.request),
      ...(raw.claimId === undefined ? {} : { claimId: identifier(raw.claimId, "claimId") }) };
    if (requestIds.has(event.requestId)) throw new Error("重复的请求编号 requestId");
    applyEvent(state, event);
    requestIds.add(event.requestId); events.push(event);
  }
  return { events, state, validBytes, totalBytes: bytes.length };
}

export function readEvents(runtime: string): CoordEvent[] {
  return withProjectLock(runtime, () => replay(runtime).events);
}

export function appendEvent(runtime: string, value: unknown, requestId: string = randomUUID()): CoordEvent {
  let request = normalizeRequest(value);
  identifier(requestId, "requestId");
  return withProjectLock(runtime, () => {
    if (request.type === "claim") request = { ...request, files: [...new Set(request.files.map(f => canonicalTarget(resolve(runtime, "../.."), f)))].sort() };
    const { events, state, validBytes, totalBytes } = replay(runtime);
    const prior = events.find(e => e.requestId === requestId);
    if (prior) {
      if (!isDeepStrictEqual(prior.request, request)) throw new Error("请求 requestId 已用过，但内容不同");
      return prior;
    }
    const event: CoordEvent = { v: 1, seq: events.length + 1, requestId,
      session: request.session ?? `session:${randomUUID()}`, request,
      ...(["claim", "takeover"].includes(request.type) ? { claimId: randomUUID() } : {}) };
    applyEvent(state, event);
    const bytes = Buffer.from(JSON.stringify(event) + "\n");
    if (bytes.length > 65536) throw new Error("协调记录超过 64 KiB");
    // Windows append-only handles cannot truncate; both operations remain under the lock.
    if (totalBytes !== validBytes) truncateSync(journalPath(runtime), validBytes);
    const fd = openSync(journalPath(runtime), "a");
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    return event;
  });
}

export function joinSession(runtime: string, label: string, requestId: string = randomUUID(), session?: string): CoordEvent {
  return appendEvent(runtime, { type: "join", label, ...(session === undefined ? {} : { session }) }, requestId);
}

export function readInbox(runtime: string, session: string, opts: { limit?: number } = {}) {
  identifier(session, "session");
  const limit = integer(opts.limit ?? 20, "limit", 1, 100);
  return withProjectLock(runtime, () => {
    const { events, state } = replay(runtime);
    if (!state.sessions.has(session)) throw new Error("不认识的会话 session");
    const cursor = state.cursors.get(session) ?? 0;
    const pending = events.filter(e => e.seq > cursor && e.request.type !== "ack");
    const page = pending.slice(0, limit);
    const hasMore = pending.length > page.length;
    return { events: page, lastSeq: hasMore ? page[page.length - 1].seq : events.length, hasMore };
  });
}

export function acknowledge(runtime: string, session: string, upto: number, requestId: string = randomUUID()): CoordEvent {
  return appendEvent(runtime, { type: "ack", session, upto }, requestId);
}

export function claimFiles(runtime: string, projectDir: string, session: string, files: string[], task: string, requestId: string = randomUUID()): CoordEvent {
  if (realpathSync(projectDir) !== realpathSync(resolve(runtime, "../.."))) throw new Error("runtime 不属于这个项目");
  if (!Array.isArray(files)) throw new Error("files 必须是文件列表");
  return appendEvent(runtime, { type: "claim", session, files: files.map(f => canonicalTarget(projectDir, f)), task }, requestId);
}

export function releaseClaim(runtime: string, session: string, claimId: string, summary: string, requestId: string = randomUUID()): CoordEvent {
  return appendEvent(runtime, { type: "release", session, claimId, summary }, requestId);
}

export function takeoverClaim(runtime: string, session: string, claimId: string, reason: string, allStopped: boolean, requestId: string = randomUUID()): CoordEvent {
  // --stopped is an explicit cooperative attestation; a file journal cannot stop external tools.
  return appendEvent(runtime, { type: "takeover", session, claimId, reason, stopped: allStopped }, requestId);
}

export function coordMain(runtime: string, args: string[]): number {
  const actions: Record<string, string[]> = {
    join: ["label", "session", "request"], say: ["session", "text", "request"],
    inbox: ["session", "limit"], ack: ["session", "upto", "request"], status: [],
    recover: ["owner", "reason", "stopped"],
    claim: ["session", "files-json", "task", "request"],
    release: ["session", "claim", "summary", "request"],
    takeover: ["session", "claim", "reason", "stopped", "request"],
  };
  const action = args[0];
  if (!Object.hasOwn(actions, action)) throw new Error("usage: coord join|say|inbox|ack|status|recover|claim|release|takeover [--label 文本] [--session ID] [--request ID] [--text 文本] [--upto 序号] [--files-json JSON] [--task 文本] [--claim ID] [--summary 文本] [--reason 文本] [--stopped]");
  const options: Record<string, string> = Object.create(null);
  for (let i = 1; i < args.length; i++) {
    const key = args[i].startsWith("--") ? args[i].slice(2) : "";
    if (!key || ![...actions[action], "project"].includes(key) || Object.hasOwn(options, key)) throw new Error(`不认识或重复的选项 ${args[i]}`);
    if (key === "stopped") { options[key] = "true"; continue; }
    if (args[i + 1] === undefined) throw new Error(`选项 --${key} 缺少值`);
    options[key] = args[++i];
  }
  let result: unknown;
  if (action === "join") result = joinSession(runtime, options.label, options.request, options.session);
  if (action === "say") result = appendEvent(runtime, { type: "say", session: options.session, text: options.text }, options.request);
  if (action === "inbox") result = readInbox(runtime, options.session, { limit: options.limit === undefined ? undefined : Number(options.limit) });
  if (action === "ack") result = acknowledge(runtime, options.session, Number(options.upto), options.request);
  if (action === "status") result = withProjectLock(runtime, () => {
    const { events, state } = replay(runtime);
    return { lastSeq: events.length, sessions: [...state.sessions].map(([session, label]) => ({ session, label, acknowledged: state.cursors.get(session) ?? 0 })), claims: [...state.claims.values()] };
  });
  if (action === "recover") {
    recoverLock(runtime, options.owner, options.reason, options.stopped === "true");
    result = { recovered: true, owner: options.owner, reason: options.reason };
  }
  if (action === "claim") result = claimFiles(runtime, resolve(runtime, "../.."), options.session, JSON.parse(options["files-json"]), options.task, options.request);
  if (action === "release") result = releaseClaim(runtime, options.session, options.claim, options.summary, options.request);
  if (action === "takeover") result = takeoverClaim(runtime, options.session, options.claim, options.reason, options.stopped === "true", options.request);
  console.log(JSON.stringify(result));
  return 0;
}
