# Frontend Asynchronous State Separation Guide

This guide establishes the architectural model for isolating asynchronous loading, error, and recovery states in SorobanPay frontend workflows.

---

## 1. Problem Statement & Design Objectives

Historically, monolithic loading flags (e.g. a single `loading: boolean`) conflated disparate operations:
1. **Background Reads**: Querying token metadata, checking account balances, or refreshing subscriber invoices.
2. **Interactive Wallet Prompts**: Awaiting user interaction with the Freighter browser extension.
3. **On-Chain Mutations**: Simulating transaction footprint, submitting transaction envelope XDR, and polling ledger confirmation.

When a background read failed or was slow, monolithic flags either froze submission buttons or falsely attributed read timeouts to transaction failure.

---

## 2. Multi-Stage Asynchronous State Model

SorobanPay partitions asynchronous workflows into three decoupled state domains:

```
+---------------------------------------------------------------------------------------------------+
| 1. DATA REFRESH / READ STATE (`dataRefresh`)                                                      |
| Statuses: `idle` | `loading` | `success` | `error`                                                |
| Invariant: Failure here displays inline advisory warning only; NEVER blocks user write actions.   |
+---------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------+
| 2. WALLET INTERACTION STATE (`walletPrompt`)                                                      |
| Statuses: `idle` | `prompting` | `approved` | `rejected` | `timeout`                              |
| Invariant: Only `prompting` blocks submission. Terminal rejection immediately re-enables inputs.  |
+---------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------+
| 3. ON-CHAIN EXECUTION STATE (`transaction`)                                                       |
| Statuses: `idle` | `simulating` | `submitting` | `confirming` | `success` | `failed`               |
| Invariant: Transaction failure requires explicit on-chain revert or RPC rejection.                |
| Unrelated background read errors will NEVER alter this state.                                     |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Recovery Transitions

| Trigger Event | Affected State | Recovery Action |
|---|---|---|
| Background balance read timeout | `dataRefresh` $\rightarrow$ `error` | Form inputs remain enabled; user can submit or click "Retry Balance Check". |
| User rejects Freighter signature | `walletPrompt` $\rightarrow$ `rejected` | Warning banner displayed; form inputs preserved; button re-enabled for retry. |
| In-flight transaction confirmation | `transaction` $\rightarrow$ `confirming` | Progress bar active; concurrent reads continue without interfering with status. |
| Transaction confirmed on-chain | `transaction` $\rightarrow$ `success` | Displays transaction receipt; triggers background cache invalidation. |
