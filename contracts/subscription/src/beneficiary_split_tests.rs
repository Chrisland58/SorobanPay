#![cfg(test)]

//! beneficiary_split_tests.rs — Comprehensive unit tests for beneficiary splits (#1609)

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol, Vec,
};

use crate::{
    error::ContractError,
    storage::{DataKey, SplitConfig, SplitRecipient},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestEnv<'a> {
    env: Env,
    client: SubscriptionProtocolClient<'a>,
    subscriber: Address,
    merchant: Address,
    token: Address,
    contract_id: Address,
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
        token_client.mint(&subscriber, &10_000_000_i128);

        let standard_token = token::Client::new(&env, &token_address);
        standard_token.approve(&subscriber, &contract_id, &10_000_000_i128, &100_000);

        TestEnv {
            env,
            client,
            subscriber,
            merchant,
            token: token_address,
            contract_id,
        }
    }

    fn sub_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.subscriber)
    }

    fn mer_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.merchant)
    }

    fn advance(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }
}

fn make_recipients(env: &Env, entries: &[(Address, u32)]) -> Vec<SplitRecipient> {
    let mut v = Vec::new(env);
    for (addr, bps) in entries {
        v.push_back(SplitRecipient {
            recipient: addr.clone(),
            share_bps: *bps,
        });
    }
    v
}

#[test]
fn test_split_valid_two_recipients() {
    let t = TestEnv::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amt,
        &ivl,
        &false,
        &None,
    );

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);

    let recipients = make_recipients(&t.env, &[(r1.clone(), 5000), (r2.clone(), 5000)]);
    let res = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert!(res.is_ok());

    let split = t.client.get_split(&t.subscriber, &t.merchant).unwrap();
    assert_eq!(split.recipients.len(), 2);

    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let tc = token::Client::new(&t.env, &t.token);
    assert_eq!(tc.balance(&r1), 500_i128, "r1 should receive 50% of 1000");
    assert_eq!(tc.balance(&r2), 500_i128, "r2 should receive 50% of 1000");
    assert_eq!(t.sub_bal(), 10_000_000_i128 - amt);
}

#[test]
fn test_split_valid_three_recipients() {
    let t = TestEnv::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amt,
        &ivl,
        &false,
        &None,
    );

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let r3 = Address::generate(&t.env);

    let recipients = make_recipients(
        &t.env,
        &[(r1.clone(), 5000), (r2.clone(), 3000), (r3.clone(), 2000)],
    );
    t.client.set_split(&t.subscriber, &t.merchant, &recipients);

    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let tc = token::Client::new(&t.env, &t.token);
    assert_eq!(tc.balance(&r1), 500_i128, "r1 should receive 50%");
    assert_eq!(tc.balance(&r2), 300_i128, "r2 should receive 30%");
    assert_eq!(tc.balance(&r3), 200_i128, "r3 should receive 20%");
    assert_eq!(t.sub_bal(), 10_000_000_i128 - amt);
}

#[test]
fn test_split_max_five_recipients_succeeds() {
    let t = TestEnv::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amt,
        &ivl,
        &false,
        &None,
    );

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let r3 = Address::generate(&t.env);
    let r4 = Address::generate(&t.env);
    let r5 = Address::generate(&t.env);

    let recipients = make_recipients(
        &t.env,
        &[
            (r1.clone(), 2000),
            (r2.clone(), 2000),
            (r3.clone(), 2000),
            (r4.clone(), 2000),
            (r5.clone(), 2000),
        ],
    );
    let res = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert!(res.is_ok());

    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let tc = token::Client::new(&t.env, &t.token);
    assert_eq!(tc.balance(&r1), 200_i128);
    assert_eq!(tc.balance(&r2), 200_i128);
    assert_eq!(tc.balance(&r3), 200_i128);
    assert_eq!(tc.balance(&r4), 200_i128);
    assert_eq!(tc.balance(&r5), 200_i128);
}

