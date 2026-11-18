import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { matchesAnyGlob, toPosixPath, walkFiles } from "../utils/glob.js";
import type { FeatureConfig, RunboxConfig } from "./schema.js";

const DEFAULT_CONFIG_FILENAMES = [
  "runbox.config.ts",
  "runbox.config.mts",
  "runbox.config.js",
  "runbox.config.mjs",
];

const DEFAULT_FEATURE_GLOBS = [
  "src/**/*.runbox.ts",
  "src/**/*.runbox.js",
  "src/**/*.runbox.mjs",
  ".runbox/features/**/*.ts",
  ".runbox/features/**/*.js",
];

export interface LoadedConfig {
  config: RunboxConfig;
  configPath: string;
}

/**
 * Loads `runbox.config.*` using jiti so TypeScript configs and async journey
 * callbacks work without requiring a separate compilation step.
 */
export async function loadConfig(
  cwd: string,
  explicitPath?: string
): Promise<LoadedConfig> {
  const resolvedCwd = path.resolve(cwd);
  let targetPath: string | undefined;

  if (explicitPath) {
    const candidate = path.resolve(resolvedCwd, explicitPath);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Runbox config not found at ${candidate}`);
    }
    targetPath = candidate;
  } else {
    for (const filename of DEFAULT_CONFIG_FILENAMES) {
      const candidate = path.join(resolvedCwd, filename);
      if (fs.existsSync(candidate)) {
        targetPath = candidate;
        break;
      }
    }
  }

  if (!targetPath) {
    throw new Error(
      `No runbox.config.{ts,js,mjs} found in ${resolvedCwd}. Run \`runbox init\` first.`
    );
  }

  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const selfEntry = [
    path.join(selfDir, "index.js"),
    path.join(selfDir, "../index.ts"),
    path.join(selfDir, "../index.js"),
  ].find((candidate) => fs.existsSync(candidate));

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
    ...(selfEntry ? { alias: { runbox: selfEntry } } : {}),
  });

  const loaded = await jiti.import(targetPath, { default: true });
  const rawConfig = (loaded as { default?: RunboxConfig })?.default ?? (loaded as RunboxConfig);

  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error(
      `Invalid runbox config in ${targetPath}: expected a configuration object.`
    );
  }

  const inlineFeatures = Array.isArray(rawConfig.features) ? [...rawConfig.features] : [];
  const featureGlobs = rawConfig.featureGlobs ?? DEFAULT_FEATURE_GLOBS;
  const federatedFeatures = await loadFederatedFeatures(resolvedCwd, featureGlobs, jiti);

  const mergedById = new Map<string, FeatureConfig>();
  for (const feat of [...inlineFeatures, ...federatedFeatures]) {
    if (feat && feat.id && !mergedById.has(feat.id)) {
      mergedById.set(feat.id, feat);
    }
  }

  const config: RunboxConfig = {
    ...rawConfig,
    features: Array.from(mergedById.values()),
  };

  return { config, configPath: targetPath };
}

async function loadFederatedFeatures(
  cwd: string,
  featureGlobs: string[],
  jiti: ReturnType<typeof createJiti>
): Promise<FeatureConfig[]> {
  if (featureGlobs.length === 0) return [];

  const candidateFiles = new Set<string>(walkFiles(cwd));
  const dotRunboxFeaturesDir = path.join(cwd, ".runbox", "features");
  if (fs.existsSync(dotRunboxFeaturesDir)) {
    for (const rel of walkFiles(dotRunboxFeaturesDir)) {
      candidateFiles.add(`.runbox/features/${rel}`);
    }
  }

  const matchedFiles = Array.from(candidateFiles)
    .filter((file) => matchesAnyGlob(file, featureGlobs))
    .sort();

  const discovered: FeatureConfig[] = [];

  for (const relFile of matchedFiles) {
    const absFile = path.join(cwd, relFile);
    const mod = await jiti.import(absFile, { default: true });
    const exported = (mod as { default?: FeatureConfig | FeatureConfig[] })?.default ?? mod;
    const entries = Array.isArray(exported) ? exported : [exported];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || typeof (entry as FeatureConfig).id !== "string") {
        continue;
      }
      const feat = entry as FeatureConfig;
      const inferredDir = toPosixPath(path.posix.dirname(relFile));
      const files =
        feat.files && feat.files.length > 0
          ? feat.files
          : [inferredDir === "." ? relFile : `${inferredDir}/**`];
      discovered.push({ ...feat, files });
    }
  }

  return discovered;
}
