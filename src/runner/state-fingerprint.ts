import type { Page } from "playwright-core";

export interface UiStateNode {
  id: string;
  label: string;
  pathname: string;
}

export interface StateTransition {
  featureId: string;
  from: string;
  to: string;
  action: string;
  ok: boolean;
}

/**
 * Computes a lightweight semantic UI state fingerprint from URL pathname,
 * visible headings/dialogs, and primary interactive status indicators.
 */
export async function captureUiState(page: Page): Promise<UiStateNode> {
  const raw = await page.evaluate(() => {
    const pathname = window.location.pathname || "/";
    const headingEl =
      document.querySelector('[role="dialog"] h1, [role="dialog"] h2') ??
      document.querySelector("h1, h2");
    const heading = headingEl?.textContent?.trim().slice(0, 40) ?? "";

    const dialogOpen = Boolean(
      document.querySelector('[role="dialog"][open], [data-state="open"], [data-testid*="drawer"][data-open="true"]')
    );

    const statusSnippets: string[] = [];
    const statusNodes = document.querySelectorAll(
      '[data-testid*="total"], [data-testid*="count"], [data-testid*="qty"], [data-testid*="coupon"], [data-testid*="status"]'
    );
    statusNodes.forEach((node) => {
      if (statusSnippets.length >= 3) return;
      const el = node as HTMLElement;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const text = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 24);
      if (text) statusSnippets.push(text);
    });

    return { pathname, heading, dialogOpen, statusSnippets };
  });

  const routePart =
    raw.pathname === "/"
      ? "Home"
      : raw.pathname
          .replace(/^\//, "")
          .replace(/[^a-zA-Z0-9]+/g, "_");

  const labelParts = [
    raw.heading || routePart,
    raw.dialogOpen ? "Open" : "",
    ...raw.statusSnippets,
  ].filter(Boolean);

  const label = labelParts.join(" · ").slice(0, 80) || raw.pathname;
  const id = sanitizeMermaidId(labelParts.join("_") || routePart);

  return {
    id,
    label,
    pathname: raw.pathname,
  };
}

export function sanitizeMermaidId(raw: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return cleaned || "State";
}
