# Client Support Diagnostics & Privacy Notice

This guide establishes the specification for client-side support diagnostics in SorobanPay. It enables users and support engineers to quickly capture the runtime environment needed to reproduce wallet or network anomalies without compromising privacy or leaking credentials.

---

## 1. Diagnostics Payload Schema

The client diagnostics payload contains strictly non-sensitive runtime information:

| Field | Type | Description | Example |
|---|---|---|---|
| `appVersion` | String | Deployed frontend release version | `"1.0.0"` |
| `browserSummary` | String | Parsed browser family (Chrome, Firefox, Safari, Edge) | `"Chrome"` |
| `selectedNetwork` | String | Active Stellar network target | `"Testnet"` or `"Mainnet"` |
| `contractIdentifier` | String | Public Soroban subscription contract address | `"CA..."` |
| `rpcEndpoint` | String | Sanitized RPC gateway host | `"https://soroban-testnet.stellar.org"` |
| `connectedWalletAddress` | String \| null | Truncated public address (`G...`) or null | `"GBBB...BBBB"` |
| `timestamp` | String | ISO-8601 generation time | `"2026-11-26T07:00:00.000Z"` |

---

## 2. Privacy & Secret Exclusion Invariants

1. **Strict Exclusion of Private Seeds**: Stellar secret keys (format `S[A-Z2-7]{55}`) are never read, stored, or rendered.
2. **No Access Tokens or Session Cookies**: Authorization headers (`Bearer ...`), JWTs, and session tokens are strictly excluded.
3. **No Raw Provider Internals**: Window objects such as `window.freighter` or internal RPC response buffers are never exported.
4. **Credential Stripping in URLs**: If an RPC endpoint URL contains inline basic authentication credentials (`https://user:pass@host`), credentials are automatically redacted to `https://***:***@host`.

---

## 3. UI Component & Copy Interaction

The component [frontend/src/components/ClientDiagnosticsCard.tsx](../frontend/src/components/ClientDiagnosticsCard.tsx) displays:
- A syntax-highlighted JSON preview.
- A single-click "Copy Diagnostics" button.
- An explicit privacy assurance notice.
