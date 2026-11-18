import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { presets } from "../src/config/presets.js";
import { defineConfig, defineFeature } from "../src/config/schema.js";
import { runGuardrails } from "../src/graph/guardrails.js";
import {
  buildImportGraph,
  resolveAffectedFeatures,
} from "../src/graph/import-graph.js";
import { runVerification } from "../src/runner/verifier.js";

const ROOT_DIR = path.resolve(__dirname, "..");
const tempDirs: string[] = [];

function makeTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-v02-"));
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
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runbox v0.2 enterprise primitives", () => {
  it("discovers co-located src/**/*.runbox.ts contracts via defineFeature() with automatic directory ownership", async () => {
    const distIndex = path.join(ROOT_DIR, "src", "index.ts");
    const dir = makeTempProject({
      "runbox.config.ts": `import { defineConfig } from ${JSON.stringify(distIndex)};
export default defineConfig({
  framework: "catalyst-core",
});`,
      "src/js/containers/Cart/Cart.js": `export default function Cart() { return null; }`,
      "src/js/containers/Cart/Cart.runbox.ts": `import { defineFeature } from ${JSON.stringify(distIndex)};
export default defineFeature({
  id: "rx-cart",
  name: "Rx Cart",
  route: "/cart",
  tier: "p0",
});`,
      "src/js/containers/Orders/Orders.js": `export default function Orders() { return null; }`,
      "src/js/containers/Orders/Orders.runbox.ts": `import { defineFeature } from ${JSON.stringify(distIndex)};
export default defineFeature({
  id: "orders",
  name: "Order History",
  route: "/orders",
  tier: "p2",
});`,
    });

    const { config } = await loadConfig(dir);
    expect(config.features).toHaveLength(2);

    const cart = config.features.find((f) => f.id === "rx-cart");
    const orders = config.features.find((f) => f.id === "orders");
    expect(cart?.tier).toBe("p0");
    expect(cart?.files).toEqual(["src/js/containers/Cart/**"]);
    expect(orders?.tier).toBe("p2");
    expect(orders?.files).toEqual(["src/js/containers/Orders/**"]);
  });

  it("sorts affected features by tier (p0 -> p1 -> p2), filters by --tier, and caps via blastRadius.maxLocalFeatures", () => {
    const dir = makeTempProject({
      "src/js/components/Navbar.js": `export function Navbar() { return null; }`,
      "src/js/containers/Orders/Orders.js": `import { Navbar } from "../../components/Navbar"; export default Navbar;`,
      "src/js/containers/Home/Home.js": `import { Navbar } from "../../components/Navbar"; export default Navbar;`,
      "src/js/containers/Cart/Cart.js": `import { Navbar } from "../../components/Navbar"; export default Navbar;`,
      "src/js/containers/PDP/PDP.js": `import { Navbar } from "../../components/Navbar"; export default Navbar;`,
    });

    const config = defineConfig({
      blastRadius: { maxLocalFeatures: 2 },
      features: [
        defineFeature({
          id: "orders",
          name: "Orders",
          route: "/orders",
          tier: "p2",
          files: ["src/js/containers/Orders/**"],
        }),
        defineFeature({
          id: "home",
          name: "Home",
          route: "/",
          tier: "p1",
          files: ["src/js/containers/Home/**"],
        }),
        defineFeature({
          id: "cart",
          name: "Cart",
          route: "/cart",
          tier: "p0",
          files: ["src/js/containers/Cart/**"],
        }),
        defineFeature({
          id: "pdp",
          name: "PDP",
          route: "/product/:id",
          tier: "p0",
          files: ["src/js/containers/PDP/**"],
        }),
      ],
    });

    const graph = buildImportGraph(dir);

    // Editing shared Navbar impacts all 4 features; maxLocalFeatures: 2 picks both p0 features first
    const capped = resolveAffectedFeatures(
      dir,
      config,
      ["src/js/components/Navbar.js"],
      graph
    );
    expect(capped.affectedFeatures.map((f) => f.id)).toEqual(["cart", "pdp"]);
    expect(capped.deferredFeatures?.map((f) => f.id)).toEqual(["home", "orders"]);
    expect(capped.skippedFeatures.map((f) => f.id)).toEqual(["home", "orders"]);

    // Filtering explicitly by tier p1 returns only home
    const onlyP1 = resolveAffectedFeatures(
      dir,
      config,
      ["src/js/components/Navbar.js"],
      graph,
      { tier: "p1" }
    );
    expect(onlyP1.affectedFeatures.map((f) => f.id)).toEqual(["home"]);
  });

  it("enforces presets.catalyst() split() routes and presets.strictAgent() timer bans", () => {
    const dir = makeTempProject({
      "src/js/routes/index.js": `import Home from "@containers/Home/Home";\nexport default [{ path: "/", component: Home }];\n`,
      "src/js/containers/Home/Home.js": `export default function Home() { setTimeout(() => {}, 10); return null; }\n`,
    });

    const config = defineConfig({
      guardrails: [...presets.catalyst(), ...presets.strictAgent()],
      features: [],
    });

    const violations = runGuardrails(dir, config);
    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("enforce-catalyst-split-routes");
    expect(ruleIds).toContain("no-timer-workarounds");
  });

  it("injects persona (localStorage, cookies, headers) and intercepts API mocks via page.route", async () => {
    const dir = makeTempProject({});

    const server = http.createServer((req, res) => {
      if (req.url === "/api/whoami") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            personaHeader: req.headers["x-runbox-persona"] ?? "none",
          })
        );
        return;
      }

      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html>
  <body>
    <div id="persona-state"></div>
    <div id="promo-result">loading</div>
    <div id="header-result">loading</div>
    <script>
      document.getElementById("persona-state").textContent =
        "carePlan=" + localStorage.getItem("carePlan") + ";cookie=" + document.cookie;
      Promise.all([
        fetch("/api/promo").then(r => r.json()),
        fetch("/api/whoami").then(r => r.json())
      ]).then(([promo, whoami]) => {
        document.getElementById("promo-result").textContent = promo.code + ":" + promo.discount;
        document.getElementById("header-result").textContent = whoami.personaHeader;
      });
    </script>
  </body>
</html>`);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const feature = defineFeature({
        id: "care-plan-checkout",
        name: "Care Plan Checkout",
        route: "/",
        tier: "p0",
        persona: "care-plan-member",
        mocks: [
          {
            urlPattern: "**/api/promo**",
            method: "GET",
            status: 200,
            body: { code: "VIP30", discount: 30 },
          },
        ],
        journey: async ({ page, step }) => {
          await step("Wait for mocked promo and header responses", async () => {
            await page.waitForFunction(
              () =>
                document.getElementById("promo-result")?.textContent === "VIP30:30" &&
                document.getElementById("header-result")?.textContent === "care-plan-member"
            );
          });
        },
        assertInvariants: async ({ page }) => {
          const personaText = await page.textContent("#persona-state");
          if (
            !personaText?.includes("carePlan=active") ||
            !personaText?.includes("session=vip-token")
          ) {
            throw new Error(`Persona injection failed: ${personaText}`);
          }
        },
      });

      const config = defineConfig({
        server: { url: baseUrl },
        personas: {
          "care-plan-member": {
            id: "care-plan-member",
            cookies: [{ name: "session", value: "vip-token" }],
            localStorage: { carePlan: "active" },
            headers: { "x-runbox-persona": "care-plan-member" },
          },
        },
        features: [feature],
      });

      const result = await runVerification(dir, config, {
        features: [feature],
        skippedFeatures: [],
        url: baseUrl,
      });

      expect(result.status).toBe("passed");
      expect(result.features[0].passed).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
