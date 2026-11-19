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
  /** Ignore third-party external script console.error messages (default: true). */
  firstPartyConsoleOnly?: boolean;
  /** Regex pattern strings of known legacy console errors to ignore. */
  ignoreConsolePatterns?: string[];
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
  /** Allow destructive UI actions and unmocked write HTTP methods during fuzzing (default: false). */
  allowMutations?: boolean;
  /** Additional regex pattern strings of button/input labels to skip during fuzzing. */
  excludeActionPatterns?: string[];
}

export type FeatureTier = "p0" | "p1" | "p2";

export interface PersonaConfig {
  /** Unique persona identifier (e.g. "care-plan-member"). */
  id: string;
  /** Cookies injected into the isolated BrowserContext before navigation. */
  cookies?: Array<{ name: string; value: string; path?: string }>;
  /** Key-value pairs seeded into `window.localStorage` before page scripts run. */
  localStorage?: Record<string, string>;
  /** Extra HTTP headers attached to requests made by this context. */
  headers?: Record<string, string>;
}

export interface NetworkMockConfig {
  /** Playwright URL glob or pattern (e.g. matching `/api/promo`). */
  urlPattern: string;
  /** Optional HTTP method filter (e.g. "GET", "POST"). */
  method?: string;
  /** HTTP status code returned by the mock (default: 200). */
  status?: number;
  /** Optional Content-Type override (defaults to application/json for objects, text/plain for strings). */
  contentType?: string;
  /** Mock response payload (serialized to JSON automatically unless already a string). */
  body: unknown;
}

export interface BlastRadiusConfig {
  /** Maximum number of highest-priority affected features to run locally on large diffs. */
  maxLocalFeatures?: number;
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
  /** Criticality tier used for blast-radius prioritization (`p0` highest, default `p1`). */
  tier?: FeatureTier;
  /** Persona name from `config.personas` or inline PersonaConfig applied to this feature's BrowserContext. */
  persona?: string | PersonaConfig;
  /** Deterministic network/API mocks applied during verification of this feature. */
  mocks?: NetworkMockConfig[];
  /** Optional deterministic user journey setup / happy-path verification. */
  journey?: (ctx: JourneyContext) => Promise<void>;
  /** Domain-specific invariant assertions checked after each journey step and fuzz action. */
  assertInvariants?: (ctx: { page: Page; baseUrl: string }) => Promise<void>;
  /** Optional custom semantic state labeler used when generating Mermaid statecharts. */
  stateLabel?: (page: Page) => Promise<string>;
  /** Optional property-based UI fuzzing configuration. */
  fuzz?: FuzzConfig;
}

export type FeatureInput = Omit<FeatureConfig, "files"> & { files?: string[] };

export function defineFeature(feature: FeatureInput): FeatureConfig {
  return {
    ...feature,
    files: feature.files ?? [],
  };
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
  /** Globs scanned for co-located `defineFeature()` files (defaults to `*.runbox.*` under `src/`). */
  featureGlobs?: string[];
  /** Blast-radius policy capping local verification on high-fanout shared edits. */
  blastRadius?: BlastRadiusConfig;
  /** Reusable user personas referenced by name from `feature.persona`. */
  personas?: Record<string, PersonaConfig>;
  /** Global network/API mocks applied across all verified features. */
  mocks?: NetworkMockConfig[];
  /** Feature Map entries linking files to runtime routes, journeys, and invariants. */
  features: FeatureConfig[];
}

export type RunboxConfigInput = Omit<RunboxConfig, "features"> & {
  features?: FeatureConfig[];
};

export function defineConfig(config: RunboxConfigInput): RunboxConfig {
  return {
    ...config,
    features: config.features ?? [],
  };
}
