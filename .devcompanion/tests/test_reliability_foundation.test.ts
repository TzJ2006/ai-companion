import "./test_hook_captureSnapshots.test.js";
import "./test_daemon_recoverableQueue.test.js";
import "./test_history_durableSession.test.js";

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  capturePreEditSnapshots,
  enqueueCapturedEvents,
} from "../../packages/hook/src/index.js";
import { runQueueWorker } from "../../packages/daemon/src/worker.js";
import { HistoryStore } from "../../packages/history/src/index.js";

const execFileAsync = promisify(execFile);

async function git(projectRoot: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  return stdout;
}

export function trackerReliabilityIntegration(): void {
  describe("tracker reliability foundation integration", () => {
    it("uses captured snapshots after the working tree is replaced and committed", async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), "aidev-reliability-integration-"));
      try {
        await git(projectRoot, "init", "--quiet");
        await git(projectRoot, "config", "user.email", "integration@example.invalid");
        await git(projectRoot, "config", "user.name", "Reliability Integration");

        const relativePath = "src/value.ts";
        const filePath = join(projectRoot, "src", "value.ts");
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(filePath, "export const value = 1;\n");
        await git(projectRoot, "add", relativePath);
        await git(projectRoot, "commit", "--quiet", "-m", "initial");

        const store = new HistoryStore(projectRoot);
        await store.init();
        const input = {
          tool_name: "Edit",
          tool_use_id: "reliability-integration-edit",
          tool_input: { file_path: filePath },
          cwd: projectRoot,
        };
        const manifests = capturePreEditSnapshots(input, projectRoot);
        expect(manifests).toHaveLength(1);

        await writeFile(filePath, "export const value = 2;\n");
        const queueRoot = join(projectRoot, ".devcompanion", "queue");
        await writeFile(join(queueRoot, "worker-launch-gate.json"), "{}\n");
        const [event] = enqueueCapturedEvents(input, manifests);
        expect(event).toMatchObject({
          file_path: relativePath,
          operation: "modify",
          evidence_quality: "full",
        });

        await writeFile(filePath, "export const value = 999;\n");
        await git(projectRoot, "add", relativePath);
        await git(projectRoot, "commit", "--quiet", "-m", "replace working state");
        expect(await readFile(filePath, "utf8")).toContain("999");

        const summary = await runQueueWorker(projectRoot);
        expect(summary).toMatchObject({ status: "completed", processed: 1, failed: 0 });

        const sessionNames = await store.listSessions();
        expect(sessionNames).toHaveLength(1);
        const session = await store.getSession(sessionNames[0]);
        expect(session.files_changed).toEqual([relativePath]);
        expect(session.changes.length).toBeGreaterThan(0);
        expect(session.changes.every((change) => change.file_path === relativePath)).toBe(true);
        expect(session.changes.map((change) => change.old_content).join("\n")).toContain("value = 1");
        expect(session.changes.map((change) => change.new_content).join("\n")).toContain("value = 2");
        expect(JSON.stringify(session)).not.toContain("999");

        const history = await store.getFileHistory(relativePath);
        expect(history).not.toBeNull();
        const records = Object.values(history!.functions).flatMap((entry) => entry.records);
        expect(records.some((record) => record.old_content?.includes("value = 1"))).toBe(true);
        expect(records.some((record) => record.new_content?.includes("value = 2"))).toBe(true);
        expect(records.every((record) => record.file_path === relativePath)).toBe(true);
        expect(JSON.stringify(records)).not.toContain("999");
      } finally {
        await rm(projectRoot, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });
}

trackerReliabilityIntegration();
