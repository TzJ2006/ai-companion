import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as hook from "../../packages/hook/src/index.js";
import * as history from "../../packages/history/src/index.js";
import * as processor from "../../packages/daemon/src/processor.js";

type ModuleNamespace = Record<string, unknown> & { __loadError?: unknown };
type ContractFunction = (...args: any[]) => any;
type ProcessResult = { code: number | null; stdout: string; stderr: string };

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const tsxCli = join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const hookModuleUrl = pathToFileURL(
  join(repositoryRoot, "packages", "hook", "src", "index.ts"),
).href;
const workerModuleUrl = pathToFileURL(
  join(repositoryRoot, "packages", "daemon", "src", "worker.ts"),
).href;
const createdRoots: string[] = [];

function contractFunction<T extends ContractFunction>(
  namespace: ModuleNamespace,
  name: string,
): T {
  const candidate = namespace[name];
  const loadError = namespace.__loadError;
  expect(
    candidate,
    loadError
      ? `${name} contract module failed to load: ${String(loadError)}`
      : `${name} must be exported for this contract`,
  ).toBeTypeOf("function");
  return candidate as T;
}

async function loadWorker(): Promise<ModuleNamespace> {
  try {
    return await import(/* @vite-ignore */ workerModuleUrl) as ModuleNamespace;
  } catch (error) {
    return { __loadError: error };
  }
}

function queueRoot(projectRoot: string): string {
  return join(projectRoot, ".devcompanion", "queue");
}

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "aidev-spool-contract-"));
  createdRoots.push(projectRoot);
  await Promise.all([
    mkdir(join(projectRoot, ".git"), { recursive: true }),
    mkdir(join(queueRoot(projectRoot), "inbox"), { recursive: true }),
    mkdir(join(queueRoot(projectRoot), "working"), { recursive: true }),
    mkdir(join(queueRoot(projectRoot), "rejected"), { recursive: true }),
    mkdir(join(queueRoot(projectRoot), "snapshots"), { recursive: true }),
    mkdir(join(queueRoot(projectRoot), "sidecars"), { recursive: true }),
    mkdir(join(projectRoot, "src"), { recursive: true }),
  ]);
  return projectRoot;
}

function degradedEvent(projectRoot: string, eventId: string): Record<string, unknown> {
  return {
    schema_version: 1,
    event_id: eventId,
    correlation_id: `correlation-${eventId}`,
    project_root: projectRoot,
    timestamp: "2026-08-17T12:00:00.000Z",
    tool: "Edit",
    file_path: `src/${eventId}.ts`,
    operation: "modify",
    reason: "recoverable queue contract",
    evidence_quality: "degraded",
    degradation_reason: "snapshot-unavailable",
    snapshots: { before: null, after: null },
  };
}

