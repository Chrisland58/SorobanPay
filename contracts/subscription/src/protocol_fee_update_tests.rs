#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{ProposedFeeConfig, ProtocolFeeConfig, MAX_FEE_BPS},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct FeeFixture {
    env: Env,
    admin: Address,
    collector: Address,
    subscriber: Address,
    merchant: Address,
    token: Address,
    contract_id: Address,
}

impl FeeFixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let collector = Address::generate(&env);
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
            &(env.ledger().sequence() + 100_000_u32),
        );

        // Initial subscription: amount 100_000
        client
            .subscribe(&subscriber, &merchant, &token, &100_000_i128, &86_400_u64)
            .unwrap();

        Self {
            env,
            admin,
            collector,
            subscriber,
            merchant,
            token,
            contract_id,
        }
    }
}

#[test]
fn test_proposal_validation_at_submission_time() {
    let f = FeeFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);
    let now = 100_000_u64;
    f.env.ledger().with_mut(|l| l.timestamp = now);

    // 1. fee_bps > MAX_FEE_BPS (500) must fail with FeeBpsTooHigh
    let res_high = client.try_propose_protocol_fee(
        &f.admin,
        &(MAX_FEE_BPS + 1),
        &f.collector,
        &(now + 86_400),
    );
    assert!(matches!(res_high, Err(Ok(ContractError::FeeBpsTooHigh))));

    // 2. activation_time < now must fail with InvalidActivationTime
    let res_past = client.try_propose_protocol_fee(
        &f.admin,
        &100, // 1%
        &f.collector,
        &(now - 1),
    );
    assert!(matches!(
        res_past,
        Err(Ok(ContractError::InvalidActivationTime))
    ));

    // 3. Valid proposal succeeds
    let res_valid = client.propose_protocol_fee(
        &f.admin,
        &100,
        &f.collector,
        &(now + 86_400),
    );
    assert_eq!(res_valid, ());

    let proposed = client.get_proposed_protocol_fee().unwrap();
    assert_eq!(proposed.fee_bps, 100);
    assert_eq!(proposed.fee_collector, f.collector);
    assert_eq!(proposed.activation_time, now + 86_400);
    assert_eq!(proposed.proposed_at, now);

    // Active fee remains None until activation!
    assert_eq!(client.get_protocol_fee(), None);
}

#[test]
fn test_proposal_cancellation_and_replacement() {
    let f = FeeFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);
    let now = 100_000_u64;
    f.env.ledger().with_mut(|l| l.timestamp = now);

    // Propose initial fee (100 bps)
    client.propose_protocol_fee(&f.admin, &100, &f.collector, &(now + 86_400));
    assert!(client.get_proposed_protocol_fee().is_some());

    // Replace proposal with 200 bps
    let new_collector = Address::generate(&f.env);
    client.propose_protocol_fee(&f.admin, &200, &new_collector, &(now + 172_800));

    let updated = client.get_proposed_protocol_fee().unwrap();
    assert_eq!(updated.fee_bps, 200);
    assert_eq!(updated.fee_collector, new_collector);
    assert_eq!(updated.activation_time, now + 172_800);

    // Cancel proposal
    client.cancel_protocol_fee_proposal(&f.admin);
    assert_eq!(client.get_proposed_protocol_fee(), None);

    // Cancelling when none exists returns NoPendingFeeProposal
    let cancel_again = client.try_cancel_protocol_fee_proposal(&f.admin);
    assert!(matches!(
        cancel_again,
        Err(Ok(ContractError::NoPendingFeeProposal))
    ));
}

#[test]
fn test_activation_boundaries_and_payment_unaffected_until_activated() {
    let f = FeeFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    // Set initial active fee of 50 bps (0.5%) via set_protocol_fee
    client.set_protocol_fee(&f.admin, &50, &f.collector);
    assert_eq!(
        client.get_protocol_fee(),
        Some(ProtocolFeeConfig {
            fee_bps: 50,
            fee_collector: f.collector.clone(),
        })
    );

    let start = 100_000_u64;
    let activation = start + 86_400; // 24hr delay
    f.env.ledger().with_mut(|l| l.timestamp = start);

    let new_collector = Address::generate(&f.env);
    // Propose 200 bps (2%)
    client.propose_protocol_fee(&f.admin, &200, &new_collector, &activation);

    // Payment collection during proposal window MUST use old fee (50 bps)
    f.env.ledger().with_mut(|l| l.timestamp = start + 1000);
    client.execute_payment(&f.subscriber, &f.merchant, &f.token).unwrap();

    let collector_balance = token::Client::new(&f.env, &f.token).balance(&f.collector);
    let new_collector_balance = token::Client::new(&f.env, &f.token).balance(&new_collector);
    // 100_000 * 50 / 10_000 = 500
    assert_eq!(collector_balance, 500);
    assert_eq!(new_collector_balance, 0); // New collector received 0!

    // 1. Activation before boundary (now < activation) fails
    let early = client.try_activate_protocol_fee(&f.admin);
    assert!(matches!(
        early,
        Err(Ok(ContractError::FeeActivationTimeNotReached))
    ));

    // 2. Activation exactly at boundary (now == activation) succeeds!
    f.env.ledger().with_mut(|l| l.timestamp = activation);
    client.activate_protocol_fee(&f.admin).unwrap();

    // Active fee is now 200 bps with new collector
    assert_eq!(
        client.get_protocol_fee(),
        Some(ProtocolFeeConfig {
            fee_bps: 200,
            fee_collector: new_collector.clone(),
        })
    );
    // Proposal is cleared
    assert_eq!(client.get_proposed_protocol_fee(), None);

    // Subsequent payment collection applies the new fee (200 bps)
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = activation + 86_401);
    client.execute_payment(&f.subscriber, &f.merchant, &f.token).unwrap();

    // 100_000 * 200 / 10_000 = 2000
    let new_collector_balance_after =
        token::Client::new(&f.env, &f.token).balance(&new_collector);
    assert_eq!(new_collector_balance_after, 2000);
}

#[test]
fn test_unauthorized_propose_or_activate_rejected() {
    let f = FeeFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);
    let attacker = Address::generate(&f.env);
    let now = 100_000_u64;
    f.env.ledger().with_mut(|l| l.timestamp = now);

    let res_prop = client.try_propose_protocol_fee(
        &attacker,
        &100,
        &f.collector,
        &(now + 86_400),
    );
    assert!(matches!(res_prop, Err(Ok(ContractError::NotAdmin))));

    let res_act = client.try_activate_protocol_fee(&attacker);
    assert!(matches!(res_act, Err(Ok(ContractError::NotAdmin))));

    let res_cancel = client.try_cancel_protocol_fee_proposal(&attacker);
    assert!(matches!(res_cancel, Err(Ok(ContractError::NotAdmin))));
}
