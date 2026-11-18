import { defineConfig, presets } from "runbox";

export default defineConfig({
  framework: "catalyst-core",
  server: {
    command: "npm start",
    readyPath: "/",
    configPath: "config/config.json",
  },
  aliases: {
    "@api": "api.js",
    "@containers": "src/js/containers",
    "@server": "server",
    "@config": "config",
    "@css": "src/static/css",
    "@routes": "src/js/routes",
    "@components": "src/js/components",
  },
  featureGlobs: ["src/**/*.runbox.ts"],
  blastRadius: {
    maxLocalFeatures: 2,
  },
  personas: {
    "care-plan-member": {
      id: "care-plan-member",
      localStorage: {
        carePlan: "active",
        pincode: "110001",
      },
    },
  },
  guardrails: presets.catalyst(),
  invariants: {
    noConsoleErrors: true,
    noUncaughtExceptions: true,
    noHydrationMismatch: true,
    noServer5xx: true,
  },
});
