import fs from "node:fs";
import path from "node:path";
import type { FeatureConfig, GuardrailRule, ServerConfig } from "../config/schema.js";
import { toPosixPath, walkFiles } from "../utils/glob.js";
import {
  SOURCE_EXTENSIONS,
  detectWorkspaceAliases,
  parseImports,
  resolveImportSpecifier,
  stripComments,
} from "../utils/imports.js";

export interface DiscoveryResult {
  framework: string;
  aliases: Record<string, string>;
  server: ServerConfig;
  guardrails: GuardrailRule[];
  features: FeatureConfig[];
}

interface RawRouteMatch {
  route: string;
  componentName?: string;
  importSpecifier?: string;
  sourceFile: string;
}

/**
 * Discovers framework, aliases, server command, guardrails, and routes across
 * file-system routers, React Router JSX trees, and config-array routers (e.g. catalyst-core).
 */
export function discoverProject(cwd: string): DiscoveryResult {
  const resolvedCwd = path.resolve(cwd);
  const aliases = detectWorkspaceAliases(resolvedCwd);
  const { framework, server } = detectFrameworkAndServer(resolvedCwd);

  const allFiles = walkFiles(resolvedCwd, { extensions: SOURCE_EXTENSIONS });

  // Strategy B & C: AST/Config-array routes and JSX <Route> declarations
  const configRoutes = discoverConfigArrayRoutes(resolvedCwd, allFiles, aliases);
  const jsxRoutes = discoverJsxRoutes(resolvedCwd, allFiles, aliases);

  const combinedDeclarative = deduplicateRawRoutes([...configRoutes, ...jsxRoutes]);

  // Strategy A: File-system routes (avoid misclassifying Vite/Catalyst `src/pages/*` when declarative routes exist)
  const fsRoutes = discoverFileSystemRoutes(
    resolvedCwd,
    allFiles,
    framework,
    combinedDeclarative.length > 0
  );

  const allRaw = deduplicateRawRoutes([...combinedDeclarative, ...fsRoutes]);
  const features = buildFeaturesFromRoutes(resolvedCwd, allRaw, aliases);
  const guardrails = buildDefaultGuardrails(resolvedCwd, framework);

  return {
    framework,
    aliases,
    server,
    guardrails,
    features,
  };
}

function detectFrameworkAndServer(cwd: string): {
  framework: string;
  server: ServerConfig;
} {
  const pkgPath = path.join(cwd, "package.json");
  let deps: Record<string, string> = {};
  let scripts: Record<string, string> = {};

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      scripts = pkg.scripts ?? {};
    } catch {
      // Fall back to filesystem heuristics
    }
  }

  let framework = "web";
  if (
    deps["catalyst-core"] ||
    deps["@tata1mg/catalyst-core"] ||
    fs.existsSync(path.join(cwd, "src/js/routes"))
  ) {
    framework = "catalyst-core";
  } else if (deps["next"] || fs.existsSync(path.join(cwd, "next.config.js")) || fs.existsSync(path.join(cwd, "next.config.mjs")) || fs.existsSync(path.join(cwd, "next.config.ts"))) {
    framework = "nextjs";
  } else if (deps["vite"]) {
    framework = deps["react-router"] || deps["react-router-dom"] ? "vite-react-router" : "vite";
  } else if (deps["@remix-run/react"] || deps["react-router"]) {
    framework = "react-router";
  } else if (deps["nuxt"]) {
    framework = "nuxt";
  } else if (deps["@sveltejs/kit"]) {
    framework = "sveltekit";
  }

  const configPath = fs.existsSync(path.join(cwd, "config/config.json"))
    ? "config/config.json"
    : undefined;

  let command = "npm run dev";
  if (framework === "catalyst-core" && scripts.start) {
    command = "npm start";
  } else if (scripts.dev) {
    if (scripts.dev.includes("vite")) {
      command = "npm run dev -- --port {{port}}";
    } else if (scripts.dev.includes("next")) {
      command = "npm run dev -- -p {{port}}";
    } else {
      command = "npm run dev";
    }
  } else if (scripts.start) {
    command = "npm start";
  }

  const server: ServerConfig = {
    command,
    readyPath: "/",
    ...(configPath ? { configPath } : {}),
  };

  return { framework, server };
}

