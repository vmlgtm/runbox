import type { ConsoleMessage, Page, Response } from "playwright-core";
import type { GlobalInvariants } from "../config/schema.js";

export type InvariantKind =
  | "noConsoleErrors"
  | "noUncaughtExceptions"
  | "noHydrationMismatch"
  | "noServer5xx"
  | "domainInvariant";

export class InvariantViolationError extends Error {
  readonly kind: InvariantKind;
  readonly detail: string;

  constructor(kind: InvariantKind, detail: string) {
    super(`[${kind}] ${detail}`);
    this.name = "InvariantViolationError";
    this.kind = kind;
    this.detail = detail;
  }
}

export interface TelemetryCounts {
  consoleErrors: number;
  uncaughtExceptions: number;
  hydrationMismatches: number;
  server5xx: number;
}

const HYDRATION_PATTERN =
  /hydration failed|did not match|server-rendered html|hydrating|text content does not match/i;

/**
 * Attaches passive listeners to a Playwright page to trap silent runtime errors:
 * uncaught exceptions, console.error, React SSR hydration mismatches, and HTTP 5xx responses.
 */
export class TelemetryTrap {
  private readonly page: Page;
  private readonly invariants: Required<GlobalInvariants>;
  private readonly origin?: string;

  private events: Array<{ kind: InvariantKind; detail: string }> = [];
  private totals: TelemetryCounts = {
    consoleErrors: 0,
    uncaughtExceptions: 0,
    hydrationMismatches: 0,
    server5xx: 0,
  };

  private readonly onPageError = (err: Error) => {
    this.totals.uncaughtExceptions++;
    if (this.invariants.noUncaughtExceptions) {
      this.events.push({
        kind: "noUncaughtExceptions",
        detail: err.message || String(err),
      });
    }
  };

  private readonly onConsole = (msg: ConsoleMessage) => {
    const text = msg.text();
    const type = msg.type();

    if (HYDRATION_PATTERN.test(text)) {
      this.totals.hydrationMismatches++;
      if (this.invariants.noHydrationMismatch) {
        this.events.push({
          kind: "noHydrationMismatch",
          detail: text.slice(0, 300),
        });
      }
      return;
    }

    if (type === "error") {
      if (msg.location()?.url?.endsWith("/favicon.ico")) {
        return;
      }
      this.totals.consoleErrors++;
      if (this.invariants.noConsoleErrors) {
        this.events.push({
          kind: "noConsoleErrors",
          detail: text.slice(0, 300),
        });
      }
    }
  };

  private readonly onResponse = (res: Response) => {
    const status = res.status();
    if (status < 500) return;

    const url = res.url();
    if (this.origin && !url.startsWith(this.origin)) {
      return;
    }

    this.totals.server5xx++;
    if (this.invariants.noServer5xx) {
      this.events.push({
        kind: "noServer5xx",
        detail: `HTTP ${status} on ${url}`,
      });
    }
  };

  constructor(page: Page, invariants: GlobalInvariants = {}, origin?: string) {
    this.page = page;
    this.origin = origin;
    this.invariants = {
      noConsoleErrors: invariants.noConsoleErrors ?? true,
      noUncaughtExceptions: invariants.noUncaughtExceptions ?? true,
      noHydrationMismatch: invariants.noHydrationMismatch ?? true,
      noServer5xx: invariants.noServer5xx ?? true,
    };

    this.page.on("pageerror", this.onPageError);
    this.page.on("console", this.onConsole);
    this.page.on("response", this.onResponse);
  }

  /** Clears recorded events for the next isolated step/fuzz iteration. */
  reset(): void {
    this.events = [];
  }

  /** Throws if any enabled runtime invariant fired since creation or last `reset()`. */
  assertClean(): void {
    if (this.events.length > 0) {
      const first = this.events[0];
      throw new InvariantViolationError(first.kind, first.detail);
    }
  }

  getTotals(): TelemetryCounts {
    return { ...this.totals };
  }

  detach(): void {
    this.page.off("pageerror", this.onPageError);
    this.page.off("console", this.onConsole);
    this.page.off("response", this.onResponse);
  }
}
