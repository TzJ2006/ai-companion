import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import open from "open";
import { resolve, join, normalize, sep } from "node:path";

// Prefix check with trailing separator (so /repo does not match /repo2) and
// case-insensitive on win32's case-insensitive filesystems.
function isInsideDir(candidate: string, root: string): boolean {
  const cased = (s: string): string => (process.platform === "win32" ? s.toLowerCase() : s);
  const rootWithSep = normalize(root).endsWith(sep) ? normalize(root) : normalize(root) + sep;
  return cased(normalize(candidate)).startsWith(cased(rootWithSep));
}
import { existsSync, statSync, createReadStream, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createServer } from "node:net";

import { loadConfig, saveConfig, addProject, removeProject } from "./config.js";
import { scanAll, scanSshReposDir } from "./scanner.js";
import type { DashboardConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(__dirname, "..", "public");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

async function start(): Promise<void> {
  let config = loadConfig();

  const app = Fastify({ logger: false });

  app.get("/api/projects", async () => {
    config = loadConfig();
    const projects = scanAll(config.projects);
    const sshRepos = scanSshReposDir(config.sshReposDir || "");
    return { projects, sshRepos, sshReposDir: config.sshReposDir || null };
  });

  app.post<{ Body: { name: string; path: string } }>(
    "/api/projects",
    async (request, reply) => {
      const { name, path: projectPath } = request.body ?? {};

      if (!name || typeof name !== "string") {
        return reply.status(400).send({ error: "name is required" });
      }
      if (!projectPath || typeof projectPath !== "string") {
        return reply.status(400).send({ error: "path is required" });
      }

      const resolvedPath = resolve(projectPath);
      if (!existsSync(resolvedPath)) {
        return reply.status(400).send({ error: "path does not exist" });
      }

      const stat = statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: "path is not a directory" });
      }

      try {
        config = addProject(config, name, resolvedPath);
        return { success: true, config };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return reply.status(409).send({ error: message });
      }
    }
  );

  app.delete<{ Params: { name: string } }>(
    "/api/projects/:name",
    async (request) => {
      const { name } = request.params;
      config = removeProject(config, name);
      return { success: true };
    }
  );

  app.post<{ Body: { path: string } }>(
    "/api/ssh-repos-dir",
    async (request, reply) => {
      const { path: dirPath } = request.body ?? {};
      if (!dirPath || typeof dirPath !== "string") {
        return reply.status(400).send({ error: "path is required" });
      }
      const resolved = resolve(dirPath);
      if (!existsSync(resolved)) {
        return reply.status(400).send({ error: "path does not exist" });
      }
      config = { ...config, sshReposDir: resolved };
      saveConfig(config);
      return { success: true, sshReposDir: resolved };
    }
  );

  app.get<{ Params: { project: string; "*": string } }>(
    "/api/reports/:project/*",
    async (request, reply) => {
      const { project } = request.params;
      const filePath = request.params["*"];

      let projectRoot: string | null = null;
      const projectEntry = config.projects.find((p) => p.name === project);
      if (projectEntry) {
        projectRoot = projectEntry.path;
      } else if (config.sshReposDir) {
        const sshSubDir = join(config.sshReposDir, project);
        if (existsSync(sshSubDir)) {
          projectRoot = sshSubDir;
        }
      }
      if (!projectRoot) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const absolutePath = normalize(join(projectRoot, filePath));
      const normalizedRoot = normalize(projectRoot);

      if (!isInsideDir(absolutePath, normalizedRoot)) {
        return reply.status(403).send({ error: "Path traversal denied" });
      }

      if (!existsSync(absolutePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const stat = statSync(absolutePath);
      if (!stat.isFile()) {
        return reply.status(404).send({ error: "Not a file" });
      }

      const ext = absolutePath.split(".").pop()?.toLowerCase() || "";
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        css: "text/css",
        js: "application/javascript",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        ico: "image/x-icon",
      };
      const contentType = mimeTypes[ext] || "application/octet-stream";

      const stream = createReadStream(absolutePath);
      return reply.type(contentType).send(stream);
    }
  );

  app.post<{ Body: { filePath: string } }>(
    "/api/open",
    async (request, reply) => {
      const { filePath } = request.body ?? {};
      if (!filePath || typeof filePath !== "string") {
        return reply.status(400).send({ error: "filePath is required" });
      }

      const resolved = normalize(resolve(filePath));
      if (!existsSync(resolved)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const allowed = config.projects.some((p) =>
        isInsideDir(resolved, p.path)
      ) || (config.sshReposDir && isInsideDir(resolved, config.sshReposDir));
      if (!allowed) {
        return reply.status(403).send({ error: "File not in a registered project" });
      }

      const { exec } = await import("node:child_process");
      exec(`start "" "${resolved}"`, { windowsHide: true });
      return { success: true };
    }
  );

  app.post<{ Body: { outputDir?: string } }>(
    "/api/export",
    async (request, reply) => {
      config = loadConfig();
      const outputDir = request.body?.outputDir
        ? resolve(request.body.outputDir)
        : resolve(config.exportDir || join(resolve("."), "reports-export"));

      const projects = scanAll(config.projects);
      let exported = 0;

      for (const project of projects) {
        if (project.reports.length === 0) continue;
        const projectDir = join(outputDir, project.name);
        mkdirSync(projectDir, { recursive: true });

        for (const report of project.reports) {
          const destName = report.relativePath.replace(/\//g, "__");
          const dest = join(projectDir, destName);
          try {
            copyFileSync(report.absolutePath, dest);
            exported++;
          } catch {
            // skip files that fail to copy
          }
        }
      }

      return { success: true, exported, outputDir };
    }
  );

  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: "/",
    wildcard: false,
  });

  const port = await findAvailablePort(config.port);
  await app.listen({ port, host: "127.0.0.1" });

  const url = `http://127.0.0.1:${port}`;
  console.log(`Dashboard running at ${url}`);
  await open(url);
}

start().catch((error) => {
  console.error("Failed to start dashboard:", error);
  process.exit(1);
});
