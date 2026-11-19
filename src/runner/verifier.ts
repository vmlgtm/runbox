import fs from "node:fs";
import path from "node:path";
import type { FeatureConfig, PersonaConfig, RunboxConfig } from "../config/schema.js";
import { launchBrowser } from "../box/browser.js";
import { withBoxServer } from "../box/server.js";
import { runFeatureFuzzer, parseSeedHex } from "./fuzzer.js";
import { captureUiState, type StateTransition } from "./state-fingerprint.js";
import {
  InvariantViolationError,
  TelemetryTrap,
  type TelemetryCounts,
} from "./telemetry.js";

export interface FeatureFailure {
  featureId: string;
  featureName: string;
  route: string;
  violatedInvariant: string;
  message: string;
  seed?: string;
  minimalReproductionSteps: string[];
  remediation: string;
}

export interface FeatureVerificationResult {
  featureId: string;
  featureName: string;
  route: string;
  passed: boolean;
  journeySteps: number;
  fuzzRuns: number;
  transitionsExecuted: number;
  seed?: string;
  telemetry: TelemetryCounts;
  transitions: StateTransition[];
  screenshots: string[];
  failure?: FeatureFailure;
}

export interface VerificationRunResult {
  status: "passed" | "failed";
  baseUrl: string;
  durationMs: number;
  affectedFeatureIds: string[];
  skippedFeatureIds: string[];
  features: FeatureVerificationResult[];
  transitions: StateTransition[];
  telemetryTotals: TelemetryCounts;
}

export interface VerifyOptions {
  features: FeatureConfig[];
  skippedFeatures: FeatureConfig[];
  url?: string;
  fuzz?: boolean;
  seed?: string;
  concurrency?: number;
}

/**
 * Boots the isolated runtime box, launches Chromium once, and verifies target
 * features in parallel isolated BrowserContexts with telemetry traps, journey tracking,
 * safe-fuzz write guards, and fast-check shrinking.
 */
export async function runVerification(
  cwd: string,
  config: RunboxConfig,
  options: VerifyOptions
): Promise<VerificationRunResult> {
  const startMs = Date.now();
  const resolvedCwd = path.resolve(cwd);
  const screenshotDir = path.join(resolvedCwd, ".runbox", "proof", "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  let featureResults: FeatureVerificationResult[] = [];
  const allTransitions: StateTransition[] = [];
  const telemetryTotals: TelemetryCounts = {
    consoleErrors: 0,
    uncaughtExceptions: 0,
    hydrationMismatches: 0,
    server5xx: 0,
  };
  let actualBaseUrl = options.url ?? config.server?.url ?? "http://127.0.0.1";

  const concurrency = Math.max(1, options.concurrency ?? 4);

  await withBoxServer(resolvedCwd, config, { url: options.url }, async (baseUrl) => {
    actualBaseUrl = baseUrl;
    const browser = await launchBrowser();
    try {
      featureResults = await runWithConcurrency(
        options.features,
        concurrency,
        (feature) =>
          verifySingleFeature({
            browser,
            baseUrl,
            config,
            feature,
            screenshotDir,
            cwd: resolvedCwd,
            enableFuzz: Boolean(options.fuzz || feature.fuzz?.enabled),
            seedOpt: options.seed,
          })
      );

      for (const result of featureResults) {
        allTransitions.push(...result.transitions);
        telemetryTotals.consoleErrors += result.telemetry.consoleErrors;
        telemetryTotals.uncaughtExceptions += result.telemetry.uncaughtExceptions;
        telemetryTotals.hydrationMismatches += result.telemetry.hydrationMismatches;
        telemetryTotals.server5xx += result.telemetry.server5xx;
      }
    } finally {
      await browser.close();
    }
  });

  const status = featureResults.every((f) => f.passed) ? "passed" : "failed";

  return {
    status,
    baseUrl: actualBaseUrl,
    durationMs: Date.now() - startMs,
    affectedFeatureIds: options.features.map((f) => f.id),
    skippedFeatureIds: options.skippedFeatures.map((f) => f.id),
    features: featureResults,
    transitions: allTransitions,
    telemetryTotals,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runnerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: runnerCount }, async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await worker(items[current], current);
      }
    })
  );
  return results;
}

