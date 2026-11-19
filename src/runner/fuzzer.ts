import fc from "fast-check";
import type { Page } from "playwright-core";
import type { FeatureConfig } from "../config/schema.js";
import { captureUiState, type StateTransition } from "./state-fingerprint.js";
import { InvariantViolationError, type TelemetryTrap } from "./telemetry.js";

export interface FuzzActionTarget {
  selector: string;
  kind: "click" | "fill";
  label: string;
  fillValues?: string[];
}

export interface FuzzActionStep {
  targetIndex: number;
  fillValue?: string;
}

export interface FuzzFailureDetail {
  invariant: string;
  message: string;
  minimalSteps: string[];
  transitions: StateTransition[];
  screenshotBuffer?: Buffer;
}

export interface FuzzResult {
  passed: boolean;
  seedHex: string;
  seedInt: number;
  runsExecuted: number;
  transitionsExecuted: number;
  transitions: StateTransition[];
  failure?: FuzzFailureDetail;
}

const DEFAULT_FUZZ_INPUTS = ["SAVE20", "0", "1", "INVALID", ""];

export function parseSeedHex(seedOpt?: string): { seedInt: number; seedHex: string } {
  if (seedOpt) {
    const cleaned = seedOpt.trim();
    const parsed = cleaned.startsWith("0x") || cleaned.startsWith("0X")
      ? Number.parseInt(cleaned.slice(2), 16)
      : Number.parseInt(cleaned, 10);
    if (!Number.isNaN(parsed)) {
      const seedInt = parsed | 0;
      const seedHex = `0x${(seedInt >>> 0).toString(16)}`;
      return { seedInt, seedHex };
    }
  }
  const randomInt = (Math.floor(Math.random() * 0xffff) + 1) | 0;
  return {
    seedInt: randomInt,
    seedHex: `0x${(randomInt >>> 0).toString(16)}`,
  };
}

const DESTRUCTIVE_ACTION_PATTERN =
  "\\b(?:log\\s*out|sign\\s*out|delete\\s*account|place\\s*order|pay\\s*now|cancel\\s*order|confirm\\s*payment|remove\\s*account)\\b";

export interface DiscoverTargetsOptions {
  allowMutations?: boolean;
  excludeActionPatterns?: string[];
}

/**
 * Discovers visible interactive controls (buttons, links, inputs) inside `scopeSelector`
 * while filtering out destructive actions in safe-fuzz mode.
 */
export async function discoverInteractiveTargets(
  page: Page,
  scopeSelector = "body",
  options: DiscoverTargetsOptions = {}
): Promise<FuzzActionTarget[]> {
  const allowMutations = options.allowMutations ?? false;
  const excludePatterns = [
    ...(allowMutations ? [] : [DESTRUCTIVE_ACTION_PATTERN]),
    ...(options.excludeActionPatterns ?? []),
  ];

  return page.evaluate(
    ({ scopeSel, patterns }) => {
      const root = document.querySelector(scopeSel) ?? document.body;
      if (!root) return [];

      const excludeRegexes = patterns.map((p) => new RegExp(p, "i"));
      const candidates = root.querySelectorAll(
        'button, [role="button"], input:not([type="hidden"]), select'
      );
      const targets: FuzzActionTarget[] = [];
      const seenSelectors = new Set<string>();

      candidates.forEach((el, idx) => {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.display === "none" || style.visibility === "hidden") return;
        if ((htmlEl as HTMLButtonElement).disabled) return;
        if (htmlEl.dataset.runboxIgnore === "true") return;

        const testId = htmlEl.getAttribute("data-testid");
        const id = htmlEl.getAttribute("id");
        const aria = htmlEl.getAttribute("aria-label");
        const text = htmlEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 32) ?? "";

        const combinedLabel = `${testId ?? ""} ${aria ?? ""} ${text}`;
        if (excludeRegexes.some((re) => re.test(combinedLabel))) {
          return;
        }

        let selector: string;
        if (testId) {
          selector = `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        } else if (id) {
          selector = `#${CSS.escape(id)}`;
        } else if (aria) {
          selector = `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        } else if (htmlEl.tagName === "BUTTON" && text) {
          selector = `${scopeSel} button:has-text("${text.replace(/"/g, '\\"')}")`;
        } else {
          selector = `${scopeSel} ${htmlEl.tagName.toLowerCase()} >> nth=${idx}`;
        }

        if (seenSelectors.has(selector)) return;
        seenSelectors.add(selector);

        const isInput = htmlEl.tagName === "INPUT";
        const labelName = testId || aria || text || id || htmlEl.tagName.toLowerCase();

        targets.push({
          selector,
          kind: isInput ? "fill" : "click",
          label: isInput ? `Fill "${labelName}"` : `Click "${labelName}"`,
        });
      });

      return targets;
    },
    { scopeSel: scopeSelector, patterns: excludePatterns }
  );
}

