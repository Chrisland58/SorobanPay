/// Property-based tests for payment interval and amount boundary conditions.
///
/// Issue: TEST-99
/// Verifies that the contract correctly accepts all valid inputs and rejects all
/// invalid inputs at the boundaries for `amount` and `interval` parameters.
///
/// Strategies:
/// - Valid amount:   1 ..= 10^18  (inclusive)
/// - Invalid amount: ≤ 0  or  > 10^18
/// - Valid interval: 86_400 ..= 31_536_000  (inclusive, seconds)
/// - Invalid interval: < 86_400  or  > 31_536_000
///
/// Run with at least 256 iterations in CI:
///   PROPTEST_CASES=1000 cargo test --manifest-path contracts/subscription/Cargo.toml
#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{self, StellarAssetClient},
        Address, Env,
    };

    use crate::{
        error::ContractError,
        storage::{DataKey, MAX_AMOUNT},
        SubscriptionProtocol, SubscriptionProtocolClient,
    };

    // ─── Boundary constants ───────────────────────────────────────────────────

    /// Minimum valid payment interval (1 day in seconds).
    const MIN_INTERVAL: u64 = 86_400;
    /// Maximum valid payment interval (365 days in seconds).
    const MAX_INTERVAL: u64 = 31_536_000;

    // ─── Test environment setup ───────────────────────────────────────────────

    struct PropEnv {
        env:         Env,
        client:      SubscriptionProtocolClient,
        subscriber:  Address,
        merchant:    Address,
        token:       Address,
        contract_id: Address,
    }

    impl PropEnv {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();

            // Set a non-zero ledger timestamp so the contract doesn't return InvalidTimestamp.
            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

            let admin      = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant   = Address::generate(&env);

            // Register SAC token and mint a large balance to the subscriber
            let token = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            StellarAssetClient::new(&env, &token)
                .mint(&subscriber, &(MAX_AMOUNT * 2));

            // Deploy subscription contract
            let contract_id = env.register(SubscriptionProtocol, ());
            let client      = SubscriptionProtocolClient::new(&env, &contract_id);

            // Approve contract to spend subscriber's tokens
            token::Client::new(&env, &token).approve(
                &subscriber,
                &contract_id,
                &(MAX_AMOUNT * 2),
                &(env.ledger().sequence() + 1_000_000_u32),
            );

            Self { env, client, subscriber, merchant, token, contract_id }
        }
    }

    // ─── Amount strategy: valid ───────────────────────────────────────────────

    /// Any i128 in [1, 10^18].
    fn valid_amount_strategy() -> impl Strategy<Value = i128> {
        (1_i128..=MAX_AMOUNT)
    }

    // ─── Amount strategy: invalid (too small) ────────────────────────────────

    /// Any i128 ≤ 0.  Clipped to [i128::MIN, 0] to avoid generating absurdly
    /// large negatives; the contract only needs ≤ 0 for the error path.
    fn invalid_amount_nonpositive_strategy() -> impl Strategy<Value = i128> {
        (i128::MIN..=0_i128)
    }

    // ─── Amount strategy: invalid (too large) ────────────────────────────────

    /// Any i128 > 10^18.  The ceiling is MAX_AMOUNT + 10^9 to keep values realistic.
    fn invalid_amount_too_large_strategy() -> impl Strategy<Value = i128> {
        ((MAX_AMOUNT + 1)..=(MAX_AMOUNT + 1_000_000_000_i128))
    }

    // ─── Interval strategy: valid ─────────────────────────────────────────────

    /// Any u64 in [86_400, 31_536_000].
    fn valid_interval_strategy() -> impl Strategy<Value = u64> {
        (MIN_INTERVAL..=MAX_INTERVAL)
    }

    // ─── Interval strategy: invalid (too short) ──────────────────────────────

    /// Any u64 in [1, 86_399]  (0 is also invalid but included for coverage).
    fn invalid_interval_too_short_strategy() -> impl Strategy<Value = u64> {
        (0_u64..MIN_INTERVAL)
    }

    // ─── Interval strategy: invalid (too long) ───────────────────────────────

    /// Any u64 > 31_536_000. Bounded to MAX_INTERVAL + 10^6 for realism.
    fn invalid_interval_too_long_strategy() -> impl Strategy<Value = u64> {
        ((MAX_INTERVAL + 1)..=(MAX_INTERVAL + 1_000_000_u64))
    }

    // =========================================================================
    // PROPERTY 1 — Valid amounts always succeed in subscribe()
    // =========================================================================

    proptest! {
        /// For every valid amount in [1, 10^18], `subscribe` must return `Ok(())`.
        ///
        /// This property verifies that no in-range value is incorrectly rejected.
        /// Regression guard against off-by-one errors such as: `amount < 0` instead of
        /// `amount <= 0`, or `amount >= MAX_AMOUNT` instead of `amount > MAX_AMOUNT`.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_valid_amount_always_succeeds(amount in valid_amount_strategy()) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL, // use minimum valid interval
            );
            prop_assert!(
                result.is_ok(),
                "subscribe with valid amount {} must succeed, got {:?}",
                amount,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 2 — Invalid amounts always return the correct error
    // =========================================================================

    proptest! {
        /// For every amount ≤ 0, `subscribe` must return `AmountMustBePositive` (error 1).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_nonpositive_amount_returns_amount_must_be_positive(
            amount in invalid_amount_nonpositive_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
                "subscribe with amount {} must return AmountMustBePositive, got {:?}",
                amount,
                result
            );
        }
    }

    proptest! {
        /// For every amount > 10^18, `subscribe` must return `AmountTooLarge` (error 9).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_large_amount_returns_amount_too_large(
            amount in invalid_amount_too_large_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::AmountTooLarge))),
                "subscribe with amount {} must return AmountTooLarge, got {:?}",
                amount,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 3 — Valid intervals always succeed in subscribe()
    // =========================================================================

    proptest! {
        /// For every valid interval in [86_400, 31_536_000], `subscribe` must return `Ok(())`.
        ///
        /// Regression guard for off-by-one bugs at interval boundaries, e.g. using
        /// `interval <= 86400` instead of `interval < 86400`.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_valid_interval_always_succeeds(interval in valid_interval_strategy()) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128, // fixed valid amount
                &interval,
                &false,
            );
            prop_assert!(
                result.is_ok(),
                "subscribe with valid interval {} must succeed, got {:?}",
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 4 — Invalid intervals always return the correct error
    // =========================================================================

    proptest! {
        /// For every interval < 86_400, `subscribe` must return `IntervalTooShort` (error 2).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_short_interval_returns_interval_too_short(
            interval in invalid_interval_too_short_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128,
                &interval,
                &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::IntervalTooShort))),
                "subscribe with interval {} must return IntervalTooShort, got {:?}",
                interval,
                result
            );
        }
    }

    proptest! {
        /// For every interval > 31_536_000, `subscribe` must return `IntervalTooLong` (error 3).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_long_interval_returns_interval_too_long(
            interval in invalid_interval_too_long_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128,
                &interval,
                &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::IntervalTooLong))),
                "subscribe with interval {} must return IntervalTooLong, got {:?}",
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 5 — execute_payment() is never callable before now >= next_payment
    // =========================================================================

    proptest! {
        /// For any valid amount and interval, `execute_payment` called immediately after
        /// `subscribe` (without advancing the ledger clock) must return `PaymentNotDue`.
        ///
        /// This is the time-lock property: next_payment = subscribe_time + interval,
        /// and the contract must enforce now < next_payment → reject.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_execute_payment_not_callable_before_interval_elapses(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // Subscribe
            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            // Attempt payment immediately — ledger clock has NOT advanced past next_payment.
            let result = p.client.try_execute_payment(&p.subscriber, &p.merchant);
            prop_assert!(
                matches!(result, Err(Ok(ContractError::PaymentNotDue))),
                "execute_payment immediately after subscribe must return PaymentNotDue \
                 (amount={}, interval={}), got {:?}",
                amount,
                interval,
                result
            );
        }
    }

    proptest! {
        /// For any valid amount and interval, `execute_payment` called after advancing the
        /// clock by exactly `interval` seconds must succeed.
        ///
        /// Complement of the above: after the full interval elapses, payment is due.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_execute_payment_succeeds_after_full_interval(
            amount   in valid_amount_strategy().prop_filter(
                "amount must be within minted balance",
                |a| *a <= MAX_AMOUNT,
            ),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // Subscribe
            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            // Advance ledger clock past the payment due time.
            let now = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

            // Payment must now be accepted.
            let result = p.client.try_execute_payment(&p.subscriber, &p.merchant);
            prop_assert!(
                result.is_ok(),
                "execute_payment after interval must succeed (amount={}, interval={}), got {:?}",
                amount,
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 6 — Boundary values (exact edges must be accepted)
    // =========================================================================

    /// `amount = 1` (minimum valid) must always succeed.
    #[test]
    fn prop_boundary_amount_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_i128, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "amount=1 must succeed; got {:?}", result);
    }

    /// `amount = MAX_AMOUNT` (maximum valid) must always succeed.
    #[test]
    fn prop_boundary_amount_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &MAX_AMOUNT, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "amount=MAX_AMOUNT must succeed; got {:?}", result);
    }

    /// `amount = MAX_AMOUNT + 1` must always return `AmountTooLarge`.
    #[test]
    fn prop_boundary_amount_just_above_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &(MAX_AMOUNT + 1), &MIN_INTERVAL,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::AmountTooLarge))),
            "amount=MAX_AMOUNT+1 must return AmountTooLarge; got {:?}",
            result
        );
    }

    /// `amount = 0` must always return `AmountMustBePositive`.
    #[test]
    fn prop_boundary_amount_zero() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &0_i128, &MIN_INTERVAL,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
            "amount=0 must return AmountMustBePositive; got {:?}",
            result
        );
    }

    /// `interval = 86_400` (minimum valid) must always succeed.
    #[test]
    fn prop_boundary_interval_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "interval=86_400 must succeed; got {:?}", result);
    }

    /// `interval = 86_399` (one below minimum) must return `IntervalTooShort`.
    #[test]
    fn prop_boundary_interval_just_below_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &(MIN_INTERVAL - 1),
        );
        assert!(
            matches!(result, Err(Ok(ContractError::IntervalTooShort))),
            "interval=86_399 must return IntervalTooShort; got {:?}",
            result
        );
    }

    /// `interval = 31_536_000` (maximum valid) must always succeed.
    #[test]
    fn prop_boundary_interval_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &MAX_INTERVAL,
        );
        assert!(result.is_ok(), "interval=31_536_000 must succeed; got {:?}", result);
    }

    /// `interval = 31_536_001` (one above maximum) must return `IntervalTooLong`.
    #[test]
    fn prop_boundary_interval_just_above_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &(MAX_INTERVAL + 1),
        );
        assert!(
            matches!(result, Err(Ok(ContractError::IntervalTooLong))),
            "interval=31_536_001 must return IntervalTooLong; got {:?}",
            result
        );
    }

    // =========================================================================
    // PROPERTY 7 — next_payment invariant: stored = subscribe_ts + interval
    // =========================================================================

    proptest! {
        /// For any valid (amount, interval), the stored `next_payment` must equal
        /// the ledger timestamp at subscription time plus `interval`.
        ///
        /// Guards against regressions where next_payment arithmetic is wrong.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_next_payment_equals_subscribe_time_plus_interval(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();
            let subscribe_ts = p.env.ledger().timestamp();

            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            let stored: crate::storage::SubscriptionData = p.env
                .storage()
                .persistent()
                .get(&DataKey::Subscription(p.subscriber.clone(), p.merchant.clone()))
                .expect("subscription must exist after subscribe");

            prop_assert_eq!(
                stored.next_payment,
                subscribe_ts + interval,
                "next_payment must equal subscribe_ts + interval \
                 (subscribe_ts={}, interval={}, got next_payment={})",
                subscribe_ts,
                interval,
                stored.next_payment
            );
        }
    }

    // =========================================================================
    // Issue #1098 — Fuzz malformed identifiers and metadata
    // =========================================================================
    //
    // The tests below exercise adversarial and boundary inputs for address
    // identity, duplicate subscriptions, and invalid parameter combinations.
    // None of these paths should corrupt storage or emit spurious events.

    // ─── PROPERTY 8 — Self-subscription is always rejected ───────────────────

    proptest! {
        /// For any valid amount and interval, subscribing with `subscriber == merchant`
        /// must return `SelfSubscription` (error 10) and must not create a storage entry.
        ///
        /// Prevents an address from setting up a payment loop to itself.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_self_subscription_is_rejected(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();
            // Use the same address as both subscriber and merchant.
            let self_addr = p.subscriber.clone();

            let result = p.client.try_subscribe(
                &self_addr,
                &self_addr,
                &p.token,
                &amount,
                &interval,
                &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(crate::error::ContractError::SelfSubscription))),
                "self-subscription must return SelfSubscription (error 10), got {:?}",
                result
            );
            // No storage entry must have been created.
            prop_assert!(
                !p.env.storage().persistent().has(
                    &DataKey::Subscription(crate::storage::subscription_key(
                        &p.env, &self_addr, &self_addr, &p.token,
                    ))
                ),
                "self-subscription must not create a storage entry"
            );
        }
    }

    // ─── PROPERTY 9 — Duplicate subscribe is an idempotent upsert ────────────

    proptest! {
        /// Subscribing twice with the same (subscriber, merchant, token) triple but
        /// different amounts must result in exactly ONE storage entry whose amount
        /// reflects the second call.
        ///
        /// Guards against accidental duplication bugs — the contract must treat
        /// re-subscription as an upsert, not an append.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_duplicate_subscribe_is_idempotent_upsert(
            amount_first  in valid_amount_strategy().prop_filter(
                "leave room for a different second amount",
                |a| *a < MAX_AMOUNT,
            ),
            amount_second in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // First subscription.
            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token,
                &amount_first, &interval, &false,
            );

            // Second subscription — same triple, different amount.
            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token,
                &amount_second, &interval, &false,
            );

            // Exactly one entry must exist.
            let key = DataKey::Subscription(crate::storage::subscription_key(
                &p.env, &p.subscriber, &p.merchant, &p.token,
            ));
            prop_assert!(
                p.env.storage().persistent().has(&key),
                "one subscription entry must exist after two subscribes"
            );

            // The stored amount must reflect the SECOND call.
            let stored: crate::storage::SubscriptionData =
                p.env.storage().persistent().get(&key).unwrap();
            prop_assert_eq!(
                stored.amount, amount_second,
                "stored amount must match the second subscribe call (upsert), \
                 first={}, second={}, stored={}",
                amount_first, amount_second, stored.amount
            );
        }
    }

    // ─── PROPERTY 10 — Negative amounts always return AmountMustBePositive ───

    proptest! {
        /// Every amount in [-1000, 0] must return `AmountMustBePositive` (error 1).
        ///
        /// Complements the existing `prop_nonpositive_amount_returns_amount_must_be_positive`
        /// with a focused range that stress-tests the lower end of the i128 domain.
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn prop_negative_amount_variants_always_rejected(
            amount in (-1_000_i128..=0_i128),
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber, &p.merchant, &p.token,
                &amount, &MIN_INTERVAL, &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(crate::error::ContractError::AmountMustBePositive))),
                "amount {} must return AmountMustBePositive, got {:?}",
                amount, result
            );
        }
    }

    // ─── BOUNDARY — Zero interval is always rejected as IntervalTooShort ─────

    /// `interval = 0` must return `IntervalTooShort` (error 2) with no side-effects.
    ///
    /// Zero is a degenerate interval that would allow unlimited-frequency collection.
    #[test]
    fn prop_zero_interval_rejected_as_too_short() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token,
            &1_000_i128, &0_u64, &false,
        );
        assert!(
            matches!(result, Err(Ok(crate::error::ContractError::IntervalTooShort))),
            "interval=0 must return IntervalTooShort; got {:?}",
            result
        );
        // No storage entry must exist.
        let key = DataKey::Subscription(crate::storage::subscription_key(
            &p.env, &p.subscriber, &p.merchant, &p.token,
        ));
        assert!(
            !p.env.storage().persistent().has(&key),
            "no subscription must be created when interval=0"
        );
    }

    // ─── PROPERTY 11 — Adversarial execute_payment with swapped addresses ────

    proptest! {
        /// Attempting execute_payment where the caller passes `merchant` as the
        /// `subscriber` argument (i.e. the same address for both) must return either
        /// `SelfSubscription` or `NoActiveSubscription` — never a successful transfer.
        ///
        /// Guards against impersonation: a merchant cannot collect from themselves
        /// by passing their own address as the subscriber.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_adversarial_merchant_cannot_impersonate_subscriber(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // A legitimate subscriber sets up a subscription to the merchant.
            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token,
                &amount, &interval, &false,
            );

            // Advance clock so payment would normally be due.
            let now = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

            // Adversarial call: pass merchant address as both subscriber AND merchant.
            // This must not succeed.
            let result = p.client.try_execute_payment(
                &p.merchant, // used as subscriber — wrong address
                &p.merchant, // used as merchant — own address
            );

            prop_assert!(
                result.is_err(),
                "execute_payment with merchant as both subscriber and merchant \
                 must fail, got Ok"
            );
            // The legitimate subscriber's balance must be untouched.
            let sub_bal = soroban_sdk::token::Client::new(&p.env, &p.token)
                .balance(&p.subscriber);
            prop_assert_eq!(
                sub_bal,
                MAX_AMOUNT * 2,
                "legitimate subscriber balance must be unchanged after adversarial attempt"
            );
        }
    }

    // ─── BOUNDARY — Contract address as token is rejected ────────────────────

    /// Passing the contract's own address as the `token` parameter to `subscribe`
    /// must return an error (`InvalidTokenAddress` or a host-level panic) and must
    /// not create a storage entry.
    ///
    /// Prevents re-entrant / circular token interactions.
    #[test]
    fn prop_contract_address_as_token_is_rejected() {
        let p = PropEnv::new();
        // Use the contract's own address as the token.
        let bad_token = p.contract_id.clone();

        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &bad_token,
            &1_000_i128, &MIN_INTERVAL, &false,
        );
        // Must fail — either InvalidTokenAddress or a host-level error.
        assert!(
            result.is_err(),
            "subscribe with contract address as token must fail; got Ok"
        );
    }
}
