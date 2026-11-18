export const PRODUCTS = [
    {
        id: "vit-c",
        name: "Vitamin C 500mg",
        category: "Vitamins",
        price: 15,
        stock: 10,
        rxRequired: false,
    },
    {
        id: "omega-3",
        name: "Omega-3 Fish Oil",
        category: "Vitamins",
        price: 22,
        stock: 12,
        rxRequired: false,
    },
    {
        id: "ibuprofen-400",
        name: "Ibuprofen 400mg Relief",
        category: "Pain Relief",
        price: 12,
        stock: 15,
        rxRequired: false,
    },
    {
        id: "naproxen-rx",
        name: "Naproxen Sodium 500mg",
        category: "Pain Relief",
        price: 28,
        stock: 8,
        rxRequired: true,
    },
    {
        id: "bp-monitor",
        name: "Digital Blood Pressure Monitor",
        category: "Diagnostics",
        price: 45,
        stock: 6,
        rxRequired: false,
    },
    {
        id: "hydro-cream",
        name: "Barrier Repair Cream",
        category: "Personal Care",
        price: 18,
        stock: 9,
        rxRequired: false,
    },
]

export const INITIAL_ORDERS = [
    {
        id: "ORD-101",
        date: "2026-10-12",
        status: "Delivered",
        itemsCount: 3,
        total: 52,
    },
    {
        id: "ORD-102",
        date: "2026-11-04",
        status: "Processing",
        itemsCount: 2,
        total: 40,
    },
    {
        id: "ORD-103",
        date: "2026-09-21",
        status: "Cancelled",
        itemsCount: 1,
        total: 15,
    },
]
