import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export interface ToolUseInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  tool_use_id?: string;
}

const CLAUDE_FILE_WRITE_TOOLS = new Set(["Edit", "Write"]);
const CODEX_APPLY_PATCH = "apply_patch";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

export function deriveCorrelationId(input: ToolUseInput): string {
  const toolUseId = input.tool_use_id?.trim();
  if (toolUseId) return toolUseId;
  return createHash("sha256").update(JSON.stringify(canonicalize({
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    cwd: input.cwd,
  }))).digest("hex");
}

/** Return true for tool calls that can change one or more files. */
export function isFileWriteTool(toolName: string | undefined): boolean {
  return CLAUDE_FILE_WRITE_TOOLS.has(toolName ?? "") || toolName === CODEX_APPLY_PATCH;
}

/**
 * Extract every path named by Codex's freeform apply_patch grammar.
 * Update patches can also contain a Move to line, which identifies a second
 * affected path that must be tracked independently.
 */
export function extractCodexPatchPaths(command: string): string[] {
  const paths: string[] = [];
  for (const line of command.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/)
      ?? line.match(/^\*\*\* Move to:\s*(.+)$/);
    if (match?.[1]) paths.push(match[1].trim());
  }
  return paths;
}

/**
 * Normalize Claude Edit/Write and Codex apply_patch inputs to absolute paths.
 * Codex sends the raw patch as tool_input.command rather than a file_path.
 */
export function getChangedFilePaths(
  input: ToolUseInput,
  fallbackCwd: string = process.cwd()
): string[] {
  if (!isFileWriteTool(input.tool_name)) return [];

  const rawPaths: string[] = [];
  const directPath = input.tool_input?.file_path;
  if (typeof directPath === "string" && directPath.trim()) {
    rawPaths.push(directPath.trim());
  }

  if (input.tool_name === CODEX_APPLY_PATCH) {
    const command = input.tool_input?.command;
    if (typeof command === "string") {
      rawPaths.push(...extractCodexPatchPaths(command));
    }
  }

  const baseDir = typeof input.cwd === "string" && input.cwd.trim()
    ? input.cwd
    : fallbackCwd;
  const seen = new Set<string>();
  for (const rawPath of rawPaths) {
    const normalized = isAbsolute(rawPath) ? resolve(rawPath) : resolve(baseDir, rawPath);
    seen.add(normalized);
  }
  return [...seen];
}
