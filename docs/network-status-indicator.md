# Network Status Indicator

`NetworkStatusIndicator` (`frontend/src/components/NetworkStatusIndicator.tsx`) provides a persistent, non-blocking status pill in `PageHeader` so users can immediately see their connection and network state without waiting for a transaction failure.

## States

| State | `data-network-state` | Trigger | Recovery Action |
| --- | --- | --- | --- |
| Offline | `offline` | `navigator.onLine === false` | `Retry` (re-checks connectivity / invokes `onRetry`) |
| Unsupported | `unsupported` | App or wallet network is not `Mainnet`, `Testnet`, or `Futurenet` | `Recheck` (re-queries Freighter network / invokes `onRecheck`) |
| Wallet Mismatch | `wallet-mismatch` | Freighter network differs from configured app network | `Switch to <AppNetwork>` (re-checks Freighter network / invokes `onRecheck`) |
| Testnet | `testnet` | Online and connected to a test network (`Testnet` / `Futurenet`) | None |
| Mainnet | `mainnet` | Online and connected to `Mainnet` | None |

## Responsive Behavior

- On narrow viewports (`< sm`), the indicator displays a compact label (`Offline`, `Unsupported`, `Mismatch`, or the network name) alongside the status dot and recovery button so it remains understandable without obscuring primary actions.
- On `sm:` and wider viewports, it displays the full label (e.g., `Mismatch: Mainnet ≠ Testnet`).
