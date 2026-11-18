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

/**
 * Discovers visible interactive controls (buttons, links, inputs) inside `scopeSelector`
 * so `fast-check` can generate deterministic UI interaction sequences.
 */
export async function discoverInteractiveTargets(
  page: Page,
  scopeSelector = "body"
): Promise<FuzzActionTarget[]> {
  return page.evaluate((scopeSel) => {
    const root = document.querySelector(scopeSel) ?? document.body;
    if (!root) return [];

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
  }, scopeSelector);
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
  const targets = await discoverInteractiveTargets(page, scopeSelector);
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

  const executeSequence = async (
    sequence: FuzzActionStep[],
    recordTransitions: boolean
  ): Promise<StateTransition[]> => {
    const runTransitions: StateTransition[] = [];
    await resetToFeatureStart();
    telemetry.reset();

    let prevState = await captureUiState(page);

    for (const step of sequence) {
      const target = targets[step.targetIndex];
      const actionLabel =
        target.kind === "fill"
          ? `Fuzz [${target.label} = "${step.fillValue ?? ""}"]`
          : `Fuzz [${target.label}]`;

      const locator = page.locator(target.selector).first();
      const visible = await locator.isVisible().catch(() => false);
      const enabled = visible ? await locator.isEnabled().catch(() => false) : false;
      if (!visible || !enabled) {
        continue;
      }

      if (target.kind === "fill") {
        await locator.fill(step.fillValue ?? "", { timeout: 1000 });
      } else {
        await locator.click({ timeout: 1000 });
      }

      // Allow microtasks / state renders to settle cleanly
      await page.waitForTimeout(40);
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

      const nextState = await captureUiState(page);
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
      if (collectedTransitions.length < 25) {
        collectedTransitions.push(edge);
      }
      prevState = nextState;
    }

    return runTransitions;
  };

  let runsExecuted = 0;
  const checkResult = await fc.check(
    fc.asyncProperty(sequenceArbitrary, async (sequence) => {
      runsExecuted++;
      await executeSequence(sequence, false);
    }),
    {
      seed: seedInt,
      numRuns,
    }
  );

  if (!checkResult.failed) {
    return {
      passed: true,
      seedHex,
      seedInt,
      runsExecuted,
      transitionsExecuted: totalTransitionsExecuted,
      transitions: collectedTransitions,
    };
  }

  // Replay the shrunk minimal counterexample once to collect clean steps, transitions & screenshot
  const shrunkSeq = (checkResult.counterexample?.[0] ?? []) as FuzzActionStep[];
  const minimalSteps = shrunkSeq.map((s) => {
    const t = targets[s.targetIndex];
    return t.kind === "fill" ? `${t.label} = "${s.fillValue ?? ""}"` : t.label;
  });

  let failureTransitions: StateTransition[] = [];
  let failureError: unknown = checkResult.errorInstance;

  try {
    await resetToFeatureStart();
    telemetry.reset();
    let prevState = await captureUiState(page);

    for (const s of shrunkSeq) {
      const t = targets[s.targetIndex];
      const actionLabel =
        t.kind === "fill"
          ? `Fuzz [${t.label} = "${s.fillValue ?? ""}"]`
          : `Fuzz [${t.label}]`;

      const locator = page.locator(t.selector).first();
      const visible = await locator.isVisible().catch(() => false);
      const enabled = visible ? await locator.isEnabled().catch(() => false) : false;
      if (!visible || !enabled) continue;

      if (t.kind === "fill") {
        await locator.fill(s.fillValue ?? "", { timeout: 1000 });
      } else {
        await locator.click({ timeout: 1000 });
      }
      await page.waitForTimeout(40);

      try {
        telemetry.assertClean();
        if (feature.assertInvariants) {
          await feature.assertInvariants({ page, baseUrl });
        }
      } catch (err) {
        failureError = err;
        failureTransitions.push({
          featureId: feature.id,
          from: prevState.id,
          to: "Invariant_Failed",
          action: `${actionLabel} ❌`,
          ok: false,
        });
        break;
      }

      const nextState = await captureUiState(page);
      failureTransitions.push({
        featureId: feature.id,
        from: prevState.id,
        to: nextState.id,
        action: actionLabel,
        ok: true,
      });
      prevState = nextState;
    }
  } catch (err) {
    failureError = err;
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
    runsExecuted,
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
