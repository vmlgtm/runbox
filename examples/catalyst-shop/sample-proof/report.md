# runbox Proof Bundle — PASSED ✅

- **Duration:** 36.38s
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
| `route-cart` (Cart (Cart)) | `/cart` | 2 | 8 | 56 | `0x42` | ✅ Passed |
| `route-home` (Home (Home)) | `/` | 2 | 8 | 56 | `0x42` | ✅ Passed |
| `route-orders` (Orders (Orders)) | `/orders` | 1 | 8 | 55 | `0x42` | ✅ Passed |
| `route-product-id` (Product Detail (ProductDetail)) | `/product/vit-c` | 2 | 8 | 56 | `0x42` | ✅ Passed |

## Verified UI Statechart

```mermaid
stateDiagram-v2
    [*] --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Load /cart
    Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Wait for Cart hydration & adjust item quantities
    Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Apply SAVE20 coupon and toggle express/gift
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "add-item-0"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "add-item-1"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "dec-item-0"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Fuzz [Click "promo-clear"]
    Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Fuzz [Click "toggle-gift"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A: Fuzz [Click "promo-freeship"]
    Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A --> Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A: Fuzz [Click "dec-item-1"]
    Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A --> Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A: Fuzz [Click "add-item-1"]
    Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A --> Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A: Fuzz [Click "toggle-checkout"]
    Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A --> Shopping_Cart__Remove_Vitamin_C_500mg_HALF50_App: Fuzz [Click "promo-half50"]
    Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A --> Shopping_Cart__Remove_Vitamin_C_500mg_FREESHIP_A: Fuzz [Fill "coupon-input" = "0"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_HALF50_App: Fuzz [Click "promo-half50"]
    Shopping_Cart__Remove_Vitamin_C_500mg_HALF50_App --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Fuzz [Click "promo-clear"]
    Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply --> Shopping_Cart__Remove_Vitamin_C_500mg_NONE_Apply: Fuzz [Click "dec-item-0"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Fill "coupon-input" = "0"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "toggle-gift"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Fill "coupon-input" = "INVALID"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "dec-item-2"]
    Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App --> Shopping_Cart__Remove_Vitamin_C_500mg_SAVE20_App: Fuzz [Click "add-item-2"]
    [*] --> Catalyst_Pharmacy_Shop_6: Load /
    Catalyst_Pharmacy_Shop_6 --> Catalyst_Pharmacy_Shop_2: Filter catalog by Vitamins category
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_2: Search & toggle price sort
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Pain Relief"]
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_2: Fuzz [Click "sort-toggle"]
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Fill "search-input" = "1"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Personal Care"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Pain Relief"]
    Catalyst_Pharmacy_Shop_2 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Personal Care"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Diagnostics"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_2: Fuzz [Click "cat-Vitamins"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Fill "search-input" = "INVALID"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "cat-Vitamins"]
    Catalyst_Pharmacy_Shop_0 --> Catalyst_Pharmacy_Shop_0: Fuzz [Click "sort-toggle"]
    [*] --> Order_History_All_Delivered_Processing: Load /orders
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Filter orders by Delivered and request refill
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Fuzz [Click "status-Processing"]
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Fuzz [Click "status-Cancelled"]
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Fuzz [Click "status-Delivered"]
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Fuzz [Click "status-All"]
    Order_History_All_Delivered_Processing --> Order_History_All_Delivered_Processing: Fuzz [Click "refill-ORD-101"]
    [*] --> Vitamin_C_500mg_1__15: Load /product/vit-c
    Vitamin_C_500mg_1__15 --> Vitamin_C_500mg_1__40: Select 500mg dosage and 2x pack
    Vitamin_C_500mg_1__40 --> Vitamin_C_500mg_2__80: Increment product quantity
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__100: Fuzz [Click "dose-1000mg"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__60: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__60 --> Vitamin_C_500mg_2__60: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__60 --> Vitamin_C_500mg_2__30: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__30 --> Vitamin_C_500mg_1__15: Fuzz [Click "pdp-dec"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__120: Fuzz [Click "pack-3"]
    Vitamin_C_500mg_2__120 --> Vitamin_C_500mg_2__40: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__40 --> Vitamin_C_500mg_2__30: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__30 --> Vitamin_C_500mg_2__60: Fuzz [Click "pack-2"]
    Vitamin_C_500mg_2__60 --> Vitamin_C_500mg_2__80: Fuzz [Click "dose-500mg"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__80: Fuzz [Click "pack-2"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_2__40: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_2__40 --> Vitamin_C_500mg_2__50: Fuzz [Click "dose-1000mg"]
    Vitamin_C_500mg_2__120 --> Vitamin_C_500mg_3__180: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_3__180 --> Vitamin_C_500mg_3__180: Fuzz [Click "pack-3"]
    Vitamin_C_500mg_3__180 --> Vitamin_C_500mg_3__120: Fuzz [Click "pack-2"]
    Vitamin_C_500mg_2__80 --> Vitamin_C_500mg_3__120: Fuzz [Click "pdp-inc"]
    Vitamin_C_500mg_3__120 --> Vitamin_C_500mg_3__90: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_3__90 --> Vitamin_C_500mg_3__45: Fuzz [Click "pack-1"]
    Vitamin_C_500mg_3__45 --> Vitamin_C_500mg_3__45: Fuzz [Click "dose-250mg"]
    Vitamin_C_500mg_2__100 --> Vitamin_C_500mg_3__150: Fuzz [Click "pdp-inc"]
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
