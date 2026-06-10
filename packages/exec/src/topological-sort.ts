import type { DagGraph, ExecutionLayer, FnNode } from "./types.js";
import { CycleDetectedError } from "./types.js";

export function topologicalSort(graph: DagGraph): ExecutionLayer[] {
  const nodeMap = new Map<string, FnNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    dependents.set(node.id, []);
  }

  for (const node of graph.nodes) {
    inDegree.set(node.id, node.depends_on.length);
    for (const dep of node.depends_on) {
      dependents.get(dep)!.push(node.id);
    }
  }

  const layers: ExecutionLayer[] = [];
  const processed = new Set<string>();

  let frontier = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();

  while (frontier.length > 0) {
    const layer: FnNode[] = frontier.map((id) => nodeMap.get(id)!);
    layers.push({ nodes: layer });

    const nextFrontier: string[] = [];
    for (const id of frontier) {
      processed.add(id);
      for (const dependent of dependents.get(id)!) {
        const newDeg = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          nextFrontier.push(dependent);
        }
      }
    }

    frontier = nextFrontier.sort();
  }

  if (processed.size < graph.nodes.length) {
    const cycleNodes = graph.nodes
      .filter((n) => !processed.has(n.id))
      .map((n) => n.id);
    throw new CycleDetectedError(cycleNodes);
  }

  return layers;
}
