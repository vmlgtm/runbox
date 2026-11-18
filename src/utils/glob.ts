import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".runbox",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
]);

/** Converts OS-specific paths into normalized POSIX relative paths. */
export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/**
 * Converts a glob pattern (`**`, `*`, `?`) into a RegExp.
 * Supports leading and nested recursive wildcard segments cleanly.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = toPosixPath(glob).replace(/^\.\//, "");
  let regexStr = "^";

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 2;
        } else {
          regexStr += ".*";
          i += 1;
        }
      } else {
        regexStr += "[^/]*";
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      regexStr += "\\" + ch;
    } else {
      regexStr += ch;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr);
}

/** Returns true if a normalized relative path matches any provided glob pattern. */
export function matchesAnyGlob(relPath: string, globs: string[]): boolean {
  const clean = toPosixPath(relPath).replace(/^\.\//, "");
  return globs.some((glob) => globToRegExp(glob).test(clean));
}

export interface WalkOptions {
  extensions?: Set<string>;
  ignoreDirs?: Set<string>;
}

/** Recursively walks `rootDir` and returns sorted POSIX paths relative to `rootDir`. */
export function walkFiles(rootDir: string, options: WalkOptions = {}): string[] {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORED_DIRS;
  const results: string[] = [];

  function visit(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        visit(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (options.extensions) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!options.extensions.has(ext)) continue;
        }
        const rel = toPosixPath(path.relative(resolvedRoot, path.join(currentDir, entry.name)));
        results.push(rel);
      }
    }
  }

  visit(resolvedRoot);
  return results.sort();
}
