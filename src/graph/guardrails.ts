import fs from "node:fs";
import path from "node:path";
import type { RunboxConfig } from "../config/schema.js";
import { matchesAnyGlob, toPosixPath } from "../utils/glob.js";
import { resolveImportSpecifier } from "../utils/imports.js";
import { buildImportGraph, type ImportGraph } from "./import-graph.js";

export interface GuardrailViolation {
  ruleId: string;
  file: string;
  line?: number;
  kind: "forbidden-import" | "forbidden-pattern";
  detail: string;
  remediation: string;
}

/**
 * Evaluates static architectural and code-pattern guardrails against workspace files.
 */
export function runGuardrails(
  cwd: string,
  config: RunboxConfig,
  options: { files?: string[]; graph?: ImportGraph } = {}
): GuardrailViolation[] {
  const rules = config.guardrails ?? [];
  if (rules.length === 0) return [];

  const resolvedCwd = path.resolve(cwd);
  const graph = options.graph ?? buildImportGraph(resolvedCwd, config.aliases);
  const candidateFiles = options.files
    ? options.files.map((f) => toPosixPath(f).replace(/^\.\//, ""))
    : graph.files;

  const violations: GuardrailViolation[] = [];

  for (const rule of rules) {
    const matchedFiles = candidateFiles.filter((file) =>
      matchesAnyGlob(file, rule.files)
    );

    for (const relFile of matchedFiles) {
      const absPath = path.join(resolvedCwd, relFile);
      if (!fs.existsSync(absPath)) continue;

      // 1. Check forbidden imports
      if (rule.forbidImportsFrom && rule.forbidImportsFrom.length > 0) {
        const imports = graph.parsedImports.get(relFile) ?? [];
        for (const imp of imports) {
          if (imp.isTypeOnly) continue;

          const resolvedTarget = resolveImportSpecifier(
            resolvedCwd,
            relFile,
            imp.specifier,
            graph.aliases
          );

          const matchedResolved =
            resolvedTarget !== null &&
            matchesAnyGlob(resolvedTarget, rule.forbidImportsFrom);
          const matchedSpecifier = matchesAnyGlob(
            imp.specifier,
            rule.forbidImportsFrom
          );

          if (matchedResolved || matchedSpecifier) {
            violations.push({
              ruleId: rule.id,
              file: relFile,
              kind: "forbidden-import",
              detail: resolvedTarget
                ? `Imports forbidden target "${resolvedTarget}" (via "${imp.specifier}")`
                : `Imports forbidden module "${imp.specifier}"`,
              remediation: rule.remediation,
            });
          }
        }
      }

      // 2. Check forbidden regex patterns line-by-line
      if (rule.forbidPatterns && rule.forbidPatterns.length > 0) {
        const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
        for (const patternRule of rule.forbidPatterns) {
          const regex = new RegExp(patternRule.pattern);
          for (let idx = 0; idx < lines.length; idx++) {
            if (regex.test(lines[idx])) {
              violations.push({
                ruleId: rule.id,
                file: relFile,
                line: idx + 1,
                kind: "forbidden-pattern",
                detail: patternRule.label
                  ? `Matched forbidden pattern "${patternRule.label}"`
                  : `Matched forbidden pattern /${patternRule.pattern}/`,
                remediation: rule.remediation,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}
