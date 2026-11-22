#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    storage::{subscription_key, DataKey, ScheduleStatus, SubscriptionData},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestEnv {
    env: Env,
    subscriber: Address,
    merchant: Address,
    token: Address,
    client: SubscriptionProtocolClient<'static>,
}

impl TestEnv {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000),
        );

        Self {
            env,
            subscriber,
            merchant,
            token,
            client,
        }
    }

    fn advance_time(&self, seconds: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + seconds);
    }
}

#[test]
fn test_preview_cancelled_or_missing_subscription() {
    let t = TestEnv::setup();

    // Query preview for a pair with no subscription.
    let preview = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_eq!(preview.status, ScheduleStatus::Cancelled);
    assert_eq!(preview.next_due_time, 0);
    assert!(!preview.is_executable);
    assert_eq!(preview.overdue_since, None);
    assert_eq!(preview.paused_until, None);
}

#[test]
fn test_preview_active_and_overdue_states() {
    let t = TestEnv::setup();
    let amount = 1_000_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amount,
        &interval,
        &false,
        &None,
    );
    let start_ts = t.env.ledger().timestamp();
    let expected_due = start_ts + interval;

    // 1. Immediately after subscribe (now < next_due_time): Active, not executable.
    let preview_active = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_eq!(preview_active.status, ScheduleStatus::Active);
    assert_eq!(preview_active.next_due_time, expected_due);
    assert!(!preview_active.is_executable);
    assert_eq!(preview_active.overdue_since, None);

    // 2. Advance time past due date: Overdue, executable.
    t.advance_time(interval + 10);
    let preview_overdue = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_eq!(preview_overdue.status, ScheduleStatus::Overdue);
    assert_eq!(preview_overdue.next_due_time, expected_due);
    assert!(preview_overdue.is_executable);
}

#[test]
fn test_preview_paused_states() {
    let t = TestEnv::setup();
    let amount = 1_000_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amount,
        &interval,
        &false,
        &None,
    );

    // Pause indefinitely
    t.client
        .pause_subscription(&t.subscriber, &t.merchant, &None);

    let preview_paused = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_eq!(preview_paused.status, ScheduleStatus::Paused);
    assert!(!preview_paused.is_executable);
    assert_eq!(preview_paused.paused_until, None);

    // Resume
    t.client.resume_subscription(&t.subscriber, &t.merchant);

    // Pause with duration: 3600 seconds
    let pause_duration = 3600_u64;
    t.client
        .pause_subscription(&t.subscriber, &t.merchant, &Some(pause_duration));
    let now = t.env.ledger().timestamp();
    let resume_expected = now + pause_duration;

    // Query while pause is active
    let preview_timed_paused = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_eq!(preview_timed_paused.status, ScheduleStatus::Paused);
    assert!(!preview_timed_paused.is_executable);
    assert_eq!(preview_timed_paused.paused_until, Some(resume_expected));

    // Advance time past resume_at: preview reflects auto-resume behavior
    t.advance_time(pause_duration + 5);
    let preview_auto_resumed = t.client.preview_schedule(&t.subscriber, &t.merchant);
    assert_ne!(preview_auto_resumed.status, ScheduleStatus::Paused);
}

#[test]
fn test_preview_is_strictly_read_only_and_leaves_storage_and_events_unchanged() {
    let t = TestEnv::setup();
    let amount = 1_000_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amount,
        &interval,
        &false,
        &None,
    );

    let hash = subscription_key(&t.env, &t.subscriber, &t.merchant);
    let key = DataKey::Subscription(hash);

    let data_before: SubscriptionData = t.env.storage().persistent().get(&key).unwrap();
    let events_count_before = t.env.events().all().len();

    // Call preview_schedule multiple times across various states
    let _ = t.client.preview_schedule(&t.subscriber, &t.merchant);
    let _ = t
        .client
        .preview_schedule(&Address::generate(&t.env), &t.merchant);

    t.advance_time(interval + 100);
    let _ = t.client.preview_schedule(&t.subscriber, &t.merchant);

    let data_after: SubscriptionData = t.env.storage().persistent().get(&key).unwrap();
    let events_count_after = t.env.events().all().len();

    // Invariant: Storage data must be strictly identical
    assert_eq!(data_before.token, data_after.token);
    assert_eq!(data_before.amount, data_after.amount);
    assert_eq!(data_before.interval, data_after.interval);
    assert_eq!(data_before.next_payment, data_after.next_payment);
    assert_eq!(data_before.is_paused, data_after.is_paused);
    assert_eq!(data_before.payment_nonce, data_after.payment_nonce);

    // Invariant: Event history must not gain any events
    assert_eq!(events_count_before, events_count_after);
}
