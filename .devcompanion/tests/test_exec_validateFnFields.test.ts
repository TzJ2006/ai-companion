import { describe, it, expect } from "vitest";
import { validateFnFields } from "../../packages/exec/src/parse-ecl-dag.js";
import { EclParseError } from "../../packages/exec/src/types.js";

const validFn = {
  id: "FN-001",
  name: "testFunc",
  parent: "MOD-001",
  visibility: "public",
  description: "A test function",
  input_interface: [],
  output_interface: { type: "string", error_cases: [] },
  side_effects: [],
  dependencies: [],
  constraints: [],
  test_cases: [],
  depends_on: [],
  enables: [],
  output: { file: "src/test.ts", symbol: "testFunc" },
  verify: { command: "npx vitest run test.ts", pass_condition: "exit 0" },
  status: "pending",
};

describe("validateFnFields", () => {
  it("returns typed FnNode for valid input", () => {
    const result = validateFnFields({ ...validFn });
    expect(result.id).toBe("FN-001");
    expect(result.output.file).toBe("src/test.ts");
    expect(result.verify.command).toBe("npx vitest run test.ts");
  });

  it("throws when id is missing", () => {
    const { id, ...noId } = validFn;
    expect(() => validateFnFields(noId)).toThrow(EclParseError);
    expect(() => validateFnFields(noId)).toThrow("missing required field: id");
  });

  it("throws when output.file is missing", () => {
    const fn = { ...validFn, output: { symbol: "x" } };
    expect(() => validateFnFields(fn as never)).toThrow("missing output.file");
  });

  it("throws when output.symbol is missing", () => {
    const fn = { ...validFn, output: { file: "x.ts" } };
    expect(() => validateFnFields(fn as never)).toThrow("missing output.symbol");
  });

  it("throws when verify.command is missing", () => {
    const fn = { ...validFn, verify: { pass_condition: "exit 0" } };
    expect(() => validateFnFields(fn as never)).toThrow("missing verify.command");
  });

  it("throws when depends_on is not an array", () => {
    const fn = { ...validFn, depends_on: "FN-002" };
    expect(() => validateFnFields(fn as never)).toThrow("depends_on must be an array");
  });
});
