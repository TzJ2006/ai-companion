import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { IdeaEntry, IdeaIndexEntry, IdeaFilter, IdeaStatus } from "./types.js";

const MAX_SLUG_LENGTH = 60;

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

export class IdeaStore {
  private readonly ideasDir: string;
  private readonly indexPath: string;

  constructor(projectRoot: string) {
    this.ideasDir = resolve(projectRoot, ".devcompanion", "ideas");
    this.indexPath = join(this.ideasDir, "ideas-index.json");
  }

  async init(): Promise<void> {
    if (!existsSync(this.ideasDir)) {
      await mkdir(this.ideasDir, { recursive: true });
    }
    if (!existsSync(this.indexPath)) {
      await writeFile(this.indexPath, "[]", "utf-8");
    }
  }

  async createIdea(title: string, description: string, tags: string[] = []): Promise<IdeaEntry> {
    await this.init();

    let slug = generateSlug(title);
    const index = await this.readIndex();

    let suffix = 1;
    const baseSlug = slug;
    while (index.some((e) => e.slug === slug)) {
      suffix++;
      slug = `${baseSlug}-${suffix}`;
    }

    const now = new Date().toISOString();
    const entry: IdeaEntry = {
      slug,
      title,
      description,
      status: "draft",
      tags,
      created: now,
      updated: now,
    };

    const filePath = this.ideaPath(slug);
    await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");

    index.push({
      slug,
      title,
      status: "draft",
      tags,
      created: now,
      updated: now,
    });
    await this.writeIndex(index);

    return entry;
  }

  async listIdeas(filter?: IdeaFilter): Promise<IdeaIndexEntry[]> {
    const index = await this.readIndex();
    if (!filter) return index;

    return index.filter((entry) => {
      if (filter.status && entry.status !== filter.status) return false;
      if (filter.tag && !entry.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async getIdea(slug: string): Promise<IdeaEntry | null> {
    const filePath = this.ideaPath(slug);
    if (!existsSync(filePath)) return null;

    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as IdeaEntry;
  }

  async updateIdeaStatus(
    slug: string,
    status: IdeaStatus,
    extra?: Partial<Pick<IdeaEntry, "failure_reason">>
  ): Promise<void> {
    const idea = await this.getIdea(slug);
    if (!idea) throw new Error(`Idea not found: ${slug}`);

    const updated: IdeaEntry = {
      ...idea,
      status,
      updated: new Date().toISOString(),
      ...(extra ?? {}),
    };

    await writeFile(this.ideaPath(slug), JSON.stringify(updated, null, 2), "utf-8");

    const index = await this.readIndex();
    const idx = index.findIndex((e) => e.slug === slug);
    if (idx >= 0) {
      index[idx] = {
        ...index[idx],
        status,
        updated: updated.updated,
      };
      await this.writeIndex(index);
    }
  }

  async setResearchSize(slug: string, sizeBytes: number): Promise<void> {
    const index = await this.readIndex();
    const idx = index.findIndex((e) => e.slug === slug);
    if (idx >= 0) {
      index[idx] = { ...index[idx], research_size_bytes: sizeBytes };
      await this.writeIndex(index);
    }
  }

  acquireLock(slug: string): boolean {
    const lockPath = this.lockPath(slug);
    try {
      writeFileSync(lockPath, String(Date.now()), { flag: "wx" });
      return true;
    } catch {
      if (existsSync(lockPath)) {
        const content = readFileSync_safe(lockPath);
        const lockTime = parseInt(content, 10);
        if (Date.now() - lockTime > 150_000) {
          unlinkSync(lockPath);
          return this.acquireLock(slug);
        }
      }
      return false;
    }
  }

  releaseLock(slug: string): void {
    const lockPath = this.lockPath(slug);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  }

  getResearchReportPath(slug: string): string {
    return join(this.ideasDir, `${slug}-research.md`);
  }

  private ideaPath(slug: string): string {
    return join(this.ideasDir, `${slug}.json`);
  }

  private lockPath(slug: string): string {
    return join(this.ideasDir, `${slug}.lock`);
  }

  private async readIndex(): Promise<IdeaIndexEntry[]> {
    if (!existsSync(this.indexPath)) return [];
    try {
      const content = await readFile(this.indexPath, "utf-8");
      return JSON.parse(content) as IdeaIndexEntry[];
    } catch {
      return [];
    }
  }

  private async writeIndex(index: IdeaIndexEntry[]): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), "utf-8");
  }
}

function readFileSync_safe(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "0";
  }
}
