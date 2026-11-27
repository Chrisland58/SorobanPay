#![cfg(test)]

//! Automated test suite for batch payment preview and outcome mapping (Issue #1616).
//!
//! Verifies:
//! - Input ordering is strictly preserved in output.
//! - Invalid items are identified with explicit reasons and never silently dropped.
//! - Duplicate identifiers in a single batch are flagged as DuplicateInBatch.
//! - Batch size boundaries (empty, max 50, >50) are enforced identically to batch execution.
//! - Preview is strictly read-only: balances, allowances, timestamps, and sequence numbers do not mutate.

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    error::ContractError,
    BatchItemEligibility, BatchPreviewItem,
    SubscriptionProtocol, SubscriptionProtocolClient,
    BATCH_MAX_SIZE,
};

struct BatchPreviewFixture {
    env: Env,
    client: SubscriptionProtocolClient,
    merchant: Address,
    token: Address,
    contract_id: Address,
    admin: Address,
}

impl BatchPreviewFixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000_u64;
            l.sequence = 100_000_u32;
        });

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        client.initialize(&admin);

        Self {
            env,
            client,
            merchant,
            token,
            contract_id,
            admin,
        }
    }

    fn create_subscriber(&self, balance: i128, allowance: i128) -> Address {
        let sub = Address::generate(&self.env);
        if balance > 0 {
            StellarAssetClient::new(&self.env, &self.token).mint(&sub, &balance);
        }
        if allowance > 0 {
            token::Client::new(&self.env, &self.token).approve(
                &sub,
                &self.contract_id,
                &allowance,
                &(self.env.ledger().sequence() + 100_000_u32),
            );
        }
        sub
    }

    fn subscribe(&self, sub: &Address, amount: i128, interval: u64) {
        self.client.subscribe(
            sub,
            &self.merchant,
            &self.token,
            &amount,
            &interval,
            &false,
            &None,
        );
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
            l.sequence += 1;
        });
    }
}

#[test]
fn test_preview_preserves_input_ordering_and_maps_outcomes() {
    let f = BatchPreviewFixture::setup();

    // Setup 4 subscribers with varied conditions
    let sub1_eligible = f.create_subscriber(10_000_000, 10_000_000);
    f.subscribe(&sub1_eligible, 1_000_000, 86_400);

    let sub2_broke = f.create_subscriber(0, 10_000_000); // no balance
    f.subscribe(&sub2_broke, 1_000_000, 86_400);

    let sub3_unapproved = f.create_subscriber(10_000_000, 0); // no allowance
    f.subscribe(&sub3_unapproved, 1_000_000, 86_400);

    let sub4_unregistered = Address::generate(&f.env); // never subscribed

    // Advance time so subscriptions become due
    f.advance_time(86_400);

    let mut batch = Vec::new(&f.env);
    batch.push_back(sub1_eligible.clone());
    batch.push_back(sub2_broke.clone());
    batch.push_back(sub3_unapproved.clone());
    batch.push_back(sub4_unregistered.clone());

    let preview = f.client.preview_batch_payment(&f.merchant, &f.token, &batch);
    assert_eq!(preview.len(), 4, "Every input item must have a corresponding preview result");

    // Item 1: Eligible
    assert_eq!(preview.get(0).unwrap().subscriber, sub1_eligible);
    assert_eq!(preview.get(0).unwrap().eligible, true);
    assert_eq!(preview.get(0).unwrap().reason, BatchItemEligibility::Eligible);
    assert_eq!(preview.get(0).unwrap().amount, 1_000_000);

    // Item 2: Insufficient Balance
    assert_eq!(preview.get(1).unwrap().subscriber, sub2_broke);
    assert_eq!(preview.get(1).unwrap().eligible, false);
    assert_eq!(preview.get(1).unwrap().reason, BatchItemEligibility::InsufficientBalance);

    // Item 3: Insufficient Allowance
    assert_eq!(preview.get(2).unwrap().subscriber, sub3_unapproved);
    assert_eq!(preview.get(2).unwrap().eligible, false);
    assert_eq!(preview.get(2).unwrap().reason, BatchItemEligibility::InsufficientAllowance);

    // Item 4: No Active Subscription
    assert_eq!(preview.get(3).unwrap().subscriber, sub4_unregistered);
    assert_eq!(preview.get(3).unwrap().eligible, false);
    assert_eq!(preview.get(3).unwrap().reason, BatchItemEligibility::NoActiveSubscription);
}

