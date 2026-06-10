import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "extractImport-tests");
let tmpFiles: string[] = [];

async function writeTmpPython(name: string, content: string): Promise<string> {
  const filePath = join(TMP_DIR, name);
  await writeFile(filePath, content, "utf-8");
  tmpFiles.push(filePath);
  return filePath;
}

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
  await initParser();
});

afterAll(async () => {
  for (const f of tmpFiles) {
    await unlink(f).catch(() => {});
  }
});

describe("extractImport", () => {
  it("should parse a simple import statement", async () => {
    const filePath = await writeTmpPython("simple.py", "import os\n");
    const result = await parseFile(filePath);

    const imp = result.imports.find((i) => i.module === "os");
    expect(imp).toBeDefined();
    expect(imp!.module).toBe("os");
    expect(imp!.names).toContain("os");
    expect(imp!.is_from).toBe(false);
    expect(imp!.line).toBe(1);
  });

  it("should parse a dotted import (import os.path)", async () => {
    const filePath = await writeTmpPython("dotted.py", "import os.path\n");
    const result = await parseFile(filePath);

    const imp = result.imports.find((i) => i.module === "os.path");
    expect(imp).toBeDefined();
    expect(imp!.module).toBe("os.path");
    expect(imp!.is_from).toBe(false);
  });

  it("should parse an aliased import (import numpy as np)", async () => {
    const filePath = await writeTmpPython("alias.py", "import numpy as np\n");
    const result = await parseFile(filePath);

    const imp = result.imports.find((i) => !i.is_from);
    expect(imp).toBeDefined();
    expect(imp!.names.some((n) => n.includes("as np"))).toBe(true);
    expect(imp!.is_from).toBe(false);
  });

  it("should report correct line number for non-first-line import", async () => {
    const filePath = await writeTmpPython(
      "line.py",
      "x = 1\ny = 2\nimport sys\n"
    );
    const result = await parseFile(filePath);

    const imp = result.imports.find((i) => i.module === "sys");
    expect(imp).toBeDefined();
    expect(imp!.line).toBe(3);
  });

  it("should set is_from to false for regular imports", async () => {
    const filePath = await writeTmpPython(
      "flag.py",
      "import os\nfrom sys import argv\n"
    );
    const result = await parseFile(filePath);

    const regularImport = result.imports.find((i) => i.module === "os");
    const fromImport = result.imports.find((i) => i.module === "sys");

    expect(regularImport!.is_from).toBe(false);
    expect(fromImport!.is_from).toBe(true);
  });

  it("should handle multiple regular imports in one file", async () => {
    const filePath = await writeTmpPython(
      "multiple.py",
      ["import os", "import sys", "import json"].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const regularImports = result.imports.filter((i) => !i.is_from);
    expect(regularImports).toHaveLength(3);

    const modules = regularImports.map((i) => i.module);
    expect(modules).toContain("os");
    expect(modules).toContain("sys");
    expect(modules).toContain("json");
  });

  it("should handle deeply nested dotted import", async () => {
    const filePath = await writeTmpPython(
      "deep.py",
      "import xml.etree.ElementTree\n"
    );
    const result = await parseFile(filePath);

    const imp = result.imports.find((i) => !i.is_from);
    expect(imp).toBeDefined();
    expect(imp!.module).toBe("xml.etree.ElementTree");
  });

  it("should return no imports for a file without import statements", async () => {
    const filePath = await writeTmpPython("no_imports.py", "x = 1\ny = 2\n");
    const result = await parseFile(filePath);

    expect(result.imports).toHaveLength(0);
  });

  it("should parse import with multiple comma-separated modules", async () => {
    const filePath = await writeTmpPython(
      "comma.py",
      "import os, sys, json\n"
    );
    const result = await parseFile(filePath);

    const regularImports = result.imports.filter((i) => !i.is_from);
    expect(regularImports.length).toBeGreaterThanOrEqual(1);
    const allNames = regularImports.flatMap((i) => i.names);
    expect(allNames).toContain("os");
  });

  it("should correctly distinguish imports from other statements", async () => {
    const filePath = await writeTmpPython(
      "mixed.py",
      [
        "import os",
        "x = 1",
        "def foo():",
        "    pass",
        "import sys",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const regularImports = result.imports.filter((i) => !i.is_from);
    expect(regularImports).toHaveLength(2);
    expect(regularImports[0].line).toBe(1);
    expect(regularImports[1].line).toBe(5);
  });
});
