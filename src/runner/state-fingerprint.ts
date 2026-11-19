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
 * visible headings/dialogs, and non-interactive status indicators (or custom `stateLabel`).
 */
export async function captureUiState(
  page: Page,
  customLabeler?: (page: Page) => Promise<string>
): Promise<UiStateNode> {
  if (customLabeler) {
    const pathname = await page.evaluate(() => window.location.pathname || "/");
    const customLabel = (await customLabeler(page)).trim().slice(0, 80) || pathname;
    return {
      id: sanitizeMermaidId(customLabel),
      label: customLabel,
      pathname,
    };
  }

  const raw = await page.evaluate(() => {
    const pathname = window.location.pathname || "/";
    const headingEl =
      document.querySelector('[role="dialog"] h1, [role="dialog"] h2') ??
      document.querySelector("h1, h2");
    const heading = headingEl?.textContent?.trim().slice(0, 32) ?? "";

    const dialogOpen = Boolean(
      document.querySelector(
        '[role="dialog"][open], [data-state="open"], [data-testid*="drawer"][data-open="true"]'
      )
    );

    const statusSnippets: string[] = [];
    const statusNodes = document.querySelectorAll(
      '[data-testid*="qty"], [data-testid*="total"], [data-testid*="count"], [data-testid*="coupon"], [data-testid*="status"], [role="status"]'
    );
    statusNodes.forEach((node) => {
      if (statusSnippets.length >= 4) return;
      const el = node as HTMLElement;
      // Exclude interactive controls (e.g. button[data-testid="dec-qty"]) so actions never pollute state labels
      if (el.matches('button, input, select, textarea, a, [role="button"]')) return;
      if (el.closest('button, a, [role="button"]')) return;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;

      const text = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 20);
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
