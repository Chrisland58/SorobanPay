/// pause_resume_tests.rs — Comprehensive unit tests for pause/resume subscription flow
///
/// Issue #1414: All success and error paths for pause_subscription and resume_subscription.
///
/// Test Cases:
/// 1. Pause without duration: payment blocked indefinitely
/// 2. Pause with duration: auto-resumes after pause_until
/// 3. Resume: payment allowed after explicit resume_subscription call
/// 4. Execute during pause: returns SubscriptionPaused (code 20)
/// 5. Pause already paused subscription: returns SubscriptionPaused
/// 6. Resume non-paused subscription: returns SubscriptionNotPaused
/// 7. Auth: only subscriber can pause/resume

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test harness ─────────────────────────────────────────────────────────────

struct PT {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl PT {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, client, subscriber, merchant, token, contract_id }
    }

    fn subscribe(&self, amount: i128, interval: u64) {
        self.client.subscribe(
            &self.subscriber,
            &self.merchant,
            &self.token,
            &amount,
            &interval,
            &false,
        );
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn sub_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.subscriber)
    }

    fn get_sub(&self) -> crate::storage::SubscriptionData {
        let hash = subscription_key(&self.env, &self.subscriber, &self.merchant);
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(hash))
            .expect("subscription not found")
    }
}

// ─── Test 1: Pause without duration — payment blocked indefinitely ────────────

/// After pause_subscription with no resume_at timestamp:
/// - is_paused must be true
/// - execute_payment must return SubscriptionPaused
/// - No tokens must be transferred
#[test]
fn pause_without_duration_blocks_payment_indefinitely() {
    let pt       = PT::new();
    let amount   = 500_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);
    pt.advance(interval + 1);

    // Pause with no auto-resume timestamp
    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);

    // Verify is_paused is set
    let data = pt.get_sub();
    assert!(data.is_paused, "is_paused must be true after pause_subscription");
    assert!(data.paused_until.is_none(), "paused_until must be None for indefinite pause");

    let bal_before = pt.sub_bal();

    // execute_payment must be blocked
    let result = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
        "execute_payment while indefinitely paused must return SubscriptionPaused; got {:?}",
        result
    );

    // No tokens transferred
    assert_eq!(pt.sub_bal(), bal_before, "no tokens must be transferred while paused");

    // Advance a long time — still blocked
    pt.advance(interval * 30);

    let result2 = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);
    assert!(
        matches!(result2, Err(Ok(ContractError::SubscriptionPaused))),
        "execute_payment must remain blocked indefinitely without resume; got {:?}",
        result2
    );
    assert_eq!(pt.sub_bal(), bal_before, "balance must not change after long pause without resume");
}

// ─── Test 2: Pause with duration — auto-resumes after pause_until ─────────────

/// When pause_subscription is called with a future resume_at timestamp:
/// - execute_payment is blocked before resume_at
/// - execute_payment succeeds at/after resume_at (auto-resume)
#[test]
fn pause_with_duration_auto_resumes_after_pause_until() {
    let pt       = PT::new();
    let amount   = 500_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);

    let now       = pt.env.ledger().timestamp();
    let resume_at = now + interval / 2; // half-interval in the future

    pt.client.pause_subscription(
        &pt.subscriber, &pt.merchant, &pt.token,
        &Some(resume_at),
    );

    // Verify paused_until is set
    let data = pt.get_sub();
    assert!(data.is_paused, "is_paused must be true");
    assert_eq!(data.paused_until, Some(resume_at), "paused_until must equal resume_at");

    // Advance to just before resume_at — still blocked (or not due)
    pt.advance(interval / 2 - 2);
    let result_before = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);
    assert!(
        matches!(result_before, Err(Ok(ContractError::SubscriptionPaused)))
            || matches!(result_before, Err(Ok(ContractError::PaymentNotDue))),
        "before resume_at must be paused or not due; got {:?}",
        result_before
    );

    // Advance well past resume_at AND past next_payment
    pt.advance(interval + 5);

    let bal_before = pt.sub_bal();
    let result_after = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);
    assert!(
        result_after.is_ok(),
        "execute_payment must succeed after passing paused_until; got {:?}",
        result_after
    );
    assert_eq!(
        pt.sub_bal(),
        bal_before - amount,
        "subscriber balance must decrease after auto-resumed payment"
    );
}

/// After auto-resume, is_paused must be cleared in storage.
#[test]
fn pause_auto_resume_clears_is_paused_flag() {
    let pt       = PT::new();
    let amount   = 100_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);

    let now       = pt.env.ledger().timestamp();
    let resume_at = now + 3600; // 1 hour

    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &Some(resume_at));
    assert!(pt.get_sub().is_paused);

    // Advance past resume_at and next_payment, then trigger payment
    pt.advance(interval + 3601);
    pt.client.execute_payment(&pt.subscriber, &pt.merchant);

    // is_paused must be cleared after auto-resume + payment
    assert!(!pt.get_sub().is_paused, "is_paused must be false after auto-resume");
}

