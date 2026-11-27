# Wallet Context Request Cancellation & State Isolation

This operational guide details the request cancellation and identity verification architecture in the SorobanPay frontend. It guarantees that asynchronous API and RPC reads for a previous account or network cannot arrive late and overwrite the active screen.

---

## 1. Problem Overview: Asynchronous Race Conditions

In Web3 applications, users frequently switch accounts or toggle network endpoints while dashboard, payment history, and merchant analytics queries are in flight:

```
Timeline:
T1: Query Started for Account A (Network: Testnet)
T2: User switches Freighter to Account B
T3: Query Started for Account B
T4: Late response for Account A arrives! -> [RISK: Overwrites Account B view!]
T5: Response for Account B arrives
```

Without explicit request cancellation and context-bound validation, Account A's transaction history or merchant subscriptions would momentarily render on Account B's screen, causing data confusion and potential privacy concerns.

---

## 2. Request Lifecycle & Cancellation Flow

SorobanPay implements the `WalletContextRequestManager` in [frontend/src/lib/cancellable_request_manager.ts](../frontend/src/lib/cancellable_request_manager.ts):

1. **Context-Bound Request Initialization**: Each query is tagged with a unique `requestId` and the snapshot of `{ accountId, networkId }`.
2. **Immediate Abort on Context Change**: When `useWallet().publicKey` or network changes, the active `AbortController.abort()` is triggered.
3. **Response Identity Check**: Before executing `setState(...)`, hooks verify:
   ```typescript
   if (!requestManager.isResponseValid(session, currentContext)) {
     return; // Discard late response silently
   }
   ```
4. **Clean Error Suppression**: `AbortError` is identified via `WalletContextRequestManager.isCancellationError()` and swallowed without displaying error toasts or triggering automatic retries.

---

## 3. Invariants & Verification Checklist

- **Strict Isolation**: Responses can only mutate state if `accountId` and `networkId` exactly match the active session.
- **Zero False Errors**: Request cancellation is an expected operational lifecycle event and never renders user-facing error banners.
- **Regression Suite**: Tested in [frontend/src/hooks/walletContextCancellation.test.tsx](../frontend/src/hooks/walletContextCancellation.test.tsx).
