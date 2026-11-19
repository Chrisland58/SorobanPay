# Transaction Lifecycle Accessibility

## Overview

Asynchronous wallet and ledger updates are announced to assistive technology via scoped ARIA live regions in:

- `frontend/src/components/TransactionAnnouncer.tsx`
- `frontend/src/components/TransactionProgressIndicator.tsx`

## Live Region Scoping & Deduplication

- **Polite announcements (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`)**:
  - `signing`: *"Transaction awaiting signature. Check your wallet extension to approve or reject."*
  - `submitted`: *"Transaction submitted to the network. Waiting for on-chain confirmation."*
  - `confirmed`: *"Transaction confirmed on-chain. You can view the receipt or continue."*
- **Assertive announcements (`role="alert"`, `aria-live="assertive"`, `aria-atomic="true"`)**:
  - `failed`: *"Transaction failed. [Error details]. Review the error details and try again."*
- **Polling deduplication**:
  - `TransactionAnnouncer` tracks the last announced state key and only updates the live region when the lifecycle state (or failure detail) actually changes.
  - `TransactionProgressIndicator` scopes `role="status"` to the status summary rather than the outer container so countdown/polling updates (`estimatedTimeRemaining`, `isRefreshing`) do not re-trigger screen-reader announcements.

## Automated Coverage

- `frontend/src/components/TransactionAnnouncer.test.tsx`: verifies `idle`, `signing`, `submitted`, `confirmed`, `failed`, polling deduplication, and custom `nextAction` overrides.
- `frontend/src/components/TransactionProgressIndicator.test.tsx`: verifies loading, success, failure, and unknown/timeout status announcements and accessible controls.

## Manual Screen-Reader Test Notes

1. **VoiceOver (macOS + Safari/Chrome)** or **NVDA (Windows + Firefox/Chrome)**:
   - Initiate a subscription or payment transaction.
   - Verify `signing` is announced once when the wallet prompt opens, without repeating.
   - Approve in the wallet and verify `submitted` is announced once while polling runs.
   - Wait for ledger confirmation and verify `confirmed` is announced once with next-action guidance.
   - Reject a signature or trigger an RPC error and verify `failed` interrupts via `role="alert"` with the error message and retry guidance.
