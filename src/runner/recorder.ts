import fs from "node:fs";
import path from "node:path";
import type { NetworkMockConfig, PersonaConfig, RunboxConfig } from "../config/schema.js";
import { launchBrowser } from "../box/browser.js";
import { withBoxServer } from "../box/server.js";

export interface RecordedAction {
  kind: "click" | "fill";
  selector: string;
  label: string;
  value?: string;
}

export interface RecordOptions {
  url?: string;
  headless?: boolean;
  durationMs?: number;
  outDir?: string;
}

export interface RecordResult {
  route: string;
  mocksCount: number;
  actionsCount: number;
  mocksPath: string;
  personaPath: string;
  featurePath: string;
}

/**
 * Opens Chromium on `route` (headed by default), records JSON API responses,
 * cookies/localStorage persona state, and user click/fill interactions, and writes
 * a ready-to-use `feature.runbox.ts` starter plus `mocks.json` & `persona.json`.
 */
export async function recordRoute(
  cwd: string,
  config: RunboxConfig,
  route = "/",
  options: RecordOptions = {}
): Promise<RecordResult> {
  const resolvedCwd = path.resolve(cwd);
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const slug =
    normalizedRoute === "/"
      ? "home"
      : normalizedRoute
          .replace(/^\//, "")
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || "route";

  const outDir = options.outDir
    ? path.resolve(resolvedCwd, options.outDir)
    : path.join(resolvedCwd, ".runbox", "recordings", slug);
  fs.mkdirSync(outDir, { recursive: true });

  const recordedMocks = new Map<string, NetworkMockConfig>();
  const recordedActions: RecordedAction[] = [];
  let latestLocalStorage: Record<string, string> = {};
  let latestCookies: Array<{ name: string; value: string; path?: string }> = [];

  await withBoxServer(resolvedCwd, config, { url: options.url }, async (baseUrl) => {
    const browser = await launchBrowser({ headless: Boolean(options.headless) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const snapshotSession = async () => {
      try {
        const cookies = await context.cookies();
        latestCookies = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          path: c.path,
        }));
      } catch {
        // Ignore if browser already closing
      }
      try {
        latestLocalStorage = await page.evaluate(() => {
          const out: Record<string, string> = {};
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key) out[key] = window.localStorage.getItem(key) ?? "";
          }
          return out;
        });
      } catch {
        // Ignore if page closed
      }
    };

    await page.exposeBinding(
      "__runboxRecordAction",
      async (_source, action: RecordedAction) => {
        recordedActions.push(action);
        await snapshotSession();
      }
    );

    await context.addInitScript(() => {
      const deriveSelector = (el: HTMLElement): { selector: string; label: string } => {
        const testId = el.getAttribute("data-testid");
        if (testId) return { selector: `[data-testid="${testId}"]`, label: testId };
        if (el.id) return { selector: `#${el.id}`, label: el.id };
        const text = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 28) ?? "";
        const tag = el.tagName.toLowerCase();
        if (tag === "button" && text) {
          return { selector: `button:has-text("${text}")`, label: text };
        }
        return { selector: tag, label: text || tag };
      };

      window.addEventListener(
        "click",
        (ev) => {
          const target = (ev.target as HTMLElement | null)?.closest(
            'button, a, [role="button"], [data-testid]'
          ) as HTMLElement | null;
          if (!target) return;
          const { selector, label } = deriveSelector(target);
          (window as unknown as { __runboxRecordAction?: (a: RecordedAction) => void }).__runboxRecordAction?.({
            kind: "click",
            selector,
            label: `Click ${label}`,
          });
        },
        true
      );

      window.addEventListener(
        "change",
        (ev) => {
          const target = ev.target as HTMLInputElement | null;
          if (!target || target.tagName !== "INPUT") return;
          const { selector, label } = deriveSelector(target);
          (window as unknown as { __runboxRecordAction?: (a: RecordedAction) => void }).__runboxRecordAction?.({
            kind: "fill",
            selector,
            label: `Fill ${label}`,
            value: target.value,
          });
        },
        true
      );
    });

    page.on("response", async (res) => {
      try {
        const status = res.status();
        if (status >= 400) return;
        const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("application/json")) return;

        const parsedUrl = new URL(res.url());
        const baseOrigin = new URL(baseUrl).origin;
        if (parsedUrl.origin !== baseOrigin && !parsedUrl.pathname.includes("/api")) {
          return;
        }

        const body = await res.json().catch(() => null);
        if (body === null) return;

        const method = res.request().method().toUpperCase();
        const urlPattern = `**${parsedUrl.pathname}*`;
        const key = `${method}:${urlPattern}`;
        recordedMocks.set(key, {
          urlPattern,
          method,
          status,
          body,
        });
      } catch {
        // Ignore transient or closed-page responses
      }
    });

    try {
      const targetUrl = `${baseUrl}${normalizedRoute}`;
      await page.goto(targetUrl, { waitUntil: "load", timeout: 20_000 });
      await page.waitForTimeout(150);
      await snapshotSession();

      if (options.durationMs && options.durationMs > 0) {
        await page.waitForTimeout(options.durationMs);
        await snapshotSession();
      } else {
        await page.waitForEvent("close").catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });

  const mocksList = Array.from(recordedMocks.values());
  const personaObj: PersonaConfig = {
    id: `${slug}-recorded`,
    ...(latestCookies.length > 0 ? { cookies: latestCookies } : {}),
    ...(Object.keys(latestLocalStorage).length > 0 ? { localStorage: latestLocalStorage } : {}),
  };

  const mocksPath = path.join(outDir, "mocks.json");
  const personaPath = path.join(outDir, "persona.json");
  const featurePath = path.join(outDir, "feature.runbox.ts");

  fs.writeFileSync(mocksPath, JSON.stringify(mocksList, null, 2) + "\n", "utf8");
  fs.writeFileSync(personaPath, JSON.stringify(personaObj, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    featurePath,
    renderRecordedFeatureTs(slug, normalizedRoute, recordedActions),
    "utf8"
  );

  return {
    route: normalizedRoute,
    mocksCount: mocksList.length,
    actionsCount: recordedActions.length,
    mocksPath: path.relative(resolvedCwd, mocksPath),
    personaPath: path.relative(resolvedCwd, personaPath),
    featurePath: path.relative(resolvedCwd, featurePath),
  };
}

function renderRecordedFeatureTs(
  slug: string,
  route: string,
  actions: RecordedAction[]
): string {
  const stepLines =
    actions.length > 0
      ? actions
          .map((act) => {
            if (act.kind === "fill") {
              return `    await step(${JSON.stringify(act.label)}, () => page.fill(${JSON.stringify(act.selector)}, ${JSON.stringify(act.value ?? "")}));`;
            }
            return `    await step(${JSON.stringify(act.label)}, () => page.click(${JSON.stringify(act.selector)}));`;
          })
          .join("\n")
      : `    // Add journey steps or keep passive telemetry + fuzz checks`;

  return `import { defineFeature } from "runbox";
import mocks from "./mocks.json";
import persona from "./persona.json";

export default defineFeature({
  id: ${JSON.stringify(`route-${slug}`)},
  name: ${JSON.stringify(slug)},
  route: ${JSON.stringify(route)},
  persona,
  mocks,
  journey: async ({ page, step }) => {
${stepLines}
  },
  fuzz: {
    enabled: true,
    steps: 6,
    runs: 6,
  },
});
`;
}
