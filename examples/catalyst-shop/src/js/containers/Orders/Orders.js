import React, { useState } from "react"
import Navbar from "@components/Navbar"
import { INITIAL_ORDERS } from "../../utils/catalogData"

const ORDER_STATUSES = ["All", "Delivered", "Processing", "Cancelled"]

function Orders() {
    const [statusFilter, setStatusFilter] = useState("All")
    const [refillIds, setRefillIds] = useState({})

    const visibleOrders = INITIAL_ORDERS.filter(
        (order) => statusFilter === "All" || order.status === statusFilter
    )

    const toggleRefill = (orderId) => {
        setRefillIds((prev) => ({
            ...prev,
            [orderId]: !prev[orderId],
        }))
    }

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
            <h1>Order History</h1>

            <section data-testid="orders-panel" style={{ display: "grid", gap: "14px" }}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    {ORDER_STATUSES.map((status) => (
                        <button
                            key={status}
                            type="button"
                            data-testid={`status-${status}`}
                            onClick={() => setStatusFilter(status)}
                            style={{ fontWeight: statusFilter === status ? 700 : 400 }}
                        >
                            {status}
                        </button>
                    ))}
                    <span>
                        Orders: <strong data-testid="orders-count">{visibleOrders.length}</strong>
                    </span>
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                    {visibleOrders.map((order) => (
                        <div
                            key={order.id}
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
                                <strong>{order.id}</strong> — {order.date} | {order.status} |{" "}
                                {order.itemsCount} items | ${order.total}
                            </div>
                            <button
                                type="button"
                                data-testid={`refill-${order.id}`}
                                onClick={() => toggleRefill(order.id)}
                            >
                                {refillIds[order.id] ? "Refill Requested" : "Request Refill"}
                            </button>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}

Orders.setMetaData = () => [<title key="title">Order History | Catalyst Shop</title>]

export default Orders
