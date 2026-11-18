# Catalyst Pharmacy & Shop (`runbox` Example App)

A multi-route universal SSR pharmacy & shopping app built with [Catalyst (`catalyst-core`)](https://github.com/tata1mg/catalyst-core) and verified end-to-end with [`runbox`](https://github.com/vmlgtm/runbox).

## Routes & Federated Feature Contracts (`feat/v0.2-enterprise`)

Features are co-located alongside their containers via `defineFeature()` and auto-discovered from [runbox.config.ts](runbox.config.ts) (which also uses `presets.catalyst()`, `blastRadius: { maxLocalFeatures: 2 }`, and a `care-plan-member` persona):

- **`/`** ([Home.js](src/js/containers/Home/Home.js) · [Home.runbox.ts](src/js/containers/Home/Home.runbox.ts), `tier: "p1"`) — Catalog with category filters (`All`, `Vitamins`, `Pain Relief`, `Diagnostics`, `Personal Care`), search, price sorting, and links to `/product/:id`
- **`/product/:id`** ([ProductDetail.js](src/js/containers/ProductDetail/ProductDetail.js) · [ProductDetail.runbox.ts](src/js/containers/ProductDetail/ProductDetail.runbox.ts), `tier: "p0"`) — Product configurator with dosage (`250mg`/`500mg`/`1000mg`), pack size (`1x`/`2x`/`3x`), and stock-bounded quantity `+`/`-`
- **`/cart`** ([Cart.js](src/js/containers/Cart/Cart.js) · [Cart.runbox.ts](src/js/containers/Cart/Cart.runbox.ts), `tier: "p0"`, `persona: "care-plan-member"`) — Multi-item cart using [pricingEngine.js](src/js/utils/pricingEngine.js) and [CouponBox.js](src/js/components/CouponBox.js) (`SAVE20`, `HALF50`, `FREESHIP`, Express Delivery, Gift Wrap, and itemized totals)
- **`/orders`** ([Orders.js](src/js/containers/Orders/Orders.js) · [Orders.runbox.ts](src/js/containers/Orders/Orders.runbox.ts), `tier: "p2"`) — Order history with status filters and refill requests

---

## Running on Another Machine

### 1. Install and link `runbox` (`feat/v0.2-enterprise`)

```bash
git clone -b feat/v0.2-enterprise https://github.com/vmlgtm/runbox.git
cd runbox
pnpm install
pnpm run build
npm link
```

*(Ensure Playwright Chromium or Google Chrome is installed; if needed run `npx playwright install chromium`.)*

### 2. Clone and install `catalyst-shop` (`feat/v0.2-enterprise`)

```bash
git clone -b feat/v0.2-enterprise https://github.com/vmlgtm/catalyst-shop.git
cd catalyst-shop
npm install
```

### 3. Run the app or verify with `runbox`

```bash
# Run Catalyst guardrails & discover all co-located *.runbox.ts contracts
runbox check

# Verify only critical P0 revenue routes (Cart & Product Detail) with property fuzzing
runbox verify --tier p0 --fuzz --seed 0x42

# Or verify all 4 routes and inspect the Mermaid Proof Bundle
runbox verify --fuzz --seed 0x42
cat .runbox/proof/report.md

# Or run the app manually in the browser (http://localhost:3005)
npm start
```

---

## Sample `runbox` Outputs

Inspect real captured results from verifying this app in [`sample-proof/`](sample-proof/report.md):

- **[`sample-proof/report.md`](sample-proof/report.md)** — Full 4-route passing Proof Bundle (invariant scorecard, rendered Mermaid `stateDiagram-v2`, and all 8 route screenshots).
- **[`sample-proof/tui-output.txt`](sample-proof/tui-output.txt)** — Terminal TUI output from `runbox verify --fuzz --seed 0x42`.
- **[`sample-proof/report-failed.md`](sample-proof/report-failed.md)** — Sample failure Proof Bundle when a discount-cap regression violates `discount <= subtotal`.
- **[`sample-proof/agent-oracle-failed.json`](sample-proof/agent-oracle-failed.json)** — `<500-token` `--agent` JSON oracle emitted on failure.
