import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseFile, initParser } from "../../packages/ast/src/parser.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = resolve(tmpdir(), "handleDecorated-test-" + Date.now());

async function writePython(name: string, content: string): Promise<string> {
  const filePath = resolve(TMP_DIR, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("handleDecorated", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it("should extract a decorated function with a single decorator", async () => {
    const filePath = await writePython("single_decorator.py", [
      "@app.route('/hello')",
      "def hello():",
      "    return 'world'",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("hello");
    expect(result.functions[0].decorators).toEqual(["app.route('/hello')"]);
  });

  it("should extract a decorated function with multiple decorators", async () => {
    const filePath = await writePython("multi_decorator.py", [
      "@login_required",
      "@cache(timeout=60)",
      "def dashboard():",
      "    pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("dashboard");
    expect(result.functions[0].decorators).toContain("login_required");
    expect(result.functions[0].decorators).toContain("cache(timeout=60)");
    expect(result.functions[0].decorators).toHaveLength(2);
  });

  it("should extract a decorated class", async () => {
    const filePath = await writePython("decorated_class.py", [
      "@dataclass",
      "class User:",
      "    name: str",
      "    age: int",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("User");
    expect(result.classes[0].decorators).toEqual(["dataclass"]);
  });

  it("should handle decorated class with multiple decorators", async () => {
    const filePath = await writePython("multi_dec_class.py", [
      "@singleton",
      "@dataclass(frozen=True)",
      "class Config:",
      "    host: str",
      "    port: int",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Config");
    expect(result.classes[0].decorators).toContain("singleton");
    expect(result.classes[0].decorators).toContain("dataclass(frozen=True)");
  });

  it("should preserve function parameters on decorated functions", async () => {
    const filePath = await writePython("dec_with_params.py", [
      "@validate",
      "def process(data: dict, verbose: bool = False):",
      "    pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.name).toBe("process");
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("data");
    expect(fn.params[0].type).toBe("dict");
    expect(fn.params[1].name).toBe("verbose");
    expect(fn.params[1].type).toBe("bool");
    expect(fn.params[1].default_value).toBe("False");
  });

  it("should not add functions or classes when decorated node has no inner definition", async () => {
    const filePath = await writePython("plain_funcs.py", [
      "def plain():",
      "    pass",
      "",
      "def another():",
      "    pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(2);
    expect(result.functions[0].decorators).toEqual([]);
    expect(result.functions[1].decorators).toEqual([]);
  });

  it("should handle decorated methods inside a class", async () => {
    const filePath = await writePython("class_methods.py", [
      "class Service:",
      "    @staticmethod",
      "    def create():",
      "        pass",
      "",
      "    @classmethod",
      "    def from_config(cls, cfg):",
      "        pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.methods).toHaveLength(2);

    const staticMethod = cls.methods.find((m) => m.name === "create");
    expect(staticMethod).toBeDefined();
    expect(staticMethod!.decorators).toContain("staticmethod");
    expect(staticMethod!.is_method).toBe(true);
    expect(staticMethod!.class_name).toBe("Service");

    const classMethod = cls.methods.find((m) => m.name === "from_config");
    expect(classMethod).toBeDefined();
    expect(classMethod!.decorators).toContain("classmethod");
  });

  it("should handle a mix of decorated and undecorated top-level definitions", async () => {
    const filePath = await writePython("mixed.py", [
      "def plain_func():",
      "    pass",
      "",
      "@app.get('/items')",
      "def get_items():",
      "    pass",
      "",
      "class PlainClass:",
      "    pass",
      "",
      "@register",
      "class Plugin:",
      "    pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(2);
    expect(result.classes).toHaveLength(2);

    const plainFunc = result.functions.find((f) => f.name === "plain_func");
    expect(plainFunc!.decorators).toEqual([]);

    const getItems = result.functions.find((f) => f.name === "get_items");
    expect(getItems!.decorators).toEqual(["app.get('/items')"]);

    const plainClass = result.classes.find((c) => c.name === "PlainClass");
    expect(plainClass!.decorators).toEqual([]);

    const plugin = result.classes.find((c) => c.name === "Plugin");
    expect(plugin!.decorators).toEqual(["register"]);
  });

  it("should set correct start and end lines for decorated functions", async () => {
    const filePath = await writePython("lines.py", [
      "@decorator_one",
      "@decorator_two",
      "def target():",
      "    x = 1",
      "    return x",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.start_line).toBeGreaterThanOrEqual(3);
    expect(fn.end_line).toBe(5);
  });

  it("should handle decorator with complex arguments", async () => {
    const filePath = await writePython("complex_decorator.py", [
      "@app.route('/api/v1/users', methods=['GET', 'POST'])",
      "def users_endpoint():",
      "    pass",
    ].join("\n"));

    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators[0]).toContain("app.route");
    expect(result.functions[0].decorators[0]).toContain("methods=");
  });
});
