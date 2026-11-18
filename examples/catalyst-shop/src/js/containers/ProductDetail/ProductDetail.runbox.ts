import { defineFeature } from "runbox";

export default defineFeature({
  id: "route-product-id",
  name: "Product Detail (ProductDetail)",
  route: "/product/:id",
  sampleRoute: "/product/vit-c",
  tier: "p0",
  journey: async ({ page, step }) => {
    await step("Select 500mg dosage and 2x pack", async () => {
      await page.waitForSelector('[data-testid="dose-500mg"]');
      await page.click('[data-testid="dose-500mg"]');
      await page.click('[data-testid="pack-2"]');
    });
    await step("Increment product quantity", async () => {
      await page.click('[data-testid="pdp-inc"]');
    });
  },
  assertInvariants: async ({ page }) => {
    const text = await page.textContent('[data-testid="pdp-total"]');
    const total = Number((text || "").replace("$", ""));
    if (Number.isNaN(total) || total <= 0) {
      throw new Error(`PDP total invariant violated: ${text}`);
    }
  },
  fuzz: {
    enabled: true,
    scopeSelector: '[data-testid="pdp-panel"]',
    steps: 6,
    runs: 8,
  },
});