function buildDefaultGuardrails(cwd: string, framework: string): GuardrailRule[] {
  const guardrails: GuardrailRule[] = [];
  const hasServerDir = fs.existsSync(path.join(cwd, "server"));
  const hasSrcJs = fs.existsSync(path.join(cwd, "src/js"));
  const hasSrcComponents = fs.existsSync(path.join(cwd, "src/components"));

  if (hasServerDir && (hasSrcJs || hasSrcComponents || framework === "catalyst-core")) {
    const clientFiles = hasSrcJs ? ["src/js/**"] : ["src/components/**", "src/pages/**"];
    guardrails.push({
      id: "no-server-in-client",
      description: "Prevent universal/client modules from importing Node/Express server code.",
      files: clientFiles,
      forbidImportsFrom: ["server/**", "@server", "@server/**"],
      remediation:
        "Universal/client modules must not import from server/. Move server-only logic behind an API endpoint or server data fetcher.",
    });
  }

  return guardrails;
}

/**
 * Strategy A: File-system routed frameworks (Next.js App/Pages, Remix, SvelteKit, Nuxt).
 */
function discoverFileSystemRoutes(
  cwd: string,
  allFiles: string[],
  framework: string,
  hasDeclarativeRoutes: boolean
): RawRouteMatch[] {
  const results: RawRouteMatch[] = [];

  for (const relFile of allFiles) {
    // 1. Next.js App Router: app/**/page.{tsx,ts,jsx,js} or src/app/**/page.*
    const appMatch = relFile.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.[jt]sx?$/);
    if (appMatch) {
      const segments = (appMatch[1] ?? "")
        .split("/")
        .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
      const route = normalizeFsRouteSegments(segments);
      results.push({ route, sourceFile: relFile });
      continue;
    }

    // 2. SvelteKit: src/routes/**/+page.*
    const svelteMatch = relFile.match(/^src\/routes\/(?:(.*)\/)?\+page\.(?:svelte|[jt]sx?)$/);
    if (svelteMatch) {
      const segments = (svelteMatch[1] ?? "").split("/").filter(Boolean);
      const route = normalizeFsRouteSegments(segments);
      results.push({ route, sourceFile: relFile });
      continue;
    }

    // 3. Pages Router: pages/**/* or src/pages/**/* (skip if declarative router already owns pages/)
    const isExplicitPagesRouter = framework === "nextjs" || framework === "nuxt";
    if (isExplicitPagesRouter || !hasDeclarativeRoutes) {
      const pagesMatch = relFile.match(/^(?:src\/)?pages\/(.+)\.[jt]sx?$/);
      if (pagesMatch) {
        const inner = pagesMatch[1];
        if (
          inner.startsWith("api/") ||
          /^_(app|document|error)$/.test(inner) ||
          /^(404|500)$/.test(inner)
        ) {
          continue;
        }
        // Only treat src/pages as file-system routed if no src/js/pages (catalyst style) and no declarative routes
        if (fs.existsSync(path.join(cwd, "src/js/routes"))) {
          continue;
        }
        const segments = inner.split("/").filter(Boolean);
        if (segments[segments.length - 1] === "index") {
          segments.pop();
        }
        const route = normalizeFsRouteSegments(segments);
        results.push({ route, sourceFile: relFile });
      }
    }
  }

  return results;
}

function normalizeFsRouteSegments(segments: string[]): string {
  const mapped = segments
    .filter(Boolean)
    .map((seg) => {
      // [...slug] or [[...slug]] -> *
      if (/^\[\[?\.\.\.[^\]]+\]\]?$/.test(seg)) return "*";
      // [id] -> :id
      const paramMatch = seg.match(/^\[([^\]]+)\]$/);
      if (paramMatch) return `:${paramMatch[1]}`;
      // $id (Remix) -> :id
      if (seg.startsWith("$")) return `:${seg.slice(1)}`;
      return seg;
    });
  return "/" + mapped.join("/");
}

