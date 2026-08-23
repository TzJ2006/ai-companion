import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as hookCapture from "../../packages/hook/src/index.js";
import * as toolEvents from "../../packages/hook/src/tool-event.js";

type HookInput = Parameters<typeof toolEvents.getChangedFilePaths>[0] & {
  tool_use_id?: string;
};
type Manifest = Record<string, unknown>;
type Event = Record<string, unknown>;
type Capture = (input: HookInput, projectRoot: string) => Manifest[];
type Enqueue = (input: HookInput, manifests: Manifest[]) => Event[];
type Correlate = (input: HookInput) => string;
type SafeRead = (projectRoot: string, filePath: string) => unknown | Promise<unknown>;

function requireFunction<T>(namespace: object, name: string): T {
  const value = (namespace as Record<string, unknown>)[name];
  expect(value, `${name} is not implemented`).toBeTypeOf("function");
  return value as T;
}

function makeRepo(root: string, name: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".devcompanion"), { recursive: true });
  return repo;
}

function editInput(filePath: string, cwd: string): HookInput {
  return { tool_name: "Edit", tool_input: { file_path: filePath }, cwd };
}

function expectDegraded(value: unknown, reason: RegExp): void {
  const serialized = JSON.stringify(value);
  expect(serialized).toContain('"evidence_quality":"degraded"');
  expect(serialized).toMatch(reason);
}

