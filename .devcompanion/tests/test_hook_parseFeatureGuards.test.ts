import { describe, it, expect } from "vitest";
import {
  findMatchingGuards,
  matchesGuardedPath,
  parseFeatureGuards,
} from "../../packages/hook/src/feature-guard.js";

const GUARD_ID_YAML = `ecl_version: "1.0"
feature: "ccoverview"
status: "phase-10-ready-for-execution"

feature_guard:
  generated: "2026-06-02"
  guards:
    - id: GUARD-001
      feature: FEAT-001
      description: "/ccoverview skill wrapper over generate-overview.ts"
      key_files:
        - "skills/ccoverview/SKILL.md"
        - "scripts/generate-overview.ts"
      invariants:
        - "Default mode produces two files"
        - "Fast --skip-translation calls no LLM"
      verification:
        command: "npx vitest run .devcompanion/tests/test_ccoverview_skillSpec.test.ts"
        expected: "all pass"
      status: active
`;

const LEGACY_FEATURE_YAML = `ecl_version: "2.0"
scope: "packages/"

features:
  - feature: "wasm-resolver"
    description: "WASM loading for tree-sitter grammar"
    implementation:
      key_files:
        - "packages/ast/src/wasm-resolver.ts"
        - "packages/ast/src/parser.ts"
      constraints:
        - "resolveWasmPath is the single source of WASM path resolution"
    verification:
      - name: "WASM path resolution"
        command: "npx vitest run test_ast_findWasmPath.test.ts"
`;

const STATUS_YAML = `feature_guard:
  guards:
    - id: GUARD-001
      feature: FEAT-001
      description: "Active guard"
      key_files:
        - "src/active.ts"
      invariants:
        - "keep this"
      verification:
        command: "npx vitest run test-active.ts"
      status: active
    - id: GUARD-002
      feature: FEAT-002
      description: "Completed guard"
      key_files:
        - "src/done.ts"
      invariants:
        - "old behavior"
      verification:
        command: "npx vitest run test-done.ts"
      status: completed
    - id: GUARD-003
      feature: FEAT-003
      description: "Retired guard"
      key_files:
        - "src/gone.ts"
      invariants:
        - "removed"
      verification:
        command: "npx vitest run test-gone.ts"
      status: retired
`;

const PATH_YAML = `feature_guard:
  guards:
    - id: GUARD-001
      feature: FEAT-AUTH
      description: "Auth module"
      key_files:
        - "src/auth.ts"
        - "src/foo.ts"
      invariants:
        - "login still works"
      verification:
        command: "npx vitest run test-auth.ts"
      status: active
`;

describe("parseFeatureGuards", () => {
  it("matches feature_guard: + - id: GUARD-001 shape", () => {
    const parsed = parseFeatureGuards(GUARD_ID_YAML);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].feature).toBe("FEAT-001");
    expect(parsed[0].description).toContain("/ccoverview");
    expect(parsed[0].keyFiles).toContain("skills/ccoverview/SKILL.md");
    expect(parsed[0].invariants).toContain("Default mode produces two files");
    expect(parsed[0].verifications[0]).toContain("test_ccoverview_skillSpec.test.ts");

    const hits = findMatchingGuards(GUARD_ID_YAML, "/repo/scripts/generate-overview.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0].feature).toBe("FEAT-001");
  });

  it("still matches old - feature: shape", () => {
    const parsed = parseFeatureGuards(LEGACY_FEATURE_YAML);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].feature).toBe("wasm-resolver");
    expect(parsed[0].invariants).toContain(
      "resolveWasmPath is the single source of WASM path resolution"
    );

    const hits = findMatchingGuards(
      LEGACY_FEATURE_YAML,
      "/project/packages/ast/src/parser.ts"
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].feature).toBe("wasm-resolver");
  });

  it("does not match when guard status is completed or retired", () => {
    expect(findMatchingGuards(STATUS_YAML, "/repo/src/active.ts")).toHaveLength(1);
    expect(findMatchingGuards(STATUS_YAML, "/repo/src/done.ts")).toHaveLength(0);
    expect(findMatchingGuards(STATUS_YAML, "/repo/src/gone.ts")).toHaveLength(0);
  });
});

describe("matchesGuardedPath", () => {
  it("matches repo-relative suffix with segment boundaries", () => {
    expect(matchesGuardedPath("src/foo.ts", "src/foo.ts")).toBe(true);
    expect(matchesGuardedPath("/repo/src/foo.ts", "src/foo.ts")).toBe(true);
    expect(matchesGuardedPath("D:/GitHub/ai-companion/src/foo.ts", "src/foo.ts")).toBe(true);
    expect(matchesGuardedPath("foo/auth.ts", "auth.ts")).toBe(true);
  });

  it("does not over-match prefixes or adjacent path segments", () => {
    expect(matchesGuardedPath("src/foo.tsxx", "src/foo.ts")).toBe(false);
    expect(matchesGuardedPath("src/auth.ts.bak", "src/auth.ts")).toBe(false);
    expect(matchesGuardedPath("foo/auth.ts.bak", "auth.ts")).toBe(false);
    expect(matchesGuardedPath("notsrc/foo.ts", "src/foo.ts")).toBe(false);
  });

  it("findMatchingGuards uses the same path-boundary rule", () => {
    expect(findMatchingGuards(PATH_YAML, "/repo/src/auth.ts")).toHaveLength(1);
    expect(findMatchingGuards(PATH_YAML, "/repo/src/auth.ts.bak")).toHaveLength(0);
    expect(findMatchingGuards(PATH_YAML, "/repo/src/foo.tsxx")).toHaveLength(0);
    expect(findMatchingGuards(PATH_YAML, "/repo/notsrc/foo.ts")).toHaveLength(0);
  });
});
