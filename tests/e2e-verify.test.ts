import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { initProject } from "../src/discovery/init.js";
import { runGuardrails } from "../src/graph/guardrails.js";
import {
  buildImportGraph,
  getGitChangedFiles,
  resolveAffectedFeatures,
} from "../src/graph/import-graph.js";

const ROOT_DIR = path.resolve(__dirname, "..");
const FIXTURE_SRC = path.join(ROOT_DIR, "fixtures", "catalyst-shop");
const CLI_PATH = path.join(ROOT_DIR, "dist", "cli.js");

const tempDirs: string[] = [];

function createGitFixtureSandbox(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-e2e-"));
  tempDirs.push(tmpDir);
  fs.cpSync(FIXTURE_SRC, tmpDir, { recursive: true });

  // Point `runbox` import in generated runbox.config.ts to our built dist/index.js
  const distIndex = path.join(ROOT_DIR, "dist", "index.js");
  const pkgLinkDir = path.join(tmpDir, "node_modules", "runbox");
  fs.mkdirSync(pkgLinkDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgLinkDir, "package.json"),
    JSON.stringify({ name: "runbox", type: "module", main: distIndex }),
    "utf8"
  );
  fs.symlinkSync(distIndex, path.join(pkgLinkDir, "index.js"));

  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@runbox.dev"], {
    cwd: tmpDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Runbox Test"], {
    cwd: tmpDir,
    stdio: "ignore",
  });

  initProject(tmpDir);

  // Enhance the generated cart feature with a journey, invariant, and fuzz scope
  const configPath = path.join(tmpDir, "runbox.config.ts");
  let configText = fs.readFileSync(configPath, "utf8");
  configText = configText.replace(
    `      id: "route-cart",
      name: "Cart (Cart)",
      route: "/cart",
      files: ["src/js/pages/Cart/**"],`,
    `      id: "route-cart",
      name: "Cart (Cart)",
      route: "/cart",
      files: ["src/js/pages/Cart/**"],
      journey: async ({ page, step }) => {
        await step("Add 2 items ($20)", async () => {
          await page.click('[data-testid="add-item"]');
          await page.click('[data-testid="add-item"]');
        });
        await step("Apply SAVE20 coupon ($20 off)", async () => {
          await page.fill('[data-testid="coupon-input"]', "SAVE20");
          await page.click('[data-testid="apply-coupon"]');
        });
      },
      assertInvariants: async ({ page }) => {
        const text = await page.textContent('[data-testid="cart-total"]');
        const num = Number((text || "").replace("$", ""));
        if (Number.isNaN(num) || num < 0) {
          throw new Error(\`Cart total dropped below $0: \${text}\`);
        }
      },
      fuzz: {
        enabled: true,
        scopeSelector: '[data-testid="cart-panel"]',
        steps: 6,
        runs: 10,
      },`
  );
  fs.writeFileSync(configPath, configText, "utf8");

  execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "baseline catalyst-shop"], {
    cwd: tmpDir,
    stdio: "ignore",
  });

  return tmpDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("E2E runbox lifecycle against catalyst-shop fixture", () => {
  it("Test A: check --diff maps CouponBox edit to route-cart and catches forbidden server/ imports", async () => {
    const sandbox = createGitFixtureSandbox();
    const couponPath = path.join(sandbox, "src/js/components/CouponBox.js");

    // 1. Edit CouponBox without violating guardrails
    fs.writeFileSync(
      couponPath,
      `export function calculateCartTotal(quantity, unitPrice, couponCode) {
  const subtotal = quantity * unitPrice;
  const discount = couponCode === "SAVE20" ? 20 : 0;
  return Math.max(0, subtotal - discount); // edited
}\n`,
      "utf8"
    );

    const changed = getGitChangedFiles(sandbox);
    expect(changed).toEqual(["src/js/components/CouponBox.js"]);

    const { config } = await loadConfig(sandbox);
    const graph = buildImportGraph(sandbox, config.aliases);
    const resolution = resolveAffectedFeatures(sandbox, config, changed, graph);
    expect(resolution.affectedFeatures.map((f) => f.id)).toEqual(["route-cart"]);
    expect(resolution.skippedFeatures.map((f) => f.id)).toEqual([
      "route-home",
      "route-about",
    ]);

    // 2. Plant a forbidden import from server/ inside src/js/components/CouponBox.js
    fs.writeFileSync(
      couponPath,
      `import "../../../server/server.js";\nexport function calculateCartTotal(q, p) { return q * p; }\n`,
      "utf8"
    );
    const violations = runGuardrails(sandbox, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("no-server-in-client");
    expect(violations[0].remediation).toContain("Universal/client modules");
  });

  it(
    "Test B & C: CLI catches planted CouponBox bug via fast-check shrinking (<500-token JSON), then passes on replay with Mermaid Proof Bundle",
    () => {
      const sandbox = createGitFixtureSandbox();
      const couponPath = path.join(sandbox, "src/js/components/CouponBox.js");

      // Test B: Plant subtle negative-total bug (omits Math.max(0, ...))
      fs.writeFileSync(
        couponPath,
        `export function calculateCartTotal(quantity, unitPrice, couponCode) {
  const subtotal = quantity * unitPrice;
  const discount = couponCode === "SAVE20" ? 20 : 0;
  return subtotal - discount;
}\n`,
        "utf8"
      );

      let failedStdout = "";
      let failedExit = 0;
      try {
        failedStdout = execFileSync(
          process.execPath,
          [CLI_PATH, "verify", "--diff", "--fuzz", "--seed", "0x42", "--agent"],
          { cwd: sandbox, encoding: "utf8" }
        );
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string };
        failedExit = execErr.status ?? 1;
        failedStdout = execErr.stdout ?? "";
      }

      expect(failedExit).toBe(1);
      expect(failedStdout.length).toBeLessThan(2000); // < 500 tokens
      const failOracle = JSON.parse(failedStdout.trim());
      expect(failOracle.status).toBe("failed");
      expect(failOracle.affectedFeatures).toEqual(["route-cart"]);
      expect(failOracle.skippedFeatures).toEqual(["route-home", "route-about"]);
      expect(failOracle.failures).toHaveLength(1);
      expect(failOracle.failures[0].featureId).toBe("route-cart");
      expect(failOracle.failures[0].violatedInvariant).toBe("domainInvariant");
      expect(failOracle.failures[0].seed).toBe("0x42");
      expect(failOracle.failures[0].minimalReproductionSteps.length).toBeGreaterThanOrEqual(1);
      expect(failOracle.failures[0].minimalReproductionSteps.length).toBeLessThanOrEqual(3);

      // Test C: Apply fix and deterministically replay with same seed --seed 0x42
      fs.writeFileSync(
        couponPath,
        `export function calculateCartTotal(quantity, unitPrice, couponCode) {
  const subtotal = quantity * unitPrice;
  const discount = couponCode === "SAVE20" ? 20 : 0;
  return Math.max(0, subtotal - discount);
}\n`,
        "utf8"
      );

      const passStdout = execFileSync(
        process.execPath,
        [CLI_PATH, "verify", "--diff", "--fuzz", "--seed", "0x42", "--agent"],
        { cwd: sandbox, encoding: "utf8" }
      );

      expect(passStdout.length).toBeLessThan(2000);
      const passOracle = JSON.parse(passStdout.trim());
      expect(passOracle.status).toBe("passed");
      expect(passOracle.failures).toEqual([]);
      expect(passOracle.proofReportPath).toBe(".runbox/proof/report.md");

      const reportPath = path.join(sandbox, ".runbox/proof/report.md");
      expect(fs.existsSync(reportPath)).toBe(true);
      const reportMd = fs.readFileSync(reportPath, "utf8");
      expect(reportMd).toContain("PASSED ✅");
      expect(reportMd).toContain("stateDiagram-v2");
      expect(reportMd).toContain("| Console Errors | 0 | ✅ |");
      expect(reportMd).toContain("| Server 5xx Responses | 0 | ✅ |");

      const screenshotDir = path.join(sandbox, ".runbox/proof/screenshots");
      const screenshots = fs.readdirSync(screenshotDir);
      expect(screenshots.some((f) => f.endsWith(".png"))).toBe(true);
    },
    30_000
  );
});
