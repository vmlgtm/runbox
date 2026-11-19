# runbox Proof Bundle — PASSED ✅

- **Duration:** 14.12s
- **Affected Features Tested:** `route-cart`, `route-home`, `route-orders`, `route-product-id`
- **Skipped Features:** _none_

## Invariant Scorecard

| Invariant | Violations | Status |
| :--- | :---: | :---: |
| Console Errors | 0 | ✅ |
| Uncaught Exceptions | 0 | ✅ |
| Hydration Mismatches | 0 | ✅ |
| Server 5xx Responses | 0 | ✅ |
| Domain Invariants | 0 | ✅ |

## Features Verified

| Feature | Route | Journey Steps | Fuzz Runs | Transitions | Seed | Result |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| `route-cart` (Cart (Cart)) | `/cart` | 2 | 8 | 59 | `0x42` | ✅ Passed |
| `route-home` (Home (Home)) | `/` | 2 | 8 | 59 | `0x42` | ✅ Passed |
| `route-orders` (Orders (Orders)) | `/orders` | 1 | 8 | 58 | `0x42` | ✅ Passed |
| `route-product-id` (Product Detail (ProductDetail)) | `/product/vit-c` | 2 | 8 | 59 | `0x42` | ✅ Passed |

## Verified UI Statechart

```mermaid
stateDiagram-v2
    [*] --> Shopping_Cart_NONE_2__37__0: Load /cart
    Shopping_Cart_NONE_2__37__0 --> Shopping_Cart_NONE_4__64__0: Wait for Cart hydration & adjust item quantities
    Shopping_Cart_NONE_4__64__0 --> Shopping_Cart_SAVE20_4__64__20: Apply SAVE20 coupon and toggle express/gift
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_SAVE20_5__79__20: Fuzz [Click "add-item-0"]
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_SAVE20_5__86__20: Fuzz [Click "add-item-1"]
    Shopping_Cart_SAVE20_5__86__20 --> Shopping_Cart_SAVE20_4__71__20: Fuzz [Click "dec-item-0"]
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_NONE_4__64__0: Fuzz [Click "promo-clear"]
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_FREESHIP_4__64__0: Fuzz [Click "promo-freeship"]
    Shopping_Cart_FREESHIP_4__64__0 --> Shopping_Cart_FREESHIP_3__42__0: Fuzz [Click "dec-item-1"]
    Shopping_Cart_FREESHIP_3__42__0 --> Shopping_Cart_FREESHIP_4__64__0: Fuzz [Click "add-item-1"]
    Shopping_Cart_FREESHIP_3__42__0 --> Shopping_Cart_HALF50_3__42__21: Fuzz [Click "promo-half50"]
    Shopping_Cart_FREESHIP_4__64__0 --> Shopping_Cart_FREESHIP_5__86__0: Fuzz [Click "add-item-1"]
    Shopping_Cart_SAVE20_5__79__20 --> Shopping_Cart_HALF50_5__79__39: Fuzz [Click "promo-half50"]
    Shopping_Cart_HALF50_5__79__39 --> Shopping_Cart_NONE_5__79__0: Fuzz [Click "promo-clear"]
    Shopping_Cart_NONE_5__79__0 --> Shopping_Cart_NONE_4__64__0: Fuzz [Click "dec-item-0"]
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_SAVE20_3__52__20: Fuzz [Click "dec-item-2"]
    Shopping_Cart_SAVE20_4__64__20 --> Shopping_Cart_SAVE20_5__76__20: Fuzz [Click "add-item-2"]
    Shopping_Cart_SAVE20_5__76__20 --> Shopping_Cart_FREESHIP_5__76__0: Fuzz [Click "promo-freeship"]
    Shopping_Cart_FREESHIP_5__76__0 --> Shopping_Cart_FREESHIP_4__61__0: Fuzz [Click "dec-qty"]
    [*] --> Home: Load /
    Home --> Catalyst_Pharmacy_Shop_2: Filter catalog by Vitamins category
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_2: Search & toggle price sort
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Pain Relief"]
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Fill "search-input" = "1"]
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Personal Care"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_2: Fuzz [Click "cat-Vitamins"]
    [*] --> orders: Load /orders
    orders --> Order_History_1: Filter orders by Delivered and request refill
    Order_History_1 --> Order_History_3: Fuzz [Click "status-All"]
    Order_History_3 --> Order_History_1: Fuzz [Click "status-Processing"]
    Order_History_3 --> Order_History_1: Fuzz [Click "status-Delivered"]
    Order_History_3 --> Order_History_1: Fuzz [Click "status-Cancelled"]
    [*] --> product_vit_c: Load /product/vit-c
    product_vit_c --> Vitamin_C_500mg_1__40: Select 500mg dosage and 2x pack
    Vitamin_C_500mg_1__40 --> Vitamin_C_500mg_2__80: Increment product quantity
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__100: Fuzz [Click "dose-1000mg"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__60: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__60 --> Vitamin_C_500mg_2__30: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__30 --> Vitamin_C_500mg_1__15: Fuzz [Click "pdp-dec"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__120: Fuzz [Click "pack-3"]
    Vitamin_C_500mg_2__120 --> Vitamin_C_500mg_2__40: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__40 --> Vitamin_C_500mg_2__30: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__30 --> Vitamin_C_500mg_2__60: Fuzz [Click "pack-2"]
    Vitamin_C_500mg_2__60 --> Vitamin_C_500mg_2__80: Fuzz [Click "dose-500mg"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__40: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__40 --> Vitamin_C_500mg_2__50: Fuzz [Click "dose-1000mg"]
    Vitamin_C_500mg_2__120 --> Vitamin_C_500mg_3__180: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_3__180 --> Vitamin_C_500mg_3__120: Fuzz [Click "pack-2"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_3__120: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_3__120 --> Vitamin_C_500mg_3__90: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_3__90 --> Vitamin_C_500mg_3__45: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__100 --> Vitamin_C_500mg_3__150: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_3__150 --> Vitamin_C_500mg_4__200: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_4__200 --> Vitamin_C_500mg_4__160: Fuzz [Click "dose-500mg"]
    Vitamin_C_500mg_4__160 --> Vitamin_C_500mg_4__240: Fuzz [Click "pack-3"]
```

## Captured Evidence

### Storefront Catalog (`/`)
![Home Initial](screenshots/route-home-initial.png)
![Home Post-Journey](screenshots/route-home-post-journey.png)

### Product Detail (`/product/vit-c`)
![Product Detail Initial](screenshots/route-product-id-initial.png)
![Product Detail Post-Journey](screenshots/route-product-id-post-journey.png)

### Multi-Item Cart (`/cart`)
![Cart Initial](screenshots/route-cart-initial.png)
![Cart Post-Journey](screenshots/route-cart-post-journey.png)

### Order History (`/orders`)
![Orders Initial](screenshots/route-orders-initial.png)
![Orders Post-Journey](screenshots/route-orders-post-journey.png)
