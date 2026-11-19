export { defineConfig, defineFeature } from "./config/schema.js";
export { presets } from "./config/presets.js";
export type {
  BlastRadiusConfig,
  FeatureConfig,
  FeatureInput,
  FeatureTier,
  FuzzConfig,
  GlobalInvariants,
  GuardrailRule,
  JourneyContext,
  NetworkMockConfig,
  PatternRule,
  PersonaConfig,
  RunboxConfig,
  RunboxConfigInput,
  ServerConfig,
} from "./config/schema.js";

export { loadConfig, type LoadedConfig } from "./config/loader.js";
export { discoverProject, type DiscoveryResult } from "./discovery/route-discovery.js";
export { initProject, renderRunboxConfigTs, type InitResult } from "./discovery/init.js";
export {
  buildImportGraph,
  getFeatureDependencyClosure,
  getGitChangedFiles,
  getTransitiveReverseClosure,
  resolveAffectedFeatures,
  type AffectedFeatureResolution,
  type ImportGraph,
} from "./graph/import-graph.js";
export { runGuardrails, type GuardrailViolation } from "./graph/guardrails.js";
export {
  discoverLiveRoute,
  runVerification,
  type FeatureFailure,
  type FeatureVerificationResult,
  type RouteDiscoverySnapshot,
  type VerificationRunResult,
} from "./runner/verifier.js";
export {
  recordRoute,
  type RecordOptions,
  type RecordResult,
  type RecordedAction,
} from "./runner/recorder.js";
export { InvariantViolationError, type InvariantKind } from "./runner/telemetry.js";
export { type StateTransition, type UiStateNode } from "./runner/state-fingerprint.js";
export {
  compileMermaidStatechart,
  writeProofBundle,
} from "./reporter/proof-bundle.js";
export {
  formatAgentCheckOracle,
  formatAgentOracle,
  type AgentCheckPayload,
  type AgentVerifyFailure,
  type AgentVerifyPayload,
} from "./reporter/agent-json.js";
