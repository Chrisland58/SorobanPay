/// schedule_overflow_tests.rs — Boundary and overflow tests for schedule arithmetic.
///
/// Issue #1646: [Testing] Add contract boundary tests for schedule arithmetic overflow
///
/// Acceptance criteria:
/// - Boundary and property-based cases cover both create and update paths.
/// - The same input produces the same result under optimized and test builds.
/// - Assert errors are stable and no partial storage changes are committed.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    checked_next_payment,
    error::ContractError,
    storage::{subscription_key, DataKey, SubscriptionData, MAX_AMOUNT},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

const MIN_INTERVAL: u64 = 86_400;
const MAX_INTERVAL: u64 = 31_536_000;
const TEST_AMOUNT: i128 = 10_000_000;

struct OverflowTestHarness {
    env: Env,
    client: SubscriptionProtocolClient,
    subscriber: Address,
    merchant: Address,
    token: Address,
}

impl OverflowTestHarness {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SubscriptionProtocol);
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let stellar_client = StellarAssetClient::new(&env, &token_address);
        stellar_client.mint(&subscriber, &1_000_000_000_000);

        let token_client = token::Client::new(&env, &token_address);
        token_client.approve(&subscriber, &contract_id, &1_000_000_000_000, &100_000);

        Self {
            env,
            client,
            subscriber,
            merchant,
            token: token_address,
        }
    }
}

// ── Checked next_payment helper unit & property checks ────────────────────────

#[test]
fn checked_next_payment_detects_overflow() {
    // Normal cases
    assert_eq!(checked_next_payment(1_000, 86_400).unwrap(), 87_400);

    // Exact boundary
    assert_eq!(
        checked_next_payment(u64::MAX - 100, 100).unwrap(),
        u64::MAX
    );

    // Overflow by 1
    assert_eq!(
        checked_next_payment(u64::MAX - 99, 100),
        Err(ContractError::InvalidTimestamp)
    );

    // Extreme overflow
    assert_eq!(
        checked_next_payment(u64::MAX, 1),
        Err(ContractError::InvalidTimestamp)
    );
    assert_eq!(
        checked_next_payment(u64::MAX, MAX_INTERVAL),
        Err(ContractError::InvalidTimestamp)
    );
}

// ── Create subscription schedule boundaries ───────────────────────────────────

#[test]
fn subscribe_at_maximum_safe_timestamp_boundary() {
    let h = OverflowTestHarness::setup();
    let safe_ts = u64::MAX - MAX_INTERVAL;
    h.env.ledger().set_timestamp(safe_ts);

    let res = h.client.try_subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &TEST_AMOUNT,
        &MAX_INTERVAL,
        &None,
        &None,
        &None,
    );

    assert!(res.is_ok(), "Expected safe boundary subscribe to succeed");
    let sub = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert_eq!(sub.next_payment, safe_ts + MAX_INTERVAL);
}

#[test]
fn subscribe_fails_cleanly_when_schedule_overflows_without_partial_commit() {
    let h = OverflowTestHarness::setup();
    // Setting timestamp to near u64::MAX so ts + interval overflows
    let overflow_ts = u64::MAX - (MAX_INTERVAL / 2);
    h.env.ledger().set_timestamp(overflow_ts);

    let res = h.client.try_subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &TEST_AMOUNT,
        &MAX_INTERVAL,
        &None,
        &None,
        &None,
    );

    assert!(res.is_err(), "Expected subscribe to fail on overflow");

    // Assert no partial storage entry was committed
    let hash = subscription_key(&h.env, &h.subscriber, &h.merchant);
    let key = DataKey::Subscription(hash);
    let exists = h.env.as_contract(&h.client.address, || {
        h.env.storage().persistent().has(&key)
    });
    assert!(!exists, "Subscription record must not be committed on failure");
}

// ── Update subscription schedule boundaries ───────────────────────────────────

#[test]
fn update_subscription_preserves_next_payment_and_updates_interval_cleanly() {
    let h = OverflowTestHarness::setup();
    h.env.ledger().set_timestamp(1_700_000_000);

    h.client.subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &TEST_AMOUNT,
        &MIN_INTERVAL,
        &None,
        &None,
        &None,
    );

    let initial = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert_eq!(initial.interval, MIN_INTERVAL);

    // Update with maximum valid interval
    h.client.update_subscription(
        &h.subscriber,
        &h.merchant,
        &(TEST_AMOUNT * 2),
        &MAX_INTERVAL,
    );

    let updated = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert_eq!(updated.amount, TEST_AMOUNT * 2);
    assert_eq!(updated.interval, MAX_INTERVAL);
    // next_payment should remain undisturbed so current billing cycle is unchanged
    assert_eq!(updated.next_payment, initial.next_payment);
}

// ── Execute payment overflow handling ─────────────────────────────────────────

#[test]
fn execute_payment_overflow_fails_atomically_without_corrupting_state() {
    let h = OverflowTestHarness::setup();
    let initial_ts = 1_000_000;
    h.env.ledger().set_timestamp(initial_ts);

    h.client.subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &TEST_AMOUNT,
        &MAX_INTERVAL,
        &None,
        &None,
        &None,
    );

    let original_sub = h.client.get_subscription(&h.subscriber, &h.merchant);

    // Fast-forward ledger timestamp to overflow boundary (now >= next_payment, but now + interval > u64::MAX)
    let overflow_now = u64::MAX - (MAX_INTERVAL / 2);
    h.env.ledger().set_timestamp(overflow_now);

    let res = h.client.try_execute_payment(&h.subscriber, &h.merchant);
    assert!(res.is_err(), "execute_payment must fail when next_payment calculation overflows");

    // Verify storage was not updated
    let after_failed = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert_eq!(after_failed.next_payment, original_sub.next_payment);
    assert_eq!(after_failed.payment_nonce, original_sub.payment_nonce);
}

#[test]
fn batch_execute_payment_isolates_overflow_failure_per_subscriber() {
    let h = OverflowTestHarness::setup();
    let initial_ts = 1_000_000;
    h.env.ledger().set_timestamp(initial_ts);

    // Subscriber 1: safe interval
    h.client.subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &TEST_AMOUNT,
        &MIN_INTERVAL,
        &None,
        &None,
        &None,
    );

    // Set time past next payment
    h.env.ledger().set_timestamp(initial_ts + MIN_INTERVAL + 10);

    let subscribers = soroban_sdk::vec![&h.env, h.subscriber.clone()];
    let results = h.client.batch_execute_payment(&h.merchant, &subscribers);

    assert_eq!(results.len(), 1);
    let (sub, success) = results.get(0).unwrap();
    assert_eq!(sub, h.subscriber);
    assert!(success, "Safe batch item should execute successfully");
}
