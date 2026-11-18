import type { GuardrailViolation } from "../graph/guardrails.js";
import type { VerificationRunResult } from "../runner/verifier.js";

const MAX_ORACLE_CHARS = 1800; // < 500 tokens at ~3.6-4 chars/token

export interface AgentCheckPayload {
  status: "passed" | "failed";
  changedFiles: string[];
  affectedFeatures: string[];
  skippedFeatures: string[];
  guardrailViolations: Array<{
    ruleId: string;
    file: string;
    line?: number;
    detail: string;
    remediation: string;
  }>;
}

export interface AgentVerifyFailure {
  featureId: string;
  violatedInvariant: string;
  message: string;
  seed?: string;
  replayCommand: string;
  minimalReproductionSteps: string[];
  remediation: string;
}

export interface AgentVerifyPayload {
  status: "passed" | "failed";
  affectedFeatures: string[];
  skippedFeatures: string[];
  guardrailViolations: Array<{
    ruleId: string;
    file: string;
    line?: number;
    detail: string;
    remediation: string;
  }>;
  failures: AgentVerifyFailure[];
  proofReportPath?: string;
}

/** Formats static `runbox check` output into a compact <500-token JSON oracle. */
export function formatAgentCheckOracle(payload: AgentCheckPayload): string {
  return fitWithinTokenBudget(payload);
}

/**
 * Formats full `runbox verify` output (including guardrails and fast-check shrunk
 * failures) into a strict <500-token self-healing JSON oracle.
 */
export function formatAgentOracle(params: {
  verification?: VerificationRunResult;
  guardrailViolations: GuardrailViolation[];
  affectedFeatures: string[];
  skippedFeatures: string[];
  proofReportPath?: string;
}): string {
  const {
    verification,
    guardrailViolations,
    affectedFeatures,
    skippedFeatures,
    proofReportPath,
  } = params;

  const failures: AgentVerifyFailure[] = (verification?.features ?? [])
    .filter((f) => !f.passed && f.failure)
    .map((f) => {
      const fail = f.failure!;
      const replayCommand = fail.seed
        ? `runbox verify --feature ${fail.featureId} --fuzz --seed ${fail.seed} --agent`
        : `runbox verify --feature ${fail.featureId} --agent`;
      return {
        featureId: fail.featureId,
        violatedInvariant: fail.violatedInvariant,
        message: fail.message.slice(0, 140),
        ...(fail.seed ? { seed: fail.seed } : {}),
        replayCommand,
        minimalReproductionSteps: fail.minimalReproductionSteps.slice(0, 6),
        remediation: fail.remediation.slice(0, 160),
      };
    });

  const status: "passed" | "failed" =
    guardrailViolations.length > 0 || (verification && verification.status === "failed")
      ? "failed"
      : "passed";

  const payload: AgentVerifyPayload = {
    status,
    affectedFeatures,
    skippedFeatures,
    guardrailViolations: guardrailViolations.slice(0, 5).map((v) => ({
      ruleId: v.ruleId,
      file: v.file,
      ...(v.line ? { line: v.line } : {}),
      detail: v.detail.slice(0, 100),
      remediation: v.remediation.slice(0, 140),
    })),
    failures,
    ...(proofReportPath ? { proofReportPath } : {}),
  };

  return fitWithinTokenBudget(payload);
}

function fitWithinTokenBudget(payload: AgentCheckPayload | AgentVerifyPayload): string {
  let serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_ORACLE_CHARS) {
    return serialized;
  }

  // Progressively compact fields while keeping status, replayCommand, steps, and remediation intact
  const clone = structuredClone(payload) as unknown as Record<string, unknown>;
  if (Array.isArray(clone.skippedFeatures) && clone.skippedFeatures.length > 5) {
    clone.skippedFeatures = [
      ...clone.skippedFeatures.slice(0, 4),
      `+${clone.skippedFeatures.length - 4} more`,
    ];
  }
  serialized = JSON.stringify(clone);
  if (serialized.length <= MAX_ORACLE_CHARS) {
    return serialized;
  }

  if (Array.isArray(clone.failures)) {
    clone.failures = (clone.failures as AgentVerifyFailure[]).slice(0, 2).map((f) => ({
      ...f,
      message: f.message.slice(0, 80),
      remediation: f.remediation.slice(0, 90),
      minimalReproductionSteps: f.minimalReproductionSteps.slice(0, 4),
    }));
  }
  if (Array.isArray(clone.guardrailViolations)) {
    clone.guardrailViolations = clone.guardrailViolations.slice(0, 2);
  }

  serialized = JSON.stringify(clone);
  return serialized.length <= MAX_ORACLE_CHARS
    ? serialized
    : serialized.slice(0, MAX_ORACLE_CHARS);
}
