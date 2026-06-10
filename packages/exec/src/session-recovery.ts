import type { DagGraph, FnNode, ExecutionState } from "./types.js";

export function getExecutionState(graph: DagGraph): ExecutionState {
  const done: FnNode[] = [];
  const blocked: FnNode[] = [];
  const ready: FnNode[] = [];
  const pending: FnNode[] = [];

  const statusMap = new Map<string, FnNode["status"]>();
  for (const node of graph.nodes) {
    statusMap.set(node.id, node.status);
  }

  for (const node of graph.nodes) {
    switch (node.status) {
      case "done":
        done.push(node);
        break;
      case "blocked":
        blocked.push(node);
        break;
      case "in-progress":
        pending.push(node);
        break;
      case "pending": {
        const allDepsDone = node.depends_on.every(
          (depId) => statusMap.get(depId) === "done"
        );
        if (allDepsDone) {
          ready.push(node);
        } else {
          pending.push(node);
        }
        break;
      }
      default:
        pending.push(node);
    }
  }

  ready.sort((a, b) => a.id.localeCompare(b.id));

  return { ready, blocked, done, pending };
}

export function getReadyNodes(graph: DagGraph): FnNode[] {
  return getExecutionState(graph).ready;
}