// ─── Test 3: Resume — payment allowed after explicit resume call ──────────────

/// After resume_subscription:
/// - is_paused must be false
/// - next_payment must be reset to now + interval (no charge for paused time)
/// - execute_payment must succeed once the new next_payment is reached
#[test]
fn resume_subscription_allows_payment_after_explicit_resume() {
    let pt       = PT::new();
    let amount   = 500_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);
    pt.advance(interval + 1);

    // Pause indefinitely
    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);
    assert!(pt.get_sub().is_paused);

    // Explicitly resume
    pt.client.resume_subscription(&pt.subscriber, &pt.merchant, &pt.token);

    let data = pt.get_sub();
    assert!(!data.is_paused,        "is_paused must be false after resume");
    assert!(data.paused_until.is_none(), "paused_until must be None after resume");

    // next_payment must be now + interval from the resume call
    let resume_ts     = pt.env.ledger().timestamp();
    let expected_next = resume_ts + interval;
    assert_eq!(
        data.next_payment, expected_next,
        "next_payment must be reset to resume_ts + interval"
    );

    // Advance past the new next_payment and collect
    pt.advance(interval + 1);
    let bal_before = pt.sub_bal();

    let result = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);
    assert!(result.is_ok(), "execute_payment must succeed after resume; got {:?}", result);
    assert_eq!(pt.sub_bal(), bal_before - amount, "payment amount must be deducted after resume");
}

// ─── Test 4: Execute during pause — returns SubscriptionPaused ───────────────

/// Verify error code 20 is returned by execute_payment on a paused subscription.
#[test]
fn execute_payment_during_pause_returns_subscription_paused_code_20() {
    let pt       = PT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);
    pt.advance(interval + 1);

    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);

    let result = pt.client.try_execute_payment(&pt.subscriber, &pt.merchant);

    // Verify the error is specifically SubscriptionPaused (code 20)
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
        "execute_payment during pause must return SubscriptionPaused (code 20); got {:?}",
        result
    );
}

// ─── Test 5: Pause already paused subscription ────────────────────────────────

/// Calling pause_subscription on an already-paused subscription must return
/// SubscriptionPaused (code 20) and leave the subscription state unchanged.
#[test]
fn pause_already_paused_subscription_returns_error() {
    let pt       = PT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);
    pt.advance(interval + 1);

    // First pause — must succeed
    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);
    assert!(pt.get_sub().is_paused);

    // Second pause — must return SubscriptionPaused
    let result = pt.client.try_pause_subscription(
        &pt.subscriber, &pt.merchant, &pt.token, &None,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
        "double-pause must return SubscriptionPaused; got {:?}",
        result
    );

    // Subscription must still be paused
    assert!(pt.get_sub().is_paused, "subscription must remain paused after rejected double-pause");
}

/// Pausing with a duration on an already-paused subscription is also rejected.
#[test]
fn pause_with_duration_already_paused_returns_error() {
    let pt       = PT::new();
    let interval = 86_400_u64;

    pt.subscribe(1_000, interval);

    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);

    let now = pt.env.ledger().timestamp();
    let result = pt.client.try_pause_subscription(
        &pt.subscriber, &pt.merchant, &pt.token,
        &Some(now + 3600),
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
        "pausing with duration on an already-paused subscription must return SubscriptionPaused; got {:?}",
        result
    );
}

// ─── Test 6: Resume non-paused subscription ───────────────────────────────────

/// Calling resume_subscription on an active (not paused) subscription must return
/// SubscriptionNotPaused (code 21) and leave the subscription state unchanged.
#[test]
fn resume_non_paused_subscription_returns_error() {
    let pt       = PT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    pt.subscribe(amount, interval);

    // Subscription is active (not paused) — resume must return SubscriptionNotPaused
    let result = pt.client.try_resume_subscription(
        &pt.subscriber, &pt.merchant, &pt.token,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionNotPaused))),
        "resuming an active subscription must return SubscriptionNotPaused (code 21); got {:?}",
        result
    );

    // Subscription state must be unchanged
    let data = pt.get_sub();
    assert!(!data.is_paused, "subscription must remain active after rejected resume");
}