function readInbox(repo: string): Event[] {
  const inbox = join(repo, ".devcompanion", "queue", "inbox");
  const names = readdirSync(inbox);
  expect(names.filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  return names
    .filter((name) => extname(name) === ".json")
    .map((name) => JSON.parse(readFileSync(join(inbox, name), "utf8")) as Event);
}

function readSnapshot(repo: string, reference: unknown): string {
  expect(reference).toBeTypeOf("string");
  const path = String(reference);
  const candidates = isAbsolute(path)
    ? [path]
    : [resolve(repo, path), resolve(repo, ".devcompanion", "queue", path)];
  const snapshot = candidates.find(existsSync);
  expect(snapshot, `snapshot ${path} does not exist`).toBeDefined();
  return readFileSync(snapshot!, "utf8");
}

export const hookCaptureContractTests = describe("snapshot-backed hook capture contract", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "aidev-hook-contract-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    const tempRoot = resolve(tmpdir()) + sep;
    expect(resolve(fixtureRoot).startsWith(tempRoot)).toBe(true);
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("[FN-001] derives stable correlation IDs and prefers tool_use_id", () => {
    const deriveCorrelationId = requireFunction<Correlate>(toolEvents, "deriveCorrelationId");
    const first = editInput("src/app.ts", fixtureRoot);
    const reordered: HookInput = {
      cwd: fixtureRoot,
      tool_input: { file_path: "src/app.ts" },
      tool_name: "Edit",
    };

    expect(deriveCorrelationId(first)).toBe(deriveCorrelationId(reordered));
    expect(deriveCorrelationId({ ...first, tool_use_id: "call-123" })).toBe("call-123");
    expect(deriveCorrelationId({
      tool_name: "apply_patch",
      tool_input: { command: "*** Update File: src/other.ts" },
      cwd: fixtureRoot,
    })).not.toBe(deriveCorrelationId(first));
  });

  it("[FN-002] captures distinct pre manifests for repeated identical inputs", () => {
    const capture = requireFunction<Capture>(hookCapture, "capturePreEditSnapshots");
    const repo = makeRepo(fixtureRoot, "repo");
    const file = join(repo, "src", "app.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "first\n");
    const input = editInput(file, repo);

    const first = capture(input, repo);
    writeFileSync(file, "second\n");
    const second = capture(input, repo);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].nonce ?? first[0].snapshot_nonce)
      .not.toBe(second[0].nonce ?? second[0].snapshot_nonce);
  });

  it("[FN-003] degrades an ambiguous per-path FIFO instead of guessing a pre snapshot", () => {
    const capture = requireFunction<Capture>(hookCapture, "capturePreEditSnapshots");
    const enqueue = requireFunction<Enqueue>(hookCapture, "enqueueCapturedEvents");
    const repo = makeRepo(fixtureRoot, "repo");
    const file = join(repo, "src", "app.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "first\n");
    const input = editInput(file, repo);

    const first = capture(input, repo);
    writeFileSync(file, "second\n");
    const second = capture(input, repo);
    expect(first[0].nonce ?? first[0].snapshot_nonce)
      .not.toBe(second[0].nonce ?? second[0].snapshot_nonce);

    writeFileSync(file, "after\n");
    const events = enqueue(input, [...first, ...second]);
    expect(events).toHaveLength(1);
    expectDegraded(events[0], /ambiguous|collision|multiple/i);
  });

  it.each([
    ["repo escape", "escape", "outside-secret\n", /escape|containment|outside/i],
    ["large text", "large", "x".repeat(3 * 1024 * 1024), /large|size|2.?mib/i],
    ["binary", "binary", Buffer.from([0, 1, 2, 3]), /binary|unsupported/i],
  ])("[FN-016] records explicit degradation for %s", async (_label, kind, contents, reason) => {
    const readSafely = requireFunction<SafeRead>(hookCapture, "readSnapshotTargetSafely");
    const repo = makeRepo(fixtureRoot, "repo");
    const path = kind === "escape"
      ? join(fixtureRoot, "outside.ts")
      : join(repo, "src", `${kind}.ts`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);

    const result = await readSafely(repo, path);
    expectDegraded(result, reason);
    expect(JSON.stringify(result)).not.toContain("outside-secret");
  });

  it("[FN-003] publishes a complete spool event by temp-write and rename with immutable snapshots", () => {
    const capture = requireFunction<Capture>(hookCapture, "capturePreEditSnapshots");
    const enqueue = requireFunction<Enqueue>(hookCapture, "enqueueCapturedEvents");
    const repo = makeRepo(fixtureRoot, "repo");
    const file = join(repo, "src", "app.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "before\n");
    const input = editInput(file, repo);
    const manifests = capture(input, repo);
    writeFileSync(file, "after\n");

    const renameSpy = vi.spyOn(fs, "renameSync");
    syncBuiltinESMExports();
    enqueue(input, manifests);
    writeFileSync(file, "later\n");

    const events = readInbox(repo);
    expect(events).toHaveLength(1);
    expect(renameSpy.mock.calls.some(([from, to]) =>
      basename(String(from)).startsWith(".tmp-")
      && extname(String(to)) === ".json"
      && basename(dirname(String(to))) === "inbox"
    )).toBe(true);
    expect(readSnapshot(repo, events[0].pre_snapshot_path)).toBe("before\n");
    expect(readSnapshot(repo, events[0].post_snapshot_path)).toBe("after\n");
  });

  it("[FN-003] partitions one apply_patch spanning two repositories", () => {
    const capture = requireFunction<Capture>(hookCapture, "capturePreEditSnapshots");
    const enqueue = requireFunction<Enqueue>(hookCapture, "enqueueCapturedEvents");
    const repoA = makeRepo(fixtureRoot, "repo-a");
    const repoB = makeRepo(fixtureRoot, "repo-b");
    const fileA = join(repoA, "src", "a.ts");
    const fileB = join(repoB, "src", "b.ts");
    mkdirSync(dirname(fileA), { recursive: true });
    mkdirSync(dirname(fileB), { recursive: true });
    writeFileSync(fileA, "a-before\n");
    writeFileSync(fileB, "b-before\n");
    const input: HookInput = {
      tool_name: "apply_patch",
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${fileA}\n@@\n*** Update File: ${fileB}\n@@\n*** End Patch`,
      },
      cwd: fixtureRoot,
    };

    const manifests = capture(input, repoA);
    expect(new Set(manifests.map((manifest) => manifest.project_root))).toEqual(new Set([
      realpathSync(repoA),
      realpathSync(repoB),
    ]));
    writeFileSync(fileA, "a-after\n");
    writeFileSync(fileB, "b-after\n");
    enqueue(input, manifests);

    const [eventA] = readInbox(repoA);
    const [eventB] = readInbox(repoB);
    expect(eventA.file_path).toBe("src/a.ts");
    expect(eventB.file_path).toBe("src/b.ts");
    expect(eventA.correlation_id).toBe(eventB.correlation_id);
  });

  it("[FN-016] rejects a storage-root junction redirected outside the repository", async () => {
    const readSafely = requireFunction<SafeRead>(hookCapture, "readSnapshotTargetSafely");
    const repo = join(fixtureRoot, "repo");
    const outsideStorage = join(fixtureRoot, "outside-storage");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(outsideStorage);
    symlinkSync(outsideStorage, join(repo, ".devcompanion"), process.platform === "win32" ? "junction" : "dir");
    const file = join(repo, "src", "app.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "secret\n");

    const result = await readSafely(repo, file);
    expectDegraded(result, /storage|queue|junction|redirect|containment/i);
    expect(readdirSync(outsideStorage)).toEqual([]);
  });

  it("[FN-016] discards content when a source directory is swapped to a junction before open", async () => {
    const readSafely = requireFunction<SafeRead>(hookCapture, "readSnapshotTargetSafely");
    const repo = makeRepo(fixtureRoot, "repo");
    const sourceDir = join(repo, "src");
    const backupDir = join(repo, "src-original");
    const outsideDir = join(fixtureRoot, "outside");
    const file = join(sourceDir, "app.ts");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(outsideDir);
    writeFileSync(file, "inside\n");
    writeFileSync(join(outsideDir, "app.ts"), "outside-secret\n");
    const realOpenSync = fs.openSync;
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation(((path, flags, mode) => {
      if (!swapped && resolve(String(path)) === resolve(file)) {
        swapped = true;
        renameSync(sourceDir, backupDir);
        symlinkSync(outsideDir, sourceDir, process.platform === "win32" ? "junction" : "dir");
      }
      return realOpenSync(path, flags, mode);
    }) as typeof fs.openSync);
    syncBuiltinESMExports();

    const result = await readSafely(repo, file);
    expect(swapped).toBe(true);
    expectDegraded(result, /changed|identity|symlink|junction|race/i);
    expect(JSON.stringify(result)).not.toContain("outside-secret");
  });
});
