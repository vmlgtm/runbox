import * as clack from "@clack/prompts";
import pc from "picocolors";
import type { GuardrailViolation } from "../graph/guardrails.js";
import type { AffectedFeatureResolution } from "../graph/import-graph.js";
import type { VerificationRunResult } from "../runner/verifier.js";

export const tui = {
  intro(commandLabel: string) {
    clack.intro(pc.bgCyan(pc.black(` runbox v0.1.0 `)) + " " + pc.dim(commandLabel));
  },

  step(title: string, details: string[] = []) {
    clack.log.step(pc.bold(title));
    for (const line of details) {
      clack.log.message(pc.dim(`  ${line}`));
    }
  },

  warn(message: string) {
    clack.log.warn(pc.yellow(message));
  },

  error(message: string) {
    clack.log.error(pc.red(message));
  },

  reportGuardrails(violations: GuardrailViolation[]) {
    if (violations.length === 0) {
      clack.log.success(pc.green("Guardrails · 0 violations"));
      return;
    }

    clack.log.error(
      pc.red(`Guardrails · ${violations.length} violation(s) found`)
    );
    for (const v of violations) {
      const loc = v.line ? `${v.file}:${v.line}` : v.file;
      clack.log.message(
        `${pc.red("✖")} ${pc.bold(v.ruleId)} at ${pc.cyan(loc)}\n` +
          `  ${v.detail}\n` +
          `  ${pc.yellow("Remediation:")} ${v.remediation}`
      );
    }
  },

  reportDiffResolution(resolution: AffectedFeatureResolution, usedDiff: boolean) {
    if (!usedDiff) {
      clack.log.info(
        `Scope · Running all ${resolution.affectedFeatures.length} configured feature(s)`
      );
      return;
    }
    const affectedNames =
      resolution.affectedFeatures.map((f) => f.id).join(", ") || "none";
    const details = [
      `Changed files: ${resolution.changedFiles.length} (${resolution.changedFiles.slice(0, 4).join(", ")}${resolution.changedFiles.length > 4 ? ", ..." : ""})`,
      `Affected features (${resolution.affectedFeatures.length}): ${affectedNames}`,
    ];
    if (resolution.skippedFeatures.length > 0) {
      details.push(
        `Skipped unaffected (${resolution.skippedFeatures.length}): ${resolution.skippedFeatures.map((f) => f.id).join(", ")}`
      );
    }
    tui.step("Diff Graph", details);
  },

  reportVerification(result: VerificationRunResult, proofReportPath?: string) {
    for (const feat of result.features) {
      const header = `Feature: ${feat.featureName} (${feat.route})`;
      const lines = [
        `${feat.passed ? pc.green("✓") : pc.red("✖")} Journey: ${feat.journeySteps} step(s)`,
        `${
          feat.telemetry.consoleErrors +
            feat.telemetry.uncaughtExceptions +
            feat.telemetry.hydrationMismatches +
            feat.telemetry.server5xx ===
          0
            ? pc.green("✓")
            : pc.red("✖")
        } Telemetry: ${feat.telemetry.consoleErrors} console · ${feat.telemetry.hydrationMismatches} hydration · ${feat.telemetry.server5xx} 5xx`,
      ];
      if (feat.fuzzRuns > 0 || feat.seed) {
        lines.push(
          `${feat.passed ? pc.green("✓") : pc.red("✖")} Property Fuzz: ${feat.fuzzRuns} runs, ${feat.transitionsExecuted} transitions (seed: ${feat.seed ?? "auto"})`
        );
      }

      if (!feat.passed && feat.failure) {
        lines.push(
          pc.red(`Violation [${feat.failure.violatedInvariant}]: ${feat.failure.message}`),
          pc.yellow(`Minimal steps: ${feat.failure.minimalReproductionSteps.join(" -> ")}`),
          pc.dim(`Remediation: ${feat.failure.remediation}`)
        );
      }

      tui.step(header, lines);
    }

    if (proofReportPath) {
      const summaryLines = [
        `Report:      ${proofReportPath}`,
        `Transitions: ${result.transitions.length} recorded`,
        `Screenshots: ${result.features.reduce((acc, f) => acc + f.screenshots.length, 0)} captured`,
      ];
      clack.note(summaryLines.join("\n"), "Proof Bundle");
    }

    const durationSec = (result.durationMs / 1000).toFixed(2);
    if (result.status === "passed") {
      clack.outro(pc.green(`✔ Verification passed in ${durationSec}s`));
    } else {
      clack.outro(pc.red(`✖ Verification failed in ${durationSec}s`));
    }
  },
};
