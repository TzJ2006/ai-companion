import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { parseDocument, isSeq, isMap } from "yaml";
import type { FnStatus, VerificationResult } from "./types.js";
import { EclParseError } from "./types.js";

const execFile = promisify(execFileCb);

export async function updateFnStatus(
  eclPath: string,
  fnId: string,
  status: FnStatus
): Promise<void> {
  let content: string;
  try {
    content = await readFile(eclPath, "utf-8");
  } catch {
    throw new EclParseError(`Cannot read ECL file: ${eclPath}`);
  }

  const doc = parseDocument(content);
  const functionsNode = doc.get("functions", true);

  if (!functionsNode || !isSeq(functionsNode)) {
    throw new EclParseError("ECL file has no functions sequence");
  }

  let found = false;
  for (const item of functionsNode.items) {
    if (isMap(item)) {
      const idNode = item.get("id");
      if (idNode === fnId) {
        item.set("status", status);
        found = true;
        break;
      }
    }
  }

  if (!found) {
    throw new Error(`FN not found in ECL: ${fnId}`);
  }

  const tempPath = `${eclPath}.${randomUUID()}.tmp`;
  const output = doc.toString();
  await writeFile(tempPath, output, "utf-8");
  await rename(tempPath, eclPath);
}

export async function runVerification(
  verifyConfig: { command: string; pass_condition: string },
  timeoutMs: number = 60_000
): Promise<VerificationResult> {
  const args = verifyConfig.command.split(/\s+/);
  const cmd = args[0];
  const cmdArgs = args.slice(1);

  const spawn = (useShell: boolean) =>
    execFile(cmd, cmdArgs, { timeout: timeoutMs, shell: useShell, windowsHide: true });

  const ok = (stdout: string, stderr: string): VerificationResult => ({
    passed: true,
    output: stdout + (stderr ? `\n${stderr}` : ""),
  });

  const fail = (err: unknown): VerificationResult => {
    const e = err as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    if (e.killed) {
      return { passed: false, output: e.stdout || "", error: `timeout after ${timeoutMs}ms` };
    }
    return { passed: false, output: e.stdout || "", error: e.stderr || e.message || "unknown error" };
  };

  // Try WITHOUT a shell first, so shell metacharacters in normal commands (e.g. the
  // `>` in `node -e "...=>..."`) are never reinterpreted by cmd.exe.
  try {
    const { stdout, stderr } = await spawn(false);
    return ok(stdout, stderr);
  } catch (err: unknown) {
    // Windows-only fallback: npm-shim commands (npx, npm…) are `.cmd` files that
    // execFile with shell:false cannot resolve (spawn ENOENT). Retry once via the
    // shell so the shim resolves. Shim verify commands (`npx vitest run …`) carry
    // no shell metacharacters, so this fallback is safe.
    if (process.platform === "win32" && (err as { code?: string }).code === "ENOENT") {
      try {
        const { stdout, stderr } = await spawn(true);
        return ok(stdout, stderr);
      } catch (retryErr: unknown) {
        return fail(retryErr);
      }
    }
    return fail(err);
  }
}
