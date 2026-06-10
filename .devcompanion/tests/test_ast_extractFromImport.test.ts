import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "extractFromImport-tests");
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

describe("extractFromImport", () => {
  it("should parse a simple from-import with one name", async () => {
    const filePath = await writeTmpPython("simple.py", "from os import path\n");
    const result = await parseFile(filePath);

    const fromImport = result.imports.find((i) => i.is_from && i.module === "os");
    expect(fromImport).toBeDefined();
    expect(fromImport!.module).toBe("os");
    expect(fromImport!.names).toContain("path");
    expect(fromImport!.is_from).toBe(true);
    expect(fromImport!.line).toBe(1);
  });

  it("should parse from-import with multiple names", async () => {
    const filePath = await writeTmpPython(
      "multi.py",
      "from collections import OrderedDict, defaultdict, Counter\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find(
      (i) => i.is_from && i.module === "collections"
    );
    expect(fromImport).toBeDefined();
    expect(fromImport!.names).toContain("OrderedDict");
    expect(fromImport!.names).toContain("defaultdict");
    expect(fromImport!.names).toContain("Counter");
  });

  it("should parse from-import with dotted module path", async () => {
    const filePath = await writeTmpPython(
      "dotted.py",
      "from os.path import join, dirname\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find(
      (i) => i.is_from && i.module === "os.path"
    );
    expect(fromImport).toBeDefined();
    expect(fromImport!.module).toBe("os.path");
    expect(fromImport!.names).toContain("join");
    expect(fromImport!.names).toContain("dirname");
  });

  it("should parse from-import with alias", async () => {
    const filePath = await writeTmpPython(
      "alias.py",
      "from datetime import datetime as dt\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find(
      (i) => i.is_from && i.module === "datetime"
    );
    expect(fromImport).toBeDefined();
    expect(fromImport!.names.some((n) => n.includes("as dt"))).toBe(true);
  });

  it("should report correct line number", async () => {
    const filePath = await writeTmpPython(
      "line.py",
      "x = 1\ny = 2\nfrom typing import List\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find(
      (i) => i.is_from && i.module === "typing"
    );
    expect(fromImport).toBeDefined();
    expect(fromImport!.line).toBe(3);
  });

  it("should set is_from to true for from-imports", async () => {
    const filePath = await writeTmpPython(
      "flag.py",
      "from sys import argv\nimport os\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find((i) => i.module === "sys");
    const regularImport = result.imports.find((i) => i.module === "os");

    expect(fromImport!.is_from).toBe(true);
    expect(regularImport!.is_from).toBe(false);
  });

  it("should handle relative import (single dot)", async () => {
    const filePath = await writeTmpPython(
      "relative.py",
      "from . import utils\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find((i) => i.is_from);
    expect(fromImport).toBeDefined();
    expect(fromImport!.names).toContain("utils");
  });

  it("should handle relative import with submodule", async () => {
    const filePath = await writeTmpPython(
      "relative_sub.py",
      "from .models import User, Group\n"
    );
    const result = await parseFile(filePath);

    const fromImport = result.imports.find((i) => i.is_from);
    expect(fromImport).toBeDefined();
    expect(fromImport!.names).toContain("User");
    expect(fromImport!.names).toContain("Group");
  });

  it("should handle multiple from-imports in one file", async () => {
    const filePath = await writeTmpPython(
      "multiple.py",
      [
        "from os import path",
        "from sys import argv",
        "from typing import Dict, Optional",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const fromImports = result.imports.filter((i) => i.is_from);
    expect(fromImports).toHaveLength(3);

    const modules = fromImports.map((i) => i.module);
    expect(modules).toContain("os");
    expect(modules).toContain("sys");
    expect(modules).toContain("typing");
  });

  it("should handle from-import with no names gracefully", async () => {
    const filePath = await writeTmpPython(
      "empty_body.py",
      "x = 1\n"
    );
    const result = await parseFile(filePath);

    const fromImports = result.imports.filter((i) => i.is_from);
    expect(fromImports).toHaveLength(0);
  });
});
