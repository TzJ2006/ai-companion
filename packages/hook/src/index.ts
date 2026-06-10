import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";

interface EclContextSlim {
  feature: string;
  requirements?: string[];
  decisions?: string[];
  ecl_file?: string;
}

export interface HookEvent {
  timestamp: string;
  tool: string;
  file_path: string;
  pre_snapshot_path: string | null;
  reason: string;
  ecl_context?: EclContextSlim;
  // Placeholder for a later "5-question" payload (see project rule on
  // file-level degradation). Always present and additive; null until populated.
  five_questions: Record<string, unknown> | null;
  // true for events recorded at file level (no AST parse), e.g. .yaml/.md.
  file_level?: boolean;
}

const QUEUE_DIR = ".devcompanion/queue";

const SUPPORTED_EXTENSIONS = new Set([".py", ".pyi", ".ts", ".tsx", ".mts", ".cts"]);

// Non-AST extensions that must still be recorded at file level rather than
// dropped ("unsupported files degrade to file-level recording, not dropped").
const FILE_LEVEL_EXTENSIONS = new Set([".yaml", ".yml", ".md"]);

export function handlePostToolUse(
  stdin: string,
  supportedExtensions: Set<string> = SUPPORTED_EXTENSIONS
): void {
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

  const ext = extname(filePath).toLowerCase();
  const isAstSupported = supportedExtensions.has(ext);
  const isFileLevel = FILE_LEVEL_EXTENSIONS.has(ext);
  // Drop only truly unsupported extensions; AST-supported and file-level
  // extensions both get recorded into the same queue.
  if (!isAstSupported && !isFileLevel) return;

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
    reason: isAstSupported
      ? "auto-captured from Claude Code session"
      : "auto-captured from Claude Code session (file-level, no AST)",
    ecl_context: detectActiveEcl(projectRoot),
    five_questions: null,
  };
  // file-level events are flagged so the daemon can skip AST parsing.
  if (!isAstSupported) event.file_level = true;

  const queueFile = join(queueDir, "events.jsonl");
  appendFileSync(queueFile, JSON.stringify(event) + "\n");

  emitVerificationReminder(projectRoot, filePath);
}

export function findProjectRoot(filePath: string): string | null {
  let dir = resolve(filePath, "..");
  let prev = "";

  while (dir !== prev) {
    if (existsSync(join(dir, ".devcompanion"))) return dir;
    if (existsSync(join(dir, ".git"))) return dir;
    prev = dir;
    dir = resolve(dir, "..");
  }

  return null;
}

function detectActiveEcl(projectRoot: string): EclContextSlim | undefined {
  const eclDir = join(projectRoot, "docs", "ecl");
  if (!existsSync(eclDir)) return undefined;

  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      const featureMatch = content.match(/^feature:\s*["']?(.+?)["']?$/m);
      const statusMatch = content.match(/^status:\s*["']?(.+?)["']?$/m);
      if (!featureMatch || !statusMatch) continue;

      const status = statusMatch[1];
      if (status === "completed" || status === "retired") continue;

      const feature = featureMatch[1];
      const reqIds = [...content.matchAll(/^\s*- id:\s*["']?(REQ-\d+)["']?$/gm)]
        .map((m) => m[1]);
      const decIds = [...content.matchAll(/^\s*- id:\s*["']?(DEC-\d+)["']?$/gm)]
        .map((m) => m[1]);

      return {
        feature,
        requirements: reqIds.length > 0 ? reqIds : undefined,
        decisions: decIds.length > 0 ? decIds : undefined,
        ecl_file: `docs/ecl/${file}`,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}


function emitVerificationReminder(projectRoot: string, filePath: string): void {
  const eclDir = join(projectRoot, "docs", "ecl");
  if (!existsSync(eclDir)) return;

  const normalizedPath = filePath.replace(/\\/g, "/");
  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));
  const commands: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      const featureBlocks = content.split(/^\s*- feature:\s*/m);

      for (const block of featureBlocks.slice(1)) {
        const keyFilesMatch = block.match(/key_files:\s*\n((?:\s+-\s*.+\n?)+)/);
        if (!keyFilesMatch) continue;

        const keyFiles: string[] = [];
        for (const line of keyFilesMatch[1].matchAll(/-\s*["']?(.+?)["']?\s*$/gm)) {
          keyFiles.push(line[1]);
        }

        const matched = keyFiles.some((keyFile) => {
          const normalizedKey = keyFile.replace(/\\/g, "/");
          return normalizedPath.endsWith(normalizedKey) || normalizedPath.includes(normalizedKey);
        });
        if (!matched) continue;

        for (const match of block.matchAll(/command:\s*["']?(.+?)["']?\s*$/gm)) {
          if (!commands.includes(match[1])) {
            commands.push(match[1]);
          }
        }
      }
    } catch {
      continue;
    }
  }

  if (commands.length > 0) {
    const list = commands.map((cmd) => `  - ${cmd}`).join("\n");
    process.stderr.write(
      `[AI Dev Companion] File edited under ECL guard. Run verification:\n${list}\n`
    );
  }
}

if (process.stdin.isTTY === false) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    handlePostToolUse(data);
  });
}
