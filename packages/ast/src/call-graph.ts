import { Node as SyntaxNode } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createLanguageParser } from "./parser-factory.js";
import { PYTHON_EXTENSIONS, TS_EXTENSIONS } from "./multi-lang.js";

export interface CallGraphEntry {
  function_name: string;
  class_name: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
  calls: string[];
}

export interface CallGraph {
  entries: CallGraphEntry[];
  reverse_index: Record<string, string[]>;
}

// parseModule is never used here — analyzeFileCalls only calls init() + parseSource().
const emptyModule = (_rootNode: unknown, filePath: string) => ({
  file_path: filePath,
  functions: [],
  classes: [],
  imports: [],
});

const tsCallParser = createLanguageParser({
  packageName: "tree-sitter-typescript",
  wasmFileName: "tree-sitter-typescript.wasm",
  parseModule: emptyModule,
});

const pyCallParser = createLanguageParser({
  packageName: "tree-sitter-python",
  wasmFileName: "tree-sitter-python.wasm",
  parseModule: emptyModule,
});

export async function analyzeFileCalls(filePath: string): Promise<CallGraphEntry[]> {
  const ext = extname(filePath).toLowerCase();
  let rootNode: SyntaxNode;

  if (TS_EXTENSIONS.has(ext)) {
    await tsCallParser.init();
    const source = await readFile(filePath, "utf-8");
    const tree = tsCallParser.parseSource(source);
    rootNode = tree.rootNode;
    return extractCallsFromTs(rootNode, filePath);
  }

  if (PYTHON_EXTENSIONS.has(ext)) {
    await pyCallParser.init();
    const source = await readFile(filePath, "utf-8");
    const tree = pyCallParser.parseSource(source);
    rootNode = tree.rootNode;
    return extractCallsFromPython(rootNode, filePath);
  }

  return [];
}

function extractCallsFromTs(rootNode: SyntaxNode, filePath: string): CallGraphEntry[] {
  const entries: CallGraphEntry[] = [];
  walkTsNode(rootNode, null, filePath, entries);
  return entries;
}

function walkTsNode(
  node: SyntaxNode,
  className: string | null,
  filePath: string,
  entries: CallGraphEntry[]
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;

    switch (child.type) {
      case "function_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        const body = child.childForFieldName("body");
        if (name && body) {
          entries.push({
            function_name: name,
            class_name: className,
            file_path: filePath,
            start_line: child.startPosition.row + 1,
            end_line: child.endPosition.row + 1,
            calls: collectCallExpressions(body),
          });
        }
        break;
      }
      case "lexical_declaration": {
        for (let j = 0; j < child.namedChildCount; j++) {
          const declarator = child.namedChild(j)!;
          if (declarator.type !== "variable_declarator") continue;
          const nameNode = declarator.childForFieldName("name");
          const valueNode = declarator.childForFieldName("value");
          if (valueNode?.type === "arrow_function") {
            const body = valueNode.childForFieldName("body");
            if (nameNode && body) {
              entries.push({
                function_name: nameNode.text,
                class_name: className,
                file_path: filePath,
                start_line: child.startPosition.row + 1,
                end_line: child.endPosition.row + 1,
                calls: collectCallExpressions(body),
              });
            }
          }
        }
        break;
      }
      case "export_statement": {
        walkTsNode(child, className, filePath, entries);
        break;
      }
      case "class_declaration": {
        const clsName = child.childForFieldName("name")?.text ?? "";
        const body = child.childForFieldName("body");
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            const member = body.namedChild(j)!;
            if (member.type === "method_definition") {
              const methodName = member.childForFieldName("name")?.text ?? "";
              const methodBody = member.childForFieldName("body");
              if (methodName && methodBody) {
                entries.push({
                  function_name: methodName,
                  class_name: clsName,
                  file_path: filePath,
                  start_line: member.startPosition.row + 1,
                  end_line: member.endPosition.row + 1,
                  calls: collectCallExpressions(methodBody),
                });
              }
            } else if (member.type === "public_field_definition") {
              const valueNode = member.childForFieldName("value");
              if (valueNode?.type === "arrow_function") {
                const fieldName = member.childForFieldName("name")?.text ?? "";
                const fieldBody = valueNode.childForFieldName("body");
                if (fieldName && fieldBody) {
                  entries.push({
                    function_name: fieldName,
                    class_name: clsName,
                    file_path: filePath,
                    start_line: member.startPosition.row + 1,
                    end_line: member.endPosition.row + 1,
                    calls: collectCallExpressions(fieldBody),
                  });
                }
              }
            }
          }
        }
        break;
      }
    }
  }
}

