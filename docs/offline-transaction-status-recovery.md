# Offline Transaction Status Recovery & Bounded Polling

This operational guide details how SorobanPay handles temporary client offline periods after a transaction has been signed and submitted to the Stellar consensus network.

---

## 1. Problem Overview & Risk Mitigation

In mobile and transient Web3 environments, a user may sign a transaction in Freighter and lose network connectivity before the application receives a final receipt confirmation from the RPC node.

> [!CAUTION]
> **Never Resubmit on Network Disconnect**:
> If network connectivity drops while a transaction is in-flight, resubmitting the transaction risks creating duplicate payments or collisions on the account sequence number. The client must persist the transaction hash and resume status checks (`getTransaction`) once connectivity returns.

---

## 2. State Machine & Recovery Lifecycle

```
[1. INITIATION & PERSISTENCE]
User approves signature -> transaction submitted to RPC.
Transaction hash persisted in `sessionStorage` (`sorobanpay_pending_tx_<hash>`).
                   |
     (Browser enters offline state)
                   v
[2. OFFLINE PAUSE]
Window `offline` event triggered.
Poller pauses active setTimeout loop.
Status transitions to `offline` with an informational indicator.
Stored record marked as `status: "offline"`.
                   |
     (Connectivity restored)
                   v
[3. BOUNDED RESUME]
Window `online` event triggered.
Poller restores `status: "confirming"` and initiates query probe.
Bounded exponential backoff resumes:
  Delay = min(10,000ms, 2,000ms * 1.5^attempt)
                   |
                   v
[4. TERMINAL STATE CLEANUP]
Transaction reaches `SUCCESS`, `FAILED`, or `TIMEOUT/EXPIRED`.
Resume record is purged from `sessionStorage`.
```

---

## 3. Operational Invariants

1. **Offline is Distinct from Failure**: Disconnection never displays a "Transaction Failed" banner; it displays "Offline - Polling Paused".
2. **Strict Backoff Ceiling**: Maximum polling delay is bounded at 10,000 ms to prevent unbounded wait times or RPC flooding upon reconnect.
3. **Storage Hygiene**: Finalized or expired transactions immediately purge resume keys from storage.
