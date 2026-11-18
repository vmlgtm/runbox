import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import type { RunboxConfig } from "./schema.js";

const DEFAULT_CONFIG_FILENAMES = [
  "runbox.config.ts",
  "runbox.config.mts",
  "runbox.config.js",
  "runbox.config.mjs",
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

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
  });

  const loaded = await jiti.import(targetPath, { default: true });
  const config = (loaded as { default?: RunboxConfig })?.default ?? (loaded as RunboxConfig);

  if (!config || typeof config !== "object" || !Array.isArray(config.features)) {
    throw new Error(
      `Invalid runbox config in ${targetPath}: expected a default export with a \`features\` array.`
    );
  }

  return { config, configPath: targetPath };
}
