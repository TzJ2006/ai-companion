import { Node as SyntaxNode } from "web-tree-sitter";
import type {
  FunctionSignature,
  FunctionParam,
  ClassInfo,
  ImportInfo,
  ParsedModule,
} from "./types.js";
import { createLanguageParser } from "./parser-factory.js";

const tsParser = createLanguageParser({
  packageName: "tree-sitter-typescript",
  wasmFileName: "tree-sitter-typescript.wasm",
  parseModule: parseTsModule,
});

export const initTsParser = tsParser.init;
export const parseTsSource = tsParser.parseSource;
export const parseTsFile = tsParser.parseFile;

function parseTsModule(rootNode: SyntaxNode, filePath: string): ParsedModule {
  const functions: FunctionSignature[] = [];
  const classes: ClassInfo[] = [];
  const imports: ImportInfo[] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;
    switch (child.type) {
      case "function_declaration":
        functions.push(extractTsFunction(child, null));
        break;
      case "lexical_declaration":
        extractArrowFunctions(child, functions);
        break;
      case "export_statement":
        handleExportStatement(child, functions, classes, imports);
        break;
      case "class_declaration":
        classes.push(extractTsClass(child));
        break;
      case "import_statement":
        imports.push(extractTsImport(child));
        break;
      case "interface_declaration":
      case "type_alias_declaration":
        break;
    }
  }

  return { file_path: filePath, functions, classes, imports };
}

export function extractTsFunction(
  node: SyntaxNode,
  className: string | null
): FunctionSignature {
  const nameNode = node.childForFieldName("name");
  const paramsNode = node.childForFieldName("parameters");
  const returnTypeNode = node.childForFieldName("return_type");

  const name = nameNode?.text ?? "";
  const params = paramsNode ? extractTsParams(paramsNode) : [];
  const return_type = returnTypeNode ? cleanTypeAnnotation(returnTypeNode.text) : null;
  const is_async = node.text.startsWith("async ");

  const docstring = extractJsDoc(node);

  return {
    name,
    params,
    return_type,
    decorators: [],
    is_method: className !== null,
    is_async,
    class_name: className,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    docstring,
  };
}

export function extractArrowFunctions(
  node: SyntaxNode,
  functions: FunctionSignature[]
): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const declarator = node.namedChild(i)!;
    if (declarator.type !== "variable_declarator") continue;

    const nameNode = declarator.childForFieldName("name");
    const valueNode = declarator.childForFieldName("value");

    if (!valueNode || valueNode.type !== "arrow_function") continue;

    const paramsNode = valueNode.childForFieldName("parameters");
    const returnTypeNode = valueNode.childForFieldName("return_type");

    const name = nameNode?.text ?? "";
    const params = paramsNode ? extractTsParams(paramsNode) : [];
    const return_type = returnTypeNode ? cleanTypeAnnotation(returnTypeNode.text) : null;
    const is_async = valueNode.text.startsWith("async ");

    functions.push({
      name,
      params,
      return_type,
      decorators: [],
      is_method: false,
      is_async,
      class_name: null,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      docstring: extractJsDoc(node),
    });
  }
}

export function handleExportStatement(
  node: SyntaxNode,
  functions: FunctionSignature[],
  classes: ClassInfo[],
  imports: ImportInfo[]
): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    switch (child.type) {
      case "function_declaration":
        functions.push(extractTsFunction(child, null));
        break;
      case "lexical_declaration":
        extractArrowFunctions(child, functions);
        break;
      case "class_declaration":
        classes.push(extractTsClass(child));
        break;
    }
  }
}

export function extractTsParams(node: SyntaxNode): FunctionParam[] {
  const params: FunctionParam[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;

    switch (child.type) {
      case "required_parameter":
      case "optional_parameter": {
        const nameNode = child.childForFieldName("pattern") ?? child.childForFieldName("name");
        const typeNode = child.childForFieldName("type");
        const valueNode = child.childForFieldName("value");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? cleanTypeAnnotation(typeNode.text) : null,
          default_value: valueNode?.text ?? null,
          is_args: false,
          is_kwargs: false,
        });
        break;
      }
      case "rest_parameter": {
        const nameNode = child.childForFieldName("pattern") ?? child.childForFieldName("name");
        const typeNode = child.childForFieldName("type");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? cleanTypeAnnotation(typeNode.text) : null,
          default_value: null,
          is_args: true,
          is_kwargs: false,
        });
        break;
      }
    }
  }

  return params;
}

