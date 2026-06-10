import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "extractParams-tests");
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

describe("extractParams", () => {
  it("should return empty array for function with no parameters", async () => {
    const filePath = await writeTmpPython(
      "no_params.py",
      "def noop():\n    pass\n"
    );
    const result = await parseFile(filePath);

    expect(result.functions[0].params).toEqual([]);
  });

  it("should extract a single untyped parameter", async () => {
    const filePath = await writeTmpPython(
      "single_param.py",
      "def greet(name):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(1);
    expect(params[0]).toEqual({
      name: "name",
      type: null,
      default_value: null,
      is_args: false,
      is_kwargs: false,
    });
  });

  it("should extract multiple untyped parameters", async () => {
    const filePath = await writeTmpPython(
      "multi_params.py",
      "def add(a, b, c):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(3);
    expect(params.map((p) => p.name)).toEqual(["a", "b", "c"]);
    params.forEach((p) => {
      expect(p.type).toBeNull();
      expect(p.default_value).toBeNull();
      expect(p.is_args).toBe(false);
      expect(p.is_kwargs).toBe(false);
    });
  });

  it("should extract typed parameters", async () => {
    const filePath = await writeTmpPython(
      "typed_params.py",
      "def process(x: int, y: str):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe("x");
    expect(params[0].type).toBe("int");
    expect(params[1].name).toBe("y");
    expect(params[1].type).toBe("str");
  });

  it("should extract complex type annotations", async () => {
    const filePath = await writeTmpPython(
      "complex_types.py",
      "def transform(items: list[dict[str, int]], callback: Callable[[int], bool]):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe("items");
    expect(params[0].type).toBe("list[dict[str, int]]");
    expect(params[1].name).toBe("callback");
    expect(params[1].type).toBe("Callable[[int], bool]");
  });

  it("should extract default parameter values", async () => {
    const filePath = await writeTmpPython(
      "defaults.py",
      "def connect(host='localhost', port=5432, ssl=True):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(3);
    expect(params[0].name).toBe("host");
    expect(params[0].default_value).toBe("'localhost'");
    expect(params[0].type).toBeNull();
    expect(params[1].name).toBe("port");
    expect(params[1].default_value).toBe("5432");
    expect(params[2].name).toBe("ssl");
    expect(params[2].default_value).toBe("True");
  });

  it("should extract typed parameters with default values", async () => {
    const filePath = await writeTmpPython(
      "typed_defaults.py",
      "def fetch(url: str, timeout: int = 30, retries: int = 3):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(3);
    expect(params[0].name).toBe("url");
    expect(params[0].type).toBe("str");
    expect(params[0].default_value).toBeNull();
    expect(params[1].name).toBe("timeout");
    expect(params[1].type).toBe("int");
    expect(params[1].default_value).toBe("30");
    expect(params[2].name).toBe("retries");
    expect(params[2].type).toBe("int");
    expect(params[2].default_value).toBe("3");
  });

  it("should detect *args parameter", async () => {
    const filePath = await writeTmpPython(
      "args.py",
      "def variadic(*args):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(1);
    expect(params[0]).toEqual({
      name: "args",
      type: null,
      default_value: null,
      is_args: true,
      is_kwargs: false,
    });
  });

  it("should detect **kwargs parameter", async () => {
    const filePath = await writeTmpPython(
      "kwargs.py",
      "def flexible(**kwargs):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(1);
    expect(params[0]).toEqual({
      name: "kwargs",
      type: null,
      default_value: null,
      is_args: false,
      is_kwargs: true,
    });
  });

  it("should handle mixed parameter types in order", async () => {
    const filePath = await writeTmpPython(
      "mixed.py",
      "def mixed(a, b: int, c=10, *args, **kwargs):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params.length).toBeGreaterThanOrEqual(5);

    const regular = params.find((p) => p.name === "a");
    expect(regular).toBeDefined();
    expect(regular!.type).toBeNull();
    expect(regular!.default_value).toBeNull();
    expect(regular!.is_args).toBe(false);
    expect(regular!.is_kwargs).toBe(false);

    const typed = params.find((p) => p.name === "b");
    expect(typed).toBeDefined();
    expect(typed!.type).toBe("int");

    const defaulted = params.find((p) => p.name === "c");
    expect(defaulted).toBeDefined();
    expect(defaulted!.default_value).toBe("10");

    const args = params.find((p) => p.is_args);
    expect(args).toBeDefined();
    expect(args!.name).toBe("args");

    const kwargs = params.find((p) => p.is_kwargs);
    expect(kwargs).toBeDefined();
    expect(kwargs!.name).toBe("kwargs");
  });

  it("should handle self parameter in methods", async () => {
    const filePath = await writeTmpPython(
      "method_self.py",
      [
        "class Service:",
        "    def process(self, data: str, verbose: bool = False):",
        "        pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const params = result.classes[0].methods[0].params;
    expect(params[0].name).toBe("self");
    expect(params[0].type).toBeNull();
    expect(params[1].name).toBe("data");
    expect(params[1].type).toBe("str");
    expect(params[2].name).toBe("verbose");
    expect(params[2].type).toBe("bool");
    expect(params[2].default_value).toBe("False");
  });

  it("should handle cls parameter in classmethods", async () => {
    const filePath = await writeTmpPython(
      "classmethod.py",
      [
        "class Factory:",
        "    @classmethod",
        "    def create(cls, name: str):",
        "        pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const params = result.classes[0].methods[0].params;
    expect(params[0].name).toBe("cls");
    expect(params[1].name).toBe("name");
    expect(params[1].type).toBe("str");
  });

  it("should handle None as default value", async () => {
    const filePath = await writeTmpPython(
      "none_default.py",
      "def maybe(value: str = None):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params[0].name).toBe("value");
    expect(params[0].type).toBe("str");
    expect(params[0].default_value).toBe("None");
  });

  it("should handle list/dict literal defaults", async () => {
    const filePath = await writeTmpPython(
      "literal_defaults.py",
      "def config(items=[], options={}):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params[0].name).toBe("items");
    expect(params[0].default_value).toBe("[]");
    expect(params[1].name).toBe("options");
    expect(params[1].default_value).toBe("{}");
  });

  it("should handle Optional type annotation", async () => {
    const filePath = await writeTmpPython(
      "optional_type.py",
      "def find(key: str, fallback: Optional[int] = None):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params[1].name).toBe("fallback");
    expect(params[1].type).toBe("Optional[int]");
    expect(params[1].default_value).toBe("None");
  });

  it("should handle only *args and **kwargs", async () => {
    const filePath = await writeTmpPython(
      "only_splats.py",
      "def catch_all(*args, **kwargs):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const params = result.functions[0].params;
    expect(params).toHaveLength(2);
    expect(params[0].is_args).toBe(true);
    expect(params[0].name).toBe("args");
    expect(params[1].is_kwargs).toBe(true);
    expect(params[1].name).toBe("kwargs");
  });

  it("should preserve parameter order", async () => {
    const filePath = await writeTmpPython(
      "order.py",
      "def ordered(first: int, second: str, third: float = 1.0):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const names = result.functions[0].params.map((p) => p.name);
    expect(names).toEqual(["first", "second", "third"]);
  });
});
