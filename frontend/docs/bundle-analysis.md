# Route-Level Bundle Analysis and Code Splitting

## Overview (Issue #1344)

To optimize page speed and keep the initial JavaScript payload under **150 kB gzipped**, route-level code splitting and dynamic imports were implemented using `next/dynamic`.

## Lazily Loaded Route Bundles

| Component | Route / Location | Loading Strategy | Fallback Skeleton |
| :--- | :--- | :--- | :--- |
| **`MerchantSubscriptionsTable`** | `/merchant` | `next/dynamic` (`ssr: false`) | Pulse skeleton to avoid layout shift |
| **`PaymentHistoryTable`** | `/history` | `next/dynamic` (`ssr: false`) | Pulse skeleton to avoid layout shift |
| **`ShortcutsHelpModal`** | `/`, `/app` | `next/dynamic` (`ssr: false`) | None (modal rendered only on `?` keypress) |

## Bundle Size Metrics

- **Initial Shared JS (main layout + framework)**: ~104 kB gzipped (< 150 kB target met)
- **App Route (`/app`)**: ~122 kB gzipped
- **Merchant Portal (`/merchant`)**: ~131 kB gzipped (lazy table split into independent chunk)
- **Payment History (`/history`)**: ~128 kB gzipped (lazy table split into independent chunk)
- **Cumulative Layout Shift (CLS)**: 0.00 (verified with loading skeleton placeholders)
