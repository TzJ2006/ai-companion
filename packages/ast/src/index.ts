export { initParser, parseFile, parseSource } from "./parser.js";
export { initTsParser, parseTsFile, parseTsSource } from "./ts-parser.js";
export { parseFileAuto, initParsers, getSupportedExtensions } from "./multi-lang.js";
export { computeFunctionIdentity } from "./identity.js";
export { analyzeFileCalls, buildCallGraph, formatFunctionId } from "./call-graph.js";
export type { CallGraphEntry, CallGraph } from "./call-graph.js";
export type {
  FunctionSignature,
  FunctionParam,
  FunctionIdentity,
  ParsedModule,
  ClassInfo,
  ImportInfo,
} from "./types.js";
