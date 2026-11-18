import { describe, expect, it } from "vitest";
import { formatAgentOracle } from "../src/reporter/agent-json.js";
import { compileMermaidStatechart } from "../src/reporter/proof-bundle.js";
import type { VerificationRunResult } from "../src/runner/verifier.js";

describe("reporters (Mermaid statechart & <500-token Agent JSON)", () => {
  it("compiles deduplicated Mermaid stateDiagram-v2 including failure transitions", () => {
    const mermaid = compileMermaidStatechart([
      {
        featureId: "cart",
        from: "[*]",
        to: "Shopping_Cart_0",
        action: "Load /cart",
        ok: true,
      },
      {
        featureId: "cart",
        from: "Shopping_Cart_0",
        to: "Shopping_Cart_SAVE20",
        action: "Apply coupon: SAVE20",
        ok: true,
      },
      {
        featureId: "cart",
        from: "Shopping_Cart_0",
        to: "Shopping_Cart_SAVE20",
        action: "Apply coupon: SAVE20",
        ok: true,
      },
      {
        featureId: "cart",
        from: "Shopping_Cart_SAVE20",
        to: "Invariant_Failed",
        action: 'Fuzz [Click "dec-qty"] ❌',
        ok: false,
      },
    ]);

    expect(mermaid).toContain("stateDiagram-v2");
    expect(mermaid).toContain("[*] --> Shopping_Cart_0: Load /cart");
    expect(mermaid).toContain("Apply coupon - SAVE20");
    expect(mermaid).toContain('Invariant_Failed: Fuzz [Click "dec-qty"] ❌');
    // Deduplication check: "Apply coupon - SAVE20" should appear once
    expect(mermaid.match(/Apply coupon - SAVE20/g)).toHaveLength(1);
  });

  it("enforces <500-token JSON budget even with verbose failure payloads", () => {
    const longMsg = "Invariant violated ".repeat(50);
    const verification: VerificationRunResult = {
      status: "failed",
      baseUrl: "http://127.0.0.1:41234",
      durationMs: 1200,
      affectedFeatureIds: ["route-cart"],
      skippedFeatureIds: ["route-home", "route-about", "a", "b", "c", "d", "e"],
      telemetryTotals: {
        consoleErrors: 0,
        uncaughtExceptions: 0,
        hydrationMismatches: 0,
        server5xx: 0,
      },
      transitions: [],
      features: [
        {
          featureId: "route-cart",
          featureName: "Cart",
          route: "/cart",
          passed: false,
          journeySteps: 3,
          fuzzRuns: 4,
          transitionsExecuted: 12,
          seed: "0x42",
          telemetry: {
            consoleErrors: 0,
            uncaughtExceptions: 0,
            hydrationMismatches: 0,
            server5xx: 0,
          },
          transitions: [],
          screenshots: [],
          failure: {
            featureId: "route-cart",
            featureName: "Cart",
            route: "/cart",
            violatedInvariant: "domainInvariant",
            message: longMsg,
            seed: "0x42",
            minimalReproductionSteps: ['Click "dec-qty"'],
            remediation: longMsg,
          },
        },
      ],
    };

    const json = formatAgentOracle({
      verification,
      guardrailViolations: [],
      affectedFeatures: ["route-cart"],
      skippedFeatures: verification.skippedFeatureIds,
      proofReportPath: ".runbox/proof/report.md",
    });

    expect(json.length).toBeLessThan(2000);
    const parsed = JSON.parse(json);
    expect(parsed.status).toBe("failed");
    expect(parsed.failures[0].seed).toBe("0x42");
    expect(parsed.failures[0].replayCommand).toContain("--seed 0x42");
  });
});