async function verifySingleFeature(params: {
  browser: Awaited<ReturnType<typeof launchBrowser>>;
  baseUrl: string;
  config: RunboxConfig;
  feature: FeatureConfig;
  screenshotDir: string;
  cwd: string;
  enableFuzz: boolean;
  seedOpt?: string;
}): Promise<FeatureVerificationResult> {
  const {
    browser,
    baseUrl,
    config,
    feature,
    screenshotDir,
    cwd,
    enableFuzz,
    seedOpt,
  } = params;

  const targetRoute = feature.sampleRoute ?? feature.route;
  const targetUrl = `${baseUrl}${targetRoute.startsWith("/") ? targetRoute : `/${targetRoute}`}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Inject persona headers, cookies, and localStorage before creating the page
  const activePersona: PersonaConfig | undefined =
    typeof feature.persona === "string"
      ? config.personas?.[feature.persona]
      : feature.persona;

  if (activePersona) {
    if (activePersona.headers && Object.keys(activePersona.headers).length > 0) {
      await context.setExtraHTTPHeaders(activePersona.headers);
    }
    if (activePersona.cookies && activePersona.cookies.length > 0) {
      const originHost = new URL(baseUrl).hostname;
      await context.addCookies(
        activePersona.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: originHost,
          path: c.path ?? "/",
        }))
      );
    }
    if (activePersona.localStorage && Object.keys(activePersona.localStorage).length > 0) {
      await context.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) {
          window.localStorage.setItem(key, value);
        }
      }, activePersona.localStorage);
    }
  }

  const page = await context.newPage();

  // Register Safe-Fuzz Write Guard FIRST so explicit mocks (registered after) take LIFO precedence
  let safeFuzzGuardActive = false;
  if (!(feature.fuzz?.allowMutations)) {
    await page.route("**/*", async (route) => {
      const method = route.request().method().toUpperCase();
      if (
        safeFuzzGuardActive &&
        (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"runboxDryRun":true}',
        });
        return;
      }
      await route.fallback();
    });
  }

  // Register deterministic network/API fixture mocks
  const activeMocks = [...(config.mocks ?? []), ...(feature.mocks ?? [])];
  for (const mock of activeMocks) {
    await page.route(mock.urlPattern, async (route) => {
      if (mock.method && route.request().method().toUpperCase() !== mock.method.toUpperCase()) {
        await route.fallback();
        return;
      }
      const isStringBody = typeof mock.body === "string";
      await route.fulfill({
        status: mock.status ?? 200,
        contentType: mock.contentType ?? (isStringBody ? "text/plain" : "application/json"),
        body: isStringBody ? (mock.body as string) : JSON.stringify(mock.body),
      });
    });
  }

  const telemetry = new TelemetryTrap(page, config.invariants, baseUrl);

  const transitions: StateTransition[] = [];
  const screenshots: string[] = [];
  let journeySteps = 0;

  const saveScreenshot = async (suffix: string, buffer?: Buffer) => {
    const fileName = `${feature.id}-${suffix}.png`;
    const absPath = path.join(screenshotDir, fileName);
    const data = buffer ?? (await page.screenshot({ fullPage: false }));
    fs.writeFileSync(absPath, data);
    screenshots.push(path.relative(cwd, absPath));
  };

  const resetToFeatureStart = async () => {
    telemetry.reset();
    const res = await page.goto(targetUrl, { waitUntil: "load", timeout: 20_000 });
    if (res && res.status() >= 500 && (config.invariants?.noServer5xx ?? true)) {
      throw new InvariantViolationError("noServer5xx", `HTTP ${res.status()} on ${targetUrl}`);
    }
    await page.waitForTimeout(40);
    telemetry.assertClean();

    if (feature.journey) {
      await feature.journey({
        page,
        baseUrl,
        step: async (_label, fn) => {
          await fn();
          await page.waitForTimeout(30);
        },
      });
    }
  };

  try {
    // Phase A & B: Navigate + run deterministic journey while recording transitions & screenshots
    const navResponse = await page.goto(targetUrl, {
      waitUntil: "load",
      timeout: 20_000,
    });
    if (navResponse && navResponse.status() >= 500 && (config.invariants?.noServer5xx ?? true)) {
      throw new InvariantViolationError(
        "noServer5xx",
        `HTTP ${navResponse.status()} loading ${targetUrl}`
      );
    }

    await page.waitForTimeout(80);
    telemetry.assertClean();

    let prevState = await captureUiState(page, feature.stateLabel);
    transitions.push({
      featureId: feature.id,
      from: "[*]",
      to: prevState.id,
      action: `Load ${targetRoute}`,
      ok: true,
    });
    await saveScreenshot("initial");

    if (feature.journey) {
      await feature.journey({
        page,
        baseUrl,
        step: async (label, fn) => {
          journeySteps++;
          await fn();
          await page.waitForTimeout(40);
          telemetry.assertClean();
          if (feature.assertInvariants) {
            await feature.assertInvariants({ page, baseUrl });
          }
          const nextState = await captureUiState(page, feature.stateLabel);
          transitions.push({
            featureId: feature.id,
            from: prevState.id,
            to: nextState.id,
            action: label,
            ok: true,
          });
          prevState = nextState;
        },
      });
      await saveScreenshot("post-journey");
    }

    if (feature.assertInvariants) {
      await feature.assertInvariants({ page, baseUrl });
    }
    telemetry.assertClean();

    // Phase C: Optional property-based UI fuzzing with fast-check shrinking
    let fuzzRuns = 0;
    let fuzzTransitionsCount = 0;
    let usedSeedHex: string | undefined;

    if (enableFuzz) {
      const { seedHex } = parseSeedHex(seedOpt);
      usedSeedHex = seedHex;
      safeFuzzGuardActive = !(feature.fuzz?.allowMutations);
      const fuzzRes = await runFeatureFuzzer({
        page,
        baseUrl,
        feature,
        telemetry,
        resetToFeatureStart: async () => {
          const prevGuard = safeFuzzGuardActive;
          safeFuzzGuardActive = false;
          try {
            await resetToFeatureStart();
          } finally {
            safeFuzzGuardActive = prevGuard;
          }
        },
        seedOpt: seedHex,
      });
      safeFuzzGuardActive = false;

      fuzzRuns = fuzzRes.runsExecuted;
      fuzzTransitionsCount = fuzzRes.transitionsExecuted;
      transitions.push(...fuzzRes.transitions);

      if (!fuzzRes.passed && fuzzRes.failure) {
        if (fuzzRes.failure.screenshotBuffer) {
          await saveScreenshot("failed", fuzzRes.failure.screenshotBuffer);
        }
        return {
          featureId: feature.id,
          featureName: feature.name,
          route: targetRoute,
          passed: false,
          journeySteps,
          fuzzRuns,
          transitionsExecuted: transitions.length + fuzzTransitionsCount,
          seed: fuzzRes.seedHex,
          telemetry: telemetry.getTotals(),
          transitions,
          screenshots,
          failure: {
            featureId: feature.id,
            featureName: feature.name,
            route: targetRoute,
            violatedInvariant: fuzzRes.failure.invariant,
            message: fuzzRes.failure.message,
            seed: fuzzRes.seedHex,
            minimalReproductionSteps: fuzzRes.failure.minimalSteps,
            remediation: buildRuntimeRemediation(
              fuzzRes.failure.invariant,
              fuzzRes.failure.message,
              feature
            ),
          },
        };
      }
    }

    return {
      featureId: feature.id,
      featureName: feature.name,
      route: targetRoute,
      passed: true,
      journeySteps,
      fuzzRuns,
      transitionsExecuted: transitions.length + fuzzTransitionsCount,
      seed: usedSeedHex,
      telemetry: telemetry.getTotals(),
      transitions,
      screenshots,
    };
  } catch (err) {
    await saveScreenshot("failed").catch(() => undefined);
    const kind =
      err instanceof InvariantViolationError ? err.kind : "domainInvariant";
    const msg =
      err instanceof InvariantViolationError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);

    transitions.push({
      featureId: feature.id,
      from: transitions[transitions.length - 1]?.to ?? "[*]",
      to: "Invariant_Failed",
      action: `${kind} ❌`,
      ok: false,
    });

    return {
      featureId: feature.id,
      featureName: feature.name,
      route: targetRoute,
      passed: false,
      journeySteps,
      fuzzRuns: 0,
      transitionsExecuted: transitions.length,
      seed: seedOpt,
      telemetry: telemetry.getTotals(),
      transitions,
      screenshots,
      failure: {
        featureId: feature.id,
        featureName: feature.name,
        route: targetRoute,
        violatedInvariant: kind,
        message: msg,
        seed: seedOpt,
        minimalReproductionSteps: [`Load ${targetRoute}`],
        remediation: buildRuntimeRemediation(kind, msg, feature),
      },
    };
  } finally {
    safeFuzzGuardActive = false;
    telemetry.detach();
    await context.close();
  }
}

function buildRuntimeRemediation(
  invariant: string,
  message: string,
  feature: FeatureConfig
): string {
  const filesHint = feature.files.join(", ");
  switch (invariant) {
    case "noHydrationMismatch":
      return `Fix SSR/client DOM mismatch in ${filesHint}. Avoid reading browser-only globals (window, localStorage) during initial render.`;
    case "noConsoleErrors":
    case "noUncaughtExceptions":
      return `Resolve runtime error in ${filesHint}: ${message.slice(0, 120)}`;
    case "noServer5xx":
      return `Fix server 5xx error triggered by ${feature.route}: ${message.slice(0, 120)}`;
    default:
      return `Fix state/business invariant violation in ${filesHint}: ${message.slice(0, 120)}`;
  }
}

export interface RouteDiscoverySnapshot {
  url: string;
  title: string;
  interactiveElements: Array<{
    tag: string;
    testId?: string;
    text?: string;
    ariaLabel?: string;
    type?: string;
  }>;
  sameOriginLinks: string[];
}

/**
 * Live route inspector (`runbox discover [route]`) that opens a route in Chromium
 * and extracts interactive controls (`data-testid`, buttons, inputs) and dynamic links.
 */
export async function discoverLiveRoute(
  cwd: string,
  config: RunboxConfig,
  route = "/",
  options: { url?: string } = {}
): Promise<RouteDiscoverySnapshot> {
  return withBoxServer(path.resolve(cwd), config, { url: options.url }, async (baseUrl) => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const targetUrl = `${baseUrl}${route.startsWith("/") ? route : `/${route}`}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(80);

      const snapshot = await page.evaluate(() => {
        const title = document.title;
        const interactiveElements: RouteDiscoverySnapshot["interactiveElements"] = [];
        document
          .querySelectorAll('button, input, select, textarea, [role="button"], [data-testid]')
          .forEach((el) => {
            if (interactiveElements.length >= 40) return;
            const htmlEl = el as HTMLElement;
            interactiveElements.push({
              tag: htmlEl.tagName.toLowerCase(),
              testId: htmlEl.getAttribute("data-testid") ?? undefined,
              text: htmlEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) || undefined,
              ariaLabel: htmlEl.getAttribute("aria-label") ?? undefined,
              type: htmlEl.getAttribute("type") ?? undefined,
            });
          });

        const linksSet = new Set<string>();
        document.querySelectorAll("a[href]").forEach((a) => {
          const href = a.getAttribute("href");
          if (href && href.startsWith("/") && !href.startsWith("//")) {
            linksSet.add(href);
          }
        });

        return {
          title,
          interactiveElements,
          sameOriginLinks: Array.from(linksSet).sort(),
        };
      });

      return {
        url: targetUrl,
        ...snapshot,
      };
    } finally {
      await browser.close();
    }
  });
}
