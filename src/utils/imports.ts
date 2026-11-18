import fs from "node:fs";
import path from "node:path";
import { toPosixPath } from "./glob.js";

export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
]);

const RESOLVE_EXT_ORDER = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs"];

export interface ParsedImport {
  specifier: string;
  /** Local identifier names bound by this import (e.g. default or named imports). */
  bindings: string[];
  isTypeOnly: boolean;
}

/**
 * Extracts static, dynamic, re-export, and CommonJS import specifiers along
 * with bound local identifiers so route extractors can trace `<Comp />` back to files.
 */
export function parseImports(sourceCode: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  const seenKey = new Set<string>();

  const add = (specifier: string, bindings: string[], isTypeOnly: boolean) => {
    const key = `${specifier}|${bindings.join(",")}|${isTypeOnly}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      results.push({ specifier, bindings, isTypeOnly });
    }
  };

  // Strip block and line comments safely enough for import scanning while preserving strings.
  const stripped = stripComments(sourceCode);

  // 1. ES module import statements:
  //    import Foo, { Bar as Baz } from "mod";
  //    import type { X } from "mod";
  //    import * as Ns from "mod";
  const esImportRegex =
    /(?:^|\n|;)\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of stripped.matchAll(esImportRegex)) {
    const isTypeOnly = Boolean(match[1]);
    const clause = match[2].trim();
    const specifier = match[3].trim();
    const bindings = extractBindingsFromClause(clause);
    add(specifier, bindings, isTypeOnly);
  }

  // 2. Side-effect imports: import "./styles.css";
  const sideEffectRegex = /(?:^|\n|;)\s*import\s+["']([^"']+)["']/g;
  for (const match of stripped.matchAll(sideEffectRegex)) {
    add(match[1].trim(), [], false);
  }

  // 3. Re-exports: export { a, b } from "./x"; export * from "./y";
  const reExportRegex =
    /(?:^|\n|;)\s*export\s+(type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
  for (const match of stripped.matchAll(reExportRegex)) {
    add(match[2].trim(), [], Boolean(match[1]));
  }

  // 4. Lazy / wrapped dynamic imports: const Page = split(() => import("./Page")) or lazy(() => import("./Page"))
  const lazyImportRegex =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.]+\s*\(\s*(?:\(\s*\)\s*=>\s*)?import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of stripped.matchAll(lazyImportRegex)) {
    add(match[2].trim(), [match[1]], false);
  }

  // 5. Bare dynamic import(...) and require(...)
  const callImportRegex = /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of stripped.matchAll(callImportRegex)) {
    add(match[1].trim(), [], false);
  }

  return results;
}

function extractBindingsFromClause(clause: string): string[] {
  const bindings: string[] = [];
  if (!clause) return bindings;

  // Remove brace section first to isolate default import if any
  const braceMatch = clause.match(/\{([^}]*)\}/);
  const withoutBraces = braceMatch ? clause.replace(braceMatch[0], "") : clause;

  // Check namespace `* as Ns`
  const nsMatch = withoutBraces.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (nsMatch) {
    bindings.push(nsMatch[1]);
  } else {
    const defaultIdent = withoutBraces
      .replace(/,/g, " ")
      .trim()
      .split(/\s+/)[0];
    if (defaultIdent && /^[A-Za-z_$][\w$]*$/.test(defaultIdent)) {
      bindings.push(defaultIdent);
    }
  }

  if (braceMatch) {
    const parts = braceMatch[1].split(",");
    for (const part of parts) {
      const cleaned = part.replace(/^\s*type\s+/, "").trim();
      if (!cleaned) continue;
      const asParts = cleaned.split(/\s+as\s+/);
      const localName = (asParts[1] ?? asParts[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(localName)) {
        bindings.push(localName);
      }
    }
  }

  return bindings;
}

export function stripComments(code: string): string {
  // Replace comments outside string literals with spaces/newlines to keep regexes accurate.
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];

    if (inSingle) {
      out += ch;
      if (ch === "\\" && i + 1 < code.length) {
        out += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === "\\" && i + 1 < code.length) {
        out += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (inTemplate) {
      out += ch;
      if (ch === "\\" && i + 1 < code.length) {
        out += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === "`") inTemplate = false;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;

    out += ch;
    i++;
  }

  return out;
}

/** Reads `compilerOptions.paths` from tsconfig.json / jsconfig.json if available. */
export function readTsconfigAliases(cwd: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const cfgName of ["tsconfig.json", "jsconfig.json"]) {
    const cfgPath = path.join(cwd, cfgName);
    if (!fs.existsSync(cfgPath)) continue;

    try {
      const raw = fs.readFileSync(cfgPath, "utf8");
      const json = JSON.parse(stripComments(raw));
      const baseUrl = json?.compilerOptions?.baseUrl ?? ".";
      const paths = json?.compilerOptions?.paths as Record<string, string[]> | undefined;
      if (!paths) continue;

      for (const [aliasKey, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const cleanKey = aliasKey.replace(/\/\*$/, "");
        const cleanTarget = targets[0].replace(/\/\*$/, "");
        const resolved = toPosixPath(
          path.normalize(path.join(baseUrl, cleanTarget))
        ).replace(/^\.\//, "");
        aliases[cleanKey] = resolved;
      }
      break;
    } catch {
      // Ignore malformed tsconfig/jsconfig and continue with fallback detection
    }
  }
  return aliases;
}

const COMMON_ALIAS_FOLDERS = [
  "pages",
  "components",
  "containers",
  "features",
  "hooks",
  "utils",
  "routes",
  "lib",
  "services",
  "store",
  "styles",
];

export function readPackageModuleAliases(cwd: string): Record<string, string> {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return {};

  const aliases: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      _moduleAliases?: Record<string, string>;
    };
    if (pkg._moduleAliases && typeof pkg._moduleAliases === "object") {
      for (const [k, v] of Object.entries(pkg._moduleAliases)) {
        if (typeof v !== "string") continue;
        const cleanKey = k.replace(/\/+$/, "");
        const cleanVal = toPosixPath(v).replace(/^\.\//, "").replace(/\/+$/, "");
        if (cleanKey && cleanVal) {
          aliases[cleanKey] = cleanVal;
        }
      }
    }
  } catch {
    // Ignore malformed package.json
  }
  return aliases;
}

