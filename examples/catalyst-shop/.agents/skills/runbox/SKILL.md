---
name: runbox
description: Verify code changes deterministically with runbox guardrails, runtime telemetry traps, and property-based UI fuzzing before completing tasks.
---

# Verification Workflow with `runbox`

After editing files in this repository, **always verify your diff using `runbox`** instead of assuming `tsc` or unit tests alone prove runtime correctness.

## 1. Pre-flight static guardrails & affected features
```bash
npx runbox check --diff --agent
```
- If `guardrailViolations` is non-empty, read each violation's `remediation` field and fix the architectural root cause.

## 2. Runtime verification & property fuzzing
```bash
npx runbox verify --diff --fuzz --agent
```
- When verification fails, inspect the compact JSON output:
  - `violatedInvariant`: exact error, console/hydration failure, HTTP 5xx, or business invariant broken
  - `seed` & `replayCommand`: deterministic replay seed
  - `minimalReproductionSteps`: shrunk interaction sequence that triggers the bug
- Fix the underlying bug in source code (never suppress errors or add timer workarounds) and re-run `replayCommand` until `status` is `"passed"`.

## 3. Enriching new features
When adding a new user flow, register or update its `journey`, `assertInvariants`, and `fuzz.scopeSelector` in `runbox.config.ts`. Use `npx runbox discover <route>` to inspect interactive selectors on a page.