async function writeEvent(
  projectRoot: string,
  eventId: string,
  directory = "inbox",
  value: Record<string, unknown> = degradedEvent(projectRoot, eventId),
): Promise<string> {
  const path = join(queueRoot(projectRoot), directory, `${eventId}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

async function jsonAt(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
}

function extractSession(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, any>;
  if (typeof object.id === "string" && Array.isArray(object.changes)) return object;
  return extractSession(object.session);
}

async function sessionsUnder(root: string): Promise<Record<string, any>[]> {
  const sessions: Record<string, any>[] = [];
  for (const path of await filesUnder(root)) {
    if (!path.endsWith(".json")) continue;
    try {
      const session = extractSession(await jsonAt(path));
      if (session) sessions.push(session);
    } catch {
      // Malformed fixtures are expected in queue contract tests.
    }
  }
  return sessions;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function runTsx(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 30_000,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, script, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`subprocess timed out: ${script}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeLauncherScript(projectRoot: string): Promise<string> {
  const script = join(projectRoot, "launch-worker.mts");
  await writeFile(script, `
import * as hook from ${JSON.stringify(hookModuleUrl)};

const fn = (hook as unknown as Record<string, unknown>).spawnQueueWorker;
if (typeof fn !== "function") throw new Error("spawnQueueWorker must be exported");
const projectRoot = process.argv[2];
const mode = process.argv[3];
const auxiliaryPath = process.argv[4];
if (mode === "spawn-failure") process.execPath = auxiliaryPath;
if (mode === "preload-exit") {
  process.env.NODE_OPTIONS = "--require=" + auxiliaryPath.replaceAll("\\\\", "/");
}
(fn as (root: string) => void)(projectRoot);
await new Promise((resolve) => setTimeout(resolve, 750));
`, "utf8");
  return script;
}

async function writeWorkerScript(projectRoot: string): Promise<string> {
  const script = join(projectRoot, "run-worker.mts");
  await writeFile(script, `
import * as worker from ${JSON.stringify(workerModuleUrl)};

const fn = (worker as unknown as Record<string, unknown>).runQueueWorker;
if (typeof fn !== "function") throw new Error("runQueueWorker must be exported");
try {
  const summary = await (fn as (root: string) => Promise<unknown>)(process.argv[2]);
  process.stdout.write(JSON.stringify({ kind: "summary", summary }));
} catch (error) {
  const value = error as Error;
  process.stdout.write(JSON.stringify({ kind: "error", name: value.name, message: value.message }));
}
`, "utf8");
  return script;
}

async function writeLease(
  projectRoot: string,
  ownerToken: string,
  heartbeat: Date,
): Promise<void> {
  const lease = join(queueRoot(projectRoot), "worker-lease");
  await mkdir(lease, { recursive: true });
  const ownerFile = join(lease, "owner.json");
  await writeFile(ownerFile, JSON.stringify({
    owner_token: ownerToken,
    pid: process.pid,
    heartbeat: heartbeat.toISOString(),
    heartbeat_ms: heartbeat.getTime(),
  }), "utf8");
  await utimes(ownerFile, heartbeat, heartbeat);
  await utimes(lease, heartbeat, heartbeat);
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true, maxRetries: 3 })
  ));
});

