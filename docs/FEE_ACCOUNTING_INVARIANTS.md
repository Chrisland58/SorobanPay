# Fee Accounting Invariants

This document describes the protocol fee accounting invariants enforced by the SorobanPay subscription contract and verified by both contract-level and backend integration tests (Issue #1648).

## Base-Unit Fee Formula

All amounts are represented and settled in integer **base units** of the underlying token (`i128` on-chain, `bigint` / decimal string in the backend):

```text
fee = (gross * fee_bps) / 10_000   // integer division (rounds down)
net = gross - fee
```

- **Maximum Fee**: `MAX_FEE_BPS = 500` (5.00%). Calls to `set_protocol_fee` with `fee_bps > 500` are rejected with `ContractError::FeeBpsTooHigh`.
- **Zero Fee**: When `fee_bps == 0` (or when `fee` rounds down to `0` for small amounts), `net == gross`, no transfer is made to the fee collector, and no `fee_collected` event is emitted.
- **Conservation Invariant**: For every executed payment, `fee + net == gross` holds exactly with zero rounding drift.

## Supported Token Decimal Precisions

The invariant is verified across tokens of varying decimal precisions:
- `0` decimals (minimum `1` base unit)
- `2` decimals (fiat-cent scale, odd/non-divisible amounts)
- `6` decimals (USDC-style)
- `7` decimals (Stellar native XLM-style)
- `18` decimals (EVM-bridged token scale)

## Automated Coverage

- **Contract tests**: [`contracts/subscription/tests/fee_collected.rs`](../contracts/subscription/tests/fee_collected.rs)
- **Backend tests**: [`backend/tests/feeAccountingInvariants.test.ts`](../backend/tests/feeAccountingInvariants.test.ts)
