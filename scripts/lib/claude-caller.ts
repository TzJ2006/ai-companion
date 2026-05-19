import { spawn } from "node:child_process";

export interface ClaudeCallOptions {
  model?: string;
  timeout?: number;
  cwd?: string;
}

function getCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (env.PATH) {
    env.PATH = env.PATH
      .split(";")
      .filter((p) => !p.includes("WindowsApps"))
      .join(";");
  }
  return env;
}

export function callClaude(
  prompt: string,
  options: ClaudeCallOptions = {}
): Promise<string> {
  const model = options.model ?? "haiku";
  const timeout = options.timeout ?? 60000;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", `claude -p --bare --output-format text --model ${model}`],
      {
        timeout,
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: getCleanEnv(),
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