/**
 * Strategy B: Config-array route trees ({ path, element, component, children }).
 * Covers catalyst-core (`src/js/routes/index.js`), React Router v6/v7 data routers, TanStack/Vue configs.
 */
function discoverConfigArrayRoutes(
  _cwd: string,
  allFiles: string[],
  _aliases: Record<string, string>
): RawRouteMatch[] {
  const routeFiles = allFiles.filter((file) =>
    /(?:^|\/)(?:routes?|router)(?:\/|\.|$)/i.test(file)
  );
  const results: RawRouteMatch[] = [];

  for (const relFile of routeFiles) {
    const absPath = path.join(_cwd, relFile);
    const code = fs.readFileSync(absPath, "utf8");
    const stripped = stripComments(code);

    const parsedRoutes = extractRouteConfigTree(stripped, "");
    if (parsedRoutes.length === 0) continue;

    const imports = parseImports(code);
    const bindingToSpecifier = buildBindingLookup(imports);

    for (const item of parsedRoutes) {
      results.push({
        route: item.route,
        componentName: item.componentName,
        importSpecifier: item.componentName ? bindingToSpecifier.get(item.componentName) : undefined,
        sourceFile: relFile,
      });
    }
  }

  return results;
}

interface ExtractedTreeRoute {
  route: string;
  componentName?: string;
}

/**
 * Scans JS/TS object literals containing `path:` or `children:` keys using balanced
 * brace/bracket scanning so arbitrarily nested `children: [...]` route trees resolve cleanly.
 */
function extractRouteConfigTree(
  code: string,
  parentPath: string
): ExtractedTreeRoute[] {
  const results: ExtractedTreeRoute[] = [];

  // Find candidate arrays assigned to routes or passed to createBrowserRouter / useRoutes
  const arrayBlocks = findTopLevelRouteArrays(code);
  for (const arrText of arrayBlocks) {
    parseRouteObjectList(arrText, parentPath, results);
  }

  return results;
}

