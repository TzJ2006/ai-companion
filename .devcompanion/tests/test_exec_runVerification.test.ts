import { describe, it, expect } from "vitest";
import { runVerification } from "../../packages/exec/src/status-manager.js";

describe("runVerification", () => {
  it("returns passed: true for exit 0 command", async () => {
    const result = await runVerification({
      command: "node -e process.exit(0)",
      pass_condition: "exit 0",
    });
    expect(result.passed).toBe(true);
  });

  it("returns passed: false for non-zero exit", async () => {
    const result = await runVerification({
      command: "node -e process.exit(1)",
      pass_condition: "exit 0",
    });
    expect(result.passed).toBe(false);
  });

  it("returns timeout error when command exceeds timeout", async () => {
    const result = await runVerification(
      { command: "node -e setTimeout(()=>{},10000)", pass_condition: "exit 0" },
      500
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("timeout");
  }, 10000);

  it("resolves npm-shim commands (npx) — regression for the Windows spawn ENOENT", async () => {
    // On Windows `npx` is `npx.cmd`, which execFile with shell:false cannot resolve
    // (spawn ENOENT). runVerification must fall back to the shell on win32 so the
    // shim resolves. Locks the fix: FAILS on Windows if anyone reverts the fallback;
    // passes on POSIX (npx resolves either way).
    const result = await runVerification({
      command: "npx --version",
      pass_condition: "npx resolves and exits 0",
    });
    expect(result.error).toBeUndefined();
    expect(result.passed).toBe(true);
    expect(result.output).toMatch(/\d+\.\d+\.\d+/); // an npx/npm version string
  }, 30000);
});