export function spoolWorkerContractTests(): void {
  describe("recoverable spool launcher contract", () => {
    it("[FN-004] contains a real spawn failure, records health, and preserves the durable event", async () => {
      contractFunction(hook as unknown as ModuleNamespace, "spawnQueueWorker");
      const projectRoot = await makeProject();
      const eventPath = await writeEvent(projectRoot, "spawn-failure");
      const launcher = await writeLauncherScript(projectRoot);
      const missingExecutable = join(projectRoot, "missing-node-executable");

      const result = await runTsx(launcher, [projectRoot, "spawn-failure", missingExecutable]);

      expect(result.code).toBe(0);
      expect(result.stderr).toMatch(/worker|spawn|ENOENT/i);
      expect(await pathExists(eventPath)).toBe(true);
      const health = await jsonAt(join(queueRoot(projectRoot), "worker-health.json"));
      expect(JSON.stringify(health)).toMatch(/spawn|error|fail/i);
    });

    it("[FN-004] allows only one worker spawn across 50 concurrent launcher processes", async () => {
      const projectRoot = await makeProject();
      await writeEvent(projectRoot, "burst");
      const launcher = await writeLauncherScript(projectRoot);
      const counterPath = join(projectRoot, "spawn-count.txt");
      const preloader = join(projectRoot, "count-and-exit.cjs");
      await writeFile(preloader, `
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.AIDEV_SPAWN_COUNTER, "spawn\\n");
process.exit(0);
`, "utf8");

      const launches = Array.from({ length: 50 }, () =>
        runTsx(
          launcher,
          [projectRoot, "preload-exit", preloader],
          { AIDEV_SPAWN_COUNTER: counterPath },
          60_000,
        )
      );
      const results = await Promise.all(launches);

      expect(results.every((result) => result.code === 0)).toBe(true);
      await waitFor(() => pathExists(counterPath), 5_000);
      const attempts = (await readFile(counterPath, "utf8")).trim().split(/\r?\n/);
      expect(attempts).toHaveLength(1);
    }, 120_000);

    it("[FN-004] does not report healthy when spawn succeeds but the worker exits before startup", async () => {
      const projectRoot = await makeProject();
      const eventPath = await writeEvent(projectRoot, "spawn-then-exit");
      const launcher = await writeLauncherScript(projectRoot);
      const preloader = join(projectRoot, "exit-before-worker.cjs");
      await writeFile(preloader, "process.exit(23);\n", "utf8");

      const result = await runTsx(launcher, [projectRoot, "preload-exit", preloader]);

      expect(result.code).toBe(0);
      expect(await pathExists(eventPath)).toBe(true);
      const healthPath = join(queueRoot(projectRoot), "worker-health.json");
      if (await pathExists(healthPath)) {
        expect(JSON.stringify(await jsonAt(healthPath))).not.toMatch(/healthy|completed/i);
      }
    });
  });

  describe("recoverable worker and claim contract", () => {
    it("[FN-005] atomically claims one immutable event when two worker subprocesses race", async () => {
      const projectRoot = await makeProject();
      await writeEvent(projectRoot, "atomic-claim");
      const workerScript = await writeWorkerScript(projectRoot);

      const results = await Promise.all([
        runTsx(workerScript, [projectRoot]),
        runTsx(workerScript, [projectRoot]),
      ]);

      expect(results.every((result) => result.code === 0)).toBe(true);
      expect(await sessionsUnder(join(projectRoot, ".devcompanion", "reviews"))).toHaveLength(1);
      const queuedEvents = (await filesUnder(queueRoot(projectRoot)))
        .filter((path) => path.endsWith("atomic-claim.json"));
      expect(queuedEvents).toHaveLength(0);
    }, 30_000);

    it("[FN-005] quarantines one malformed event without blocking the valid event", async () => {
      const projectRoot = await makeProject();
      await writeEvent(projectRoot, "valid-after-malformed");
      const malformedPath = join(queueRoot(projectRoot), "inbox", "malformed.json");
      await writeFile(malformedPath, "{not-json", "utf8");
      const workerScript = await writeWorkerScript(projectRoot);

      const result = await runTsx(workerScript, [projectRoot]);

      expect(result.code).toBe(0);
      expect(await sessionsUnder(join(projectRoot, ".devcompanion", "reviews"))).toHaveLength(1);
      const rejected = await filesUnder(join(queueRoot(projectRoot), "rejected"));
      expect(rejected).toHaveLength(1);
      expect(await readFile(rejected[0], "utf8")).toBe("{not-json");
      expect(await pathExists(malformedPath)).toBe(false);
    }, 30_000);

    it("[FN-007] reuses the finalized session sidecar after a journal failure", async () => {
      const projectRoot = await makeProject();
      const ownerToken = "sidecar-owner";
      await writeLease(projectRoot, ownerToken, new Date());
      const eventPath = await writeEvent(
        projectRoot,
        "sidecar-retry",
        join("working", ownerToken),
      );
      const processSpoolEvent = contractFunction<(
        path: string,
        root: string,
        store: unknown,
      ) => Promise<unknown>>(processor as ModuleNamespace, "processSpoolEvent");
      const store = new history.HistoryStore(projectRoot);
      await store.init();
      const saveSession = store.saveSession.bind(store);
      const failOnceStore = Object.create(store) as typeof store;
      failOnceStore.saveSession = async () => {
        throw new Error("injected journal failure");
      };

      await expect(processSpoolEvent(eventPath, projectRoot, failOnceStore))
        .rejects.toThrow(/injected journal failure/);
      expect(await pathExists(eventPath)).toBe(true);
      const sidecarSessions = await sessionsUnder(queueRoot(projectRoot));
      expect(sidecarSessions).toHaveLength(1);
      const finalized = structuredClone(sidecarSessions[0]);

      failOnceStore.saveSession = saveSession;
      await processSpoolEvent(eventPath, projectRoot, failOnceStore);

      const journal = await sessionsUnder(join(projectRoot, ".devcompanion", "reviews"));
      expect(journal).toHaveLength(1);
      expect(journal[0].id).toBe(finalized.id);
      expect(journal[0].timestamp).toBe(finalized.timestamp);
      expect(journal[0].changes.map((change: any) => change.id))
        .toEqual(finalized.changes.map((change: any) => change.id));
      expect(await pathExists(eventPath)).toBe(false);
    });

    it("[FN-005] fences a forced stale lease when two replacement workers race", async () => {
      const projectRoot = await makeProject();
      const staleOwner = "stale-owner";
      const staleAt = new Date(Date.now() - 6 * 60_000);
      await writeLease(projectRoot, staleOwner, staleAt);
      await writeEvent(projectRoot, "stale-claim", join("working", staleOwner));
      const workerScript = await writeWorkerScript(projectRoot);

      const results = await Promise.all([
        runTsx(workerScript, [projectRoot]),
        runTsx(workerScript, [projectRoot]),
      ]);

      expect(results.every((result) => result.code === 0)).toBe(true);
      expect(await sessionsUnder(join(projectRoot, ".devcompanion", "reviews"))).toHaveLength(1);
      const staleEvents = (await filesUnder(join(queueRoot(projectRoot), "working")))
        .filter((path) => path.endsWith("stale-claim.json"));
      expect(staleEvents).toHaveLength(0);
    }, 30_000);

    it("[FN-005] promotes only complete aged temp events and leaves fresh temps alone", async () => {
      const projectRoot = await makeProject();
      const inbox = join(queueRoot(projectRoot), "inbox");
      const aged = join(inbox, ".tmp-aged-temp.json");
      const fresh = join(inbox, ".tmp-fresh-temp.json");
      await writeFile(aged, JSON.stringify(degradedEvent(projectRoot, "aged-temp")), "utf8");
      await writeFile(fresh, JSON.stringify(degradedEvent(projectRoot, "fresh-temp")), "utf8");
      const old = new Date(Date.now() - 10 * 60_000);
      await utimes(aged, old, old);
      const workerScript = await writeWorkerScript(projectRoot);

      const result = await runTsx(workerScript, [projectRoot]);

      expect(result.code).toBe(0);
      expect(await sessionsUnder(join(projectRoot, ".devcompanion", "reviews"))).toHaveLength(1);
      expect(await pathExists(aged)).toBe(false);
      expect(await pathExists(fresh)).toBe(true);
    }, 30_000);
  });

  describe("spool validation, diff, cleanup, and quota contract", () => {
    it("[FN-006] builds a diff only from immutable snapshots, not the later working tree", async () => {
      const projectRoot = await makeProject();
      const snapshots = join(queueRoot(projectRoot), "snapshots");
      await writeFile(join(snapshots, "snapshot-diff.before"), "export const value = 1;\n", "utf8");
      await writeFile(join(snapshots, "snapshot-diff.after"), "export const value = 2;\n", "utf8");
      await writeFile(join(projectRoot, "src", "value.ts"), "export const value = 999;\n", "utf8");
      const buildSnapshotDiffs = contractFunction<(events: unknown[]) => Promise<unknown[]>>(
        processor as ModuleNamespace,
        "buildSnapshotDiffs",
      );
      const event = {
        ...degradedEvent(projectRoot, "snapshot-diff"),
        file_path: "src/value.ts",
        evidence_quality: "full",
        degradation_reason: undefined,
        before_snapshot_path: "snapshots/snapshot-diff.before",
        after_snapshot_path: "snapshots/snapshot-diff.after",
        snapshots: {
          before: { state: "present", token: "snapshot-diff.before" },
          after: { state: "present", token: "snapshot-diff.after" },
        },
      };

      const diffs = await buildSnapshotDiffs([event]);
      const rendered = JSON.stringify(diffs);

      expect(diffs).toHaveLength(1);
      expect(rendered).toContain("src/value.ts");
      expect(rendered).toContain("value = 1");
      expect(rendered).toContain("value = 2");
      expect(rendered).not.toContain("value = 999");
    });

    it("[FN-019] rejects oversized and out-of-root artifacts through the bounded reader", async () => {
      const projectRoot = await makeProject();
      const worker = await loadWorker();
      const readValidatedQueueArtifact = contractFunction<(
        root: string,
        path: string,
        kind: "event" | "sidecar" | "snapshot",
      ) => Promise<unknown>>(worker, "readValidatedQueueArtifact");
      const oversized = join(queueRoot(projectRoot), "inbox", "oversized.json");
      await writeFile(oversized, JSON.stringify({ payload: "x".repeat(300 * 1024) }), "utf8");
      const outside = join(projectRoot, "outside-event.json");
      await writeFile(outside, JSON.stringify(degradedEvent(projectRoot, "outside")), "utf8");

      await expect(readValidatedQueueArtifact(queueRoot(projectRoot), oversized, "event"))
        .rejects.toMatchObject({ name: "QueueArtifactRejected" });
      await expect(readValidatedQueueArtifact(queueRoot(projectRoot), outside, "event"))
        .rejects.toMatchObject({ name: "QueueArtifactRejected" });
    });

    it("[FN-017] bounds each aged-artifact cleanup pass and never deletes active evidence", async () => {
      const projectRoot = await makeProject();
      const worker = await loadWorker();
      const cleanupExpiredSnapshots = contractFunction<(
        root: string,
        now: Date,
      ) => Promise<Record<string, unknown>>>(worker, "cleanupExpiredSnapshots");
      const snapshots = join(queueRoot(projectRoot), "snapshots");
      const sidecars = join(queueRoot(projectRoot), "sidecars");
      const activeSnapshot = join(snapshots, "active.before");
      await writeFile(activeSnapshot, "active evidence", "utf8");
      await writeEvent(projectRoot, "active", "inbox", {
        ...degradedEvent(projectRoot, "active"),
        before_snapshot_path: "snapshots/active.before",
        snapshots: { before: { state: "present", token: "active.before" }, after: null },
      });
      const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
      for (let index = 0; index < 300; index += 1) {
        const path = join(sidecars, `orphan-${String(index).padStart(3, "0")}.session.json`);
        await writeFile(path, JSON.stringify({ orphan: index }), "utf8");
        await utimes(path, old, old);
      }

      const summary = await cleanupExpiredSnapshots(queueRoot(projectRoot), new Date());
      const remaining = (await filesUnder(sidecars))
        .filter((path) => path.endsWith(".session.json"));

      expect(await pathExists(activeSnapshot)).toBe(true);
      expect(remaining.length).toBeGreaterThan(0);
      expect(remaining.length).toBeLessThan(300);
      expect(summary).toMatchObject({ budget_exhausted: true });
    });

    it("[FN-017] reports degraded capture when aggregate queue bytes cross the hard quota", async () => {
      const projectRoot = await makeProject();
      const worker = await loadWorker();
      const cleanupExpiredSnapshots = contractFunction<(
        root: string,
        now: Date,
      ) => Promise<Record<string, unknown>>>(worker, "cleanupExpiredSnapshots");
      const snapshots = join(queueRoot(projectRoot), "snapshots");
      for (let index = 0; index < 72; index += 1) {
        const handle = await open(join(snapshots, `quota-${index}.after`), "w");
        await handle.truncate(1024 * 1024);
        await handle.close();
      }

      const summary = await cleanupExpiredSnapshots(queueRoot(projectRoot), new Date());
      const quotaArtifacts = (await filesUnder(queueRoot(projectRoot)))
        .filter((path) => /overflow|watermark|health/i.test(path));
      const observation = `${JSON.stringify(summary)} ${quotaArtifacts.join(" ")}`;

      expect(observation).toMatch(/degraded|overflow|high.?water/i);
      expect(await filesUnder(snapshots)).toHaveLength(72);
    });
  });
}

spoolWorkerContractTests();
