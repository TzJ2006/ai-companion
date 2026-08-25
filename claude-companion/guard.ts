#!/usr/bin/env tsx
// The enforcement layer. Five rules the agent cannot talk its way past, because
// they run in the harness rather than in the prompt.
//
//   R1  PostToolUse  every Edit/Write is appended to ideas/log.md          (记录)
//   R2  PreToolUse   an existing idea's `status:` may only change via `set` (防造假)
//   R3  PreToolUse   no writing an idea's code before its test file exists  (测试先行)
//   R4  PreToolUse   no writing an idea whose how/why_this_way is empty     (先想清楚)
//   R5  Stop         the turn cannot end while `check` reports errors       (图不能坏)
//   R6  PreToolUse   no building a graph no human has approved              (等人审核)
//   R7  PostToolUse  a scanned file is crossed off only by an actual Read    (真读完)
//
// R6 and R7 rest on the same trick: bind the claim to an event the agent cannot
// produce without doing the work. A UserPromptSubmit happens only when the human
// types, so "a person approved this graph" is unfakeable. A file leaves the scan
// worklist only on a Read, so "I read every file" becomes a countdown instead of
// a promise. Any marker an agent can write, an agent can forge.
//
// Wired by install.ts into .claude/settings.json. Set AIDEV_GUARD=off to disable.
//
// ponytail: one script for all five, dispatched on hook_event_name. Exit 2 +
// stderr is the one mechanism that means "block, and tell Claude why" on every
// hook event, so there is nothing else to learn.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { argv, exit, env, platform } from "node:process";
import { parse } from "yaml";
import {
  check, strike, readWorklist, graphPath, worklistFile, logFile, agentName,
  type Graph, type Idea,
} from "./ideas.js";

/** Where this install lives, so the messages can print a command you can paste. */
const COMPANION = dirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");

/** Paths in messages are relative to the project — absolute ones are unreadable. */
const short = (projectDir: string, filePath: string) =>
  relative(projectDir, filePath).replaceAll("\\", "/") || filePath;

export interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
    replace_all?: boolean;
  };
  prompt?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

export interface Decision {
  block: boolean;
  message?: string;
  log?: string;
  /** A graph hash to record as human-approved. Only R6's handler sets this. */
  approve?: string;
}

const OK: Decision = { block: false };

/** Windows paths differ only by case and slash direction; compare them fairly. */
const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
};

export function loadGraph(projectDir: string): Graph | null {
  const file = graphPath(projectDir);
  if (!existsSync(file)) return null;          // repo hasn't run /ccscan — nothing to guard
  try {
    const graph = parse(readFileSync(file, "utf8")) as Graph;
    return graph && Array.isArray(graph.ideas) ? graph : null;
  } catch {
    return null;                               // a broken graph is R5's problem, not R2-R4's
  }
}

/**
 * Approval is bound to the exact graph that was approved. Change one word of
 * one idea and the hash moves, so the approval no longer covers it — which is
 * the point: nobody signed off on the version you just edited.
 */
export function graphHash(projectDir: string): string | null {
  const file = graphPath(projectDir);
  if (!existsSync(file)) return null;
  // Newlines are normalised so a CRLF checkout does not read as a different graph.
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export const approvalFile = (projectDir: string) =>
  join(projectDir, "ideas", agentName(projectDir, ".approved"));

/** The graph hash a human last approved, or null. */
export function approvedHash(projectDir: string): string | null {
  const file = approvalFile(projectDir);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim().split(/\s+/)[0] || null;
}

// Only a message that IS the approval counts. Requiring the whole (trimmed)
// prompt to be the token is what keeps "我不批准" from reading as approval.
const APPROVALS = new Set([
  "批准", "approve", "approved", "同意", "ok", "通过",
  "/ccgraph approve", "ccgraph approve",
]);

export function isApproval(prompt: string | undefined): boolean {
  return APPROVALS.has((prompt ?? "").trim().toLowerCase().replace(/[。.!！]+$/, ""));
}

/** Which idea claims this file as its own, if any. */
export function ideaFor(graph: Graph, projectDir: string, filePath: string): Idea | undefined {
  return graph.ideas.find((idea) =>
    (idea.code ?? []).some((ref) => ref.file && samePath(resolve(projectDir, ref.file), resolve(filePath))));
}

/**
 * The test file a verify command runs. `npx vitest run path/to/x.test.ts` →
 * `path/to/x.test.ts`. Returns undefined when the command has no recognisable
 * path — an unparseable command must not block anything.
 */
export function testFileOf(idea: Idea): string | undefined {
  const command = idea.verify?.command;
  if (!command) return undefined;
  return command.split(/\s+/).find((token) => /\.(test|spec)\.[jt]sx?$|_test\.py$|^test_.*\.py$/.test(token));
}

/** id → status, for spotting a hand-edited status flip. */
function statusMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const graph = parse(text) as Graph;
    for (const idea of graph?.ideas ?? []) if (idea?.id) map.set(idea.id, idea.status ?? "todo");
  } catch { /* unparseable — R2 has nothing to compare, so it allows */ }
  return map;
}

