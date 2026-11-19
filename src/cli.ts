import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config/loader.js";
import type { FeatureConfig, FeatureTier } from "./config/schema.js";
import { initProject } from "./discovery/init.js";
import { runGuardrails } from "./graph/guardrails.js";
import {
  buildImportGraph,
  getGitChangedFiles,
  resolveAffectedFeatures,
  type AffectedFeatureResolution,
} from "./graph/import-graph.js";
import {
  formatAgentCheckOracle,
  formatAgentOracle,
} from "./reporter/agent-json.js";
import { writeProofBundle } from "./reporter/proof-bundle.js";
import { discoverLiveRoute, runVerification } from "./runner/verifier.js";
import { recordRoute } from "./runner/recorder.js";
import { tui } from "./ui/tui.js";

const program = new Command();

program
  .name("runbox")
  .description("Framework-agnostic downstream verification harness for AI coding agents")
  .version("0.2.0");

program
  .command("init")
  .description("Auto-discover routes, aliases, server command, and generate runbox.config.ts + SKILL.md")
  .option("-f, --force", "Overwrite existing runbox.config.ts")
  .option("--agent", "Emit compact JSON output without TUI formatting")
  .action((opts: { force?: boolean; agent?: boolean }) => {
    const cwd = process.cwd();
    if (!opts.agent) tui.intro("init");

    try {
      const res = initProject(cwd, { overwrite: opts.force });
      const relConfig = path.relative(cwd, res.configPath);
      const relSkill = path.relative(cwd, res.skillPath);

      if (opts.agent) {
        console.log(
          JSON.stringify({
            status: "ok",
            framework: res.discovery.framework,
            configPath: relConfig,
            skillPath: relSkill,
            featuresDiscovered: res.discovery.features.map((f) => ({
              id: f.id,
              route: f.route,
              files: f.files,
            })),
          })
        );
      } else {
        tui.step(`Detected framework: ${res.discovery.framework}`, [
          `Aliases: ${Object.keys(res.discovery.aliases).length} detected`,
          `Features: ${res.discovery.features.length} route(s) discovered`,
          `Guardrails: ${res.discovery.guardrails.length} rule(s)`,
        ]);
        tui.step("Generated files", [relConfig, relSkill]);
        tui.step("Next step", ["Run `npx runbox check` or `npx runbox verify --fuzz`"]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.agent) {
        console.log(JSON.stringify({ status: "error", message: msg }));
      } else {
        tui.error(msg);
      }
      process.exitCode = 1;
    }
  });

function parseTierOption(raw?: string): FeatureTier | undefined {
  if (!raw) return undefined;
  const norm = raw.toLowerCase();
  if (norm === "p0" || norm === "p1" || norm === "p2") {
    return norm;
  }
  throw new Error(`Invalid --tier value "${raw}". Expected p0, p1, or p2.`);
}

program
  .command("check")
  .description("Run static Golden Rule guardrails and resolve git diff to affected features")
  .option("--diff", "Resolve changed files from git status/diff to affected features")
  .option("--tier <tier>", "Filter features by criticality tier (p0, p1, p2)")
  .option("-c, --config <path>", "Path to runbox config file")
  .option("--agent", "Emit <500-token self-healing JSON oracle")
  .action(async (opts: { diff?: boolean; tier?: string; config?: string; agent?: boolean }) => {
    const cwd = process.cwd();
    if (!opts.agent) tui.intro(opts.diff ? "check --diff" : "check");

    try {
      const tier = parseTierOption(opts.tier);
      const { config } = await loadConfig(cwd, opts.config);
      const graph = buildImportGraph(cwd, config.aliases);
      const changedFiles = opts.diff ? getGitChangedFiles(cwd) : [];
      const resolution: AffectedFeatureResolution = opts.diff
        ? resolveAffectedFeatures(cwd, config, changedFiles, graph, { tier })
        : {
            changedFiles: [],
            impactedFiles: [],
            affectedFeatures: tier
              ? config.features.filter((f) => (f.tier ?? "p1") === tier)
              : [...config.features],
            skippedFeatures: tier
              ? config.features.filter((f) => (f.tier ?? "p1") !== tier)
              : [],
          };

      const violations = runGuardrails(cwd, config, { graph });
      const status = violations.length > 0 ? "failed" : "passed";

      if (opts.agent) {
        console.log(
          formatAgentCheckOracle({
            status,
            changedFiles: resolution.changedFiles,
            affectedFeatures: resolution.affectedFeatures.map((f) => f.id),
            skippedFeatures: resolution.skippedFeatures.map((f) => f.id),
            guardrailViolations: violations,
          })
        );
      } else {
        tui.reportDiffResolution(resolution, Boolean(opts.diff));
        tui.reportGuardrails(violations);
      }

      if (status === "failed") {
        process.exitCode = 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.agent) {
        console.log(JSON.stringify({ status: "error", message: msg }));
      } else {
        tui.error(msg);
      }
      process.exitCode = 1;
    }
  });

program
  .command("verify")
  .description("Boot the ephemeral box, run telemetry traps + journeys + property fuzzing, and emit Proof Bundle")
  .option("--diff", "Only verify features impacted by current git diff")
  .option("--feature <id>", "Verify a specific feature ID from runbox.config.ts")
  .option("--tier <tier>", "Only verify features matching criticality tier (p0, p1, p2)")
  .option("--fuzz", "Enable fast-check UI property fuzzing with counterexample shrinking")
  .option("--seed <seed>", "Deterministic PRNG seed (hex or integer, e.g. 0x42)")
  .option("--url <url>", "Attach to an already running server URL instead of spawning server.command")
  .option("-c, --config <path>", "Path to runbox config file")
  .option("--agent", "Emit <500-token self-healing JSON oracle on stdout")
  .action(
    async (opts: {
      diff?: boolean;
      feature?: string;
      tier?: string;
      fuzz?: boolean;
      seed?: string;
      url?: string;
      config?: string;
      agent?: boolean;
    }) => {
      const cwd = process.cwd();
      if (!opts.agent) tui.intro(opts.diff ? "verify --diff" : "verify");

      try {
        const tier = parseTierOption(opts.tier);
        const { config } = await loadConfig(cwd, opts.config);
        const graph = buildImportGraph(cwd, config.aliases);
        const violations = runGuardrails(cwd, config, { graph });

        let targetFeatures: FeatureConfig[] = [];
        let skippedFeatures: FeatureConfig[] = [];

        if (opts.feature) {
          const match = config.features.find((f) => f.id === opts.feature);
          if (!match) {
            throw new Error(
              `Feature "${opts.feature}" not found in runbox.config.ts. Available: ${config.features.map((f) => f.id).join(", ")}`
            );
          }
          targetFeatures = [match];
          skippedFeatures = config.features.filter((f) => f.id !== opts.feature);
        } else if (opts.diff) {
          const changed = getGitChangedFiles(cwd);
          const resolution = resolveAffectedFeatures(cwd, config, changed, graph, { tier });
          targetFeatures = resolution.affectedFeatures;
          skippedFeatures = resolution.skippedFeatures;
          if (!opts.agent) {
            tui.reportDiffResolution(resolution, true);
          }
        } else if (tier) {
          targetFeatures = config.features.filter((f) => (f.tier ?? "p1") === tier);
          skippedFeatures = config.features.filter((f) => (f.tier ?? "p1") !== tier);
        } else {
          targetFeatures = [...config.features];
        }

        // Fail fast before booting runtime if static Golden Rules were broken
        if (violations.length > 0) {
          if (opts.agent) {
            console.log(
              formatAgentOracle({
                guardrailViolations: violations,
                affectedFeatures: targetFeatures.map((f) => f.id),
                skippedFeatures: skippedFeatures.map((f) => f.id),
              })
            );
          } else {
            tui.reportGuardrails(violations);
          }
          process.exitCode = 1;
          return;
        }

        if (targetFeatures.length === 0) {
          if (opts.agent) {
            console.log(
              formatAgentOracle({
                guardrailViolations: [],
                affectedFeatures: [],
                skippedFeatures: skippedFeatures.map((f) => f.id),
              })
            );
          } else {
            tui.warn("No affected features matched the current diff.");
          }
          return;
        }

        const verification = await runVerification(cwd, config, {
          features: targetFeatures,
          skippedFeatures,
          url: opts.url,
          fuzz: opts.fuzz,
          seed: opts.seed,
        });

        const proofReportPath = await writeProofBundle(cwd, verification);

        if (opts.agent) {
          console.log(
            formatAgentOracle({
              verification,
              guardrailViolations: [],
              affectedFeatures: verification.affectedFeatureIds,
              skippedFeatures: verification.skippedFeatureIds,
              proofReportPath,
            })
          );
        } else {
          tui.reportGuardrails([]);
          tui.reportVerification(verification, proofReportPath);
        }

        if (verification.status === "failed") {
          process.exitCode = 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.agent) {
          console.log(JSON.stringify({ status: "error", message: msg }));
        } else {
          tui.error(msg);
        }
        process.exitCode = 1;
      }
    }
  );

program
  .command("discover [route]")
  .description("Inspect live interactive elements and same-origin links on a route")
  .option("--url <url>", "Attach to an already running server URL")
  .option("-c, --config <path>", "Path to runbox config file")
  .option("--agent", "Emit compact JSON snapshot")
  .action(
    async (
      route: string | undefined,
      opts: { url?: string; config?: string; agent?: boolean }
    ) => {
      const cwd = process.cwd();
      const targetRoute = route ?? "/";
      if (!opts.agent) tui.intro(`discover ${targetRoute}`);

      try {
        const { config } = await loadConfig(cwd, opts.config);
        const snapshot = await discoverLiveRoute(cwd, config, targetRoute, {
          url: opts.url,
        });

        if (opts.agent) {
          console.log(JSON.stringify(snapshot));
        } else {
          tui.step(`Page: ${snapshot.title || targetRoute} (${snapshot.url})`, [
            `Interactive controls: ${snapshot.interactiveElements.length}`,
            ...snapshot.interactiveElements.slice(0, 12).map(
              (el) =>
                `  <${el.tag}> ${el.testId ? `[data-testid="${el.testId}"]` : ""} ${el.text ?? el.ariaLabel ?? ""}`
            ),
            `Same-origin links: ${snapshot.sameOriginLinks.join(", ") || "none"}`,
          ]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.agent) {
          console.log(JSON.stringify({ status: "error", message: msg }));
        } else {
          tui.error(msg);
        }
        process.exitCode = 1;
      }
    }
  );

program
  .command("record [route]")
  .description("Record JSON API mocks, persona cookies/localStorage, and journey steps into .runbox/recordings/")
  .option("--url <url>", "Attach to an already running server URL")
  .option("--duration <ms>", "Auto-stop recording after N milliseconds (otherwise stops when browser closes)")
  .option("--headless", "Run headless (useful for automated fixture capture)")
  .option("-c, --config <path>", "Path to runbox config file")
  .option("--agent", "Emit compact JSON output")
  .action(
    async (
      route: string | undefined,
      opts: {
        url?: string;
        duration?: string;
        headless?: boolean;
        config?: string;
        agent?: boolean;
      }
    ) => {
      const cwd = process.cwd();
      const targetRoute = route ?? "/";
      if (!opts.agent) tui.intro(`record ${targetRoute}`);

      try {
        const { config } = await loadConfig(cwd, opts.config);
        const durationMs = opts.duration ? Number.parseInt(opts.duration, 10) : undefined;
        if (!opts.agent && !durationMs) {
          tui.step("Recording session open", [
            "Interact with the app in Chromium, then close the browser window to save fixtures.",
          ]);
        }

        const recorded = await recordRoute(cwd, config, targetRoute, {
          url: opts.url,
          headless: Boolean(opts.headless),
          durationMs: durationMs && !Number.isNaN(durationMs) ? durationMs : undefined,
        });

        if (opts.agent) {
          console.log(JSON.stringify({ status: "ok", ...recorded }));
        } else {
          tui.step(`Saved recording for ${recorded.route}`, [
            `API Mocks:  ${recorded.mocksCount} -> ${recorded.mocksPath}`,
            `Persona:    ${recorded.personaPath}`,
            `Actions:    ${recorded.actionsCount} -> ${recorded.featurePath}`,
          ]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.agent) {
          console.log(JSON.stringify({ status: "error", message: msg }));
        } else {
          tui.error(msg);
        }
        process.exitCode = 1;
      }
    }
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
