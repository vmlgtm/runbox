import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FeatureConfig, RunboxConfig } from "../config/schema.js";
import { matchesAnyGlob, toPosixPath, walkFiles } from "../utils/glob.js";
import {
  SOURCE_EXTENSIONS,
  detectWorkspaceAliases,
  parseImports,
  resolveImportSpecifier,
  type ParsedImport,
} from "../utils/imports.js";

export interface ImportGraph {
  files: string[];
  aliases: Record<string, string>;
  forwardImports: Map<string, Set<string>>;
  reverseImporters: Map<string, Set<string>>;
  parsedImports: Map<string, ParsedImport[]>;
}

export interface AffectedFeatureResolution {
  changedFiles: string[];
  impactedFiles: string[];
  affectedFeatures: FeatureConfig[];
  skippedFeatures: FeatureConfig[];
}

/**
 * Builds the forward and reverse module dependency graph for a repository,
 * resolving relative imports, tsconfig paths, and heuristic workspace aliases.
 */
export function buildImportGraph(
  cwd: string,
  explicitAliases?: Record<string, string>
): ImportGraph {
  const resolvedCwd = path.resolve(cwd);
  const aliases = detectWorkspaceAliases(resolvedCwd, explicitAliases);
  const files = walkFiles(resolvedCwd, { extensions: SOURCE_EXTENSIONS });

  const forwardImports = new Map<string, Set<string>>();
  const reverseImporters = new Map<string, Set<string>>();
  const parsedImports = new Map<string, ParsedImport[]>();

  for (const file of files) {
    forwardImports.set(file, new Set());
    if (!reverseImporters.has(file)) {
      reverseImporters.set(file, new Set());
    }
  }

  for (const relFile of files) {
    const absPath = path.join(resolvedCwd, relFile);
    const code = fs.readFileSync(absPath, "utf8");
    const imports = parseImports(code);
    parsedImports.set(relFile, imports);

    for (const imp of imports) {
      const target = resolveImportSpecifier(resolvedCwd, relFile, imp.specifier, aliases);
      if (target && target !== relFile) {
        forwardImports.get(relFile)?.add(target);
        if (!reverseImporters.has(target)) {
          reverseImporters.set(target, new Set());
        }
        reverseImporters.get(target)?.add(relFile);
      }
    }
  }

  return {
    files,
    aliases,
    forwardImports,
    reverseImporters,
    parsedImports,
  };
}

/**
 * Walks reverse importers transitively from `seedFiles` to find every file
 * that directly or indirectly depends on any changed file.
 */
export function getTransitiveReverseClosure(
  graph: ImportGraph,
  seedFiles: string[]
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const seed of seedFiles) {
    const clean = toPosixPath(seed).replace(/^\.\//, "");
    if (!visited.has(clean)) {
      visited.add(clean);
      queue.push(clean);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const importers = graph.reverseImporters.get(current);
    if (!importers) continue;
    for (const parent of importers) {
      if (!visited.has(parent)) {
        visited.add(parent);
        queue.push(parent);
      }
    }
  }

  return visited;
}

/**
 * Walks forward imports transitively from files matching `entryGlobs`.
 */
export function getFeatureDependencyClosure(
  graph: ImportGraph,
  entryGlobs: string[]
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const file of graph.files) {
    if (matchesAnyGlob(file, entryGlobs)) {
      visited.add(file);
      queue.push(file);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = graph.forwardImports.get(current);
    if (!deps) continue;
    for (const dep of deps) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  return visited;
}

/**
 * Maps changed files to affected features using both feature entry globs
 * and transitive import graph traversal.
 */
export function resolveAffectedFeatures(
  cwd: string,
  config: RunboxConfig,
  changedFiles: string[],
  existingGraph?: ImportGraph
): AffectedFeatureResolution {
  const normalizedChanged = Array.from(
    new Set(changedFiles.map((f) => toPosixPath(f).replace(/^\.\//, "")).filter(Boolean))
  );

  if (normalizedChanged.length === 0) {
    return {
      changedFiles: [],
      impactedFiles: [],
      affectedFeatures: [],
      skippedFeatures: [...config.features],
    };
  }

  const graph = existingGraph ?? buildImportGraph(cwd, config.aliases);
  const reverseClosure = getTransitiveReverseClosure(graph, normalizedChanged);

  const affectedFeatures: FeatureConfig[] = [];
  const skippedFeatures: FeatureConfig[] = [];

  for (const feature of config.features) {
    const featureDeps = getFeatureDependencyClosure(graph, feature.files);

    const isDirectOrReverseMatch = Array.from(reverseClosure).some((file) =>
      matchesAnyGlob(file, feature.files)
    );
    const isForwardClosureMatch = normalizedChanged.some((file) =>
      featureDeps.has(file)
    );

    if (isDirectOrReverseMatch || isForwardClosureMatch) {
      affectedFeatures.push(feature);
    } else {
      skippedFeatures.push(feature);
    }
  }

  return {
    changedFiles: normalizedChanged,
    impactedFiles: Array.from(reverseClosure).sort(),
    affectedFeatures,
    skippedFeatures,
  };
}

/**
 * Returns uncommitted, staged, and untracked changed files in `cwd`,
 * falling back to `HEAD~1..HEAD` if the working tree is clean.
 */
export function getGitChangedFiles(cwd: string): string[] {
  const resolvedCwd = path.resolve(cwd);
  const changed = new Set<string>();

  try {
    const porcelain = execFileSync(
      "git",
      ["status", "--porcelain", "-uall"],
      { cwd: resolvedCwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    for (const rawLine of porcelain.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      let filePart = rawLine.slice(3).trim();
      if (filePart.includes(" -> ")) {
        filePart = filePart.split(" -> ").pop()!.trim();
      }
      filePart = filePart.replace(/^"|"$/g, "");
      if (filePart) changed.add(toPosixPath(filePart));
    }
  } catch {
    // Ignore git status failure
  }

  if (changed.size > 0) {
    return Array.from(changed).sort();
  }

  // Fallback to last commit diff when working tree is clean
  try {
    const diffOutput = execFileSync(
      "git",
      ["diff", "--name-only", "HEAD~1", "HEAD"],
      { cwd: resolvedCwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    for (const line of diffOutput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) changed.add(toPosixPath(trimmed));
    }
  } catch {
    // Repo may only have 0 or 1 commit
  }

  return Array.from(changed).sort();
}