/** Apply the pending edit in memory so we can diff what it would produce. */
function afterEdit(current: string, input: HookInput["tool_input"]): string | null {
  if (input?.content !== undefined) return input.content;                    // Write
  if (input?.old_string === undefined || input?.new_string === undefined) return null;
  return input.replace_all
    ? current.split(input.old_string).join(input.new_string)
    : current.replace(input.old_string, input.new_string);
}

// ─── the five rules ─────────────────────────────────────────────────────────

export function decide(input: HookInput, projectDir: string): Decision {
  if (env.AIDEV_GUARD === "off") return OK;
  const event = input.hook_event_name;

  if (event === "Stop") return ruleGraphIsSound(input, projectDir);
  if (event === "PostToolUse") return ruleRecord(input, projectDir);
  if (event === "UserPromptSubmit") return recordApproval(input, projectDir);
  if (event !== "PreToolUse") return OK;
  if (!/^(Edit|Write|NotebookEdit)$/.test(input.tool_name ?? "")) return OK;

  const filePath = input.tool_input?.file_path;
  if (!filePath) return OK;
  const graph = loadGraph(projectDir);
  if (!graph) return OK;

  const graphFile = graphPath(projectDir);
  if (samePath(filePath, graphFile)) return ruleStatusViaSet(input, graphFile);

  // R6/R7's bookkeeping is only worth something if the agent cannot write it.
  // `.approved` says a human signed off; `.scan-todo` says how much is unread.
  // Both are conclusions the agent must earn, never author.
  for (const [path, rule] of [
    [approvalFile(projectDir), "R6：批准只能由人发一条「批准」消息产生，不能写文件"],
    [worklistFile(projectDir), "R7：扫描清单只能由真的 Read 划掉，不能手改"],
  ] as [string, string][]) {
    if (samePath(filePath, path)) {
      return { block: true, message: `${rule}。\n\n拒绝写入 ${short(projectDir, filePath)}。` };
    }
  }

  return ruleTestFirst(graph, projectDir, filePath);
}

/** R2 — an existing idea's status may only change through `ideas.ts set`. */
function ruleStatusViaSet(input: HookInput, graphFile: string): Decision {
  if (!existsSync(graphFile)) return OK;                       // first write — nothing to protect
  const current = readFileSync(graphFile, "utf8");
  const next = afterEdit(current, input.tool_input);
  if (next === null) return OK;

  const before = statusMap(current);
  const after = statusMap(next);
  const flipped = [...before].filter(([id, status]) => after.has(id) && after.get(id) !== status);
  if (flipped.length === 0) return OK;                         // adding ideas is fine

  return {
    block: true,
    message: `不能手改已有想法的 status。${flipped.map(([id, was]) =>
      `${id}: ${was} → ${after.get(id)}`).join("; ")}

用 set，它会校验证据并自动记一笔：
  npx tsx "${COMPANION}/ideas.ts" set ${flipped[0][0]} ${after.get(flipped[0][0])} --by <command> --note "<原因>"

set 会拒绝没有 code/verify 的 done、拒绝没签字的人工验证 —— 手改绕过的正是这个检查。`,
  };
}

