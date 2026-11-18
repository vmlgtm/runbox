import type { GuardrailRule } from "./schema.js";

/**
 * Built-in enterprise SSR, Catalyst, and agent-discipline guardrail presets.
 */
export const presets = {
  /**
   * Prevents universal/client code from importing Node/Express server modules.
   */
  ssr(options: { clientFiles?: string[] } = {}): GuardrailRule[] {
    return [
      {
        id: "no-server-in-client",
        description: "Prevent universal/client modules from importing Node/Express server code.",
        files: options.clientFiles ?? [
          "src/js/**",
          "src/components/**",
          "src/pages/**",
          "src/containers/**",
        ],
        forbidImportsFrom: ["server/**", "@server", "@server/**"],
        remediation:
          "Universal/client modules must not import from server/. Move server-only logic behind an API endpoint or server data fetcher.",
      },
    ];
  },

  /**
   * Catalyst framework guardrails: enforces server/client isolation and code-split route loading.
   */
  catalyst(): GuardrailRule[] {
    return [
      ...presets.ssr({ clientFiles: ["src/js/**"] }),
      {
        id: "enforce-catalyst-split-routes",
        description:
          "Enforce lazy code-splitting via split(() => import(...)) in Catalyst route tables.",
        files: ["src/js/routes/index.*"],
        forbidPatterns: [
          {
            pattern: "^\\s*import\\s+[A-Za-z_$][\\w$]*\\s+from\\s+[\"']@containers/",
            label: "static @containers import in route definition",
          },
        ],
        remediation:
          "Routes in src/js/routes/index.* must use Catalyst's code-splitting wrapper `const Page = split(() => import('@containers/...'))` instead of static top-level `@containers/*` imports.",
      },
    ];
  },

  /**
   * Agent-discipline guardrails that block fragile async timer workarounds.
   */
  strictAgent(options: { files?: string[] } = {}): GuardrailRule[] {
    return [
      {
        id: "no-timer-workarounds",
        description: "Block raw setTimeout / requestIdleCallback workarounds used to paper over race conditions.",
        files: options.files ?? ["src/**"],
        forbidPatterns: [
          {
            pattern: "\\b(?:setTimeout|requestIdleCallback)\\s*\\(",
            label: "raw timer workaround",
          },
        ],
        remediation:
          "Do not use raw setTimeout/requestIdleCallback workarounds to mask async state or lifecycle bugs. Use deterministic state transitions or framework lifecycle hooks.",
      },
    ];
  },
};
