//! Property-based tests for arithmetic overflow and boundary behaviour.
//!
//! Issue #1081: Exercise amount, period, fee, and accumulated-total arithmetic
//! across u128/i128 boundaries to ensure the contract never panics or silently
//! wraps on extreme inputs.
//!
//! Run with:
//!   cd contracts/subscription && cargo test  (full suite)
//!   cd contracts/subscription && cargo test prop_  (property tests only)

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{MAX_AMOUNT, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Shared test harness ──────────────────────────────────────────────────────

struct P {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl P {
    /// Create a harness with subscriber minted `balance` tokens and `allowance`
    /// approved to the contract. Both values are independent.
    fn with_funds(balance: i128, allowance: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

        // Clamp to i64::MAX — Stellar SAC balance ceiling.
        let safe_balance = balance.min(i64::MAX as i128).max(0);
        if safe_balance > 0 {
            StellarAssetClient::new(&env, &token).mint(&subscriber, &safe_balance);
        }

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        let safe_allowance = allowance.min(i64::MAX as i128).max(0);
        if safe_allowance > 0 {
            token::Client::new(&env, &token).approve(
                &subscriber,
                &contract_id,
                &safe_allowance,
                &(env.ledger().sequence() + 100_000_u32),
            );
        }

        P { env, client, subscriber, merchant, token, contract_id }
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn sub_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.subscriber)
    }

    fn mer_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.merchant)
    }
}

// ─── Amount boundary properties ───────────────────────────────────────────────

proptest! {
    /// Any positive amount at or below MAX_AMOUNT must be accepted by subscribe.
    #[test]
    fn prop_amount_at_most_max_amount_accepted(
        amount   in 1_i128..=MAX_AMOUNT,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(r.is_ok(), "amount={amount} ≤ MAX_AMOUNT must be accepted");
    }

    /// Any amount strictly above MAX_AMOUNT must be rejected with AmountTooLarge.
    #[test]
    fn prop_amount_above_max_always_rejected(
        excess in 1_i128..=(i128::MAX - MAX_AMOUNT),
    ) {
        let amount = MAX_AMOUNT + excess;
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &86_400_u64);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::AmountTooLarge))),
            "amount={amount} > MAX_AMOUNT must be rejected"
        );
    }

    /// Any non-positive amount (≤ 0) must be rejected with AmountMustBePositive.
    #[test]
    fn prop_non_positive_amount_always_rejected(
        amount   in i128::MIN..=0_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::AmountMustBePositive))),
            "amount={amount} ≤ 0 must be rejected"
        );
    }

    /// i128::MIN must be rejected cleanly without panic or overflow.
    #[test]
    fn prop_i128_min_never_panics(
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &i128::MIN, &interval);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::AmountMustBePositive))),
            "i128::MIN must be rejected as AmountMustBePositive"
        );
    }

    /// MAX_AMOUNT is the exact upper boundary — must be accepted at every valid interval.
    #[test]
    fn prop_max_amount_exact_boundary_accepted(
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &MAX_AMOUNT, &interval);
        prop_assert!(r.is_ok(), "MAX_AMOUNT must be accepted at every valid interval");
    }
}

// ─── Interval / period boundary properties ───────────────────────────────────

proptest! {
    /// Any interval in [86_400, 31_536_000] must be accepted.
    #[test]
    fn prop_valid_interval_always_accepted(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(r.is_ok(), "interval={interval} is valid but was rejected");
    }

    /// Any interval below 86_400 must be rejected as IntervalTooShort.
    #[test]
    fn prop_short_interval_always_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 0_u64..86_400_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::IntervalTooShort))),
            "interval={interval} < 86400 must be rejected"
        );
    }

    /// Any interval above 31_536_000 must be rejected as IntervalTooLong.
    #[test]
    fn prop_long_interval_always_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 31_536_001_u64..=u64::MAX / 2,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::IntervalTooLong))),
            "interval={interval} > 31536000 must be rejected"
        );
    }

    /// u64::MAX interval must be rejected cleanly without overflow.
    #[test]
    fn prop_u64_max_interval_rejected(
        amount in 1_i128..=1_000_000_i128,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &u64::MAX);
        prop_assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
    }
}

// ─── next_payment overflow guard ─────────────────────────────────────────────

proptest! {
    /// When timestamp + interval would overflow u64, subscribe must return
    /// InvalidTimestamp — never wrap or panic.
    #[test]
    fn prop_next_payment_overflow_returns_invalid_timestamp(
        // Set timestamp near u64::MAX so adding any valid interval overflows.
        delta in 0_u64..86_400_u64,
    ) {
        let p = P::with_funds(0, 0);
        let overflow_ts = u64::MAX - delta;
        p.env.ledger().with_mut(|l| l.timestamp = overflow_ts);

        let r = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_i128, &86_400_u64,
        );
        prop_assert!(
            matches!(r, Err(Ok(ContractError::InvalidTimestamp))),
            "timestamp near u64::MAX must produce InvalidTimestamp"
        );
    }

    /// Zero ledger timestamp must produce InvalidTimestamp for all valid inputs.
    #[test]
    fn prop_zero_timestamp_always_returns_invalid_timestamp(
        amount   in 1_i128..=MAX_AMOUNT,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        p.env.ledger().with_mut(|l| l.timestamp = 0);

        let r = p.client.try_subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::InvalidTimestamp))),
            "zero timestamp must always produce InvalidTimestamp"
        );
    }
}

