import type { Page } from "playwright-core";

export interface ServerConfig {
  /** Shell command to start the dev/prod server. Supports `{{port}}` interpolation. */
  command?: string;
  /** Attach directly to an already-running server URL instead of spawning `command`. */
  url?: string;
  /** HTTP path to poll when waiting for server readiness (default: "/"). */
  readyPath?: string;
  /** Preferred port; if omitted, an ephemeral free port is allocated. */
  port?: number;
  /** Max milliseconds to wait for server readiness (default: 30000). */
  timeoutMs?: number;
  /** Optional path to framework config file (e.g. "config/config.json"). */
  configPath?: string;
  /** Extra environment variables injected into the spawned server process. */
  env?: Record<string, string>;
}

export interface PatternRule {
  /** Regular expression source string matched line-by-line. */
  pattern: string;
  /** Optional human-readable label for the forbidden pattern. */
  label?: string;
}

export interface GuardrailRule {
  /** Unique rule identifier. */
  id: string;
  /** Optional summary describing why this boundary exists. */
  description?: string;
  /** File globs this guardrail applies to (e.g. ["src/js/**"]). */
  files: string[];
  /** Glob patterns of forbidden import targets (e.g. ["server/**"] or ["playwright-core"]). */
  forbidImportsFrom?: string[];
  /** Regex patterns forbidden inside matching files. */
  forbidPatterns?: PatternRule[];
  /** Actionable self-healing guidance returned to the LLM agent on violation. */
  remediation: string;
}

export interface GlobalInvariants {
  /** Fail if any `console.error` fires during runtime verification (default: true). */
  noConsoleErrors?: boolean;
  /** Fail if any uncaught `pageerror` fires during runtime verification (default: true). */
  noUncaughtExceptions?: boolean;
  /** Fail if React/SSR hydration mismatch warnings appear (default: true). */
  noHydrationMismatch?: boolean;
  /** Fail if any same-origin HTTP >= 500 response occurs (default: true). */
  noServer5xx?: boolean;
}

export interface JourneyContext {
  page: Page;
  baseUrl: string;
  step: (label: string, fn: () => Promise<void>) => Promise<void>;
}

export interface FuzzConfig {
  /** Whether to run fast-check UI property fuzzing on this feature. */
  enabled?: boolean;
  /** CSS selector bounding interactive elements targeted by the fuzzer (default: "body"). */
  scopeSelector?: string;
  /** Maximum random UI actions per generated property sequence (default: 8). */
  steps?: number;
  /** Number of fast-check property runs before shrinking (default: 6). */
  runs?: number;
}

export interface FeatureConfig {
  /** Unique identifier used for CLI flags (`--feature <id>`). */
  id: string;
  /** Human-readable feature name. */
  name: string;
  /** URL path for the feature (may include dynamic segments like `/product/:id`). */
  route: string;
  /** Concrete URL path used at runtime when `route` contains dynamic parameters. */
  sampleRoute?: string;
  /** Entry files or globs owning this feature. */
  files: string[];
  /** Optional deterministic user journey setup / happy-path verification. */
  journey?: (ctx: JourneyContext) => Promise<void>;
  /** Domain-specific invariant assertions checked after each journey step and fuzz action. */
  assertInvariants?: (ctx: { page: Page; baseUrl: string }) => Promise<void>;
  /** Optional property-based UI fuzzing configuration. */
  fuzz?: FuzzConfig;
}

export interface RunboxConfig {
  /** Optional detected framework hint (e.g. "catalyst-core", "nextjs", "react-router"). */
  framework?: string;
  /** Ephemeral server boot configuration. */
  server?: ServerConfig;
  /** Module alias mappings (e.g. { "@pages": "src/js/pages" }). */
  aliases?: Record<string, string>;
  /** Static architectural & pattern guardrails with remediation prompts. */
  guardrails?: GuardrailRule[];
  /** Global runtime telemetry traps active across all features. */
  invariants?: GlobalInvariants;
  /** Feature Map entries linking files to runtime routes, journeys, and invariants. */
  features: FeatureConfig[];
}

export function defineConfig(config: RunboxConfig): RunboxConfig {
  return config;
}
