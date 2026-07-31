import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installAgentConfig } from "../../scripts/lib/install-agent-config.ts";

describe("installAgentConfig Codex path", () => {
  it("throws a clear error when .codex exists as a file", () => {
    const target = mkdtempSync(join(tmpdir(), "aidev-install-codex-file-"));
    try {
      writeFileSync(join(target, ".codex"), "not a directory");
      expect(() =>
        installAgentConfig({
          targetPath: target,
          aidevRoot: resolve(import.meta.dirname, "../.."),
          enforce: false,
          includeCommands: false,
          agent: "codex",
        })
      ).toThrow(/exists as a file.*Delete the file/i);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