// ─── Balance / accumulated-total invariants ───────────────────────────────────

proptest! {
    /// After a successful payment: subscriber debited exactly `amount`,
    /// merchant credited exactly `amount`, no tokens created or destroyed.
    #[test]
    fn prop_balance_conservation_on_successful_payment(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let initial = amount * 3;
        let p = P::with_funds(initial, initial);

        let sub_before = p.sub_bal();
        let mer_before = p.mer_bal();
        let total_before = sub_before + mer_before;

        p.client.subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval)
            .expect("subscribe must succeed");
        p.advance(interval + 1);
        p.client.execute_payment(&p.subscriber, &p.merchant)
            .expect("execute_payment must succeed");

        prop_assert_eq!(p.sub_bal(), sub_before - amount, "subscriber must be debited exactly once");
        prop_assert_eq!(p.mer_bal(), mer_before + amount, "merchant must be credited exactly once");
        prop_assert_eq!(p.sub_bal() + p.mer_bal(), total_before, "total supply must be conserved");
    }

    /// After N successful payments the total debited equals N × amount.
    #[test]
    fn prop_accumulated_total_after_n_payments(
        n        in 1_usize..=5_usize,
        amount   in 1_i128..=10_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let total_needed = amount * n as i128;
        let p = P::with_funds(total_needed * 2, total_needed * 2);

        let sub_before = p.sub_bal();
        let mer_before = p.mer_bal();

        p.client.subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval)
            .expect("subscribe must succeed");

        for _ in 0..n {
            p.advance(interval + 1);
            p.client.execute_payment(&p.subscriber, &p.merchant)
                .expect("execute_payment must succeed");
        }

        prop_assert_eq!(p.sub_bal(), sub_before - total_needed,
            "subscriber must be debited N × amount");
        prop_assert_eq!(p.mer_bal(), mer_before + total_needed,
            "merchant must be credited N × amount");
    }

    /// When subscriber balance is zero, every execute_payment must return
    /// TransferFailed and no funds must move.
    #[test]
    fn prop_zero_balance_always_transfer_failed(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);

        p.client.subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval)
            .expect("subscribe must succeed");
        p.advance(interval + 1);

        let r = p.client.try_execute_payment(&p.subscriber, &p.merchant);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::TransferFailed))),
            "zero balance must produce TransferFailed"
        );
        prop_assert_eq!(p.sub_bal(), 0_i128);
        prop_assert_eq!(p.mer_bal(), 0_i128);
    }
}

// ─── Double-payment prevention ────────────────────────────────────────────────

proptest! {
    /// After a successful payment, an immediate second call must return
    /// PaymentNotDue for the entire valid (amount, interval) range.
    #[test]
    fn prop_double_payment_never_succeeds(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(amount * 4, amount * 4);

        p.client.subscribe(&p.subscriber, &p.merchant, &p.token, &amount, &interval)
            .expect("subscribe must succeed");
        p.advance(interval + 1);
        p.client.execute_payment(&p.subscriber, &p.merchant)
            .expect("first payment must succeed");

        let bal_after = p.sub_bal();
        let r = p.client.try_execute_payment(&p.subscriber, &p.merchant);
        prop_assert!(
            matches!(r, Err(Ok(ContractError::PaymentNotDue))),
            "immediate second payment must return PaymentNotDue"
        );
        prop_assert_eq!(p.sub_bal(), bal_after,
            "subscriber balance must not change on rejected double-payment");
    }
}

// ─── Self-subscription rejection ─────────────────────────────────────────────

proptest! {
    /// subscribe(subscriber, subscriber, …) must always return SelfSubscription.
    #[test]
    fn prop_self_subscription_always_rejected(
        amount   in 1_i128..=MAX_AMOUNT,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let p = P::with_funds(0, 0);
        let r = p.client.try_subscribe(
            &p.subscriber, &p.subscriber, &p.token, &amount, &interval,
        );
        prop_assert!(
            matches!(r, Err(Ok(ContractError::SelfSubscription))),
            "self-subscription must always be rejected"
        );
    }
}

// ─── TTL constant sanity checks ───────────────────────────────────────────────

/// TTL constants must satisfy MIN < MAX so extend_ttl calls are meaningful.
#[test]
fn test_ttl_constants_ordering() {
    assert!(
        MIN_TTL_LEDGERS < MAX_TTL_LEDGERS,
        "MIN_TTL_LEDGERS ({MIN_TTL_LEDGERS}) must be less than MAX_TTL_LEDGERS ({MAX_TTL_LEDGERS})"
    );
    // ~30 days at 5 s/ledger
    assert!(MIN_TTL_LEDGERS >= 518_000, "MIN_TTL_LEDGERS should represent at least ~30 days");
    // ~365 days at 5 s/ledger
    assert!(MAX_TTL_LEDGERS >= 6_300_000, "MAX_TTL_LEDGERS should represent at least ~365 days");
}

/// MAX_AMOUNT must be exactly 1e18.
#[test]
fn test_max_amount_value() {
    assert_eq!(MAX_AMOUNT, 1_000_000_000_000_000_000_i128);
}

/// MAX_AMOUNT must be below i64::MAX to avoid SAC balance overflow.
#[test]
fn test_max_amount_below_i64_max() {
    assert!(
        MAX_AMOUNT < i64::MAX as i128,
        "MAX_AMOUNT must be below i64::MAX to avoid SAC balance overflow"
    );
}
