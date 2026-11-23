# Settlement Accounting

Each payment uses explicit fee accounting to prevent ambiguity.

## Settlement Breakdown

Every successful `execute_payment` call calculates and emits a `Settlement`:

| Field | Description |
|-------|-------------|
| `gross_amount` | Full amount charged to subscriber (base token units) |
| `protocol_fee` | Fee deducted by protocol (0 at current 0 bps rate) |
| `net_amount` | Amount received by merchant (gross - protocol_fee) |

## Invariant

For every payment: `gross_amount == net_amount + protocol_fee`

This invariant holds for zero fees (current), maximum amounts, and any future non-zero fee rate.

## Events

A successful payment emits two events:
1. `payment_settled(subscriber, merchant, token)` → `Settlement { gross, fee, net }`
2. `executed(subscriber, merchant, token)` → `gross_amount`

Amounts are reported in base token units without rounding.

## Current Fee

The protocol fee is currently **0 bps** (fee-free). The `PROTOCOL_FEE_BPS` constant in `storage.rs` controls this. When the fee is 0, `protocol_fee = 0` and `net_amount = gross_amount`.

## Checked Arithmetic

All fee calculations use Rust checked arithmetic (`checked_mul`, `checked_div`, `checked_sub`). An overflow returns `ContractError::SettlementOverflow` instead of panicking or silently wrapping.
