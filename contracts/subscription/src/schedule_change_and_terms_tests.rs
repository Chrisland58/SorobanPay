#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, BytesN, Env,
};

use crate::{
    error::ContractError,
    storage::PendingScheduleChange,
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestFixture {
    env: Env,
    client: SubscriptionProtocolClient,
    subscriber: Address,
    merchant: Address,
    token: Address,
}

impl TestFixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &50_000_000_i128);

        let contract_id = env.register_contract(None, SubscriptionProtocol);
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);

        // Initial subscription: amount 100, interval 100,000 (next_payment = 1,100,000)
        client.subscribe(
            &subscriber,
            &merchant,
            &token,
            &100_i128,
            &100_000_u64,
            &false,
            &None,
        );

        TestFixture {
            env,
            client,
            subscriber,
            merchant,
            token,
        }
    }
}

#[test]
fn test_schedule_change_future_effective_time() {
    let f = TestFixture::new();
    let effective = 1_200_000;

    let res = f.client.try_schedule_subscription_change(
        &f.subscriber,
        &f.merchant,
        &250_i128,
        &120_000_u64,
        &effective,
    );
    assert!(res.is_ok());

    let pending = f.client.get_pending_schedule(&f.subscriber, &f.merchant);
    assert_eq!(
        pending,
        Some(PendingScheduleChange {
            new_amount: 250,
            new_interval: 120_000,
            effective_time: effective,
        })
    );
}

#[test]
fn test_schedule_change_rejects_past_effective_time() {
    let f = TestFixture::new();
    let past = 900_000; // current time is 1,000,000

    let res = f.client.try_schedule_subscription_change(
        &f.subscriber,
        &f.merchant,
        &200_i128,
        &90_000_u64,
        &past,
    );
    assert_eq!(res, Err(Ok(ContractError::EffectiveTimeInPast)));
}

#[test]
fn test_schedule_change_only_applies_at_or_after_effective_time() {
    let f = TestFixture::new();
    // next_payment is 1,100,000. Schedule change effective at 1,150,000.
    f.client.schedule_subscription_change(
        &f.subscriber,
        &f.merchant,
        &300_i128,
        &150_000_u64,
        &1_150_000_u64,
    );

    // 1st payment executes at 1,100,000 (before effective time 1,150,000)
    f.env.ledger().with_mut(|l| l.timestamp = 1_100_000);
    f.client.execute_payment(&f.subscriber, &f.merchant, &f.token);

    // Sub charged old amount (100) and pending change is still intact
    let pending = f.client.get_pending_schedule(&f.subscriber, &f.merchant);
    assert!(pending.is_some());

    // Advance to 1,200,000 (next_payment was 1,100,000 + 100,000 = 1,200,000 >= effective 1,150,000)
    f.env.ledger().with_mut(|l| l.timestamp = 1_200_000);
    f.client.execute_payment(&f.subscriber, &f.merchant, &f.token);

    // Change was applied and pending record cleared
    let pending_after = f.client.get_pending_schedule(&f.subscriber, &f.merchant);
    assert_eq!(pending_after, None);
}

#[test]
fn test_cancel_pending_schedule() {
    let f = TestFixture::new();
    f.client.schedule_subscription_change(
        &f.subscriber,
        &f.merchant,
        &300_i128,
        &150_000_u64,
        &1_200_000_u64,
    );

    let cancel_res = f.client.try_cancel_pending_schedule(&f.subscriber, &f.merchant);
    assert!(cancel_res.is_ok());

    let pending = f.client.get_pending_schedule(&f.subscriber, &f.merchant);
    assert_eq!(pending, None);
}

#[test]
fn test_terms_digest_storage_and_retrieval() {
    let f = TestFixture::new();
    let digest = BytesN::from_array(&f.env, &[42u8; 32]);

    assert_eq!(f.client.get_terms_digest(&f.subscriber, &f.merchant), None);

    let set_res = f.client.try_set_terms_digest(&f.subscriber, &f.merchant, &digest);
    assert!(set_res.is_ok());

    let stored = f.client.get_terms_digest(&f.subscriber, &f.merchant);
    assert_eq!(stored, Some(digest));
}
