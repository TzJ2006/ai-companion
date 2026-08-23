import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { findMatchingGuards, isInactiveEclStatus, type GuardInfo } from "./feature-guard.js";
import { handlePreToolUse as checkCcplanGuard } from "./pre-tool-use-guard.js";
import { getChangedFilePaths, isFileWriteTool, type ToolUseInput } from "./tool-event.js";

const SUPPORTED_EXTENSIONS = new Set([".py", ".pyi", ".ts", ".tsx", ".mts", ".cts"]);

interface PreToolInput extends ToolUseInput {}

export function handlePreToolUse(stdin: string): void {
  let input: PreToolInput;
  try {
    input = JSON.parse(stdin.replace(/^\uFEFF/, ""));
  } catch {
    return;
  }

  const toolName = input.tool_name;
  if (!toolName) return;

  // ccplan read-only guard: check before any other logic
  const candidatePaths = getChangedFilePaths(input);
  const projectRoot = candidatePaths.length > 0
    ? findProjectRoot(candidatePaths[0])
    : findProjectRootFromCwd();

  if (projectRoot) {
    const guardResult = checkCcplanGuard(
      { tool_name: toolName, tool_input: input.tool_input || {}, cwd: input.cwd },
      projectRoot
    );
    if (guardResult.blocked) {
      process.stderr.write((guardResult.message ?? "Blocked by ccplan read-only guard.") + "\n");
      process.exit(2);
    }
  }

  if (!isFileWriteTool(toolName)) return;
  const filePath = candidatePaths.find((path) => SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase()));
  if (!filePath) return;

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;

  if (!projectRoot) return;

  const eclDir = join(projectRoot, "docs", "ecl");
  if (!existsSync(eclDir)) {
    process.stderr.write(
      "[AI Dev Companion] WARNING: No docs/ecl/ directory found. " +
      "Consider using /ccplan to create a feature plan before editing.\n"
    );
    return;
  }

  const guards = findGuardsForFile(eclDir, filePath);
  if (guards.length > 0) {
    const guardMessages = guards.map((guard) => {
      const invariants = guard.invariants.map((inv) => `    - ${inv}`).join("\n");
      const verifications = guard.verifications.map((cmd) => `    - ${cmd}`).join("\n");
      return `  GUARD: ${guard.feature} (${guard.description})\n  Invariants to preserve:\n${invariants}\n  Verification commands:\n${verifications}`;
    });

    process.stderr.write(
      `[AI Dev Companion] Feature Guard(s) protect this file:\n${guardMessages.join("\n\n")}\n` +
      "Ensure all invariants remain intact after your edit. Run verification commands when done.\n"
    );
  }

  const activeFeatures = findActiveFeatures(eclDir);
  if (activeFeatures.length === 0) {
    process.stderr.write(
      "[AI Dev Companion] WARNING: No active ECL feature found in docs/ecl/. " +
      "Use /ccplan to plan your changes before editing.\n"
    );
  }
}

function findGuardsForFile(eclDir: string, filePath: string): GuardInfo[] {
  const results: GuardInfo[] = [];
  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      results.push(...findMatchingGuards(content, filePath));
    } catch {
      continue;
    }
  }

  return results;
}

function findActiveFeatures(eclDir: string): string[] {
  const active: string[] = [];
  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      const statusMatch = content.match(/^status:\s*["']?([^\s"']+)/m);
      if (!statusMatch) continue;

      const status = statusMatch[1];
      if (!isInactiveEclStatus(status)) {
        const featureMatch = content.match(/^feature:\s*["']?(.+?)["']?$/m);
        if (featureMatch) {
          active.push(featureMatch[1]);
        }
      }
    } catch {
      continue;
    }
  }

  return active;
}

function findProjectRoot(filePath: string): string | null {
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

function findProjectRootFromCwd(): string | null {
  let dir = resolve(process.cwd());
  let prev = "";

  while (dir !== prev) {
    if (existsSync(join(dir, ".devcompanion"))) return dir;
    if (existsSync(join(dir, ".git"))) return dir;
    prev = dir;
    dir = resolve(dir, "..");
  }

  return null;
}

if (!process.stdin.isTTY) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    handlePreToolUse(data);
  });
}
