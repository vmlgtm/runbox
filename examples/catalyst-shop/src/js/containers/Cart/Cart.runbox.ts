import { defineFeature } from "runbox";

export default defineFeature({
  id: "route-cart",
  name: "Cart (Cart)",
  route: "/cart",
  tier: "p0",
  persona: "care-plan-member",
  journey: async ({ page, step }) => {
    await step("Wait for Cart hydration & adjust item quantities", async () => {
      await page.waitForSelector('[data-testid="add-item"]');
      await page.click('[data-testid="add-item"]');
      await page.click('[data-testid="add-item-2"]');
    });
    await step("Apply SAVE20 coupon and toggle express/gift", async () => {
      await page.fill('[data-testid="coupon-input"]', "SAVE20");
      await page.click('[data-testid="apply-coupon"]');
      await page.click('[data-testid="toggle-express"]');
      await page.click('[data-testid="toggle-gift"]');
    });
  },
  assertInvariants: async ({ page }) => {
    const totalText = await page.textContent('[data-testid="cart-total"]');
    const subtotalText = await page.textContent('[data-testid="cart-subtotal"]');
    const discountText = await page.textContent('[data-testid="cart-discount"]');

    const total = Number((totalText || "").replace("$", ""));
    const subtotal = Number((subtotalText || "").replace("$", ""));
    const discount = Number((discountText || "").replace("$", ""));

    if (Number.isNaN(total) || total < 0) {
      throw new Error(`Cart total invariant violated: ${totalText}`);
    }
    if (Number.isNaN(subtotal) || Number.isNaN(discount) || discount > subtotal) {
      throw new Error(
        `Cart discount invariant violated: discount=${discountText} > subtotal=${subtotalText}`
      );
    }
  },
  fuzz: {
    enabled: true,
    scopeSelector: '[data-testid="cart-panel"]',
    steps: 6,
    runs: 8,
  },
});
