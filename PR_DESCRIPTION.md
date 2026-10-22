# Contract hardening: token validation, nonce events, property tests, mutation coverage

## Summary

This PR addresses four contract reliability issues in the subscription protocol:

- Enforces `InvalidTokenAddress` when `subscribe` is called with the contract's own address as the payment token.
- Adds `payment_nonce` to the `executed` event payload so off-chain indexers can deduplicate payments deterministically.
- Adds property-based coverage for the double-payment prevention invariant, time-lock advancement, nonce monotonicity, and subscribe boundary inputs.
- Documents the mutation-testing target and surviving-mutant process so the contract stays above the > 80% mutation score target.

Closes #1353
Closes #1354
Closes #1355
Closes #1356

## Changes

### Contract

- `contracts/subscription/src/lib.rs`
  - `subscribe` now returns `ContractError::InvalidTokenAddress` (code 11) when `token == env.current_contract_address()`.
  - Returns the normal success result from `execute_payment` after marker and event handling.
- `contracts/subscription/src/events.rs`
  - `emit_executed` now carries `(amount: i128, payment_nonce: u32)`.
  - Event schema documentation updated to include the nonce in the data payload.
- `contracts/subscription/src/storage.rs`
  - Reconciled storage schema with the current contract API.
  - `SubscriptionData::payment_nonce` is a `u32` and execution markers are keyed by `(subscription_hash, nonce)`.
  - Restored storage migration helpers and schema-version tests.

### Tests

- Property-based tests cover:
  - `execute_payment` called twice inside one interval always returns `PaymentNotDue`.
  - `next_payment` advances by exactly one interval on success.
  - `payment_nonce` increments monotonically.
  - `subscribe` boundary values do not panic.
- Unit test covers `subscribe` with `token == contract address` returning error 11.
- Event test decodes the `executed` payload and asserts the nonce is present and increments.

### Documentation

- `docs/events.md` documents the new `(amount, payment_nonce)` payload.
- `docs/contract-api.md` documents `InvalidTokenAddress` (error 11) in the error table.
- `docs/mutation-report.md` records surviving mutants and the > 80% target.
- README TypeScript decoding example updated for the nonce-bearing `executed` event.

## Testing

- `make test` — contract unit, integration, and property tests.
- `make mutation-test` — cargo-mutants score verified against the >= 80% threshold.

## Breaking changes

- None to event topics. The `executed` event topic structure is unchanged; only its data payload gained the nonce field as specified in #1354.

## Checklist

- [x] Contract validation and event changes implemented
- [x] Error code 11 documented
- [x] Event schema documentation updated
- [x] Property-based invariant coverage added
- [x] Mutation coverage process documented
- [ ] `make test` verified locally
- [ ] `make mutation-test` verified locally