#[test]
fn test_split_exceeds_max_recipients_rejected() {
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

    let mut entries = Vec::new(&t.env);
    for _ in 0..6 {
        entries.push_back(SplitRecipient {
            recipient: Address::generate(&t.env),
            share_bps: 1666,
        });
    }
    let r = t.client.try_set_split(&t.subscriber, &t.merchant, &entries);
    assert_eq!(r, Err(Ok(ContractError::TooManyRecipients)));
}

#[test]
fn test_split_invalid_sum_rejected() {
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

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);

    // Sum is 6000 != 10000
    let recipients = make_recipients(&t.env, &[(r1.clone(), 3000), (r2.clone(), 3000)]);
    let r = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert_eq!(r, Err(Ok(ContractError::InvalidShareSum)));

    // Sum is 11000 != 10000
    let recipients_over = make_recipients(&t.env, &[(r1.clone(), 6000), (r2.clone(), 5000)]);
    let r_over = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients_over);
    assert_eq!(r_over, Err(Ok(ContractError::InvalidShareSum)));
}

#[test]
fn test_split_duplicate_recipient_rejected() {
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

    let r1 = Address::generate(&t.env);

    let recipients = make_recipients(&t.env, &[(r1.clone(), 5000), (r1.clone(), 5000)]);
    let r = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert_eq!(r, Err(Ok(ContractError::DuplicateRecipient)));
}

#[test]
fn test_split_zero_share_rejected() {
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

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);

    let recipients = make_recipients(&t.env, &[(r1.clone(), 0), (r2.clone(), 10000)]);
    let r = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert_eq!(r, Err(Ok(ContractError::ZeroShare)));
}

#[test]
fn test_split_no_active_subscription_rejected() {
    let t = TestEnv::new();
    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let recipients = make_recipients(&t.env, &[(r1.clone(), 5000), (r2.clone(), 5000)]);

    let r = t
        .client
        .try_set_split(&t.subscriber, &t.merchant, &recipients);
    assert_eq!(r, Err(Ok(ContractError::NoActiveSubscription)));
}

#[test]
fn test_split_clear_configuration() {
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

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let recipients = make_recipients(&t.env, &[(r1.clone(), 5000), (r2.clone(), 5000)]);
    t.client.set_split(&t.subscriber, &t.merchant, &recipients);
    assert!(t.client.get_split(&t.subscriber, &t.merchant).is_some());

    // Clearing split by passing empty vec
    let empty = Vec::new(&t.env);
    t.client.set_split(&t.subscriber, &t.merchant, &empty);
    assert!(t.client.get_split(&t.subscriber, &t.merchant).is_none());
}

#[test]
fn test_split_remainder_absorbed_without_dust() {
    let t = TestEnv::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amt,
        &ivl,
        &false,
        &None,
    );

    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let r3 = Address::generate(&t.env);

    // 3333 + 3333 + 3334 = 10000; last recipient absorbs remainder
    let recipients = make_recipients(
        &t.env,
        &[(r1.clone(), 3333), (r2.clone(), 3333), (r3.clone(), 3334)],
    );
    t.client.set_split(&t.subscriber, &t.merchant, &recipients);

    let sub_before = t.sub_bal();
    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let tc = token::Client::new(&t.env, &t.token);
    let total_received = tc.balance(&r1) + tc.balance(&r2) + tc.balance(&r3);
    assert_eq!(total_received, amt);
    assert_eq!(t.sub_bal(), sub_before - amt);
}

#[test]
fn test_split_already_settled_unaffected() {
    let t = TestEnv::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &amt,
        &ivl,
        &false,
        &None,
    );

    // Payment 1: no split, goes to merchant
    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let mer_after_first = t.mer_bal();
    assert_eq!(mer_after_first, amt);

    // Configure split
    let r1 = Address::generate(&t.env);
    let r2 = Address::generate(&t.env);
    let recipients = make_recipients(&t.env, &[(r1.clone(), 7000), (r2.clone(), 3000)]);
    t.client.set_split(&t.subscriber, &t.merchant, &recipients);

    // Payment 2: split applies
    t.advance(ivl + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let tc = token::Client::new(&t.env, &t.token);
    assert_eq!(tc.balance(&r1), 700_i128);
    assert_eq!(tc.balance(&r2), 300_i128);
    assert_eq!(t.mer_bal(), mer_after_first);
}
