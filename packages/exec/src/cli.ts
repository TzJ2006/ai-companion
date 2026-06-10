#!/usr/bin/env npx tsx
/**
 * CLI entry for @aidev/exec — invoked by the /ccedit skill (skills/ccedit/SKILL.md).
 *
 * Subcommands:
 *   parse <ecl>                       validate the FN DAG; report node/edge/layer counts
 *   state <ecl>                       print execution state (ready / pending / blocked / done)
 *   set-status <ecl> <id> <status>    atomically write an FN's status (pending|in-progress|done|blocked)
 *   verify <ecl> <id>                 run an FN's verify.command; exit 1 on failure
 *
 * Only this CLI (driven by the ccedit orchestrator) writes ECL status — never subagents.
 */
import {
  parseEclDag,
  getExecutionState,
  topologicalSort,
  updateFnStatus,
  runVerification,
} from "./index.js";
import type { FnNode, FnStatus } from "./index.js";

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

const ids = (nodes: FnNode[]): string =>
  nodes.length ? nodes.map((n) => n.id).join(", ") : "(none)";

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case "parse": {
      const eclPath = rest[0];
      if (!eclPath) return fail("usage: cli.ts parse <ecl-path>");
      const graph = await parseEclDag(eclPath);
      const edgeCount = Array.from(graph.edges.values()).reduce(
        (n, deps) => n + deps.length,
        0
      );
      const layers = topologicalSort(graph);
      console.log(
        `OK: ${graph.nodes.length} nodes, ${edgeCount} edges, ${layers.length} layers`
      );
      return;
    }

    case "state": {
      const eclPath = rest[0];
      if (!eclPath) return fail("usage: cli.ts state <ecl-path>");
      const s = getExecutionState(await parseEclDag(eclPath));
      console.log(`ready:   ${ids(s.ready)}`);
      console.log(`pending: ${ids(s.pending)}`);
      console.log(`blocked: ${ids(s.blocked)}`);
      console.log(`done:    ${ids(s.done)}`);
      if (!s.ready.length && !s.pending.length && !s.blocked.length) {
        console.log("ALL DONE");
      }
      return;
    }

    case "set-status": {
      const [eclPath, fnId, status] = rest;
      if (!eclPath || !fnId || !status) {
        return fail(
          "usage: cli.ts set-status <ecl-path> <fn-id> <pending|in-progress|done|blocked>"
        );
      }
      const valid: FnStatus[] = ["pending", "in-progress", "done", "blocked"];
      if (!valid.includes(status as FnStatus)) {
        return fail(`invalid status '${status}' (one of: ${valid.join(", ")})`);
      }
      await updateFnStatus(eclPath, fnId, status as FnStatus);
      console.log(`OK: ${fnId} -> ${status}`);
      return;
    }

    case "verify": {
      const [eclPath, fnId] = rest;
      if (!eclPath || !fnId) return fail("usage: cli.ts verify <ecl-path> <fn-id>");
      const node = (await parseEclDag(eclPath)).nodes.find((n) => n.id === fnId);
      if (!node) return fail(`FN not found: ${fnId}`);
      const result = await runVerification(node.verify);
      console.log(`verify ${fnId}: ${result.passed ? "PASS" : "FAIL"}`);
      if (result.output) console.log(result.output);
      if (result.error) console.error(result.error);
      if (!result.passed) process.exitCode = 1;
      return;
    }

    default:
      return fail(
        `unknown command: ${cmd ?? "(none)"}\n` +
          "usage: cli.ts <parse|state|set-status|verify> <ecl-path> [...]"
      );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