#[test]
fn test_preview_identifies_payment_not_due_and_paused() {
    let f = BatchPreviewFixture::setup();

    let sub_early = f.create_subscriber(10_000_000, 10_000_000);
    f.subscribe(&sub_early, 1_000_000, 86_400);

    let sub_paused = f.create_subscriber(10_000_000, 10_000_000);
    f.subscribe(&sub_paused, 1_000_000, 86_400);
    f.client.pause_subscription(&sub_paused, &f.merchant, &f.token, &None);

    // Advance time only halfway for sub_early
    f.advance_time(40_000);

    let mut batch = Vec::new(&f.env);
    batch.push_back(sub_early.clone());
    batch.push_back(sub_paused.clone());

    let preview = f.client.preview_batch_payment(&f.merchant, &f.token, &batch);
    assert_eq!(preview.len(), 2);

    assert_eq!(preview.get(0).unwrap().reason, BatchItemEligibility::PaymentNotDue);
    assert_eq!(preview.get(0).unwrap().eligible, false);

    assert_eq!(preview.get(1).unwrap().reason, BatchItemEligibility::SubscriptionPaused);
    assert_eq!(preview.get(1).unwrap().eligible, false);
}

#[test]
fn test_preview_detects_duplicate_identifiers() {
    let f = BatchPreviewFixture::setup();

    let sub = f.create_subscriber(10_000_000, 10_000_000);
    f.subscribe(&sub, 1_000_000, 86_400);

    f.advance_time(86_400);

    // Include sub twice in the same batch
    let mut batch = Vec::new(&f.env);
    batch.push_back(sub.clone());
    batch.push_back(sub.clone());

    let preview = f.client.preview_batch_payment(&f.merchant, &f.token, &batch);
    assert_eq!(preview.len(), 2);

    // First appearance is eligible
    assert_eq!(preview.get(0).unwrap().eligible, true);
    assert_eq!(preview.get(0).unwrap().reason, BatchItemEligibility::Eligible);

    // Second appearance is flagged as duplicate
    assert_eq!(preview.get(1).unwrap().eligible, false);
    assert_eq!(preview.get(1).unwrap().reason, BatchItemEligibility::DuplicateInBatch);
}

#[test]
fn test_preview_batch_size_boundaries() {
    let f = BatchPreviewFixture::setup();

    // 1. Empty batch rejected
    let empty = Vec::new(&f.env);
    let err_empty = f.client.try_preview_batch_payment(&f.merchant, &f.token, &empty);
    assert_eq!(err_empty, Err(Ok(ContractError::EmptyBatch)));

    // 2. Exactly BATCH_MAX_SIZE (50) accepted
    let mut max_batch = Vec::new(&f.env);
    for _ in 0..BATCH_MAX_SIZE {
        max_batch.push_back(Address::generate(&f.env));
    }
    let res_max = f.client.try_preview_batch_payment(&f.merchant, &f.token, &max_batch);
    assert!(res_max.is_ok(), "50 items should be accepted in preview");
    assert_eq!(res_max.unwrap().unwrap().len(), 50);

    // 3. 51 items rejected
    max_batch.push_back(Address::generate(&f.env));
    let err_too_large = f.client.try_preview_batch_payment(&f.merchant, &f.token, &max_batch);
    assert_eq!(err_too_large, Err(Ok(ContractError::BatchTooLarge)));
}

#[test]
fn test_preview_does_not_mutate_state() {
    let f = BatchPreviewFixture::setup();

    let sub = f.create_subscriber(10_000_000, 10_000_000);
    f.subscribe(&sub, 1_000_000, 86_400);

    f.advance_time(86_400);

    let sub_before = f.client.get_subscription(&sub, &f.merchant, &f.token).unwrap();
    let bal_before = token::Client::new(&f.env, &f.token).balance(&sub);
    let events_before_count = f.env.events().all().len();

    let mut batch = Vec::new(&f.env);
    batch.push_back(sub.clone());

    // Run preview multiple times
    let preview1 = f.client.preview_batch_payment(&f.merchant, &f.token, &batch);
    let preview2 = f.client.preview_batch_payment(&f.merchant, &f.token, &batch);
    assert_eq!(preview1, preview2);

    let sub_after = f.client.get_subscription(&sub, &f.merchant, &f.token).unwrap();
    let bal_after = token::Client::new(&f.env, &f.token).balance(&sub);
    let events_after_count = f.env.events().all().len();

    // Verify complete state immutability
    assert_eq!(sub_before.next_payment, sub_after.next_payment, "next_payment must not change");
    assert_eq!(sub_before.payment_nonce, sub_after.payment_nonce, "sequence must not change");
    assert_eq!(bal_before, bal_after, "balances must not change");
    assert_eq!(events_before_count, events_after_count, "preview must emit zero events");
}
