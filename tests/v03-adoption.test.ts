import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchBrowser } from "../src/box/browser.js";
import { defineConfig, defineFeature } from "../src/config/schema.js";
import { buildImportGraph } from "../src/graph/import-graph.js";
import { compileMermaidStatechart } from "../src/reporter/proof-bundle.js";
import { discoverInteractiveTargets } from "../src/runner/fuzzer.js";
import { recordRoute } from "../src/runner/recorder.js";
import { captureUiState } from "../src/runner/state-fingerprint.js";
import { TelemetryTrap } from "../src/runner/telemetry.js";
import { runVerification } from "../src/runner/verifier.js";

const tempDirs: string[] = [];

function makeTempDir(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-v03-"));
  tempDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("runbox v0.3 adoption & production-readiness upgrades", () => {
  it("ignores third-party script console errors and ignoreConsolePatterns while still trapping 1P errors", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html>
  <body>
    <script src="https://cdn.thirdparty.test/pixel.js"></script>
    <script>
      console.error("legacy-analytics-warning: safe to ignore");
      window.__triggerFirstPartyError = () => console.error("1P fatal bug");
    </script>
  </body>
</html>`);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.route("https://cdn.thirdparty.test/pixel.js", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: `console.error("3P tracking pixel error");`,
        });
      });

      const trap = new TelemetryTrap(
        page,
        {
          firstPartyConsoleOnly: true,
          ignoreConsolePatterns: ["legacy-analytics-warning"],
        },
        baseUrl
      );

      await page.goto(baseUrl, { waitUntil: "load" });
      await page.waitForTimeout(50);

      // Neither the 3P script error nor the ignored pattern should fail assertClean()
      expect(() => trap.assertClean()).not.toThrow();

      // Triggering an actual 1P console.error must still fail
      await page.evaluate(() => {
        (window as unknown as { __triggerFirstPartyError: () => void }).__triggerFirstPartyError();
      });
      await page.waitForTimeout(30);
      expect(() => trap.assertClean()).toThrow(/1P fatal bug/);

      trap.detach();
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);

  it("safe-fuzz mode skips destructive buttons, dry-runs unmocked POSTs, and preserves explicit mocks", async () => {
    const dir = makeTempDir();
    let realPostHits = 0;

    const server = http.createServer((req, res) => {
      if (req.url === "/api/order" && req.method === "POST") {
        realPostHits++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ charged: true }));
        return;
      }
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html>
  <body>
    <button data-testid="safe-ping" onclick="fetch('/api/order', { method: 'POST' })">Check Ping</button>
    <button data-testid="btn-logout">Logout</button>
    <button data-testid="btn-place-order">Place Order</button>
    <button data-testid="safe-preview" onclick="fetch('/api/preview', { method: 'POST' }).then(r => r.json()).then(d => document.getElementById('out').textContent = d.mode)">Preview</button>
    <div id="out" data-testid="preview-status">idle</div>
  </body>
</html>`);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: "load" });
        const targets = await discoverInteractiveTargets(page, "body");
        const labels = targets.map((t) => t.label);
        expect(labels).toContain('Click "safe-ping"');
        expect(labels).not.toContain('Click "btn-logout"');
        expect(labels).not.toContain('Click "btn-place-order"');
      } finally {
        await browser.close();
      }

      const feature = defineFeature({
        id: "safe-fuzz-check",
        name: "Safe Fuzz",
        route: "/",
        mocks: [
          {
            urlPattern: "**/api/preview**",
            method: "POST",
            body: { mode: "mocked-preview" },
          },
        ],
        fuzz: { enabled: true, steps: 4, runs: 4 },
      });

      const config = defineConfig({
        server: { url: baseUrl },
        features: [feature],
      });

      const res = await runVerification(dir, config, {
        features: [feature],
        skippedFeatures: [],
        url: baseUrl,
        fuzz: true,
        seed: "0x42",
      });

      expect(res.status).toBe("passed");
      expect(realPostHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);

  it("excludes button text from state fingerprinting and collapses passing fuzz self-loops in Mermaid", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <h1>Shopping Cart</h1>
        <button data-testid="dec-qty">- Remove Vitamin C</button>
        <span data-testid="cart-qty">2</span>
        <span data-testid="cart-total">$30</span>
      `);
      const node = await captureUiState(page);
      expect(node.id).not.toContain("Remove_Vitamin_C");
      expect(node.id).toContain("Shopping_Cart");
      expect(node.id).toContain("30");
    } finally {
      await browser.close();
    }

    const mermaid = compileMermaidStatechart([
      { featureId: "cart", from: "[*]", to: "Cart_2_30", action: "Load /cart", ok: true },
      { featureId: "cart", from: "Cart_2_30", to: "Cart_2_30", action: 'Fuzz [Click "promo-clear"]', ok: true },
      { featureId: "cart", from: "Cart_2_30", to: "Cart_1_15", action: 'Fuzz [Click "dec-qty"]', ok: true },
    ]);
    expect(mermaid).not.toContain("promo-clear");
    expect(mermaid).toContain("Cart_2_30 --> Cart_1_15");
  }, 15_000);

  it("caches parsed imports in os.tmpdir() without creating files inside cwd", () => {
    const dir = makeTempDir({
      "src/a.ts": `import { b } from "./b"; export const a = b;`,
      "src/b.ts": `export const b = 1;`,
    });

    const first = buildImportGraph(dir);
    expect(first.cacheHits).toBe(0);

    const second = buildImportGraph(dir);
    expect(second.cacheHits).toBe(2);
    expect(fs.existsSync(path.join(dir, ".runbox"))).toBe(false);
  });

  it("recordRoute captures API JSON mocks, localStorage persona, and generates feature.runbox.ts", async () => {
    const dir = makeTempDir();
    const server = http.createServer((req, res) => {
      if (req.url === "/api/catalog") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [{ id: "vit-c", price: 15 }] }));
        return;
      }
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html>
  <body>
    <button data-testid="btn-hi" onclick="localStorage.setItem('recordedUser', 'yes')">Hi</button>
    <script>
      localStorage.setItem('pincode', '110001');
      fetch('/api/catalog').then(r => r.json());
    </script>
  </body>
</html>`);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const config = defineConfig({ server: { url: baseUrl }, features: [] });
      const recorded = await recordRoute(dir, config, "/", {
        url: baseUrl,
        headless: true,
        durationMs: 400,
      });

      expect(recorded.mocksCount).toBe(1);
      expect(fs.existsSync(path.join(dir, recorded.mocksPath))).toBe(true);
      expect(fs.existsSync(path.join(dir, recorded.personaPath))).toBe(true);
      expect(fs.existsSync(path.join(dir, recorded.featurePath))).toBe(true);

      const mocksJson = JSON.parse(
        fs.readFileSync(path.join(dir, recorded.mocksPath), "utf8")
      );
      expect(mocksJson[0].urlPattern).toBe("**/api/catalog*");
      expect(mocksJson[0].body.items[0].id).toBe("vit-c");

      const personaJson = JSON.parse(
        fs.readFileSync(path.join(dir, recorded.personaPath), "utf8")
      );
      expect(personaJson.localStorage.pincode).toBe("110001");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
