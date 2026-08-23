import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getChangedFilePaths, isFileWriteTool, type ToolUseInput } from "./tool-event.js";

const MARKER_FILE = ".devcompanion/.ccplan-active";

const WRITE_BASH_PATTERNS = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bgit\s+(commit|push|reset|checkout|merge|rebase|cherry-pick)/,
  /\bnpm\s+(publish|install|uninstall)/,
  /\bmkdir\b/,
  /\btouch\b/,
  />/,
  /\btee\b/,
];

export interface PreToolUseEvent extends ToolUseInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseResult {
  blocked: boolean;
  message?: string;
}

export function isCcplanActive(projectRoot?: string): boolean {
  const root = projectRoot || process.cwd();
  const markerPath = join(root, MARKER_FILE);
  return existsSync(markerPath);
}

function isEclWrite(event: PreToolUseEvent, projectRoot?: string): boolean {
  const paths = getChangedFilePaths(event, projectRoot);
  return paths.length > 0 && paths.every((filePath) => {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.includes("/docs/ecl/") && normalized.endsWith(".yaml");
  });
}

function isWriteBash(toolInput: Record<string, unknown>): boolean {
  const command = (toolInput.command as string) || "";
  return WRITE_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

export function handlePreToolUse(
  event: PreToolUseEvent,
  projectRoot?: string
): PreToolUseResult {
  if (!isCcplanActive(projectRoot)) {
    return { blocked: false };
  }

  const { tool_name, tool_input } = event;

  if (isFileWriteTool(tool_name)) {
    if (isEclWrite(event, projectRoot)) {
      return { blocked: false };
    }
    return {
      blocked: true,
      message: `ccplan is in planning mode (read-only). Cannot use ${tool_name} on non-ECL files. Exit ccplan or use /ccedit to implement.`,
    };
  }

  if (tool_name === "Bash" && isWriteBash(tool_input)) {
    return {
      blocked: true,
      message: "ccplan is in planning mode (read-only). Write operations via Bash are blocked. Exit ccplan or use /ccedit to implement.",
    };
  }

  return { blocked: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "") && !process.stdin.isTTY) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    try {
      const event = JSON.parse(data.replace(/^\uFEFF/, "")) as PreToolUseEvent;
      const root = process.env.DEVCOMPANION_ROOT || process.cwd();
      const result = handlePreToolUse(event, root);
      if (result.blocked) {
        process.stderr.write((result.message ?? "Blocked by ccplan read-only guard.") + "\n");
        process.exit(2);
      }
    } catch {
      // Parse failure = don't block
    }
  });
}
