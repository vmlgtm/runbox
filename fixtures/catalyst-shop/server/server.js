import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const port = Number(process.env.PORT || process.env.APPLICATION_PORT || 3099);

function renderPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <nav>
      <a href="/">Home</a>
      <a href="/cart">Cart</a>
      <a href="/about">About</a>
    </nav>
    <main>${bodyHtml}</main>
  </body>
</html>`;
}

const cartHtml = renderPage(
  "Cart — Catalyst Shop",
  `
  <h1>Shopping Cart</h1>
  <section data-testid="cart-panel">
    <p>Qty: <span data-testid="cart-qty">0</span></p>
    <p>Coupon: <span data-testid="cart-coupon">NONE</span></p>
    <p>Total: <span data-testid="cart-total">$0</span></p>
    <div>
      <button type="button" data-testid="add-item">+1 Item ($10)</button>
      <button type="button" data-testid="dec-qty">-1 Qty</button>
    </div>
    <div>
      <input type="text" data-testid="coupon-input" placeholder="Coupon code" />
      <button type="button" data-testid="apply-coupon">Apply Coupon</button>
    </div>
  </section>
  <script type="module">
    import { calculateCartTotal } from "/src/js/components/CouponBox.js";

    let qty = 0;
    let coupon = "";
    const unitPrice = 10;

    const qtyEl = document.querySelector('[data-testid="cart-qty"]');
    const couponEl = document.querySelector('[data-testid="cart-coupon"]');
    const totalEl = document.querySelector('[data-testid="cart-total"]');
    const inputEl = document.querySelector('[data-testid="coupon-input"]');

    function render() {
      const total = calculateCartTotal(qty, unitPrice, coupon);
      qtyEl.textContent = String(qty);
      couponEl.textContent = coupon || "NONE";
      totalEl.textContent = "$" + total;
    }

    document.querySelector('[data-testid="add-item"]').addEventListener("click", () => {
      qty += 1;
      render();
    });

    document.querySelector('[data-testid="dec-qty"]').addEventListener("click", () => {
      qty = Math.max(0, qty - 1);
      render();
    });

    document.querySelector('[data-testid="apply-coupon"]').addEventListener("click", () => {
      const code = inputEl.value.trim().toUpperCase();
      if (code === "SAVE20") {
        coupon = "SAVE20";
      }
      render();
    });

    render();
  </script>
`
);

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage("Home — Catalyst Shop", "<h1>Catalyst Shop</h1><p>Welcome</p>"));
    return;
  }

  if (url === "/about") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage("About — Catalyst Shop", "<h1>About Catalyst Shop</h1>"));
    return;
  }

  if (url === "/cart") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(cartHtml);
    return;
  }

  if (url === "/src/js/components/CouponBox.js") {
    const filePath = path.join(rootDir, "src/js/components/CouponBox.js");
    const source = fs.readFileSync(filePath, "utf8");
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(source);
    return;
  }

  if (url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Listening on http://127.0.0.1:${port}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
