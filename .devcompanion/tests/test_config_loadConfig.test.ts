import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig } from "../../packages/dashboard/src/config.ts";

describe("loadConfig", () => {
  it("returns defaults when the config file is missing", () => {
    const path = join(tmpdir(), `aidev-dash-missing-${randomUUID()}.json`);
    const loaded = loadConfig(path);
    expect(loaded.projects).toEqual([]);
    expect(loaded.port).toBe(4200);
    expect(loaded.sshReposDir).toBeUndefined();
    expect(loaded.exportDir).toBeUndefined();
  });

  it("round-trips sshReposDir and exportDir with projects and port", () => {
    const path = join(tmpdir(), `aidev-dash-roundtrip-${randomUUID()}.json`);
    const saved = {
      projects: [{ name: "demo", path: "/tmp/demo" }],
      port: 4300,
      sshReposDir: "/tmp/ssh-repos",
      exportDir: "/tmp/export",
    };
    try {
      saveConfig(saved, path);
      const loaded = loadConfig(path);
      expect(loaded.projects).toEqual(saved.projects);
      expect(loaded.port).toBe(4300);
      expect(loaded.sshReposDir).toBe("/tmp/ssh-repos");
      expect(loaded.exportDir).toBe("/tmp/export");
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it("keeps optional dirs undefined when they were never saved", () => {
    const path = join(tmpdir(), `aidev-dash-partial-${randomUUID()}.json`);
    try {
      writeFileSync(path, JSON.stringify({ projects: [], port: 4200 }), "utf-8");
      const loaded = loadConfig(path);
      expect(loaded.sshReposDir).toBeUndefined();
      expect(loaded.exportDir).toBeUndefined();
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  });
});
