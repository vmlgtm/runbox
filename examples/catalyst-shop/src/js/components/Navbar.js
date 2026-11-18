import React from "react"
import { Link } from "react-router"

function Navbar() {
    return (
        <header
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
                paddingBottom: "16px",
                marginBottom: "24px",
                borderBottom: "1px solid #e5e7eb",
                flexWrap: "wrap",
            }}
        >
            <strong style={{ fontSize: "1.1rem" }}>Catalyst Pharmacy</strong>
            <nav style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <Link to="/" data-testid="nav-home">
                    Home
                </Link>
                <Link to="/product/vit-c" data-testid="nav-product">
                    Product Detail
                </Link>
                <Link to="/cart" data-testid="nav-cart">
                    Cart
                </Link>
                <Link to="/orders" data-testid="nav-orders">
                    Orders
                </Link>
            </nav>
        </header>
    )
}

export default Navbar