/**
 * Discovers conventional folder aliases (e.g. `@pages` -> `src/js/pages` or `src/pages`)
 * common in webpack / catalyst-core / Vite repositories without explicit tsconfig paths.
 */
export function detectWorkspaceAliases(
  cwd: string,
  explicitAliases?: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {
    ...readPackageModuleAliases(cwd),
    ...readTsconfigAliases(cwd),
    ...explicitAliases,
  };

  for (const base of ["src/js", "src"]) {
    for (const folder of COMMON_ALIAS_FOLDERS) {
      const candidate = path.join(cwd, base, folder);
      const aliasKey = `@${folder}`;
      if (!merged[aliasKey] && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        merged[aliasKey] = toPosixPath(path.join(base, folder));
      }
    }
  }

  return merged;
}

/**
 * Resolves a single import specifier from `fromRelFile` against disk files.
 * Returns normalized POSIX path relative to `cwd`, or `null` for external/unresolvable modules.
 */
export function resolveImportSpecifier(
  cwd: string,
  fromRelFile: string,
  specifier: string,
  aliases: Record<string, string>
): string | null {
  const cleanSpec = specifier.split("?")[0].split("#")[0];

  // 1. Relative import
  if (cleanSpec.startsWith("./") || cleanSpec.startsWith("../") || cleanSpec === ".") {
    const absTarget = path.resolve(cwd, path.dirname(fromRelFile), cleanSpec);
    return probeFileOnDisk(cwd, absTarget);
  }

  // 2. Explicit or detected aliases (sorted longest prefix first)
  const sortedAliases = Object.entries(aliases).sort(
    ([a], [b]) => b.length - a.length
  );
  for (const [aliasKey, targetDir] of sortedAliases) {
    if (cleanSpec === aliasKey || cleanSpec.startsWith(`${aliasKey}/`)) {
      const remainder = cleanSpec === aliasKey ? "" : cleanSpec.slice(aliasKey.length + 1);
      const absTarget = path.resolve(cwd, targetDir, remainder);
      const hit = probeFileOnDisk(cwd, absTarget);
      if (hit) return hit;
    }
  }

  // 3. Heuristic @<folder>/<rest> -> src/<folder>/<rest> or src/js/<folder>/<rest>
  if (cleanSpec.startsWith("@") && !cleanSpec.startsWith("@tata1mg/")) {
    const match = cleanSpec.match(/^@([^/]+)(?:\/(.*))?$/);
    if (match) {
      const folder = match[1];
      const rest = match[2] ?? "";
      for (const base of ["src/js", "src", "."]) {
        const absTarget = path.resolve(cwd, base, folder, rest);
        const hit = probeFileOnDisk(cwd, absTarget);
        if (hit) return hit;
      }
    }
  }

  // 4. Root-relative src/... imports
  if (cleanSpec.startsWith("src/") || cleanSpec.startsWith("app/") || cleanSpec.startsWith("server/")) {
    const absTarget = path.resolve(cwd, cleanSpec);
    return probeFileOnDisk(cwd, absTarget);
  }

  return null;
}

function probeFileOnDisk(cwd: string, absBase: string): string | null {
  const resolvedCwd = path.resolve(cwd);

  const tryPath = (candidate: string): string | null => {
    if (!fs.existsSync(candidate)) return null;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return null;
    const rel = toPosixPath(path.relative(resolvedCwd, candidate));
    if (rel.startsWith("..")) return null;
    return rel;
  };

  // Exact match
  const exact = tryPath(absBase);
  if (exact) return exact;

  // Append extensions (handling ESM `.js` import pointing to `.ts`/`.tsx`)
  if (absBase.endsWith(".js") || absBase.endsWith(".jsx")) {
    const stem = absBase.replace(/\.(js|jsx)$/, "");
    for (const ext of RESOLVE_EXT_ORDER) {
      const hit = tryPath(`${stem}${ext}`);
      if (hit) return hit;
    }
  } else {
    for (const ext of RESOLVE_EXT_ORDER) {
      const hit = tryPath(`${absBase}${ext}`);
      if (hit) return hit;
    }
  }

  // Directory index resolution
  if (fs.existsSync(absBase) && fs.statSync(absBase).isDirectory()) {
    for (const ext of RESOLVE_EXT_ORDER) {
      const hit = tryPath(path.join(absBase, `index${ext}`));
      if (hit) return hit;
    }
  }

  return null;
}
