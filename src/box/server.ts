import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { RunboxConfig } from "../config/schema.js";

/** Finds an ephemeral free TCP port on localhost. */
export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Failed to allocate free TCP port")));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export interface BoxServerOptions {
  url?: string;
  timeoutMs?: number;
}

/**
 * Ensures an application server is reachable during `fn(baseUrl)`.
 * Either attaches to an existing URL or spawns `config.server.command` on an
 * ephemeral port (with stdout port auto-latching) and tears down cleanly in `finally`.
 */
export async function withBoxServer<T>(
  cwd: string,
  config: RunboxConfig,
  options: BoxServerOptions,
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const readyPath = normalizeReadyPath(config.server?.readyPath ?? "/");
  const timeoutMs = options.timeoutMs ?? config.server?.timeoutMs ?? 30_000;

  const explicitUrl = options.url ?? config.server?.url;
  if (explicitUrl) {
    const cleanUrl = explicitUrl.replace(/\/+$/, "");
    await waitForHttpReady(`${cleanUrl}${readyPath}`, timeoutMs);
    return fn(cleanUrl);
  }

  const commandTemplate = config.server?.command;
  if (!commandTemplate) {
    throw new Error(
      "Neither `--url` nor `server.command` is configured in runbox.config.ts."
    );
  }

  const realCwd = fs.existsSync(cwd) ? fs.realpathSync(cwd) : path.resolve(cwd);
  const allocatedPort = config.server?.port ?? (await allocateFreePort());
  const command = commandTemplate.replace(/\{\{\s*port\s*\}\}/g, String(allocatedPort));

  const fallbackConfigPort = readPortFromConfigFile(realCwd, config.server?.configPath);
  const candidatePorts = new Set<number>([allocatedPort]);
  if (fallbackConfigPort) {
    candidatePorts.add(fallbackConfigPort);
  }

  const child = spawn(command, {
    cwd: realCwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(allocatedPort),
      APPLICATION_PORT: String(allocatedPort),
      NODE_SERVER_PORT: String(allocatedPort),
      ...config.server?.env,
    },
  });

  let recentLogs = "";
  let childExitCode: number | null = null;

  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    recentLogs = (recentLogs + text).slice(-4000);
    const detectedPort = extractBoundPort(text);
    if (detectedPort) {
      candidatePorts.add(detectedPort);
    }
  };

  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("exit", (code) => {
    childExitCode = code;
  });

  try {
    const baseUrl = await waitForAnyPortReady(
      candidatePorts,
      readyPath,
      timeoutMs,
      () => childExitCode,
      () => recentLogs
    );
    return await fn(baseUrl);
  } finally {
    await terminateProcessTree(child);
  }
}

function normalizeReadyPath(readyPath: string): string {
  return readyPath.startsWith("/") ? readyPath : `/${readyPath}`;
}

function readPortFromConfigFile(cwd: string, configPath?: string): number | undefined {
  if (!configPath) return undefined;
  const absPath = path.resolve(cwd, configPath);
  if (!fs.existsSync(absPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(absPath, "utf8")) as Record<string, unknown>;
    const raw =
      parsed.PORT ??
      parsed.port ??
      parsed.APPLICATION_PORT ??
      parsed.applicationPort ??
      parsed.NODE_SERVER_PORT;
    const num = Number(raw);
    return Number.isInteger(num) && num > 0 && num < 65536 ? num : undefined;
  } catch {
    return undefined;
  }
}

function extractBoundPort(text: string): number | undefined {
  const urlMatch = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i);
  if (urlMatch) {
    const port = Number(urlMatch[1]);
    if (port > 0 && port < 65536) return port;
  }

  const portMatch = text.match(/\b(?:listening\s+on|port)\s*(?::|=|\s)\s*(\d{2,5})\b/i);
  if (portMatch) {
    const port = Number(portMatch[1]);
    if (port > 0 && port < 65536) return port;
  }

  return undefined;
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeUrl(url)) return;
    await delay(150);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for server at ${url}`);
}

async function waitForAnyPortReady(
  candidatePorts: Set<number>,
  readyPath: string,
  timeoutMs: number,
  getExitCode: () => number | null,
  getLogs: () => string
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const exitCode = getExitCode();
    if (exitCode !== null) {
      throw new Error(
        `Server process exited early with code ${exitCode}.\nLogs:\n${getLogs()}`
      );
    }

    for (const port of Array.from(candidatePorts)) {
      for (const host of ["127.0.0.1", "localhost"]) {
        const baseUrl = `http://${host}:${port}`;
        if (await probeUrl(`${baseUrl}${readyPath}`)) {
          return baseUrl;
        }
      }
    }

    await delay(150);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for server on ports [${Array.from(candidatePorts).join(", ")}].\nLogs:\n${getLogs()}`
  );
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.killed || child.exitCode !== null) return;

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return;
    await delay(50);
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process already dead
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