function findTopLevelRouteArrays(code: string): string[] {
  const blocks: string[] = [];
  const triggerRegex =
    /(?:(?:routes|router)\s*(?::[^=]+)?=\s*|createBrowserRouter\s*\(\s*|useRoutes\s*\(\s*|export\s+default\s+)\[/g;

  for (const match of code.matchAll(triggerRegex)) {
    const startIdx = match.index! + match[0].length - 1;
    const endIdx = findMatchingDelimiter(code, startIdx, "[", "]");
    if (endIdx !== -1) {
      blocks.push(code.slice(startIdx, endIdx + 1));
    }
  }
  return blocks;
}

function parseRouteObjectList(
  arrayText: string,
  parentPath: string,
  out: ExtractedTreeRoute[]
): void {
  const objects = splitTopLevelObjects(arrayText);
  for (const objText of objects) {
    // Only inspect direct properties (not nested inside `children: [...]`)
    const { shallowText, childrenArrayText } = splitShallowAndChildren(objText);

    const pathMatch = shallowText.match(/\bpath\s*:\s*["'`]([^"'`]+)["'`]/);
    const isIndex = /\bindex\s*:\s*true\b/.test(shallowText);

    let fullRoute: string | undefined;
    if (pathMatch) {
      fullRoute = joinRoutePaths(parentPath, pathMatch[1]);
    } else if (isIndex) {
      fullRoute = parentPath || "/";
    }

    const componentName = extractComponentIdentifier(shallowText);

    if (fullRoute && (componentName || !childrenArrayText)) {
      out.push({ route: fullRoute, componentName });
    } else if (fullRoute && childrenArrayText && componentName) {
      out.push({ route: fullRoute, componentName });
    }

    if (childrenArrayText) {
      parseRouteObjectList(childrenArrayText, fullRoute ?? parentPath, out);
    }
  }
}

function splitShallowAndChildren(objText: string): {
  shallowText: string;
  childrenArrayText?: string;
} {
  const childrenMatch = objText.match(/\bchildren\s*:\s*\[/);
  if (!childrenMatch || childrenMatch.index === undefined) {
    return { shallowText: objText };
  }
  const arrStart = childrenMatch.index + childrenMatch[0].length - 1;
  const arrEnd = findMatchingDelimiter(objText, arrStart, "[", "]");
  if (arrEnd === -1) {
    return { shallowText: objText };
  }
  const childrenArrayText = objText.slice(arrStart, arrEnd + 1);
  const shallowText = objText.slice(0, childrenMatch.index) + objText.slice(arrEnd + 1);
  return { shallowText, childrenArrayText };
}

function splitTopLevelObjects(arrayText: string): string[] {
  const objects: string[] = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let braceDepth = 0;
  let objStart = -1;

  while (i < arrayText.length) {
    const ch = arrayText[i];
    if (inSingle || inDouble || inTemplate) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === "`") inTemplate = false;
      i++;
      continue;
    }

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    else if (ch === "{") {
      if (braceDepth === 0) objStart = i;
      braceDepth++;
    } else if (ch === "}") {
      braceDepth--;
      if (braceDepth === 0 && objStart !== -1) {
        objects.push(arrayText.slice(objStart, i + 1));
        objStart = -1;
      }
    }
    i++;
  }
  return objects;
}

function findMatchingDelimiter(
  text: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inSingle || inDouble || inTemplate) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    else if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractComponentIdentifier(snippet: string): string | undefined {
  // element: <Home ... /> or component: <Home /> or React.createElement(Home) or Component: Home
  const jsxMatch = snippet.match(/(?:element|component)\s*:\s*<\s*([A-Z][\w.]*)/);
  if (jsxMatch) return jsxMatch[1].split(".")[0];

  const propIdentMatch = snippet.match(/(?:component|Component)\s*:\s*([A-Z][\w$]*)/);
  if (propIdentMatch) return propIdentMatch[1];

  const createElemMatch = snippet.match(/createElement\s*\(\s*([A-Z][\w$]*)/);
  if (createElemMatch) return createElemMatch[1];

  return undefined;
}

/**
 * Strategy C: JSX `<Route path="..." element={<Comp />} />` declarations (Vite + React Router).
 */
function discoverJsxRoutes(
  cwd: string,
  allFiles: string[],
  _aliases: Record<string, string>
): RawRouteMatch[] {
  const jsxFiles = allFiles.filter((f) => f.endsWith(".tsx") || f.endsWith(".jsx"));
  const results: RawRouteMatch[] = [];

  for (const relFile of jsxFiles) {
    const code = fs.readFileSync(path.join(cwd, relFile), "utf8");
    if (!code.includes("<Route")) continue;

    const stripped = stripComments(code);
    const imports = parseImports(code);
    const bindingToSpecifier = buildBindingLookup(imports);

    const parsed = parseJsxRouteTags(stripped);
    for (const item of parsed) {
      results.push({
        route: item.route,
        componentName: item.componentName,
        importSpecifier: item.componentName ? bindingToSpecifier.get(item.componentName) : undefined,
        sourceFile: relFile,
      });
    }
  }

  return results;
}

function parseJsxRouteTags(code: string): ExtractedTreeRoute[] {
  const results: ExtractedTreeRoute[] = [];
  const stack: string[] = [""];

  const startRegex = /<(\/?)Route\b/g;
  for (const match of code.matchAll(startRegex)) {
    const isClosing = match[1] === "/";
    const afterNameIdx = match.index! + match[0].length;
    const tagEnd = findJsxTagEnd(code, afterNameIdx);
    if (tagEnd === -1) continue;

    if (isClosing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const rawAttrs = code.slice(afterNameIdx, tagEnd);
    const isSelfClosing = /\/\s*$/.test(rawAttrs);
    const attrs = isSelfClosing ? rawAttrs.replace(/\/\s*$/, "") : rawAttrs;

    const parentPath = stack[stack.length - 1] ?? "";
    const pathMatch = attrs.match(/\bpath\s*=\s*["']([^"']+)["']/);
    const isIndex = /\bindex\b/.test(attrs);

    const fullRoute = pathMatch
      ? joinRoutePaths(parentPath, pathMatch[1])
      : isIndex
        ? parentPath || "/"
        : undefined;

    const elemMatch = attrs.match(/\belement\s*=\s*\{\s*<\s*([A-Z][\w.]*)/);
    const compMatch = attrs.match(/\b(?:component|Component)\s*=\s*\{\s*([A-Z][\w$]*)/);
    const componentName = elemMatch?.[1]?.split(".")[0] ?? compMatch?.[1];

    if (fullRoute && componentName) {
      results.push({ route: fullRoute, componentName });
    }

    if (!isSelfClosing) {
      stack.push(fullRoute ?? parentPath);
    }
  }

  return results;
}

function findJsxTagEnd(code: string, startIndex: number): number {
  let braceDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = startIndex; i < code.length; i++) {
    const ch = code[i];
    if (inSingle || inDouble || inTemplate) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === ">" && braceDepth === 0) return i;
  }

  return -1;
}

function buildBindingLookup(
  imports: ReturnType<typeof parseImports>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const imp of imports) {
    for (const binding of imp.bindings) {
      map.set(binding, imp.specifier);
    }
  }
  return map;
}

function joinRoutePaths(parent: string, child: string): string {
  if (!child) return parent || "/";
  if (child.startsWith("/")) return child;
  const cleanParent = parent === "/" ? "" : parent.replace(/\/+$/, "");
  const cleanChild = child.replace(/^\/+/, "");
  return `${cleanParent}/${cleanChild}` || "/";
}

function deduplicateRawRoutes(items: RawRouteMatch[]): RawRouteMatch[] {
  const seen = new Map<string, RawRouteMatch>();
  for (const item of items) {
    const existing = seen.get(item.route);
    if (!existing || (!existing.importSpecifier && item.importSpecifier)) {
      seen.set(item.route, item);
    }
  }
  return Array.from(seen.values());
}

function buildFeaturesFromRoutes(
  cwd: string,
  rawRoutes: RawRouteMatch[],
  aliases: Record<string, string>
): FeatureConfig[] {
  const features: FeatureConfig[] = [];
  const usedIds = new Set<string>();

  for (const raw of rawRoutes) {
    // Skip catch-all wildcard routes like "*" unless no other routes exist
    if (raw.route === "*") continue;

    let resolvedEntry: string | null = null;
    if (raw.importSpecifier) {
      resolvedEntry = resolveImportSpecifier(
        cwd,
        raw.sourceFile,
        raw.importSpecifier,
        aliases
      );
    }

    const entryFile = resolvedEntry ?? raw.sourceFile;
    const filesGlob = toFeatureFileGlob(entryFile);

    let id = routeToFeatureId(raw.route);
    if (usedIds.has(id)) {
      id = `${id}-${usedIds.size + 1}`;
    }
    usedIds.add(id);

    const hasDynamicParams = raw.route.includes(":");
    const sampleRoute = hasDynamicParams
      ? raw.route.replace(/:[^/]+/g, "sample-1")
      : undefined;

    const labelSuffix = raw.componentName ? ` (${raw.componentName})` : "";
    const name = `${routeToHumanName(raw.route)}${labelSuffix}`;

    features.push({
      id,
      name,
      route: raw.route,
      ...(sampleRoute ? { sampleRoute } : {}),
      files: [filesGlob],
    });
  }

  return features;
}

function toFeatureFileGlob(relFile: string): string {
  const clean = toPosixPath(relFile);
  const ext = path.posix.extname(clean);
  const base = path.posix.basename(clean);
  const stem = path.posix.basename(clean, ext);
  const dir = path.posix.dirname(clean);
  const parentDirName = dir === "." ? "" : path.posix.basename(dir);

  if (
    /^(index|page|\+page)\.[jt]sx?$/.test(base) ||
    (parentDirName && stem === parentDirName)
  ) {
    return dir === "." ? clean : `${dir}/**`;
  }
  return clean;
}

function routeToFeatureId(route: string): string {
  if (route === "/") return "route-home";
  const slug = route
    .replace(/^\//, "")
    .replace(/:/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `route-${slug || "index"}`;
}

function routeToHumanName(route: string): string {
  if (route === "/") return "Home";
  return route
    .replace(/^\//, "")
    .split("/")
    .map((part) => {
      const clean = part.replace(/^:/, "");
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join(" / ");
}
