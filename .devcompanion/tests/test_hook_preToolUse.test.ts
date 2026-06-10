import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { handlePreToolUse } from "../../packages/hook/src/pre-tool-use.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const SAMPLE_ECL_YAML = `ecl_version: "2.0"
scope: "packages/"
generated_at: "2026-05-17T22:00:00Z"
generated_by: "/ccplan"

features:
  - feature: "wasm-resolver"
    description: "WASM loading for tree-sitter grammar"
    purpose: "Provide AST parsing capability"
    implementation:
      key_files:
        - "packages/ast/src/wasm-resolver.ts"
        - "packages/ast/src/parser.ts"
      approach: "resolveWasmPath handles all WASM path resolution"
      constraints:
        - "resolveWasmPath is the single source of WASM path resolution"
        - "parser.ts delegates to resolveWasmPath, never inline path search"
    verification:
      - name: "WASM path resolution"
        command: "npx vitest run test_ast_findWasmPath.test.ts"
      - name: "No inline WASM paths"
        command: "grep -rn wasm packages/ast/src/"

  - feature: "daemon-processor"
    description: "Background async processing"
    purpose: "Keep hook lightweight"
    implementation:
      key_files:
        - "packages/daemon/src/processor.ts"
      approach: "processor.ts handles the full pipeline"
      constraints:
        - "processQueue uses parseFileAuto, not hardcoded filter"
    verification:
      - name: "processor pipeline test"
        command: "npx vitest run test_daemon_processor.test.ts"
`;

/**
 * Shape the existsSync mock so that:
 *  - the ccplan read-only marker (.devcompanion/.ccplan-active) is NEVER present,
 *    keeping the ccplan guard inert (so it doesn't block + process.exit(1)).
 *  - project-root markers (.devcompanion / .git) and the docs/ecl dir resolve as present,
 *    so findProjectRoot + the feature-guard path are exercised.
 * Additional per-path overrides can be supplied to vary behavior (e.g. hide docs/ecl).
 */
function setupExistsSync(
  extra: (path: string) => boolean | undefined = () => undefined
): void {
  (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
    const path = String(p);
    // The ccplan marker must never appear, or the read-only guard fires first.
    if (path.includes(".ccplan-active")) return false;

    const override = extra(path);
    if (override !== undefined) return override;

    // project root discovery
    if (path.includes(".devcompanion") || path.includes(".git")) return true;
    // docs/ecl directory present by default
    if (path.includes("docs/ecl") || path.includes("docs\\ecl")) return true;
    if (path.includes("docs")) return true;
    return false;
  });
}

describe("handlePreToolUse", () => {
  let stderrOutput: string;
  let stdoutOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrOutput = "";
    stdoutOutput = "";

    // Trap process.exit so a (hypothetical) ccplan block can't abort the test run.
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrOutput += chunk;
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutOutput += chunk;
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should ignore non-JSON input", () => {
    handlePreToolUse("not json");
    expect(stderrOutput).toBe("");
    expect(stdoutOutput).toBe("");
  });

  it("should ignore non-Edit/Write tools", () => {
    setupExistsSync();
    handlePreToolUse(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/a/b.ts" } }));
    expect(stderrOutput).toBe("");
  });

  it("should ignore unsupported extensions", () => {
    setupExistsSync();
    handlePreToolUse(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/a/b.txt" } }));
    expect(stderrOutput).toBe("");
  });

  it("should warn when no docs/ecl/ directory exists", () => {
    // Project root present, but docs/ecl dir missing.
    setupExistsSync((path) => {
      if (path.includes("docs")) return false;
      return undefined;
    });

    handlePreToolUse(JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "/project/src/app.ts" },
    }));

    expect(stderrOutput).toContain("No docs/ecl/ directory found");
  });

  it("should output guard info when file matches key_files", () => {
    setupExistsSync();
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(["onboard-packages.yaml"]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(SAMPLE_ECL_YAML);

    handlePreToolUse(JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "/project/packages/ast/src/parser.ts" },
    }));

    expect(stderrOutput).toContain("Feature Guard(s) protect this file");
    expect(stderrOutput).toContain("wasm-resolver");
    expect(stderrOutput).toContain("resolveWasmPath is the single source of WASM path resolution");
    expect(stderrOutput).toContain("npx vitest run test_ast_findWasmPath.test.ts");
  });

  it("should not output guard info when file does not match any key_files", () => {
    setupExistsSync();
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(["onboard-packages.yaml"]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(SAMPLE_ECL_YAML);

    handlePreToolUse(JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "/project/packages/core/src/diff/parser.ts" },
    }));

    expect(stderrOutput).not.toContain("Feature Guard(s) protect this file");
  });

  it("should match multiple features when file appears in multiple key_files", () => {
    const multiFeatureYaml = `features:
  - feature: "feature-a"
    description: "Feature A"
    implementation:
      key_files:
        - "src/shared.ts"
      constraints:
        - "Constraint A"
    verification:
      - name: "Test A"
        command: "npx vitest run test-a.ts"

  - feature: "feature-b"
    description: "Feature B"
    implementation:
      key_files:
        - "src/shared.ts"
      constraints:
        - "Constraint B"
    verification:
      - name: "Test B"
        command: "npx vitest run test-b.ts"
`;

    setupExistsSync();
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(["multi.yaml"]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(multiFeatureYaml);

    handlePreToolUse(JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "/project/src/shared.ts" },
    }));

    expect(stderrOutput).toContain("feature-a");
    expect(stderrOutput).toContain("feature-b");
    expect(stderrOutput).toContain("Constraint A");
    expect(stderrOutput).toContain("Constraint B");
  });

  it("should handle malformed yaml gracefully without crashing", () => {
    setupExistsSync();
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(["bad.yaml"]);
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("file read error");
    });

    expect(() => {
      handlePreToolUse(JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "/project/packages/ast/src/parser.ts" },
      }));
    }).not.toThrow();
  });
});
