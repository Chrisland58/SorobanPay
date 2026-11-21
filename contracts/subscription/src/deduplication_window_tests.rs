#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, BytesN, Env,
};

use crate::{
    error::ContractError,
    storage::{ExecutionRecord, DEDUP_WINDOW_SECONDS},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct DedupFixture {
    env: Env,
    admin: Address,
    subscriber: Address,
    merchant: Address,
    token: Address,
    contract_id: Address,
}

impl DedupFixture {
    fn new() -> Self {
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
            &(env.ledger().sequence() + 100_000_u32),
        );

        // Create initial active subscription: interval 86_400 (1 day), amount 100_000
        client
            .subscribe(&subscriber, &merchant, &token, &100_000_i128, &86_400_u64)
            .unwrap();

        Self {
            env,
            admin,
            subscriber,
            merchant,
            token,
            contract_id,
        }
    }
}

#[test]
fn test_replayed_identifier_cannot_collect_twice_within_window() {
    let f = DedupFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    // Advance ledger so payment is due
    f.env.ledger().with_mut(|l| l.timestamp = 86_401);

    let exec_id = BytesN::from_array(&f.env, &[42u8; 32]);

    // Initial payment execution with identifier
    client
        .execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &exec_id)
        .unwrap();

    let balance_after_1 = token::Client::new(&f.env, &f.token).balance(&f.merchant);
    assert_eq!(balance_after_1, 100_000_i128);

    // Immediate replay with the same identifier MUST fail with DuplicateExecution
    let replay = client.try_execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &exec_id);
    assert!(matches!(replay, Err(Ok(ContractError::DuplicateExecution))));

    // Verify merchant balance was NOT charged twice
    let balance_after_replay = token::Client::new(&f.env, &f.token).balance(&f.merchant);
    assert_eq!(balance_after_replay, 100_000_i128);

    // Verify record exists via query
    let record = client
        .get_execution_record(&f.subscriber, &f.merchant, &exec_id)
        .unwrap();
    assert_eq!(record.amount, 100_000_i128);
    assert_eq!(record.executed_at, 86_401);
}

#[test]
fn test_deduplication_window_boundary_and_deterministic_cleanup() {
    let f = DedupFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    let start_time = 100_000_u64;
    f.env.ledger().with_mut(|l| l.timestamp = start_time);

    let exec_id = BytesN::from_array(&f.env, &[77u8; 32]);

    client
        .execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &exec_id)
        .unwrap();

    // 1. Within retention window: cleanup must fail with DeduplicationWindowActive
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = start_time + 1000);
    let cleanup_early =
        client.try_cleanup_execution_record(&f.subscriber, &f.merchant, &exec_id);
    assert!(matches!(
        cleanup_early,
        Err(Ok(ContractError::DeduplicationWindowActive))
    ));

    // 2. Exactly at window boundary (executed_at + DEDUP_WINDOW_SECONDS): still active
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = start_time + DEDUP_WINDOW_SECONDS);
    let cleanup_boundary =
        client.try_cleanup_execution_record(&f.subscriber, &f.merchant, &exec_id);
    assert!(matches!(
        cleanup_boundary,
        Err(Ok(ContractError::DeduplicationWindowActive))
    ));

    // Replay at exact boundary is still blocked
    let replay_boundary =
        client.try_execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &exec_id);
    assert!(matches!(
        replay_boundary,
        Err(Ok(ContractError::DuplicateExecution))
    ));

    // 3. Just past window boundary (+ 1 second): cleanup succeeds deterministically
    f.env
        .ledger()
        .with_mut(|l| l.timestamp = start_time + DEDUP_WINDOW_SECONDS + 1);
    let cleaned = client.cleanup_execution_record(&f.subscriber, &f.merchant, &exec_id);
    assert_eq!(cleaned, true);

    // Record is now pruned
    assert_eq!(
        client.get_execution_record(&f.subscriber, &f.merchant, &exec_id),
        None
    );
}

#[test]
fn test_distinct_execution_identifiers_succeed_independently() {
    let f = DedupFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    // First payment cycle
    f.env.ledger().with_mut(|l| l.timestamp = 86_401);
    let id_1 = BytesN::from_array(&f.env, &[1u8; 32]);
    client
        .execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &id_1)
        .unwrap();

    // Second payment cycle (next day)
    f.env.ledger().with_mut(|l| l.timestamp = 86_401 + 86_400);
    let id_2 = BytesN::from_array(&f.env, &[2u8; 32]);
    client
        .execute_payment_with_id(&f.subscriber, &f.merchant, &f.token, &id_2)
        .unwrap();

    let balance = token::Client::new(&f.env, &f.token).balance(&f.merchant);
    assert_eq!(balance, 200_000_i128);

    assert!(client
        .get_execution_record(&f.subscriber, &f.merchant, &id_1)
        .is_some());
    assert!(client
        .get_execution_record(&f.subscriber, &f.merchant, &id_2)
        .is_some());
}