/// Calling resume after an explicit resume (subscription is already active) must
/// also return SubscriptionNotPaused.
#[test]
fn double_resume_returns_subscription_not_paused() {
    let pt       = PT::new();
    let interval = 86_400_u64;

    pt.subscribe(1_000, interval);

    // Pause then resume
    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);
    pt.client.resume_subscription(&pt.subscriber, &pt.merchant, &pt.token);

    // Second resume must fail
    let result = pt.client.try_resume_subscription(
        &pt.subscriber, &pt.merchant, &pt.token,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionNotPaused))),
        "double-resume must return SubscriptionNotPaused; got {:?}",
        result
    );
}

// ─── Test 7: Auth — only subscriber can pause/resume ─────────────────────────

/// pause_subscription called without subscriber auth must panic.
#[test]
#[should_panic]
fn pause_without_subscriber_auth_panics() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe with mock auth
    env.mock_all_auths();
    client.subscribe(&subscriber, &merchant, &token, &1_000_i128, &86_400_u64, &false);

    // Call pause WITHOUT subscriber auth — only merchant signs
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &merchant,
        invoke:  &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name:  "pause_subscription",
            args:     soroban_sdk::vec![
                &env,
                subscriber.clone().into(),
                merchant.clone().into(),
                token.clone().into(),
                soroban_sdk::Val::from(()),
            ]
            .into(),
            sub_invokes: &[],
        },
    }]);
    client.pause_subscription(&subscriber, &merchant, &token, &None);
}

/// resume_subscription called without subscriber auth must panic.
#[test]
#[should_panic]
fn resume_without_subscriber_auth_panics() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe and pause with mock auth
    env.mock_all_auths();
    client.subscribe(&subscriber, &merchant, &token, &1_000_i128, &86_400_u64, &false);
    client.pause_subscription(&subscriber, &merchant, &token, &None);

    // Attempt resume WITHOUT subscriber auth — merchant signs instead
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &merchant,
        invoke:  &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name:  "resume_subscription",
            args:     soroban_sdk::vec![
                &env,
                subscriber.clone().into(),
                merchant.clone().into(),
                token.clone().into(),
            ]
            .into(),
            sub_invokes: &[],
        },
    }]);
    client.resume_subscription(&subscriber, &merchant, &token);
}

/// Merchant cannot pause a subscription (subscriber auth required).
#[test]
#[should_panic]
fn merchant_cannot_pause_subscription() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe with mock auth
    env.mock_all_auths();
    client.subscribe(&subscriber, &merchant, &token, &1_000_i128, &86_400_u64, &false);

    // No mock auth set — Soroban must panic for missing subscriber signature
    env.mock_auths(&[]);
    client.pause_subscription(&subscriber, &merchant, &token, &None);
}

// ─── Event emissions ─────────────────────────────────────────────────────────

/// pause_subscription must emit a "paused" event with the subscriber and merchant topics.
#[test]
fn pause_emits_paused_event() {
    use soroban_sdk::{IntoVal, Symbol};

    let pt       = PT::new();
    let interval = 86_400_u64;

    pt.subscribe(1_000, interval);

    // Clear any previous events from subscribe call
    let event_count_before = pt.env.events().all().len();

    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);

    let events = pt.env.events().all();
    let contract_events: std::vec::Vec<_> = events
        .iter()
        .filter(|e| e.0 == pt.contract_id)
        .collect();

    assert!(
        contract_events.len() > event_count_before as usize
            || !contract_events.is_empty(),
        "pause_subscription must emit at least one contract event"
    );

    // Verify a "paused" event exists in the emitted events
    let paused_sym = Symbol::new(&pt.env, "paused").into_val(&pt.env);
    let has_paused_event = contract_events
        .iter()
        .any(|(_, topics, _)| topics.get(0).map_or(false, |t| t == paused_sym));
    assert!(has_paused_event, "pause_subscription must emit a 'paused' event");
}

/// resume_subscription must emit a "resumed" event.
#[test]
fn resume_emits_resumed_event() {
    use soroban_sdk::{IntoVal, Symbol};

    let pt       = PT::new();
    let interval = 86_400_u64;

    pt.subscribe(1_000, interval);
    pt.client.pause_subscription(&pt.subscriber, &pt.merchant, &pt.token, &None);

    let events_before_count = pt.env.events().all().len();

    pt.client.resume_subscription(&pt.subscriber, &pt.merchant, &pt.token);

    let events = pt.env.events().all();
    let contract_events: std::vec::Vec<_> = events
        .iter()
        .filter(|e| e.0 == pt.contract_id)
        .collect();

    // Verify a "resumed" event was emitted after the resume call
    let resumed_sym = Symbol::new(&pt.env, "resumed").into_val(&pt.env);
    let has_resumed_event = contract_events
        .iter()
        .any(|(_, topics, _)| topics.get(0).map_or(false, |t| t == resumed_sym));
    assert!(has_resumed_event, "resume_subscription must emit a 'resumed' event");
}
