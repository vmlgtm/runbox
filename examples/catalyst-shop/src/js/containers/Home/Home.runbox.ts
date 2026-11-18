import { defineFeature } from "runbox";

export default defineFeature({
  id: "route-home",
  name: "Home (Home)",
  route: "/",
  tier: "p1",
  journey: async ({ page, step }) => {
    await step("Filter catalog by Vitamins category", async () => {
      await page.waitForSelector('[data-testid="cat-Vitamins"]');
      await page.click('[data-testid="cat-Vitamins"]');
    });
    await step("Search & toggle price sort", async () => {
      await page.fill('[data-testid="search-input"]', "Vitamin");
      await page.click('[data-testid="sort-toggle"]');
    });
  },
  assertInvariants: async ({ page }) => {
    const text = await page.textContent('[data-testid="product-count"]');
    const count = Number((text || "").trim());
    if (Number.isNaN(count) || count < 0) {
      throw new Error(`Product count invariant violated: ${text}`);
    }
  },
  fuzz: {
    enabled: true,
    scopeSelector: '[data-testid="catalog-panel"]',
    steps: 6,
    runs: 8,
  },
});
