#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};

use crate::{
    error::ContractError,
    storage::{DataKey, TokenStatus},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestEnv {
    env: Env,
    admin: Address,
    subscriber: Address,
    merchant: Address,
    token: Address,
    token_admin: Address,
    client: SubscriptionProtocolClient<'static>,
}

impl TestEnv {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &100_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &50_000_000_i128,
            &(env.ledger().sequence() + 100_000),
        );

        Self {
            env,
            admin,
            subscriber,
            merchant,
            token,
            token_admin,
            client,
        }
    }

    fn advance_time(&self, seconds: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + seconds);
    }
}

#[test]
fn test_token_allowlist_admin_lifecycle() {
    let t = TestEnv::setup();

    // 1. Initial state: token has no explicit status.
    assert_eq!(t.client.get_token_status(&t.token), None);

    // 2. Admin adds token as Active.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Active);
    assert_eq!(
        t.client.get_token_status(&t.token),
        Some(TokenStatus::Active)
    );

    // Verify event emission: (old = 0, new = 1)
    let last_event = t.env.events().all().last().unwrap();
    assert_eq!(last_event.0, t.client.address);

    // 3. Admin transitions token to Disabled.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Disabled);
    assert_eq!(
        t.client.get_token_status(&t.token),
        Some(TokenStatus::Disabled)
    );

    // 4. Admin re-enables token back to Active.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Active);
    assert_eq!(
        t.client.get_token_status(&t.token),
        Some(TokenStatus::Active)
    );

    // 5. Admin transitions token to Retired.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Retired);
    assert_eq!(
        t.client.get_token_status(&t.token),
        Some(TokenStatus::Retired)
    );

    // 6. Attempting to transition from Retired to Active or Disabled must fail.
    let res = t
        .client
        .try_set_token_status(&t.admin, &t.token, &TokenStatus::Active);
    assert_eq!(
        res.err(),
        Some(Ok(ContractError::InvalidTokenStatusTransition))
    );

    let res_disabled = t
        .client
        .try_set_token_status(&t.admin, &t.token, &TokenStatus::Disabled);
    assert_eq!(
        res_disabled.err(),
        Some(Ok(ContractError::InvalidTokenStatusTransition))
    );
}

#[test]
fn test_unauthorized_token_status_change() {
    let t = TestEnv::setup();
    let imposter = Address::generate(&t.env);

    let res = t
        .client
        .try_set_token_status(&imposter, &t.token, &TokenStatus::Active);
    assert_eq!(res.err(), Some(Ok(ContractError::NotAdmin)));
}

#[test]
fn test_disabled_asset_settles_existing_obligations_but_blocks_new_creation() {
    let t = TestEnv::setup();

    // Set token to Active initially.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Active);

    // Create an existing subscription with the active asset.
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

    // Admin disables the token.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Disabled);

    // 1. Attempting to create a NEW subscription with the disabled token must fail.
    let subscriber_2 = Address::generate(&t.env);
    let res_new_sub = t.client.try_subscribe(
        &subscriber_2,
        &t.merchant,
        &t.token,
        &amount,
        &interval,
        &false,
        &None,
    );
    assert_eq!(res_new_sub.err(), Some(Ok(ContractError::TokenDisabled)));

    // 2. Existing subscription MUST still settle its obligations.
    t.advance_time(interval);
    let initial_merchant_bal = token::Client::new(&t.env, &t.token).balance(&t.merchant);
    let exec_res = t
        .client
        .try_execute_payment(&t.subscriber, &t.merchant, &t.token);
    assert!(
        exec_res.is_ok(),
        "Disabled token should allow settling existing subscriptions"
    );
    let after_merchant_bal = token::Client::new(&t.env, &t.token).balance(&t.merchant);
    assert_eq!(after_merchant_bal, initial_merchant_bal + amount);
}

#[test]
fn test_retired_asset_blocks_new_creation_and_existing_settlement() {
    let t = TestEnv::setup();

    // Create subscription while active.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Active);
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

    // Admin retires the token.
    t.client
        .set_token_status(&t.admin, &t.token, &TokenStatus::Retired);

    // 1. New subscription with retired token is blocked.
    let subscriber_2 = Address::generate(&t.env);
    let res_new_sub = t.client.try_subscribe(
        &subscriber_2,
        &t.merchant,
        &t.token,
        &amount,
        &interval,
        &false,
        &None,
    );
    assert_eq!(res_new_sub.err(), Some(Ok(ContractError::TokenRetired)));

    // 2. Existing subscription CANNOT settle obligations with retired token.
    t.advance_time(interval);
    let exec_res = t
        .client
        .try_execute_payment(&t.subscriber, &t.merchant, &t.token);
    assert_eq!(exec_res.err(), Some(Ok(ContractError::TokenRetired)));
}

#[test]
fn test_strict_allowlist_mode() {
    let t = TestEnv::setup();

    // Strict allowlist enabled by admin.
    t.client.set_token_allowlist_enabled(&t.admin, &true);
    assert!(t.client.is_token_allowlist_enabled());

    let unlisted_token = t
        .env
        .register_stellar_asset_contract_v2(t.token_admin.clone())
        .address();

    // New subscription with unlisted token fails.
    let amount = 1_000_000_i128;
    let interval = 86_400_u64;
    let res = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &unlisted_token,
        &amount,
        &interval,
        &false,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(ContractError::TokenNotAllowed)));

    // After allowlisting, subscription succeeds.
    t.client
        .set_token_status(&t.admin, &unlisted_token, &TokenStatus::Active);
    StellarAssetClient::new(&t.env, &unlisted_token).mint(&t.subscriber, &10_000_000_i128);
    token::Client::new(&t.env, &unlisted_token).approve(
        &t.subscriber,
        &t.client.address,
        &5_000_000_i128,
        &(t.env.ledger().sequence() + 10_000),
    );
    let ok_res = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &unlisted_token,
        &amount,
        &interval,
        &false,
        &None,
    );
    assert!(ok_res.is_ok());
}
