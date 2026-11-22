#![cfg(test)]

//! horizon_boundary_tests.rs — Boundary and governance tests for maximum subscription horizon (#1607)

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{DEFAULT_MAX_HORIZON, MAX_AMOUNT},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestEnv<'a> {
    env: Env,
    client: SubscriptionProtocolClient<'a>,
    admin: Address,
    subscriber: Address,
    merchant: Address,
    token: Address,
}

impl<'a> TestEnv<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000;
        });

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token_id.address();
        let token_client = StellarAssetClient::new(&env, &token_address);
        token_client.mint(&subscriber, &10_000_000_000_i128);

        let standard_token = token::Client::new(&env, &token_address);
        standard_token.approve(&subscriber, &contract_id, &10_000_000_000_i128, &100_000);

        TestEnv {
            env,
            client,
            admin,
            subscriber,
            merchant,
            token: token_address,
        }
    }
}

#[test]
fn test_default_max_horizon_value() {
    let t = TestEnv::new();
    assert_eq!(t.client.get_max_horizon(), DEFAULT_MAX_HORIZON);
    assert_eq!(t.client.get_max_horizon(), 31_536_000); // 365 days
}

#[test]
fn test_subscribe_boundary_exact_max_horizon_succeeds() {
    let t = TestEnv::new();
    let max_h = t.client.get_max_horizon();

    // Creation with interval exactly equal to maximum horizon must succeed
    let res = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &max_h,
        &false,
        &None,
    );
    assert!(res.is_ok());

    let sub = t
        .client
        .get_subscription(&t.subscriber, &t.merchant)
        .unwrap();
    assert_eq!(sub.interval, max_h);
    assert_eq!(sub.next_payment, 1_700_000_000 + max_h);
}

#[test]
fn test_subscribe_boundary_one_unit_beyond_max_horizon_rejected() {
    let t = TestEnv::new();
    // Reconfigure max horizon to a smaller test horizon to avoid IntervalTooLong (> 31_536_000)
    let custom_horizon = 10_000_000_u64;
    t.client.set_max_horizon(&t.admin, &custom_horizon);

    // 1 unit beyond custom maximum horizon
    let res = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &(custom_horizon + 1),
        &false,
        &None,
    );
    assert_eq!(res, Err(Ok(ContractError::ScheduleHorizonExceeded)));
}

#[test]
fn test_subscribe_boundary_timestamp_overflow_rejected() {
    let t = TestEnv::new();
    // Advance ledger clock so that ledger + interval overflows u64
    t.env.ledger().with_mut(|l| {
        l.timestamp = u64::MAX - 100;
    });

    let res = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &86_400_u64,
        &false,
        &None,
    );
    assert_eq!(res, Err(Ok(ContractError::InvalidTimestamp)));
}

#[test]
fn test_update_subscription_boundary_exact_max_horizon_succeeds() {
    let t = TestEnv::new();
    let max_h = t.client.get_max_horizon();

    // Initial subscribe with 1 day
    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &86_400_u64,
        &false,
        &None,
    );

    // Update interval to exact max horizon
    let res = t
        .client
        .try_update_subscription(&t.subscriber, &t.merchant, &2_000_i128, &max_h);
    assert!(res.is_ok());

    let sub = t
        .client
        .get_subscription(&t.subscriber, &t.merchant)
        .unwrap();
    assert_eq!(sub.interval, max_h);
    assert_eq!(sub.amount, 2_000_i128);
}

#[test]
fn test_update_subscription_boundary_one_unit_beyond_rejected() {
    let t = TestEnv::new();
    let custom_horizon = 10_000_000_u64;
    t.client.set_max_horizon(&t.admin, &custom_horizon);

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &86_400_u64,
        &false,
        &None,
    );

    // Update with 1 unit beyond max horizon
    let res = t.client.try_update_subscription(
        &t.subscriber,
        &t.merchant,
        &2_000_i128,
        &(custom_horizon + 1),
    );
    assert_eq!(res, Err(Ok(ContractError::ScheduleHorizonExceeded)));
}

#[test]
fn test_update_subscription_timestamp_overflow_rejected() {
    let t = TestEnv::new();

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &1_000_i128,
        &86_400_u64,
        &false,
        &None,
    );

    // Warp ledger to near u64::MAX
    t.env.ledger().with_mut(|l| {
        l.timestamp = u64::MAX - 100;
    });

    let res =
        t.client
            .try_update_subscription(&t.subscriber, &t.merchant, &2_000_i128, &86_400_u64);
    assert_eq!(res, Err(Ok(ContractError::InvalidTimestamp)));
}

#[test]
fn test_admin_governance_set_max_horizon() {
    let t = TestEnv::new();

    let new_horizon = 15_000_000_u64;
    let res = t.client.try_set_max_horizon(&t.admin, &new_horizon);
    assert!(res.is_ok());
    assert_eq!(t.client.get_max_horizon(), new_horizon);
}

#[test]
fn test_admin_governance_non_admin_rejected() {
    let t = TestEnv::new();
    let non_admin = Address::generate(&t.env);

    let res = t.client.try_set_max_horizon(&non_admin, &15_000_000_u64);
    assert_eq!(res, Err(Ok(ContractError::NotAdmin)));
}

#[test]
fn test_admin_governance_invalid_horizon_bounds() {
    let t = TestEnv::new();

    // Less than 1 day (86_400)
    let res_low = t.client.try_set_max_horizon(&t.admin, &86_399_u64);
    assert_eq!(res_low, Err(Ok(ContractError::InvalidHorizon)));

    // Greater than 10 years (315_360_000)
    let res_high = t.client.try_set_max_horizon(&t.admin, &315_360_001_u64);
    assert_eq!(res_high, Err(Ok(ContractError::InvalidHorizon)));
}

#[test]
fn test_governance_reconfiguration_applies_consistently_to_creation_and_update() {
    let t = TestEnv::new();

    // Configure horizon to 5 days
    let five_days = 5 * 86_400_u64;
    t.client.set_max_horizon(&t.admin, &five_days);

    // Creation at 5 days succeeds
    assert!(t
        .client
        .try_subscribe(
            &t.subscriber,
            &t.merchant,
            &t.token,
            &1_000_i128,
            &five_days,
            &false,
            &None,
        )
        .is_ok());

    // Creation beyond 5 days fails
    let sub2 = Address::generate(&t.env);
    assert_eq!(
        t.client.try_subscribe(
            &sub2,
            &t.merchant,
            &t.token,
            &1_000_i128,
            &(five_days + 1),
            &false,
            &None,
        ),
        Err(Ok(ContractError::ScheduleHorizonExceeded))
    );

    // Update at 5 days succeeds
    assert!(t
        .client
        .try_update_subscription(&t.subscriber, &t.merchant, &2_000_i128, &five_days,)
        .is_ok());

    // Update beyond 5 days fails
    assert_eq!(
        t.client
            .try_update_subscription(&t.subscriber, &t.merchant, &2_000_i128, &(five_days + 1),),
        Err(Ok(ContractError::ScheduleHorizonExceeded))
    );
}