/**
 * Runs seeded property-based UI fuzzing via `fast-check` with automatic
 * counterexample shrinking when any telemetry trap or domain invariant fails.
 */
export async function runFeatureFuzzer(params: {
  page: Page;
  baseUrl: string;
  feature: FeatureConfig;
  telemetry: TelemetryTrap;
  resetToFeatureStart: () => Promise<void>;
  seedOpt?: string;
}): Promise<FuzzResult> {
  const { page, baseUrl, feature, telemetry, resetToFeatureStart, seedOpt } = params;
  const { seedInt, seedHex } = parseSeedHex(seedOpt);
  const scopeSelector = feature.fuzz?.scopeSelector ?? "body";
  const maxSteps = feature.fuzz?.steps ?? 8;
  const numRuns = feature.fuzz?.runs ?? 6;

  // Inspect targets once at the post-journey state
  const targets = await discoverInteractiveTargets(page, scopeSelector, {
    allowMutations: feature.fuzz?.allowMutations,
    excludeActionPatterns: feature.fuzz?.excludeActionPatterns,
  });
  if (targets.length === 0) {
    return {
      passed: true,
      seedHex,
      seedInt,
      runsExecuted: 0,
      transitionsExecuted: 0,
      transitions: [],
    };
  }

  const stepArbitrary = fc.record({
    targetIndex: fc.integer({ min: 0, max: targets.length - 1 }),
    fillValue: fc.constantFrom(...DEFAULT_FUZZ_INPUTS),
  });
  const sequenceArbitrary = fc.array(stepArbitrary, {
    minLength: 1,
    maxLength: maxSteps,
  });

  const collectedTransitions: StateTransition[] = [];
  let totalTransitionsExecuted = 0;

  const executeSingleStep = async (
    step: FuzzActionStep,
    prevState: { id: string },
    recordTransitions: boolean,
    runTransitions: StateTransition[]
  ): Promise<{ id: string } | null> => {
    const target = targets[step.targetIndex];
    const actionLabel =
      target.kind === "fill"
        ? `Fuzz [${target.label} = "${step.fillValue ?? ""}"]`
        : `Fuzz [${target.label}]`;

    const locator = page.locator(target.selector).first();
    const visible = await locator.isVisible().catch(() => false);
    const enabled = visible ? await locator.isEnabled().catch(() => false) : false;
    if (!visible || !enabled) {
      return null;
    }

    if (target.kind === "fill") {
      await locator.fill(step.fillValue ?? "", { timeout: 1000 });
    } else {
      await locator.click({ timeout: 1000 });
    }

    await page.waitForTimeout(25);
    totalTransitionsExecuted++;

    try {
      telemetry.assertClean();
      if (feature.assertInvariants) {
        await feature.assertInvariants({ page, baseUrl });
      }
    } catch (err) {
      if (recordTransitions) {
        runTransitions.push({
          featureId: feature.id,
          from: prevState.id,
          to: "Invariant_Failed",
          action: `${actionLabel} ❌`,
          ok: false,
        });
      }
      throw err;
    }

    const nextState = await captureUiState(page, feature.stateLabel);
    const edge: StateTransition = {
      featureId: feature.id,
      from: prevState.id,
      to: nextState.id,
      action: actionLabel,
      ok: true,
    };
    if (recordTransitions) {
      runTransitions.push(edge);
    }
    if (collectedTransitions.length < 40) {
      collectedTransitions.push(edge);
    }
    return nextState;
  };

  const executeSequence = async (
    sequence: FuzzActionStep[],
    recordTransitions: boolean
  ): Promise<StateTransition[]> => {
    const runTransitions: StateTransition[] = [];
    await resetToFeatureStart();
    telemetry.reset();

    let prevState: { id: string } = await captureUiState(page, feature.stateLabel);
    for (const step of sequence) {
      const next = await executeSingleStep(step, prevState, recordTransitions, runTransitions);
      if (next) prevState = next;
    }
    return runTransitions;
  };

  // Phase 1: Explore-First Fast Pass (reuses initial post-journey page for seq 0; resets between sequences)
  const sampledSequences = fc.sample(sequenceArbitrary, { seed: seedInt, numRuns });
  let executedFlatPrefix: FuzzActionStep[] = [];
  let fastExploreError: unknown = null;
  let fastRunsExecuted = 0;
  let liveState: { id: string } = await captureUiState(page, feature.stateLabel);

  outer: for (let seqIdx = 0; seqIdx < sampledSequences.length; seqIdx++) {
    const seq = sampledSequences[seqIdx];
    if (seqIdx > 0) {
      await resetToFeatureStart();
      telemetry.reset();
      liveState = await captureUiState(page, feature.stateLabel);
    }
    fastRunsExecuted++;
    executedFlatPrefix = [];
    for (const step of seq) {
      executedFlatPrefix.push(step);
      try {
        const next = await executeSingleStep(step, liveState, false, []);
        if (next) liveState = next;
      } catch (err) {
        fastExploreError = err;
        break outer;
      }
    }
  }

  if (!fastExploreError) {
    return {
      passed: true,
      seedHex,
      seedInt,
      runsExecuted: fastRunsExecuted,
      transitionsExecuted: totalTransitionsExecuted,
      transitions: collectedTransitions,
    };
  }

  // Phase 2: Shrink-Only-On-Failure via fast-check asyncProperty
  let shrinkRunsExecuted = 0;
  const checkResult = await fc.check(
    fc.asyncProperty(sequenceArbitrary, async (sequence) => {
      shrinkRunsExecuted++;
      await executeSequence(sequence, false);
    }),
    {
      seed: seedInt,
      numRuns,
    }
  );

  let shrunkSeq: FuzzActionStep[];
  let failureError: unknown = fastExploreError;

  if (checkResult.failed) {
    shrunkSeq = (checkResult.counterexample?.[0] ?? []) as FuzzActionStep[];
    failureError = checkResult.errorInstance ?? fastExploreError;
  } else {
    // Fallback shrink when failure depended on cumulative clicks across sampled sequences
    shrunkSeq = await shrinkFlatActionPrefix(executedFlatPrefix, (seq) =>
      executeSequence(seq, false).then(() => undefined)
    );
  }

  const minimalSteps = shrunkSeq.map((s) => {
    const t = targets[s.targetIndex];
    return t.kind === "fill" ? `${t.label} = "${s.fillValue ?? ""}"` : t.label;
  });

  let failureTransitions: StateTransition[] = [];
  try {
    failureTransitions = await executeSequence(shrunkSeq, true);
  } catch (err) {
    failureError = err;
    // executeSequence pushes the failing edge onto runTransitions before throwing only if captured;
    // replay step-by-step here so failureTransitions always includes prior edges + failing edge
    try {
      await resetToFeatureStart();
      telemetry.reset();
      let prevState: { id: string } = await captureUiState(page, feature.stateLabel);
      failureTransitions = [];
      for (const s of shrunkSeq) {
        const next = await executeSingleStep(s, prevState, true, failureTransitions);
        if (next) prevState = next;
      }
    } catch (innerErr) {
      failureError = innerErr;
    }
  }

  const screenshotBuffer = await page.screenshot({ fullPage: false }).catch(() => undefined);
  const invariantKind =
    failureError instanceof InvariantViolationError
      ? failureError.kind
      : "domainInvariant";
  const detailMsg =
    failureError instanceof InvariantViolationError
      ? failureError.detail
      : failureError instanceof Error
        ? failureError.message
        : String(failureError ?? "Property invariant failed");

  return {
    passed: false,
    seedHex,
    seedInt,
    runsExecuted: fastRunsExecuted + shrinkRunsExecuted,
    transitionsExecuted: totalTransitionsExecuted,
    transitions: failureTransitions.length > 0 ? failureTransitions : collectedTransitions,
    failure: {
      invariant: invariantKind,
      message: detailMsg,
      minimalSteps,
      transitions: failureTransitions,
      screenshotBuffer,
    },
  };
}

async function shrinkFlatActionPrefix(
  steps: FuzzActionStep[],
  runSteps: (seq: FuzzActionStep[]) => Promise<void>
): Promise<FuzzActionStep[]> {
  let current = [...steps];
  let idx = 0;
  while (idx < current.length && current.length > 1) {
    const candidate = [...current.slice(0, idx), ...current.slice(idx + 1)];
    let failed = false;
    try {
      await runSteps(candidate);
    } catch {
      failed = true;
    }
    if (failed) {
      current = candidate;
    } else {
      idx++;
    }
  }
  return current;
}
