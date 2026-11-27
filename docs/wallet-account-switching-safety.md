# Wallet Account Switching Safety & Lifecycle Boundary Guide

This document establishes operational expectations, frontend architecture, and testing invariants when a user switches accounts in their Stellar browser wallet (e.g., Freighter) while interacting with SorobanPay.

---

## 1. Lifecycle Boundaries & Invariant Guarantees

In multi-account Web3 environments, a user may switch accounts in the browser extension at any time. SorobanPay enforces strict isolation across all transaction lifecycle phases:

```
[Phase 1: Transaction Construction]
- User enters payment/subscription parameters
- Form reads `useWallet().publicKey`
                     |
         (Account switch occurs)
                     v
- Form updates active sender address immediately
- Address allowance & balance re-checks execute against new account
- Previous draft inputs preserved

[Phase 2: In-Flight Signing / Wallet Prompt]
- User clicked "Confirm & Authorize"; prompt displayed in Freighter extension
- Active submit attempt bound to Account A and registered with an `AbortController`
                     |
         (Account switch occurs to Account B)
                     v
- `AbortController.abort()` triggers immediately
- Stale signature response from Account A is discarded upon resolution
- Submission modal resets and `isSubmitting` resets to `false`
- NO second transaction is automatically submitted under Account B

[Phase 3: Transaction Confirmation & Polling]
- Transaction submitted to RPC; awaiting ledger inclusion
                     |
         (Account switch occurs)
                     v
- In-flight poller detached from UI context
- UI updates to show Account B state without associating Account A payment with Account B
```

---

## 2. Invariants Checklist

1. **Zero Accidental Cross-Account Debits**: A transaction constructed for Account A will never be signed or submitted by Account B.
2. **Explicit User Intent for New Account**: Switching accounts always resets the submission pipeline to `idle`, requiring an explicit user click to authorize with the new account.
3. **No Dangling Submission State**: Switching accounts cancels any in-flight signing or confirmation spinners, restoring button interactivity.

---

## 3. Regression Testing Matrix

- **Unit / Component Test**: [frontend/src/components/SubscriptionForm.account-switch.test.tsx](../frontend/src/components/SubscriptionForm.account-switch.test.tsx) validates abort controller signaling and stale promise discard.
- **Browser-Level Test**: [frontend/e2e/11-account-switch-recovery.spec.ts](../frontend/e2e/11-account-switch-recovery.spec.ts) validates browser extension postMessage protocol handling with `switchFreighterAccountInPage`.