export function extractTsClass(node: SyntaxNode): ClassInfo {
  const nameNode = node.childForFieldName("name");
  const bodyNode = node.childForFieldName("body");
  const heritageNode = node.namedChildren.find(
    (c): c is SyntaxNode => c != null && c.type === "class_heritage"
  );

  const name = nameNode?.text ?? "";
  const bases: string[] = [];
  if (heritageNode) {
    for (let i = 0; i < heritageNode.namedChildCount; i++) {
      const clause = heritageNode.namedChild(i)!;
      if (clause.type === "extends_clause" || clause.type === "implements_clause") {
        for (let j = 0; j < clause.namedChildCount; j++) {
          const typeNode = clause.namedChild(j)!;
          bases.push(typeNode.text);
        }
      }
    }
  }

  const methods: FunctionSignature[] = [];
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const child = bodyNode.namedChild(i)!;
      if (child.type === "method_definition") {
        methods.push(extractTsMethod(child, name));
      } else if (child.type === "public_field_definition") {
        const valueNode = child.childForFieldName("value");
        if (valueNode?.type === "arrow_function") {
          const fieldName = child.childForFieldName("name");
          const paramsNode = valueNode.childForFieldName("parameters");
          const returnTypeNode = valueNode.childForFieldName("return_type");
          methods.push({
            name: fieldName?.text ?? "",
            params: paramsNode ? extractTsParams(paramsNode) : [],
            return_type: returnTypeNode ? cleanTypeAnnotation(returnTypeNode.text) : null,
            decorators: [],
            is_method: true,
            is_async: valueNode.text.startsWith("async "),
            class_name: name,
            start_line: child.startPosition.row + 1,
            end_line: child.endPosition.row + 1,
            docstring: null,
          });
        }
      }
    }
  }

  return {
    name,
    methods,
    decorators: [],
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    bases,
  };
}

export function extractTsMethod(
  node: SyntaxNode,
  className: string
): FunctionSignature {
  const nameNode = node.childForFieldName("name");
  const paramsNode = node.childForFieldName("parameters");
  const returnTypeNode = node.childForFieldName("return_type");

  const name = nameNode?.text ?? "";
  const params = paramsNode ? extractTsParams(paramsNode) : [];
  const return_type = returnTypeNode ? cleanTypeAnnotation(returnTypeNode.text) : null;
  const is_async = node.text.startsWith("async ") ||
    node.namedChildren.some((c): c is SyntaxNode => c != null && c.type === "async");

  return {
    name,
    params,
    return_type,
    decorators: extractTsDecorators(node),
    is_method: true,
    is_async,
    class_name: className,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    docstring: extractJsDoc(node),
  };
}

export function extractTsDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = [];
  let prev = node.previousNamedSibling;
  while (prev && prev.type === "decorator") {
    decorators.unshift(prev.text.slice(1));
    prev = prev.previousNamedSibling;
  }
  return decorators;
}

export function extractJsDoc(node: SyntaxNode): string | null {
  const prev = node.previousSibling;
  if (prev && prev.type === "comment" && prev.text.startsWith("/**")) {
    return prev.text
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\* ?/gm, "")
      .trim();
  }
  return null;
}

export function extractTsImport(node: SyntaxNode): ImportInfo {
  const sourceNode = node.childForFieldName("source");
  const module = sourceNode?.text.replace(/^['"]|['"]$/g, "") ?? "";

  const names: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "import_clause") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const inner = child.namedChild(j)!;
        if (inner.type === "identifier") {
          names.push(inner.text);
        } else if (inner.type === "named_imports") {
          for (let k = 0; k < inner.namedChildCount; k++) {
            const spec = inner.namedChild(k)!;
            if (spec.type === "import_specifier") {
              names.push(spec.text);
            }
          }
        } else if (inner.type === "namespace_import") {
          names.push(inner.text);
        }
      }
    }
  }

  return { module, names, is_from: true, line: node.startPosition.row + 1 };
}

export function cleanTypeAnnotation(text: string): string {
  return text.replace(/^:\s*/, "").trim();
}
