import { defineFeature } from "runbox";

export default defineFeature({
  id: "route-orders",
  name: "Orders (Orders)",
  route: "/orders",
  tier: "p2",
  journey: async ({ page, step }) => {
    await step("Filter orders by Delivered and request refill", async () => {
      await page.waitForSelector('[data-testid="status-Delivered"]');
      await page.click('[data-testid="status-Delivered"]');
      await page.click('[data-testid="refill-ORD-101"]');
    });
  },
  assertInvariants: async ({ page }) => {
    const text = await page.textContent('[data-testid="orders-count"]');
    const count = Number((text || "").trim());
    if (Number.isNaN(count) || count < 0) {
      throw new Error(`Orders count invariant violated: ${text}`);
    }
  },
  fuzz: {
    enabled: true,
    scopeSelector: '[data-testid="orders-panel"]',
    steps: 6,
    runs: 8,
  },
});
