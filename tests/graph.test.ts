import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/config/schema.js";
import { runGuardrails } from "../src/graph/guardrails.js";
import {
  buildImportGraph,
  resolveAffectedFeatures,
} from "../src/graph/import-graph.js";

const tempDirs: string[] = [];

function makeTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-graph-"));
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
    const d = tempDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("import graph diff routing and Golden Rule guardrails", () => {
  it("resolves leaf component edits transitively to affected route features while skipping unrelated routes", () => {
    const dir = makeTempProject({
      "src/js/components/CouponBox.js": `import { formatMoney } from "../utils/money";\nexport function CouponBox() { return formatMoney(10); }`,
      "src/js/utils/money.js": `export function formatMoney(n) { return "$" + n; }`,
      "src/js/pages/Cart/index.js": `import { CouponBox } from "@components/CouponBox";\nexport default function Cart() { return CouponBox(); }`,
      "src/js/pages/Home/index.js": `export default function Home() { return "home"; }`,
      "src/js/pages/About/index.js": `export default function About() { return "about"; }`,
    });

    const config = defineConfig({
      aliases: {
        "@pages": "src/js/pages",
        "@components": "src/js/components",
      },
      features: [
        { id: "route-home", name: "Home", route: "/", files: ["src/js/pages/Home/**"] },
        { id: "route-cart", name: "Cart", route: "/cart", files: ["src/js/pages/Cart/**"] },
        { id: "route-about", name: "About", route: "/about", files: ["src/js/pages/About/**"] },
      ],
    });

    const graph = buildImportGraph(dir, config.aliases);
    const resolution = resolveAffectedFeatures(
      dir,
      config,
      ["src/js/utils/money.js"],
      graph
    );

    expect(resolution.affectedFeatures.map((f) => f.id)).toEqual(["route-cart"]);
    expect(resolution.skippedFeatures.map((f) => f.id)).toEqual([
      "route-home",
      "route-about",
    ]);
  });

  it("detects forbidden server imports and banned code patterns with LLM remediation prompts", () => {
    const dir = makeTempProject({
      "server/db.js": `export const query = () => {};`,
      "src/js/components/BadWidget.js": `import { query } from "../../../server/db.js";\nsetTimeout(() => query(), 50);\n`,
    });

    const config = defineConfig({
      guardrails: [
        {
          id: "no-server-in-client",
          files: ["src/js/**"],
          forbidImportsFrom: ["server/**"],
          remediation: "Never import server/** in universal src/js/** code.",
        },
        {
          id: "no-timer-hacks",
          files: ["src/js/**"],
          forbidPatterns: [
            { pattern: "\\bsetTimeout\\s*\\(", label: "raw setTimeout workaround" },
          ],
          remediation: "Replace timer hacks with explicit state transitions.",
        },
      ],
      features: [{ id: "home", name: "Home", route: "/", files: ["src/js/**"] }],
    });

    const violations = runGuardrails(dir, config);
    expect(violations).toHaveLength(2);
    expect(violations[0].ruleId).toBe("no-server-in-client");
    expect(violations[0].remediation).toContain("Never import server/**");
    expect(violations[1].ruleId).toBe("no-timer-hacks");
    expect(violations[1].line).toBe(2);
  });
});
