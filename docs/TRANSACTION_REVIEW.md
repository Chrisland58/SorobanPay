# Transaction Review Summary

Before signing a subscription transaction, `TransactionReviewSummary` (`frontend/src/components/TransactionReviewSummary.tsx`) presents a complete, mobile-friendly breakdown of all material costs and recipient details:

- **Recipient (Merchant)** and **Token** (symbol and contract address)
- **Recurrence Schedule** (human-readable interval and seconds)
- **Subscription Amount** (**Fixed**, formatted to consistent token precision, default 7 decimals)
- **Protocol Fee** (**Fixed**, formatted to consistent token precision)
- **Network Fee** (**Estimated** in XLM, with `aria-live="polite"` updates for loading and fallback states when estimation is unavailable)
- **Total Per Payment** combining fixed token costs and noting the estimated network fee

All material cost information remains visible on small screens (`flex-col sm:flex-row`), and action buttons (`Back`, `Confirm & Sign`) are keyboard-navigable with visible focus rings.
