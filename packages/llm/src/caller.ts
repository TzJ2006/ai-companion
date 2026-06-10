import { spawn } from "node:child_process";
import { platform } from "node:os";
import type {
  ClaudeCallOptions,
  ClaudeCallResult,
  PreflightResult,
} from "./types.js";
import { ClaudeNotAvailableError, ClaudeTimeoutError } from "./types.js";

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32_768;

function getCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (platform() === "win32" && env.PATH) {
    env.PATH = env.PATH
      .split(";")
      .filter((p) => !p.includes("WindowsApps"))
      .join(";");
  }
  return env;
}

function resolveClaudeCommand(): { command: string; args: string[] } {
  if (platform() === "win32") {
    return {
      command: "cmd.exe",
      args: ["/c", "claude"],
    };
  }
  return { command: "claude", args: [] };
}

let preflightCache: PreflightResult | null = null;

export async function preflight(): Promise<PreflightResult> {
  if (preflightCache) return preflightCache;

  const { command, args } = resolveClaudeCommand();

  const result = await new Promise<PreflightResult>((resolve) => {
    const child = spawn(command, [...args, "--version"], {
      timeout: 10_000,
      env: getCleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ available: true, version: stdout.trim() });
      } else {
        resolve({
          available: false,
          error: "Claude CLI exited with non-zero code. Run `claude --version` to diagnose.",
        });
      }
    });

    child.on("error", () => {
      resolve({
        available: false,
        error: "Claude CLI not found on PATH. Install from https://claude.ai/code",
      });
    });
  });

  preflightCache = result;
  return result;
}

export function resetPreflightCache(): void {
  preflightCache = null;
}

export async function callClaude(
  prompt: string,
  options: ClaudeCallOptions = {}
): Promise<ClaudeCallResult> {
  const check = await preflight();
  if (!check.available) {
    throw new ClaudeNotAvailableError(check.error ?? "Claude CLI not available");
  }

  const model = options.model ?? "sonnet";
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const { command, args } = resolveClaudeCommand();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await new Promise<ClaudeCallResult>((resolve, reject) => {
      const child = spawn(
        command,
        [...args, "-p", "--output-format", "text", "--model", model],
        {
          cwd: options.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: getCleanEnv(),
          signal: controller.signal,
        }
      );

      let stdout = "";
      let truncated = false;

      child.stdout.on("data", (data: Buffer) => {
        if (!truncated) {
          stdout += data.toString();
          if (maxOutputBytes > 0 && Buffer.byteLength(stdout) > maxOutputBytes) {
            stdout = stdout.slice(0, maxOutputBytes);
            truncated = true;
          }
        }
      });

      let stderr = "";
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ output: stdout, truncated });
        } else {
          reject(new Error(`Claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      child.on("error", (error) => {
        if (error.name === "AbortError") {
          reject(new ClaudeTimeoutError());
        } else {
          reject(error);
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  } finally {
    clearTimeout(timer);
  }
}
