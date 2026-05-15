import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface HookEvent {
  timestamp: string;
  tool: string;
  file_path: string;
  pre_snapshot_path: string | null;
  reason: string;
}

const QUEUE_DIR = ".devcompanion/queue";

export function handlePostToolUse(stdin: string): void {
  let input: { tool_name?: string; tool_input?: Record<string, unknown> };
  try {
    input = JSON.parse(stdin);
  } catch {
    return;
  }

  const toolName = input.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") return;

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return;

  if (!filePath.endsWith(".py")) return;

  const projectRoot = findProjectRoot(filePath);
  if (!projectRoot) return;

  const queueDir = join(projectRoot, QUEUE_DIR);
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true });
  }

  const event: HookEvent = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    file_path: filePath,
    pre_snapshot_path: null,
    reason: "auto-captured from Claude Code session",
  };

  const queueFile = join(queueDir, "events.jsonl");
  appendFileSync(queueFile, JSON.stringify(event) + "\n");
}

function findProjectRoot(filePath: string): string | null {
  let dir = resolve(filePath, "..");
  const root = resolve("/");

  while (dir !== root) {
    if (existsSync(join(dir, ".devcompanion"))) return dir;
    if (existsSync(join(dir, ".git"))) return dir;
    dir = resolve(dir, "..");
  }

  return null;
}

if (process.stdin.isTTY === false) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    handlePostToolUse(data);
  });
}
