import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IdeaStore } from "@aidev/idea";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("IdeaStore", () => {
  let tempDir: string;
  let store: IdeaStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idea-test-"));
    store = new IdeaStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createIdea", () => {
    it("creates an idea with correct fields", async () => {
      const idea = await store.createIdea("Test Idea", "A description", ["tag1"]);

      expect(idea.slug).toBe("test-idea");
      expect(idea.title).toBe("Test Idea");
      expect(idea.description).toBe("A description");
      expect(idea.status).toBe("draft");
      expect(idea.tags).toEqual(["tag1"]);
      expect(idea.created).toBeDefined();
    });

    it("appends suffix on slug collision", async () => {
      const first = await store.createIdea("My Idea", "first");
      const second = await store.createIdea("My Idea", "second");

      expect(first.slug).toBe("my-idea");
      expect(second.slug).toBe("my-idea-2");
    });

    it("updates the index", async () => {
      await store.createIdea("Indexed", "test");
      const list = await store.listIdeas();

      expect(list).toHaveLength(1);
      expect(list[0].slug).toBe("indexed");
    });
  });

  describe("getIdea", () => {
    it("returns null for nonexistent slug", async () => {
      const result = await store.getIdea("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the full idea entry", async () => {
      await store.createIdea("Fetch Me", "details here", ["x"]);
      const idea = await store.getIdea("fetch-me");

      expect(idea).not.toBeNull();
      expect(idea!.title).toBe("Fetch Me");
      expect(idea!.description).toBe("details here");
    });
  });

  describe("updateIdeaStatus", () => {
    it("transitions status correctly", async () => {
      await store.createIdea("Status Test", "");
      await store.updateIdeaStatus("status-test", "researching");

      const idea = await store.getIdea("status-test");
      expect(idea!.status).toBe("researching");
    });

    it("records failure reason", async () => {
      await store.createIdea("Fail Test", "");
      await store.updateIdeaStatus("fail-test", "failed", {
        failure_reason: "timeout",
      });

      const idea = await store.getIdea("fail-test");
      expect(idea!.status).toBe("failed");
      expect(idea!.failure_reason).toBe("timeout");
    });

    it("throws for nonexistent slug", async () => {
      await expect(
        store.updateIdeaStatus("ghost", "archived")
      ).rejects.toThrow("Idea not found");
    });
  });

  describe("listIdeas with filter", () => {
    it("filters by status", async () => {
      await store.createIdea("A", "");
      await store.createIdea("B", "");
      await store.updateIdeaStatus("b", "archived");

      const drafts = await store.listIdeas({ status: "draft" });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].slug).toBe("a");
    });

    it("filters by tag", async () => {
      await store.createIdea("Tagged", "", ["important"]);
      await store.createIdea("Untagged", "");

      const filtered = await store.listIdeas({ tag: "important" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].slug).toBe("tagged");
    });
  });

  describe("lock mechanism", () => {
    it("acquires and releases lock", async () => {
      await store.createIdea("Lock Test", "");

      const acquired = store.acquireLock("lock-test");
      expect(acquired).toBe(true);

      const second = store.acquireLock("lock-test");
      expect(second).toBe(false);

      store.releaseLock("lock-test");
      const third = store.acquireLock("lock-test");
      expect(third).toBe(true);
      store.releaseLock("lock-test");
    });
  });
});
