import { describe, it, expect } from "vitest";
import { formatSubagentPrompt } from "../../packages/exec/src/build-subagent-context.js";
import type { SubagentContext } from "../../packages/exec/src/types.js";

describe("formatSubagentPrompt", () => {
  it("produces a prompt with all key sections", () => {
    const context: SubagentContext = {
      fn: {
        id: "FN-001",
        name: "authenticate",
        parent: "MOD-001",
        visibility: "public",
        description: "Authenticate user credentials",
        input_interface: [{ name: "credentials", type: "AuthInput", source: "parameter" }],
        output_interface: { type: "Promise<AuthResult>", error_cases: [{ type: "AuthError", when: "invalid" }] },
        side_effects: [],
        dependencies: [],
        constraints: ["Must complete in <200ms"],
        test_cases: [],
        depends_on: [],
        enables: [],
        output: { file: "src/auth.ts", symbol: "authenticate" },
        verify: { command: "npx vitest run auth.test.ts", pass_condition: "exit 0" },
        status: "pending",
      },
      outputFile: "src/auth.ts",
      outputSymbol: "authenticate",
      moduleInterface: {
        name: "Auth Module",
        entry_point: "index.ts",
        public_interface: [
          { name: "authenticate", signature: "(c: AuthInput) => Promise<AuthResult>", description: "Auth entry" },
        ],
      },
      completedDeps: [
        { fnId: "FN-000", outputFile: "src/session.ts", outputSymbol: "createSession" },
      ],
    };

    const prompt = formatSubagentPrompt(context);
    expect(prompt).toContain("## Task: Implement authenticate");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("authenticate");
    expect(prompt).toContain("credentials: AuthInput");
    expect(prompt).toContain("Must complete in <200ms");
    expect(prompt).toContain("Auth Module");
    expect(prompt).toContain("createSession");
    expect(prompt).toContain("npx vitest run auth.test.ts");
  });
});
