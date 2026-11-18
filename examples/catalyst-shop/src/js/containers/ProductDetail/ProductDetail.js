import React, { useState } from "react"
import { useParams } from "react-router"
import Navbar from "@components/Navbar"
import { PRODUCTS } from "../../utils/catalogData"

const DOSE_ADJUSTMENTS = {
    "250mg": 0,
    "500mg": 5,
    "1000mg": 10,
}

const PACK_SIZES = [1, 2, 3]

function ProductDetail() {
    const { id } = useParams()
    const product = PRODUCTS.find((item) => item.id === id) || PRODUCTS[0]

    const [dose, setDose] = useState("250mg")
    const [packSize, setPackSize] = useState(1)
    const [qty, setQty] = useState(1)

    const effectiveQty = Math.min(Math.max(1, qty), product.stock)
    const unitPrice = (product.price + (DOSE_ADJUSTMENTS[dose] || 0)) * packSize
    const total = unitPrice * effectiveQty

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
            <h1>{product.name}</h1>
            <p>
                Category: {product.category} | Base Price: ${product.price} | Stock: {product.stock}
                {product.rxRequired ? " | Prescription Required" : ""}
            </p>

            <section
                data-testid="pdp-panel"
                style={{
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "grid",
                    gap: "14px",
                }}
            >
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <span>Dosage:</span>
                    {["250mg", "500mg", "1000mg"].map((option) => (
                        <button
                            key={option}
                            type="button"
                            data-testid={`dose-${option}`}
                            onClick={() => setDose(option)}
                            style={{ fontWeight: dose === option ? 700 : 400 }}
                        >
                            {option}
                        </button>
                    ))}
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <span>Pack Size:</span>
                    {PACK_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            data-testid={`pack-${size}`}
                            onClick={() => setPackSize(size)}
                            style={{ fontWeight: packSize === size ? 700 : 400 }}
                        >
                            {size}x Pack
                        </button>
                    ))}
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span>Quantity:</span>
                    <button
                        type="button"
                        data-testid="pdp-dec"
                        onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                    >
                        -
                    </button>
                    <strong data-testid="pdp-qty">{effectiveQty}</strong>
                    <button
                        type="button"
                        data-testid="pdp-inc"
                        onClick={() => setQty((prev) => Math.min(product.stock, prev + 1))}
                    >
                        +
                    </button>
                </div>

                <div style={{ fontSize: "1.1rem" }}>
                    Configured Total:{" "}
                    <strong data-testid="pdp-total">${total}</strong>
                </div>
            </section>
        </div>
    )
}

ProductDetail.setMetaData = () => [<title key="title">Product Detail | Catalyst Shop</title>]

export default ProductDetail
