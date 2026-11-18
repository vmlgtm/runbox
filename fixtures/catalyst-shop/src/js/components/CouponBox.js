/**
 * Computes final cart total after applying an optional flat $20 SAVE20 coupon.
 */
export function calculateCartTotal(quantity, unitPrice, couponCode) {
  const subtotal = quantity * unitPrice;
  const discount = couponCode === "SAVE20" ? 20 : 0;
  return Math.max(0, subtotal - discount);
}
