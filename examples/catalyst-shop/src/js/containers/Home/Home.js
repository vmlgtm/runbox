import React, { useMemo, useState } from "react"
import { Link } from "react-router"
import Navbar from "@components/Navbar"
import { PRODUCTS } from "../../utils/catalogData"

const CATEGORIES = ["All", "Vitamins", "Pain Relief", "Diagnostics", "Personal Care"]

function Home() {
    const [selectedCategory, setSelectedCategory] = useState("All")
    const [searchQuery, setSearchQuery] = useState("")
    const [sortOrder, setSortOrder] = useState("asc")

    const filteredProducts = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        const matching = PRODUCTS.filter((item) => {
            const matchesCategory =
                selectedCategory === "All" || item.category === selectedCategory
            const matchesSearch =
                !query ||
                item.name.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query)
            return matchesCategory && matchesSearch
        })

        return [...matching].sort((a, b) =>
            sortOrder === "asc" ? a.price - b.price : b.price - a.price
        )
    }, [selectedCategory, searchQuery, sortOrder])

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
            <h1>Catalyst Pharmacy & Shop</h1>
            <p>Universal SSR pharmacy & wellness catalog built with Catalyst.</p>

            <section data-testid="catalog-panel" style={{ marginTop: "16px" }}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {CATEGORIES.map((category) => (
                        <button
                            key={category}
                            type="button"
                            data-testid={`cat-${category}`}
                            onClick={() => setSelectedCategory(category)}
                            style={{
                                fontWeight: selectedCategory === category ? 700 : 400,
                            }}
                        >
                            {category}
                        </button>
                    ))}
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: "12px",
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginBottom: "16px",
                    }}
                >
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search products..."
                        data-testid="search-input"
                    />
                    <button
                        type="button"
                        data-testid="sort-toggle"
                        onClick={() =>
                            setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
                        }
                    >
                        Price: {sortOrder === "asc" ? "Low to High" : "High to Low"}
                    </button>
                    <span>
                        Showing <strong data-testid="product-count">{filteredProducts.length}</strong>{" "}
                        products
                    </span>
                </div>

                <div style={{ display: "grid", gap: "12px" }}>
                    {filteredProducts.map((item) => (
                        <div
                            key={item.id}
                            style={{
                                border: "1px solid #ddd",
                                borderRadius: "8px",
                                padding: "12px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <div>
                                <strong>{item.name}</strong> ({item.category}) — ${item.price}
                                {item.rxRequired ? " [Rx]" : ""}
                            </div>
                            <Link to={`/product/${item.id}`} data-testid={`product-link-${item.id}`}>
                                View Product
                            </Link>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}

Home.setMetaData = () => [<title key="title">Catalyst Pharmacy & Shop</title>]

export default Home
