# Payment History URL Filter Persistence

Payment history filters are synchronized with the page URL query string via `usePaymentHistoryFilters` (`frontend/src/hooks/usePaymentHistoryFilters.ts`).

## Supported Query Parameters

| Query Key | Filter Field | Validation Rules |
| --- | --- | --- |
| `from` | `dateFrom` | Valid `YYYY-MM-DD` calendar date |
| `to` | `dateTo` | Valid `YYYY-MM-DD` calendar date |
| `types` | `eventTypes` | Comma-separated subset of `executed`, `payment_transfer_failure`, `cancel`, `all` |
| `merchant` | `merchantSearch` | Trimmed non-empty string |
| `minAmt` | `amountMin` | Finite non-negative number |
| `maxAmt` | `amountMax` | Finite non-negative number |
| `token` | `tokenFilter` | Trimmed non-empty string |

## Behavior

- **Invalid values**: Unrecognized or malformed query values are safely ignored on parse so they do not produce an empty misleading result set.
- **Unrelated route state**: Updating or clearing filters only modifies the supported filter query keys and preserves any unrelated query parameters on the route.
- **Browser navigation**: Changes to `searchParams` from browser back/forward navigation automatically restore the corresponding filter state.
