import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery/route-discovery.js";
import { initProject } from "../src/discovery/init.js";

const tempDirs: string[] = [];

function makeTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-disc-"));
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

describe("discoverProject across 3 framework archetypes", () => {
  it("Archetype 1: discovers file-system routed Next.js App Router pages & dynamic params", () => {
    const dir = makeTempProject({
      "package.json": JSON.stringify({
        scripts: { dev: "next dev" },
        dependencies: { next: "15.0.0", react: "19.0.0" },
      }),
      "app/page.tsx": "export default function Home() { return null; }",
      "app/checkout/page.tsx": "export default function Checkout() { return null; }",
      "app/product/[id]/page.tsx": "export default function Product() { return null; }",
      "app/layout.tsx": "export default function Layout({ children }: any) { return children; }",
    });

    const res = discoverProject(dir);
    expect(res.framework).toBe("nextjs");
    expect(res.server.command).toContain("-p {{port}}");

    const routes = res.features.map((f) => f.route);
    expect(routes).toContain("/");
    expect(routes).toContain("/checkout");
    expect(routes).toContain("/product/:id");

    const product = res.features.find((f) => f.route === "/product/:id");
    expect(product?.sampleRoute).toBe("/product/sample-1");
    expect(product?.files).toEqual(["app/product/[id]/**"]);
  });

  it("Archetype 2: discovers Vite + JSX <Route> declarations with nested routes & tsconfig aliases", () => {
    const dir = makeTempProject({
      "package.json": JSON.stringify({
        scripts: { dev: "vite" },
        dependencies: { vite: "6.0.0", "react-router-dom": "7.0.0" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
      "src/pages/Home.tsx": "export function Home() { return null; }",
      "src/pages/Dashboard.tsx": "export function Dashboard() { return null; }",
      "src/pages/Settings.tsx": "export function Settings() { return null; }",
      "src/App.tsx": `
        import { Home } from "@/pages/Home";
        import { Dashboard } from "@/pages/Dashboard";
        import { Settings } from "@/pages/Settings";
        export function App() {
          return (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />}>
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          );
        }
      `,
    });

    const res = discoverProject(dir);
    expect(res.framework).toBe("vite-react-router");
    expect(res.server.command).toContain("--port {{port}}");

    const home = res.features.find((f) => f.route === "/");
    const settings = res.features.find((f) => f.route === "/dashboard/settings");
    expect(home?.files).toEqual(["src/pages/Home.tsx"]);
    expect(settings?.files).toEqual(["src/pages/Settings.tsx"]);
  });

  it("Archetype 3: discovers catalyst-core config-array routes with nested children, @pages aliases & server guardrails", () => {
    const dir = makeTempProject({
      "package.json": JSON.stringify({
        scripts: { start: "catalyst-core start" },
        dependencies: { "@tata1mg/catalyst-core": "^1.0.2", "react-router": "^7.0.0" },
      }),
      "config/config.json": JSON.stringify({ APPLICATION_PORT: 3000 }),
      "server/server.js": "export default {};",
      "src/js/pages/Home/index.js": "export default function Home() { return null; }",
      "src/js/pages/Dashboard/index.js": "export default function Dashboard() { return null; }",
      "src/js/pages/Settings/index.js": "export default function Settings() { return null; }",
      "src/js/components/Navbar.js": "export function Navbar() { return null; }",
      "src/js/routes/index.js": `
        import Home from "@pages/Home";
        import Dashboard from "@pages/Dashboard";
        import Settings from "@pages/Settings";

        const routes = [
          { path: "/", element: <Home /> },
          {
            path: "/dashboard",
            element: <Dashboard />,
            children: [
              { path: "settings", element: <Settings /> },
            ],
          },
        ];
        export default routes;
      `,
    });

    const initRes = initProject(dir);
    expect(fs.existsSync(initRes.configPath)).toBe(true);
    expect(fs.existsSync(initRes.skillPath)).toBe(true);

    const { discovery } = initRes;
    expect(discovery.framework).toBe("catalyst-core");
    expect(discovery.server.command).toBe("npm start");
    expect(discovery.server.configPath).toBe("config/config.json");
    expect(discovery.aliases["@pages"]).toBe("src/js/pages");
    expect(discovery.aliases["@components"]).toBe("src/js/components");
    expect(discovery.guardrails.some((g) => g.id === "no-server-in-client")).toBe(true);

    const settings = discovery.features.find((f) => f.route === "/dashboard/settings");
    expect(settings).toBeDefined();
    expect(settings?.files).toEqual(["src/js/pages/Settings/**"]);
  });
});
