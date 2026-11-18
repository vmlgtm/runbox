import { split } from "catalyst-core"

const Home = split(() => import("@containers/Home/Home"))
const ProductDetail = split(() => import("@containers/ProductDetail/ProductDetail"))
const Cart = split(() => import("@containers/Cart/Cart"))
const Orders = split(() => import("@containers/Orders/Orders"))

const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
    {
        path: "/product/:id",
        end: true,
        component: ProductDetail,
    },
    {
        path: "/cart",
        end: true,
        component: Cart,
    },
    {
        path: "/orders",
        end: true,
        component: Orders,
    },
]

export default routes
