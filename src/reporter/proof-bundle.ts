import fs from "node:fs";
import path from "node:path";
import type { StateTransition } from "../runner/state-fingerprint.js";
import type { VerificationRunResult } from "../runner/verifier.js";

/**
 * Compiles recorded UI state transitions into valid Mermaid `stateDiagram-v2` syntax,
 * deduplicating repeated identical transitions so fuzz loops stay concise.
 */
export function compileMermaidStatechart(transitions: StateTransition[]): string {
  const lines: string[] = ["stateDiagram-v2"];
  const seen = new Set<string>();

  if (transitions.length === 0) {
    lines.push("    [*] --> Idle: No transitions recorded");
    return lines.join("\n");
  }

  for (const t of transitions) {
    const fromId = t.from === "[*]" ? "[*]" : sanitizeStateId(t.from);
    const toId = sanitizeStateId(t.to);
    // Collapse passing no-op fuzz self-loops while keeping real state transitions, journey steps, and failures
    if (t.ok && fromId === toId && t.action.startsWith("Fuzz [")) {
      continue;
    }
    const label = sanitizeTransitionLabel(t.action);
    const line = `    ${fromId} --> ${toId}: ${label}`;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }

  if (lines.length === 1) {
    lines.push("    [*] --> Idle: No state changes recorded");
  }

  return lines.join("\n");
}

function sanitizeStateId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_") || "State";
}

function sanitizeTransitionLabel(label: string): string {
  return label
    .replace(/:/g, " -")
    .replace(/[;\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
}

/**
 * Writes the human-reviewable Proof Bundle markdown report to `.runbox/proof/report.md`.
 * Returns the path relative to `cwd`.
 */
export async function writeProofBundle(
  cwd: string,
  result: VerificationRunResult
): Promise<string> {
  const resolvedCwd = path.resolve(cwd);
  const proofDir = path.join(resolvedCwd, ".runbox", "proof");
  fs.mkdirSync(proofDir, { recursive: true });
  const reportPath = path.join(proofDir, "report.md");

  const statusBadge = result.status === "passed" ? "PASSED ✅" : "FAILED ❌";
  const domainFailures = result.features.filter(
    (f) => f.failure?.violatedInvariant === "domainInvariant"
  ).length;

  const lines: string[] = [
    `# runbox Proof Bundle — ${statusBadge}`,
    ``,
    `- **Duration:** ${(result.durationMs / 1000).toFixed(2)}s`,
    `- **Affected Features Tested:** ${result.affectedFeatureIds.length > 0 ? result.affectedFeatureIds.map((id) => `\`${id}\``).join(", ") : "_none_"}`,
    `- **Skipped Features:** ${result.skippedFeatureIds.length > 0 ? result.skippedFeatureIds.map((id) => `\`${id}\``).join(", ") : "_none_"}`,
    ``,
    `## Invariant Scorecard`,
    ``,
    `| Invariant | Violations | Status |`,
    `| :--- | :---: | :---: |`,
    `| Console Errors | ${result.telemetryTotals.consoleErrors} | ${result.telemetryTotals.consoleErrors === 0 ? "✅" : "❌"} |`,
    `| Uncaught Exceptions | ${result.telemetryTotals.uncaughtExceptions} | ${result.telemetryTotals.uncaughtExceptions === 0 ? "✅" : "❌"} |`,
    `| Hydration Mismatches | ${result.telemetryTotals.hydrationMismatches} | ${result.telemetryTotals.hydrationMismatches === 0 ? "✅" : "❌"} |`,
    `| Server 5xx Responses | ${result.telemetryTotals.server5xx} | ${result.telemetryTotals.server5xx === 0 ? "✅" : "❌"} |`,
    `| Domain Invariants | ${domainFailures} | ${domainFailures === 0 ? "✅" : "❌"} |`,
    ``,
    `## Features Verified`,
    ``,
    `| Feature | Route | Journey Steps | Fuzz Runs | Transitions | Seed | Result |`,
    `| :--- | :--- | :---: | :---: | :---: | :--- | :---: |`,
  ];

  for (const feat of result.features) {
    lines.push(
      `| \`${feat.featureId}\` (${feat.featureName}) | \`${feat.route}\` | ${feat.journeySteps} | ${feat.fuzzRuns} | ${feat.transitionsExecuted} | ${feat.seed ? `\`${feat.seed}\`` : "—"} | ${feat.passed ? "✅ Passed" : "❌ Failed"} |`
    );
  }

  lines.push(
    ``,
    `## Verified UI Statechart`,
    ``,
    "```mermaid",
    compileMermaidStatechart(result.transitions),
    "```",
    ``
  );

  const failedFeatures = result.features.filter((f) => !f.passed && f.failure);
  if (failedFeatures.length > 0) {
    lines.push(`## Failure Counterexamples`, ``);
    for (const feat of failedFeatures) {
      const f = feat.failure!;
      lines.push(`### \`${f.featureId}\` — \`${f.violatedInvariant}\``);
      lines.push(`- **Error:** ${f.message}`);
      if (f.seed) {
        lines.push(`- **Replay Command:** \`npx runbox verify --feature ${f.featureId} --fuzz --seed ${f.seed}\``);
      }
      lines.push(`- **Minimal Reproduction Steps:**`);
      f.minimalReproductionSteps.forEach((step, idx) => {
        lines.push(`  ${idx + 1}. ${step}`);
      });
      lines.push(`- **Remediation:** ${f.remediation}`);
      lines.push(``);
    }
  }

  const allScreenshots = result.features.flatMap((f) => f.screenshots);
  if (allScreenshots.length > 0) {
    lines.push(`## Captured Evidence`, ``);
    for (const relFromCwd of allScreenshots) {
      const relFromProofDir = path.relative(proofDir, path.join(resolvedCwd, relFromCwd));
      const label = path.basename(relFromCwd);
      lines.push(`- [${label}](${relFromProofDir})`);
    }
    lines.push(``);
  }

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  return path.relative(resolvedCwd, reportPath);
}
