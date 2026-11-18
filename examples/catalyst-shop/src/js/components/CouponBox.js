import React, { useState } from "react"
import { calculateOrderBreakdown } from "../utils/pricingEngine"

export function calculateCartTotal(qty, unitPrice, couponCode) {
    const { total } = calculateOrderBreakdown({
        items: [{ price: unitPrice, qty }],
        couponCode,
        expressDelivery: false,
        giftWrap: false,
    })
    return total
}

function CouponBox({ activeCoupon, onApply }) {
    const [inputCode, setInputCode] = useState("")

    const handleApply = () => {
        const normalized = inputCode.trim().toUpperCase()
        onApply(normalized)
    }

    return (
        <div
            style={{
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "12px",
                marginTop: "12px",
            }}
        >
            <div style={{ marginBottom: "8px" }}>
                Active Coupon:{" "}
                <span data-testid="cart-coupon" style={{ fontWeight: 700 }}>
                    {activeCoupon || "NONE"}
                </span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                <button type="button" data-testid="promo-save20" onClick={() => onApply("SAVE20")}>
                    SAVE20
                </button>
                <button type="button" data-testid="promo-half50" onClick={() => onApply("HALF50")}>
                    HALF50
                </button>
                <button type="button" data-testid="promo-freeship" onClick={() => onApply("FREESHIP")}>
                    FREESHIP
                </button>
                <button type="button" data-testid="promo-clear" onClick={() => onApply("")}>
                    Clear
                </button>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
                <input
                    type="text"
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value)}
                    placeholder="Enter coupon code"
                    data-testid="coupon-input"
                />
                <button type="button" data-testid="apply-coupon" onClick={handleApply}>
                    Apply Coupon
                </button>
            </div>
        </div>
    )
}

export default CouponBox
