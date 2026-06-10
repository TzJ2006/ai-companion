import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKER_FILE = ".devcompanion/.ccplan-active";

const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

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

export interface PreToolUseEvent {
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

function isEclWrite(toolInput: Record<string, unknown>): boolean {
  const filePath = (toolInput.file_path as string) || "";
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("docs/ecl/") && normalized.endsWith(".yaml");
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

  if (WRITE_TOOLS.has(tool_name)) {
    if (isEclWrite(tool_input)) {
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    try {
      const event = JSON.parse(data) as PreToolUseEvent;
      const root = process.env.DEVCOMPANION_ROOT || process.cwd();
      const result = handlePreToolUse(event, root);
      if (result.blocked) {
        process.stdout.write(JSON.stringify(result));
        process.exit(1);
      }
    } catch {
      // Parse failure = don't block
    }
  });
}