/** R3 + R4 — an idea's code may not be written before it is thought through and has a test. */
function ruleTestFirst(graph: Graph, projectDir: string, filePath: string): Decision {
  const idea = ideaFor(graph, projectDir, filePath);
  if (!idea || idea.status === "done") return OK;              // untracked file, or already built
  const target = short(projectDir, filePath);

  // R4 first: an unthought idea should not reach the "write its test" stage either.
  const unanswered = (["how", "why_this_way"] as const).filter((field) => !idea[field]);
  if (unanswered.length > 0) {
    return {
      block: true,
      message: `${idea.id}「${idea.name}」还没想清楚就要动手写 ${target}。

缺：${unanswered.join(" / ")}

先跑 /ccthink 把这个想法补完 —— 调研（仓库内 + 联网，能借就借）之后再回答
"如何实现"和"为什么这样实现"。现在写下去，写完也说不清为什么是这样。`,
    };
  }

  // R6: a graph nobody signed off on is not a plan, it is a draft.
  const current = graphHash(projectDir);
  const approved = approvedHash(projectDir);
  if (current && approved !== current) {
    return {
      block: true,
      message: approved === null
        ? `这张想法图还没有人审核过，不能开始实现 ${target}。

先渲染出来让人看：
  npx tsx "${COMPANION}/ideas.ts" render

然后请人打开 ideas/graph.html，确认拆分和依赖是对的，
再由人（不是你）回一条消息，内容就是「批准」或 approve。

你无法代替这一步 —— 批准只认人亲手发的消息。`
        : `想法图在上次批准之后被改过了（已批准 ${approved} → 现在 ${current}），
不能接着实现 ${target}。

改动之后需要重新过一遍人眼。让人看过 ideas/graph.html 再回「批准」。`,
    };
  }

  // R3: the test comes first, and it has to exist on disk before the code does.
  const testFile = testFileOf(idea);
  if (!testFile) return OK;                                    // manual verify, or unparseable — allow
  if (existsSync(resolve(projectDir, testFile))) return OK;

  return {
    block: true,
    message: `测试先行：${idea.id}「${idea.name}」的测试还不存在。

先写：  ${testFile}
再跑它，确认它 失败（因为东西还没实现），然后才写 ${target}。

一个从来没红过的测试，可能根本没在测它声称测的东西。
（${idea.id} 的 verify: ${idea.verify?.command}）`,
  };
}

/**
 * R6's other half — the human just said "批准". Bind that to the graph as it
 * stands right now. Nothing an agent can call reaches this code path.
 */
function recordApproval(input: HookInput, projectDir: string): Decision {
  if (!isApproval(input.prompt)) return OK;
  const hash = graphHash(projectDir);
  if (!hash) return OK;
  return { block: false, approve: hash, log: `人工批准想法图 ${hash}` };
}

/** R1 — every edit is recorded, whether or not the agent remembers to. */
function ruleRecord(input: HookInput, projectDir: string): Decision {
  const filePath = input.tool_input?.file_path;
  if (!filePath) return OK;

  // R7 — a scanned file is crossed off only by an actual Read. The agent cannot
  // claim coverage it did not take: no Read, no strike.
  if (input.tool_name === "Read") {
    const struck = strike(projectDir, filePath);
    if (!struck) return OK;                                    // not on the list, or no scan running
    const left = readWorklist(projectDir).length;
    return { block: false, log: `读 ${short(projectDir, filePath)}  (扫描还剩 ${left})` };
  }
  const graph = loadGraph(projectDir);
  const idea = graph ? ideaFor(graph, projectDir, filePath) : undefined;
  const relative = filePath.replaceAll("\\", "/").replace(resolve(projectDir).replaceAll("\\", "/") + "/", "");
  return { block: false, log: `${input.tool_name} ${relative}${idea ? `  → ${idea.id} ${idea.name}` : ""}` };
}

/** R5 — the turn cannot end leaving the graph in a state `check` rejects. */
function ruleGraphIsSound(input: HookInput, projectDir: string): Decision {
  // Claude Code sets this when it is already continuing because of a Stop hook.
  // Blocking again here is how a hook turns into an infinite loop.
  if (input.stop_hook_active) return OK;
  const graph = loadGraph(projectDir);
  if (!graph) return OK;

  const { errors } = check(graph, projectDir);
  if (errors.length === 0) return OK;
  return {
    block: true,
    message: `想法图有 ${errors.length} 个错误，修完再结束：\n\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  };
}

// ─── plumbing ───────────────────────────────────────────────────────────────

function appendLog(projectDir: string, line: string): void {
  const file = logFile(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  if (!existsSync(file)) appendFileSync(file, `# 修改记录\n\n自动生成，只追加。\n\n`);
  appendFileSync(file, `- ${stamp}  ${line}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

if (argv[1]?.endsWith("guard.ts")) {
  readStdin().then((raw) => {
    let input: HookInput;
    try { input = JSON.parse(raw || "{}"); } catch { exit(0); return; }
    // A guard that crashes must never block work — fail open, always.
    let decision: Decision = OK;
    try {
      decision = decide(input, resolve(input.cwd ?? process.cwd()));
    } catch { exit(0); return; }

    const projectDir = resolve(input.cwd ?? process.cwd());
    if (decision.approve) {
      const stamp = new Date().toISOString().slice(0, 10);
      try {
        mkdirSync(dirname(approvalFile(projectDir)), { recursive: true });
        writeFileSync(approvalFile(projectDir), `${decision.approve}  approved ${stamp}\n`);
      } catch { /* an unwritable approval file just means R6 keeps asking */ }
    }
    if (decision.log) {
      try { appendLog(projectDir, decision.log); } catch { /* never block on logging */ }
    }
    if (decision.block) {
      process.stderr.write(decision.message ?? "blocked");
      exit(2);                                   // 2 = block, and show this to Claude
    }
    exit(0);
  });
}
