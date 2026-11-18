export function calculateOrderBreakdown({
    items = [],
    couponCode = "",
    expressDelivery = false,
    giftWrap = false,
}) {
    const subtotal = items.reduce((sum, item) => {
        const price = Number(item.price) || 0
        const qty = Math.max(0, Number(item.qty) || 0)
        return sum + price * qty
    }, 0)

    let rawDiscount = 0
    if (couponCode === "SAVE20") {
        rawDiscount = 20
    } else if (couponCode === "HALF50") {
        rawDiscount = Math.min(40, Math.floor(subtotal * 0.5))
    }

    const discount = Math.min(subtotal, rawDiscount)

    const baseShipping =
        subtotal === 0 || subtotal >= 50 || couponCode === "FREESHIP" ? 0 : 15
    const expressFee = expressDelivery && subtotal > 0 ? 10 : 0
    const shipping = baseShipping + expressFee

    const giftFee = giftWrap && subtotal > 0 ? 5 : 0
    const total = Math.max(0, subtotal - discount + shipping + giftFee)
    const loyaltyPoints = Math.floor(total * 2)

    return {
        subtotal,
        discount,
        shipping,
        giftFee,
        total,
        loyaltyPoints,
    }
}
