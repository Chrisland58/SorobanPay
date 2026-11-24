# Subscription pause/resume, wallet persistence, and dependency audit fixes

## Summary

This PR addresses four issues across the contract and frontend:

- Completes the pause/resume flow, including auto-resume and paused-subscription handling.
- Returns a unique, documented `SameMerchant` error for no-op subscription transfers.
- Makes `cargo audit` pass with justified, narrowly scoped advisory suppressions and fixes the CI audit commands.
- Persists the Freighter wallet session across reloads with stale-session invalidation and race protection.

Closes #1348
Closes #1357
Closes #1315
Closes #1323

## Changes

### Contract: pause/resume (`#1348`)

- `pause_subscription` keeps requiring subscriber auth, rejects double pauses with `SubscriptionPaused`, and stores an optional `paused_until`.
- `resume_subscription` clears pause state, recomputes `next_payment`, persists it, and emits `resumed`.
- `execute_payment` now auto-resumes a timed pause when `paused_until` has elapsed, persists the cleared state, and emits `resumed`.
- `batch_execute_payment` skips paused subscriptions instead of charging them.
- Pause/resume entry points and `SubscriptionData` pause fields are documented in `docs/contract-api.md`.

### Contract: error codes and `SameMerchant` (`#1357`)

- Error discriminants are unique across the contract.
- `SubscriptionPaused` is code `12`; `SameMerchant` is code `20`.
- `transfer_subscription` returns `SameMerchant` when `old_merchant == new_merchant`.
- Error tables in `docs/contract-api.md` and `README.md` now match the enum, including codes through `25` (`FeeBpsTooHigh`).

### Security audit (`#1315`)

- Repaired both audit config files (`audit.toml` and `.cargo/audit.toml`) to use valid cargo-audit 0.22 syntax.
- `cd contracts/subscription && cargo audit` now exits `0`.
- Remaining advisories are ignored with explicit justifications because they are pinned by `soroban-env-host` 20:
  - `RUSTSEC-2024-0344` — `curve25519-dalek` 4.1.2
  - `RUSTSEC-2026-0009` — `time` 0.3.44
  - `RUSTSEC-2026-0097` — `rand` 0.8.5
  - `RUSTSEC-2025-0056` — unmaintained `adler`
  - `RUSTSEC-2024-0436` — unmaintained `paste`
- CI audit steps now run from `contracts/subscription`; the unsupported `cargo audit --manifest-path` invocation was removed.

### Frontend: wallet session persistence (`#1323`)

- Persists the connected public key in `sessionStorage` under `sorobanpay_wallet_public_key`.
- Silently restores an existing Freighter session on mount via `restoreWalletSession()`, which never prompts for access.
- Invalidates stale sessions when Freighter is unavailable or the active account changed.
- Clears the cache on disconnect and on failed/stale restores.
- Guards against races where a pending silent restore could overwrite an explicit connect or reconnect after disconnect.
- Adds unit coverage for restore, invalidation, failure, unavailable-extension, and race paths.

## Testing

- `cargo check --offline --manifest-path contracts/subscription/Cargo.toml` — passed.
- `cd contracts/subscription && cargo audit` — exit `0`.
- Frontend Jest/TypeScript checks were not run because `frontend/node_modules` is not installed in this workspace.
- Full contract tests remain blocked by pre-existing merge-damaged test modules unrelated to this PR.

## Breaking changes

- None. The existing pause/resume entry-point signatures and event topics are unchanged.
