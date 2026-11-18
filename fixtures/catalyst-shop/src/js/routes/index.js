import Home from "@pages/Home";
import Cart from "@pages/Cart";
import About from "@pages/About";

const routes = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/cart",
    element: <Cart />,
  },
  {
    path: "/about",
    element: <About />,
  },
];

export default routes;
