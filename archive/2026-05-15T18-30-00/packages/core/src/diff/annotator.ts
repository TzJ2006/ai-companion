import type { FileDiff, DiffHunk } from "./parser.js";
import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";
import { computeFunctionIdentity } from "@aidev/ast";
import { randomUUID } from "node:crypto";

export interface AnnotationContext {
  reason: string;
  reason_source: "context" | "llm-inferred" | "user-provided";
  session_id: string;
}

export interface AnnotatedChange {
  file_path: string;
  function_name: string;
  function_hash: string;
  class_name: string | null;
  change_type: ChangeRecord["change_type"];
  reason: string;
  reason_source: ChangeRecord["reason_source"];
  hunks: DiffHunk[];
  start_line: number;
  end_line: number;
}

export function annotateChanges(
  diffs: FileDiff[],
  functionMap: Map<string, FunctionSignature[]>,
  context: AnnotationContext
): AnnotatedChange[] {
  const annotations: AnnotatedChange[] = [];

  for (const diff of diffs) {
    const functions = functionMap.get(diff.file_path) ?? [];

    for (const hunk of diff.hunks) {
      const affectedFunctions = findAffectedFunctions(hunk, functions);

      if (affectedFunctions.length === 0) {
        annotations.push({
          file_path: diff.file_path,
          function_name: "<module-level>",
          function_hash: `module::${diff.file_path}`,
          class_name: null,
          change_type: inferChangeType(diff, hunk),
          reason: context.reason,
          reason_source: context.reason_source,
          hunks: [hunk],
          start_line: hunk.new_start,
          end_line: hunk.new_start + hunk.new_count,
        });
      } else {
        for (const fn of affectedFunctions) {
          const identity = computeFunctionIdentity(diff.file_path, fn);
          annotations.push({
            file_path: diff.file_path,
            function_name: fn.name,
            function_hash: identity.hash,
            class_name: fn.class_name,
            change_type: inferChangeType(diff, hunk),
            reason: context.reason,
            reason_source: context.reason_source,
            hunks: [hunk],
            start_line: fn.start_line,
            end_line: fn.end_line,
          });
        }
      }
    }
  }

  return deduplicateByFunction(annotations);
}

export function toChangeRecords(
  annotations: AnnotatedChange[],
  sessionId: string
): ChangeRecord[] {
  return annotations.map((a) => ({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    file_path: a.file_path,
    function_hash: a.function_hash,
    function_name: a.function_name,
    class_name: a.class_name,
    change_type: a.change_type,
    reason: a.reason,
    reason_source: a.reason_source,
    old_content: extractOldContent(a.hunks),
    new_content: extractNewContent(a.hunks),
    start_line: a.start_line,
    end_line: a.end_line,
    test_status: "pending",
    test_file: null,
    error_id: null,
    session_id: sessionId,
  }));
}

function findAffectedFunctions(
  hunk: DiffHunk,
  functions: FunctionSignature[]
): FunctionSignature[] {
  const hunkStart = hunk.new_start;
  const hunkEnd = hunk.new_start + hunk.new_count;

  return functions.filter(
    (fn) => fn.start_line <= hunkEnd && fn.end_line >= hunkStart
  );
}

function inferChangeType(
  diff: FileDiff,
  _hunk: DiffHunk
): ChangeRecord["change_type"] {
  if (diff.status === "added") return "add";
  if (diff.status === "deleted") return "delete";
  if (diff.status === "renamed") return "rename";
  return "modify";
}

export function deduplicateByFunction(
  annotations: AnnotatedChange[]
): AnnotatedChange[] {
  const byKey = new Map<string, AnnotatedChange>();

  for (const a of annotations) {
    const key = `${a.file_path}::${a.function_hash}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.hunks.push(...a.hunks);
      existing.start_line = Math.min(existing.start_line, a.start_line);
      existing.end_line = Math.max(existing.end_line, a.end_line);
    } else {
      byKey.set(key, { ...a });
    }
  }

  return Array.from(byKey.values());
}

function extractOldContent(hunks: DiffHunk[]): string {
  return hunks
    .flatMap((h) => h.lines.filter((l) => l.type === "delete").map((l) => l.content))
    .join("\n");
}

function extractNewContent(hunks: DiffHunk[]): string {
  return hunks
    .flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.content))
    .join("\n");
}
