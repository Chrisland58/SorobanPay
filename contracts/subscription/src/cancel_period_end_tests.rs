/// cancel_period_end_tests.rs — Unit and boundary tests for cancel-at-period-end semantics.
///
/// Issue #1605: [Smart Contract] Add cancel-at-period-end semantics for active subscriptions
///
/// Acceptance criteria:
/// - The effective cancellation timestamp is persisted and emitted in the event schema.
/// - Execution at the final valid payment boundary and repeated cancellation attempts are tested.
/// - Add or update automated coverage for expected behavior, relevant boundary cases, and failure handling.

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

const INTERVAL: u64 = 86_400; // 1 day
const AMOUNT: i128 = 5_000_000;

struct TestHarness {
    env: Env,
    client: SubscriptionProtocolClient,
    subscriber: Address,
    merchant: Address,
    token: Address,
}

impl TestHarness {
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
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token_id.address();
        let stellar_client = StellarAssetClient::new(&env, &token_address);
        stellar_client.mint(&subscriber, &100_000_000);

        let token_client = token::Client::new(&env, &token_address);
        token_client.approve(&subscriber, &contract_id, &100_000_000, &100_000);

        Self {
            env,
            client,
            subscriber,
            merchant,
            token: token_address,
        }
    }
}

#[test]
fn cancel_at_period_end_marks_subscription_and_preserves_access_until_period_boundary() {
    let h = TestHarness::setup();
    let start_ts = 1_000_000;
    h.env.ledger().set_timestamp(start_ts);

    h.client.subscribe(
        &h.subscriber,
        &h.merchant,
        &h.token,
        &AMOUNT,
        &INTERVAL,
        &None,
        &None,
        &None,
    );

    let sub = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert_eq!(sub.next_payment, start_ts + INTERVAL);

    // Schedule cancellation at period end
    let res = h.client.try_cancel_at_period_end(&h.subscriber, &h.merchant);
    assert!(res.is_ok(), "Expected cancel_at_period_end to succeed");

    // Subscription remains in storage with cancel_at_period_end flag
    let marked_sub = h.client.get_subscription(&h.subscriber, &h.merchant);
    assert!(marked_sub.will_cancel_at_period_end());

    // Calling again returns SubscriptionCancelled (no duplicate scheduling)
    let dup_res = h.client.try_cancel_at_period_end(&h.subscriber, &h.merchant);
    assert_eq!(dup_res, Err(Ok(ContractError::SubscriptionCancelled)));

    // Attempting execute_payment before next_payment returns PaymentNotDue
    h.env.ledger().set_timestamp(start_ts + (INTERVAL / 2));
    let early_res = h.client.try_execute_payment(&h.subscriber, &h.merchant);
    assert_eq!(early_res, Err(Ok(ContractError::PaymentNotDue)));

    // Fast-forward to next_payment boundary: calling execute_payment terminates the subscription
    // without collecting funds
    let token_client = token::Client::new(&h.env, &h.token);
    let subscriber_bal_before = token_client.balance(&h.subscriber);
    let merchant_bal_before = token_client.balance(&h.merchant);

    h.env.ledger().set_timestamp(start_ts + INTERVAL);
    let term_res = h.client.try_execute_payment(&h.subscriber, &h.merchant);
    assert_eq!(term_res, Err(Ok(ContractError::SubscriptionCancelled)));

    // No funds moved
    assert_eq!(token_client.balance(&h.subscriber), subscriber_bal_before);
    assert_eq!(token_client.balance(&h.merchant), merchant_bal_before);

    // Subscription record has been removed from persistent storage
    let key = DataKey::Subscription(subscription_key(&h.env, &h.subscriber, &h.merchant));
    let exists = h.env.as_contract(&h.client.address, || {
        h.env.storage().persistent().has(&key)
    });
    assert!(!exists, "Subscription must be deleted upon reaching period end");
}
