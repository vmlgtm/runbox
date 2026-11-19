import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FeatureConfig, FeatureTier, RunboxConfig } from "../config/schema.js";
import { matchesAnyGlob, toPosixPath, walkFiles } from "../utils/glob.js";
import {
  SOURCE_EXTENSIONS,
  detectWorkspaceAliases,
  parseImports,
  resolveImportSpecifier,
  type ParsedImport,
} from "../utils/imports.js";

interface CachedFileImports {
  mtimeMs: number;
  size: number;
  imports: ParsedImport[];
}

export interface BuildImportGraphOptions {
  useCache?: boolean;
}

export interface ImportGraph {
  files: string[];
  aliases: Record<string, string>;
  forwardImports: Map<string, Set<string>>;
  reverseImporters: Map<string, Set<string>>;
  parsedImports: Map<string, ParsedImport[]>;
  cacheHits?: number;
}

export interface AffectedFeatureResolution {
  changedFiles: string[];
  impactedFiles: string[];
  affectedFeatures: FeatureConfig[];
  skippedFeatures: FeatureConfig[];
  deferredFeatures?: FeatureConfig[];
}

const TIER_PRIORITY: Record<FeatureTier, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
};

function getGraphCachePath(resolvedCwd: string): string {
  const cwdHash = crypto
    .createHash("sha1")
    .update(resolvedCwd)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), "runbox-graph-cache", `${cwdHash}.json`);
}

function readGraphCache(cachePath: string): Record<string, CachedFileImports> {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf8")) as Record<string, CachedFileImports>;
    }
  } catch {
    // Ignore corrupt cache and rebuild incrementally
  }
  return {};
}

function writeGraphCache(cachePath: string, data: Record<string, CachedFileImports>): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data), "utf8");
  } catch {
    // Best-effort cache write
  }
}

/**
 * Builds the forward and reverse module dependency graph for a repository,
 * reusing mtime/size-keyed parsed imports from an OS temp cache so repeat runs stay fast.
 */
export function buildImportGraph(
  cwd: string,
  explicitAliases?: Record<string, string>,
  options: BuildImportGraphOptions = {}
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

  const useCache = options.useCache ?? true;
  const cachePath = getGraphCachePath(resolvedCwd);
  const existingCache = useCache ? readGraphCache(cachePath) : {};
  const nextCache: Record<string, CachedFileImports> = {};
  let cacheDirty = false;
  let cacheHits = 0;

  for (const relFile of files) {
    const absPath = path.join(resolvedCwd, relFile);
    let imports: ParsedImport[];

    const stat = fs.statSync(absPath);
    const cached = existingCache[relFile];

    if (useCache && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      imports = cached.imports;
      cacheHits++;
      nextCache[relFile] = cached;
    } else {
      const code = fs.readFileSync(absPath, "utf8");
      imports = parseImports(code);
      nextCache[relFile] = { mtimeMs: stat.mtimeMs, size: stat.size, imports };
      cacheDirty = true;
    }

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

  if (useCache && (cacheDirty || Object.keys(existingCache).length !== files.length)) {
    writeGraphCache(cachePath, nextCache);
  }

  return {
    files,
    aliases,
    forwardImports,
    reverseImporters,
    parsedImports,
    cacheHits,
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

export interface ResolveAffectedOptions {
  tier?: FeatureTier;
  maxFeatures?: number;
}

/**
 * Maps changed files to affected features using feature entry globs,
 * transitive import graph traversal, criticality tier ordering, and blast-radius caps.
 */
export function resolveAffectedFeatures(
  cwd: string,
  config: RunboxConfig,
  changedFiles: string[],
  existingGraph?: ImportGraph,
  options: ResolveAffectedOptions = {}
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
      deferredFeatures: [],
    };
  }

  const graph = existingGraph ?? buildImportGraph(cwd, config.aliases);
  const reverseClosure = getTransitiveReverseClosure(graph, normalizedChanged);

  let affectedFeatures: FeatureConfig[] = [];
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

  // Order affected features by criticality tier (p0 -> p1 -> p2)
  affectedFeatures.sort(
    (a, b) => TIER_PRIORITY[a.tier ?? "p1"] - TIER_PRIORITY[b.tier ?? "p1"]
  );

  if (options.tier) {
    const filtered: FeatureConfig[] = [];
    for (const f of affectedFeatures) {
      if ((f.tier ?? "p1") === options.tier) {
        filtered.push(f);
      } else {
        skippedFeatures.push(f);
      }
    }
    affectedFeatures = filtered;
  }

  let deferredFeatures: FeatureConfig[] = [];
  const cap = options.maxFeatures ?? config.blastRadius?.maxLocalFeatures;
  if (cap && cap > 0 && affectedFeatures.length > cap) {
    deferredFeatures = affectedFeatures.slice(cap);
    affectedFeatures = affectedFeatures.slice(0, cap);
    skippedFeatures.push(...deferredFeatures);
  }

  return {
    changedFiles: normalizedChanged,
    impactedFiles: Array.from(reverseClosure).sort(),
    affectedFeatures,
    skippedFeatures,
    deferredFeatures,
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
