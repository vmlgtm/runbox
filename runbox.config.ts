import { defineConfig } from "./src/index.js";

export default defineConfig({
  framework: "typescript-cli",
  guardrails: [
    {
      id: "pure-static-analysis-layers",
      description:
        "Keep static discovery and import-graph layers decoupled from browser/runtime orchestration.",
      files: ["src/graph/**", "src/discovery/**"],
      forbidImportsFrom: ["playwright-core", "src/box/**", "src/runner/**"],
      remediation:
        "src/graph/** and src/discovery/** must stay pure static analysis layers. Move browser/runtime interactions into src/box/** or src/runner/**.",
    },
  ],
  features: [
    {
      id: "cli-discovery-graph",
      name: "Discovery & Import Graph Engine",
      route: "/",
      files: ["src/discovery/**", "src/graph/**", "src/utils/**"],
    },
    {
      id: "runtime-box-runner",
      name: "Ephemeral Box & Runtime Verifier",
      route: "/",
      files: ["src/box/**", "src/runner/**"],
    },
    {
      id: "dual-reporters-cli",
      name: "Proof Bundle & Agent JSON Reporters",
      route: "/",
      files: ["src/reporter/**", "src/ui/**", "src/cli.ts"],
    },
  ],
});