function extractCallsFromPython(rootNode: SyntaxNode, filePath: string): CallGraphEntry[] {
  const entries: CallGraphEntry[] = [];
  walkPythonNode(rootNode, null, filePath, entries);
  return entries;
}

function walkPythonNode(
  node: SyntaxNode,
  className: string | null,
  filePath: string,
  entries: CallGraphEntry[]
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;

    switch (child.type) {
      case "function_definition": {
        const name = child.childForFieldName("name")?.text ?? "";
        const body = child.childForFieldName("body");
        if (name && body) {
          entries.push({
            function_name: name,
            class_name: className,
            file_path: filePath,
            start_line: child.startPosition.row + 1,
            end_line: child.endPosition.row + 1,
            calls: collectPythonCalls(body),
          });
        }
        break;
      }
      case "decorated_definition": {
        const funcNode = child.namedChildren.find(
          (c): c is SyntaxNode => c != null && c.type === "function_definition"
        );
        if (funcNode) {
          const name = funcNode.childForFieldName("name")?.text ?? "";
          const body = funcNode.childForFieldName("body");
          if (name && body) {
            entries.push({
              function_name: name,
              class_name: className,
              file_path: filePath,
              start_line: child.startPosition.row + 1,
              end_line: child.endPosition.row + 1,
              calls: collectPythonCalls(body),
            });
          }
        }
        break;
      }
      case "class_definition": {
        const clsName = child.childForFieldName("name")?.text ?? "";
        const body = child.childForFieldName("body");
        if (body) {
          walkPythonNode(body, clsName, filePath, entries);
        }
        break;
      }
    }
  }
}

function collectCallExpressions(node: SyntaxNode): string[] {
  const calls = new Set<string>();
  walkForCalls(node, calls, "call_expression");
  return [...calls];
}

function collectPythonCalls(node: SyntaxNode): string[] {
  const calls = new Set<string>();
  walkForCalls(node, calls, "call");
  return [...calls];
}

function walkForCalls(node: SyntaxNode, calls: Set<string>, callType: string): void {
  if (node.type === callType) {
    const funcNode = node.childForFieldName("function");
    if (funcNode) {
      const callee = resolveCalleeName(funcNode);
      if (callee) {
        calls.add(callee);
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkForCalls(child, calls, callType);
    }
  }
}

function resolveCalleeName(node: SyntaxNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "member_expression":
    case "attribute": {
      const property = node.childForFieldName("property") ?? node.childForFieldName("attribute");
      return property?.text ?? null;
    }
    case "scoped_identifier": {
      const name = node.childForFieldName("name");
      return name?.text ?? null;
    }
    default:
      return null;
  }
}

export function buildCallGraph(entries: CallGraphEntry[]): CallGraph {
  const reverse_index: Record<string, string[]> = {};

  for (const entry of entries) {
    const callerId = formatFunctionId(entry.file_path, entry.class_name, entry.function_name);

    for (const calledName of entry.calls) {
      const targets = findTargets(entries, calledName);
      for (const target of targets) {
        const targetId = formatFunctionId(target.file_path, target.class_name, target.function_name);
        if (!reverse_index[targetId]) {
          reverse_index[targetId] = [];
        }
        if (!reverse_index[targetId].includes(callerId)) {
          reverse_index[targetId].push(callerId);
        }
      }
    }
  }

  return { entries, reverse_index };
}

function findTargets(entries: CallGraphEntry[], calledName: string): CallGraphEntry[] {
  return entries.filter((e) => e.function_name === calledName);
}

export function formatFunctionId(filePath: string, className: string | null, functionName: string): string {
  if (className) {
    return `${filePath}::${className}.${functionName}`;
  }
  return `${filePath}::${functionName}`;
}
