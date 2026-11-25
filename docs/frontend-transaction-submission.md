# Frontend Transaction Submission Safety & Controlled Timing

This operational guide details the transaction submission lifecycle in the SorobanPay frontend application. It specifies client-side duplicate-submission prevention, controlled promise timing during wallet interaction, terminal state handling, and navigation lifecycle cleanup.

---

## 1. Submission Lifecycle & Double-Click Prevention

When initiating transactions (such as subscription authorizations or payments), users interact with external wallet extensions (e.g., Freighter) that present interactive signature prompts with variable user response times.

```
+----------------------------------------------------------------------------------------------------+
| 1. IDLE / READY                                                                                    |
| Form populated; submit button active ("Authorize Subscription").                                   |
+----------------------------------------------------------------------------------------------------+
                                                 |
                                         (User submits form)
                                                 v
+----------------------------------------------------------------------------------------------------+
| 2. MODAL CONFIRMATION & LOCKOUT                                                                    |
| Confirmation modal opens. First click on "Confirm & Authorize" initiates submission.               |
| Modal buttons immediately enter `disabled` state (`isSubmitting = true`).                          |
| Any subsequent rapid duplicate clicks are strictly dropped.                                        |
+----------------------------------------------------------------------------------------------------+
                                                 |
                                     (Prompt sent to Freighter)
                                                 v
+----------------------------------------------------------------------------------------------------+
| 3. IN-FLIGHT PROMISE & ABORT CONTROLLER                                                            |
| An active attempt token is registered with a dedicated `AbortController`.                          |
| Wallet prompt waits for user interaction (seconds to minutes).                                      |
+----------------------------------------------------------------------------------------------------+
                                                 |
                   +-----------------------------+-----------------------------+
                   |                                                           |
       (User Rejects / Closes)                                      (User Approves Signature)
                   v                                                           v
+--------------------------------------+                     +---------------------------------------+
| 4A. TERMINAL REJECTION               |                     | 4B. TERMINAL SUCCESS                  |
| - `isSubmitting` resets to `false`   |                     | - Transaction hash displayed          |
| - Dismissible warning alert shown    |                     | - Form transitions to receipt view    |
| - Form inputs preserved              |                     | - Clean unmount of temporary state    |
| - Primary button re-enabled          |                     +---------------------------------------+
|   for safe user retry                |
+--------------------------------------+
```

---

## 2. Invariants & Guarantees

### Invariant 1: Single Active Submission Intent
Only one transaction construction, simulation, and signing call occurs for any single user confirmation. Re-clicking or double-tapping the button while `isSubmitting === true` is a no-op.

### Invariant 2: Control Availability on Terminal Outcomes
The submission control must never remain permanently disabled following a terminal event:
- **User Rejection ("User declined transaction")**: Button resets to enabled, inline alert explains rejection, and all form values remain intact so the user does not need to re-enter data.
- **Wallet Timeout or Transport Error**: Button resets to enabled, allowing the user to retry after checking wallet connectivity.
- **Contract Simulation Revert**: Revert error is surfaced in the alert panel, and inputs are unlocked for correction.

### Invariant 3: Clean Lifecycle Cleanup on Navigation
If the user navigates away from the submission screen while a wallet prompt is awaiting signature:
- The active `AbortController.abort()` is invoked immediately on unmount.
- Any subsequent late resolution from the wallet extension is ignored.
- No React state update is performed on unmounted component instances.

---

## 3. Automated Test Coverage

The test suite in `frontend/src/components/SubscriptionForm.duplicate-click.test.tsx` validates:
- Repeated rapid clicks on the confirm button result in exactly one execution of `buildSignAndSubmitSubscribe`.
- Controlled promise rejection restores button state and preserves form field values.
- Clean retry path after rejection transitions to terminal success.
- Unmounting the component triggers the `AbortSignal` to prevent stale background completion.
