import { Parser, Language, Tree, Node as SyntaxNode } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import type { ParsedModule } from "./types.js";
import { resolveWasmPath } from "./wasm-resolver.js";

export interface LanguageParserConfig {
  packageName: string;
  wasmFileName: string;
  parseModule: (rootNode: SyntaxNode, filePath: string) => ParsedModule;
}

export interface LanguageParserInstance {
  init(): Promise<void>;
  parseSource(source: string): Tree;
  parseFile(filePath: string): Promise<ParsedModule>;
}

export function createLanguageParser(config: LanguageParserConfig): LanguageParserInstance {
  let parser: Parser | null = null;
  let language: InstanceType<typeof Language> | null = null;

  async function init(): Promise<void> {
    if (parser) return;
    await Parser.init();
    parser = new Parser();
    const wasmPath = resolveWasmPath(config.packageName, config.wasmFileName);
    language = await Language.load(wasmPath);
    parser.setLanguage(language);
  }

  function parseSource(source: string): Tree {
    if (!parser) throw new Error("Parser not initialized. Call init() first.");
    const tree = parser.parse(source);
    if (!tree) throw new Error("Failed to parse source");
    return tree;
  }

  async function parseFile(filePath: string): Promise<ParsedModule> {
    await init();
    const source = await readFile(filePath, "utf-8");
    const tree = parseSource(source);
    return config.parseModule(tree.rootNode, filePath);
  }

  return { init, parseSource, parseFile };
}

export type { SyntaxNode };
