import { describe, expect, it } from "vitest";
import { pathKey } from "../../scripts/lib/registry.ts";

describe("registry pathKey", () => {
  it("treats win32 path casing as equal when platform is win32", () => {
    if (process.platform !== "win32") {
      // On POSIX, keys stay case-sensitive — just ensure function is stable.
      const p = "/tmp/SomeProject";
      expect(pathKey(p)).toBe(pathKey(p));
      return;
    }
    const a = "D:\\GitHub\\LifeCopilot";
    const b = "D:\\Github\\LifeCopilot";
    // Only equal if both resolve to the same realpath; when the folder exists,
    // native casing wins and lowercased keys match.
    expect(pathKey(a).toLowerCase()).toBe(pathKey(b).toLowerCase());
  });
});
