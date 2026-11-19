import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";

/**
 * Resolves a local Chromium / Chrome executable path without requiring a fresh
 * browser download when an existing Playwright cache or system Chrome exists.
 */
export function resolveChromiumExecutablePath(): string | undefined {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // Ignore and continue checking local installations
  }

  // Scan local Playwright cache directories (macOS and Linux)
  const cacheRoots = [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];

  for (const cacheRoot of cacheRoots) {
    if (!fs.existsSync(cacheRoot)) continue;

    const entries = fs.readdirSync(cacheRoot).sort().reverse();
    // Prefer full Chromium / Chrome for Testing first, then headless shell
    for (const prefix of ["chromium-", "chromium_headless_shell-"]) {
      for (const entry of entries) {
        if (!entry.startsWith(prefix)) continue;
        const found = findExecutableInDir(path.join(cacheRoot, entry));
        if (found) return found;
      }
    }
  }

  // Fallback to system browsers
  const systemCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

const EXECUTABLE_NAMES = new Set([
  "chrome-headless-shell",
  "Google Chrome for Testing",
  "Chromium",
  "chrome",
]);

function findExecutableInDir(root: string, depth = 0): string | undefined {
  if (depth > 4 || !fs.existsSync(root)) return undefined;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && EXECUTABLE_NAMES.has(entry.name)) {
      return full;
    }
    if (entry.isDirectory()) {
      const hit = findExecutableInDir(full, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

export async function launchBrowser(options: { headless?: boolean } = {}): Promise<Browser> {
  const executablePath = resolveChromiumExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No Chromium/Chrome executable found. Install Playwright Chromium (`npx playwright install chromium`) or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH."
    );
  }

  return chromium.launch({
    executablePath,
    headless: options.headless ?? true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
}
