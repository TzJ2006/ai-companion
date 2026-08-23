import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";

const PID_FILE = join(homedir(), ".aidev-dashboard.pid");

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const content = readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(content, 10);
  return isNaN(pid) ? null : pid;
}

function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

function removePid(): void {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function status(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("Status: stopped (no PID file)");
    return;
  }
  if (!isProcessAlive(pid)) {
    console.log(`Status: stopped (stale PID ${pid})`);
    removePid();
    return;
  }
  const portUsed = await isPortInUse(4200);
  console.log(`Status: running (PID ${pid}, port ${portUsed ? "4200 in use" : "unknown"})`);
}

async function start(): Promise<void> {
  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    console.log(`Already running (PID ${existingPid}). Use 'restart' to restart.`);
    return;
  }
  removePid();

  const serverPath = join(import.meta.dirname, "server.ts");
  const child = spawn(process.execPath, ["--import", "tsx", serverPath], {
    cwd: join(import.meta.dirname, "..", "..", ".."),
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  if (!child.pid) {
    console.error("Failed to start server");
    process.exit(1);
  }

  child.unref();
  writePid(child.pid);
  console.log(`Started dashboard (PID ${child.pid})`);

  await new Promise((r) => setTimeout(r, 2000));
  const portUsed = await isPortInUse(4200);
  if (portUsed) {
    console.log("Dashboard is running at http://127.0.0.1:4200");
  } else {
    console.log("Warning: port 4200 not responding yet, server may still be starting");
  }
}

async function stop(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("Not running (no PID file)");
    return;
  }
  if (!isProcessAlive(pid)) {
    console.log(`Not running (stale PID ${pid})`);
    removePid();
    return;
  }
  killProcess(pid);
  await new Promise((r) => setTimeout(r, 500));

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch { /* ignore */ }
  }
  removePid();
  console.log(`Stopped dashboard (PID ${pid})`);
}

async function restart(): Promise<void> {
  await stop();
  await new Promise((r) => setTimeout(r, 1000));
  await start();
}

const command = process.argv[2] || "start";

switch (command) {
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "restart":
    restart();
    break;
  case "status":
    status();
    break;
  default:
    console.log("Usage: dashboard <start|stop|restart|status>");
    process.exit(1);
}
