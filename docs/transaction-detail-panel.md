# Transaction Detail Panel

The `TransactionDetailPanel` component (`frontend/src/components/TransactionDetailPanel.tsx`) provides users and support staff with a searchable, accessible view of Stellar transaction details in one location.

## Displayed Fields

Only explicit, non-sensitive display fields are rendered and searchable:

- **Transaction Hash** (`txHash`) — monospace, copyable
- **Ledger Time** (`ledgerTime`) — formatted in UTC
- **Account** (`account`) — monospace, copyable
- **Token Amount** (`tokenAmount` + optional `tokenSymbol`) — copyable
- **Status** (`status`) — rendered via `StatusBadge`

Sensitive internal identifiers (such as `internalId`, `sessionToken`, `secretKey`, `apiKey`, or `privateKey`) are never rendered or indexed by the search filter.

## Network-Bound Explorer Links

- Explorer URLs are generated via `buildExplorerTxUrl(txHash, network)` using Stellar Expert (`testnet` or `public` for `mainnet`/`public`).
- When `activeNetwork` is provided and does not match the transaction record's `network`, the explorer link is blocked and an alert is displayed so links cannot point to a different network than the transaction record.

## Accessibility & Copy Feedback

- Each copyable field uses `CopyButton` for one-click clipboard copy with visual `"Copied!"` feedback and `execCommand` fallback.
- Copy actions update an `aria-live="polite"` status region (`Copied <Field> to clipboard.`) for screen-reader announcements.
