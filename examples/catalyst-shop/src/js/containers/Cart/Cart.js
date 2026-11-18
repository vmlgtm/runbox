import React, { useState } from "react"
import Navbar from "@components/Navbar"
import CouponBox from "@components/CouponBox"
import { PRODUCTS } from "../../utils/catalogData"
import { calculateOrderBreakdown } from "../../utils/pricingEngine"

const CART_PRODUCTS = PRODUCTS.slice(0, 3)

function Cart() {
    const [quantities, setQuantities] = useState([1, 1, 0])
    const [coupon, setCoupon] = useState("")
    const [expressDelivery, setExpressDelivery] = useState(false)
    const [giftWrap, setGiftWrap] = useState(false)
    const [checkoutConfirmed, setCheckoutConfirmed] = useState(false)

    const updateQty = (index, delta) => {
        setQuantities((prev) =>
            prev.map((q, i) => {
                if (i !== index) return q
                const maxStock = CART_PRODUCTS[i]?.stock ?? 99
                return Math.min(maxStock, Math.max(0, q + delta))
            })
        )
    }

    const lineItems = CART_PRODUCTS.map((product, index) => ({
        ...product,
        qty: quantities[index] || 0,
    }))

    const breakdown = calculateOrderBreakdown({
        items: lineItems,
        couponCode: coupon,
        expressDelivery,
        giftWrap,
    })

    const totalQty = quantities.reduce((sum, q) => sum + q, 0)

    return (
        <div
            style={{
                fontFamily: "system-ui, sans-serif",
                maxWidth: "820px",
                margin: "32px auto",
                padding: "0 16px",
            }}
        >
            <Navbar />
            <h1>Shopping Cart</h1>

            <section
                data-testid="cart-panel"
                style={{
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "grid",
                    gap: "12px",
                }}
            >
                <div style={{ display: "grid", gap: "8px" }}>
                    {lineItems.map((item, idx) => (
                        <div
                            key={item.id}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                borderBottom: "1px solid #f3f4f6",
                                paddingBottom: "8px",
                            }}
                        >
                            <div>
                                <strong>{item.name}</strong> — ${item.price} x {item.qty}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <button
                                    type="button"
                                    data-testid={`dec-item-${idx}`}
                                    onClick={() => updateQty(idx, -1)}
                                >
                                    -
                                </button>
                                <span>{item.qty}</span>
                                <button
                                    type="button"
                                    data-testid={`add-item-${idx}`}
                                    onClick={() => updateQty(idx, 1)}
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                        type="button"
                        data-testid="add-item"
                        onClick={() => updateQty(0, 1)}
                    >
                        + Add {CART_PRODUCTS[0].name}
                    </button>
                    <button
                        type="button"
                        data-testid="dec-qty"
                        onClick={() => updateQty(0, -1)}
                    >
                        - Remove {CART_PRODUCTS[0].name}
                    </button>
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                        type="button"
                        data-testid="toggle-express"
                        onClick={() => setExpressDelivery((prev) => !prev)}
                    >
                        Express Delivery: {expressDelivery ? "ON" : "OFF"}
                    </button>
                    <button
                        type="button"
                        data-testid="toggle-gift"
                        onClick={() => setGiftWrap((prev) => !prev)}
                    >
                        Gift Wrap: {giftWrap ? "ON" : "OFF"}
                    </button>
                    <button
                        type="button"
                        data-testid="toggle-checkout"
                        onClick={() => setCheckoutConfirmed((prev) => !prev)}
                    >
                        {checkoutConfirmed ? "Checkout Confirmed" : "Confirm Checkout"}
                    </button>
                </div>

                <CouponBox activeCoupon={coupon} onApply={setCoupon} />

                <div
                    style={{
                        borderTop: "1px solid #e5e7eb",
                        paddingTop: "12px",
                        display: "grid",
                        gap: "4px",
                    }}
                >
                    <div>
                        Items: <span data-testid="cart-qty">{totalQty}</span>
                    </div>
                    <div>
                        Subtotal: <span data-testid="cart-subtotal">${breakdown.subtotal}</span>
                    </div>
                    <div>
                        Discount: <span data-testid="cart-discount">${breakdown.discount}</span>
                    </div>
                    <div>
                        Shipping: <span data-testid="cart-shipping">${breakdown.shipping}</span>
                    </div>
                    <div>
                        Gift Fee: <span>${breakdown.giftFee}</span>
                    </div>
                    <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                        Total: <span data-testid="cart-total">${breakdown.total}</span>
                    </div>
                    <div>Loyalty Points Earned: {breakdown.loyaltyPoints}</div>
                </div>
            </section>
        </div>
    )
}

Cart.setMetaData = () => [<title key="title">Shopping Cart | Catalyst Shop</title>]

export default Cart
