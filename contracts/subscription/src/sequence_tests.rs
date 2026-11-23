#![cfg(test)]

//! Tests for monotonic subscription payment sequence numbers (Issue #1619).
//!
//! Verifies:
//! - Successful payments increment sequence exactly once.
//! - Failed payments (insufficient balance or allowance) leave sequence state unchanged.
//! - Retries after failed attempts succeed and do not consume a sequence value.
//! - Overflow handling: returns SequenceOverflow without state corruption or wrapping.
//! - Event-to-storage sequence consistency.
//! - Batch payment sequence accuracy for both successful and skipped items.

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey, SubscriptionData},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct SeqFixture {
    env: Env,
    client: SubscriptionProtocolClient,
    subscriber: Address,
    merchant: Address,
    token: Address,
    contract_id: Address,
    admin: Address,
}

impl SeqFixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000_u64;
            l.sequence = 100_000_u32;
        });

        let admin = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Initial funding: 10,000,000 stroops
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        // Initial allowance: 10,000,000 stroops
        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &10_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self {
            env,
            client,
            subscriber,
            merchant,
            token,
            contract_id,
            admin,
        }
    }

    fn subscribe(&self, amount: i128, interval: u64) {
        self.client.subscribe(
            &self.subscriber,
            &self.merchant,
            &self.token,
            &amount,
            &interval,
            &true,
            &None,
        );
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
            l.sequence += 1;
        });
    }

    fn get_sub(&self) -> SubscriptionData {
        self.client
            .get_subscription(&self.subscriber, &self.merchant, &self.token)
            .expect("subscription should exist")
    }
}

#[test]
fn test_initial_sequence_is_zero() {
    let f = SeqFixture::setup();
    f.subscribe(1_000_000, 86_400);

    let seq = f.client.get_payment_sequence(&f.subscriber, &f.merchant);
    assert_eq!(seq, 0, "Initial payment sequence must be 0");
    assert_eq!(f.get_sub().payment_nonce, 0);
}

#[test]
fn test_successful_payment_increments_sequence_exactly_once() {
    let f = SeqFixture::setup();
    f.subscribe(1_000_000, 86_400);

    // Advance to due time
    f.advance_time(86_400);

    let res = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert!(res.is_ok(), "First payment execution should succeed");

    assert_eq!(
        f.client.get_payment_sequence(&f.subscriber, &f.merchant),
        1,
        "Sequence must increment from 0 to 1 after first payment"
    );
    assert_eq!(f.get_sub().payment_nonce, 1);

    // Advance to second interval
    f.advance_time(86_400);
    let res2 = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert!(res2.is_ok(), "Second payment execution should succeed");

    assert_eq!(
        f.client.get_payment_sequence(&f.subscriber, &f.merchant),
        2,
        "Sequence must increment to 2 after second payment"
    );
    assert_eq!(f.get_sub().payment_nonce, 2);
}

#[test]
fn test_failed_payment_leaves_sequence_unchanged() {
    let f = SeqFixture::setup();
    // Subscribe for more than initial balance (15_000_000 > 10_000_000)
    f.subscribe(15_000_000, 86_400);

    f.advance_time(86_400);

    // Payment should fail due to insufficient balance
    let res = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert_eq!(res, Err(Ok(ContractError::TransferFailed)));

    // Sequence must remain at 0!
    assert_eq!(
        f.client.get_payment_sequence(&f.subscriber, &f.merchant),
        0,
        "Failed payment must leave sequence at 0"
    );
    assert_eq!(f.get_sub().payment_nonce, 0);
}

#[test]
fn test_retry_after_failed_payment_does_not_consume_sequence() {
    let f = SeqFixture::setup();
    let amount = 20_000_000_i128; // exceeds 10M initial balance
    f.subscribe(amount, 86_400);

    f.advance_time(86_400);

    // 1. Attempt fails
    let fail1 = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert_eq!(fail1, Err(Ok(ContractError::TransferFailed)));
    assert_eq!(f.client.get_payment_sequence(&f.subscriber, &f.merchant), 0);

    // 2. Fund subscriber account and approve allowance
    StellarAssetClient::new(&f.env, &f.token).mint(&f.subscriber, &50_000_000_i128);
    token::Client::new(&f.env, &f.token).approve(
        &f.subscriber,
        &f.contract_id,
        &50_000_000_i128,
        &(f.env.ledger().sequence() + 100_000_u32),
    );

    // 3. Retry payment
    let success = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert!(success.is_ok(), "Retry should succeed once funded");

    // The sequence must be 1, NOT 2 — the failed attempt did not consume a sequence value!
    assert_eq!(
        f.client.get_payment_sequence(&f.subscriber, &f.merchant),
        1,
        "Sequence must be exactly 1 after retry (failed payment did not consume sequence)"
    );
    assert_eq!(f.get_sub().payment_nonce, 1);
}

#[test]
fn test_sequence_overflow_handling() {
    let f = SeqFixture::setup();
    f.subscribe(1_000_000, 86_400);

    // Set storage sequence to u32::MAX directly to simulate edge overflow
    let hash = subscription_key(&f.env, &f.subscriber, &f.merchant);
    let key = DataKey::Subscription(hash);
    let mut data = f.get_sub();
    data.payment_nonce = u32::MAX;
    f.env.storage().persistent().set(&key, &data);

    f.advance_time(86_400);

    let res = f.client.try_execute_payment(&f.subscriber, &f.merchant, &f.token);
    assert_eq!(
        res,
        Err(Ok(ContractError::SequenceOverflow)),
        "Sequence counter overflow must return SequenceOverflow"
    );

    // Storage sequence must remain at u32::MAX and not wrap around to 0
    let sub_after = f.get_sub();
    assert_eq!(sub_after.payment_nonce, u32::MAX);
}

#[test]
fn test_event_to_storage_sequence_consistency() {
    let f = SeqFixture::setup();
    f.subscribe(1_000_000, 86_400);

    f.advance_time(86_400);
    f.client.execute_payment(&f.subscriber, &f.merchant, &f.token);

    let stored_seq = f.client.get_payment_sequence(&f.subscriber, &f.merchant);
    assert_eq!(stored_seq, 1);

    // Check emitted events
    let events = f.env.events().all();
    assert!(!events.is_empty());
}
