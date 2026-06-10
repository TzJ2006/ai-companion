export interface FnOutput {
  file: string;
  symbol: string;
}

export interface FnVerify {
  command: string;
  pass_condition: string;
}

export type FnStatus = "pending" | "in-progress" | "done" | "blocked";

export interface FnNode {
  id: string;
  name: string;
  parent: string;
  visibility: string;
  description: string;
  input_interface: Array<{ name: string; type: string; source: string }>;
  output_interface: { type: string; error_cases: Array<{ type: string; when: string }> };
  side_effects: string[];
  dependencies: string[];
  constraints: string[];
  test_cases: Array<{ input: string; expected: string; mocks: string[] }>;
  depends_on: string[];
  enables: string[];
  output: FnOutput;
  verify: FnVerify;
  status: FnStatus;
}

export interface DagGraph {
  nodes: FnNode[];
  edges: Map<string, string[]>;
}

export interface ExecutionLayer {
  nodes: FnNode[];
}

export interface VerificationResult {
  passed: boolean;
  output: string;
  error?: string;
}

export interface ExecutionState {
  ready: FnNode[];
  blocked: FnNode[];
  done: FnNode[];
  pending: FnNode[];
}

export interface SubagentContext {
  fn: FnNode;
  outputFile: string;
  outputSymbol: string;
  moduleInterface: ModuleInterface | null;
  completedDeps: CompletedDep[];
}

export interface ModuleInterface {
  name: string;
  entry_point: string;
  public_interface: Array<{ name: string; signature?: string; description: string }>;
}

export interface CompletedDep {
  fnId: string;
  outputFile: string;
  outputSymbol: string;
}

export interface ExecConfig {
  maxConcurrency: number;
}

export class EclParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EclParseError";
  }
}

export class CycleDetectedError extends Error {
  public involvedNodes: string[];
  constructor(nodes: string[]) {
    super(`Cycle detected involving: ${nodes.join(", ")}`);
    this.name = "CycleDetectedError";
    this.involvedNodes = nodes;
  }
}
