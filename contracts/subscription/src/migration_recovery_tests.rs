#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{self, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    error::ContractError,
    storage::{
        subscription_key, DataKey, MigrationProgress, MigrationStatus, SubscriptionData,
        CURRENT_SCHEMA_VERSION, MAX_MIGRATION_STEP,
    },
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct MigrationFixture {
    env: Env,
    admin: Address,
    contract_id: Address,
    token: Address,
}

impl MigrationFixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);

        Self {
            env,
            admin,
            contract_id,
            token,
        }
    }

    fn create_valid_subscription(
        &self,
        subscriber: &Address,
        merchant: &Address,
        amount: i128,
        interval: u64,
    ) {
        StellarAssetClient::new(&self.env, &self.token).mint(subscriber, &10_000_000_i128);
        token::Client::new(&self.env, &self.token).approve(
            subscriber,
            &self.contract_id,
            &5_000_000_i128,
            &(self.env.ledger().sequence() + 100_000_u32),
        );
        let client = SubscriptionProtocolClient::new(&self.env, &self.contract_id);
        client
            .subscribe(subscriber, merchant, &self.token, &amount, &interval)
            .unwrap();
    }
}

#[test]
fn test_bounded_migration_processes_in_steps_and_completes() {
    let f = MigrationFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    let mut records = Vec::new(&f.env);
    for _ in 0..5 {
        let sub = Address::generate(&f.env);
        let merch = Address::generate(&f.env);
        f.create_valid_subscription(&sub, &merch, 100_000, 86_400);
        records.push_back((sub, merch));
    }

    // Step 1: Process 2 records
    let p1 = client.migrate_records_bounded(&f.admin, &records, &2);
    assert_eq!(p1.status, MigrationStatus::InProgress);
    assert_eq!(p1.processed_records, 2);
    assert_eq!(p1.batch_cursor, 2);
    assert_eq!(p1.total_records, 5);

    // Step 2: Process next 2 records
    let p2 = client.migrate_records_bounded(&f.admin, &records, &2);
    assert_eq!(p2.status, MigrationStatus::InProgress);
    assert_eq!(p2.processed_records, 4);
    assert_eq!(p2.batch_cursor, 4);

    // Step 3: Process remaining 1 record (completing the migration)
    let p3 = client.migrate_records_bounded(&f.admin, &records, &2);
    assert_eq!(p3.status, MigrationStatus::Completed);
    assert_eq!(p3.processed_records, 5);
    assert_eq!(p3.batch_cursor, 5);

    // Schema version should now be current
    assert_eq!(client.get_schema_version(), CURRENT_SCHEMA_VERSION);

    // Calling again returns already completed error
    let repeated = client.try_migrate_records_bounded(&f.admin, &records, &2);
    assert!(matches!(
        repeated,
        Err(Ok(ContractError::MigrationAlreadyCompleted))
    ));
}

#[test]
fn test_migration_stops_on_invalid_legacy_record_without_partial_writes() {
    let f = MigrationFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    let mut records = Vec::new(&f.env);

    // Valid record 0
    let sub0 = Address::generate(&f.env);
    let merch0 = Address::generate(&f.env);
    f.create_valid_subscription(&sub0, &merch0, 100_000, 86_400);
    records.push_back((sub0.clone(), merch0.clone()));

    // Corrupt record 1 directly in storage (amount = 0)
    let sub1 = Address::generate(&f.env);
    let merch1 = Address::generate(&f.env);
    let hash1 = subscription_key(&f.env, &sub1, &merch1);
    let key1 = DataKey::Subscription(hash1);
    let corrupt_data = SubscriptionData {
        token: f.token.clone(),
        amount: 0, // INVALID amount
        interval: 86_400,
        next_payment: 100,
        is_paused: false,
        grace_period: None,
        paused_until: None,
        overdue_since: None,
    };
    f.env.storage().persistent().set(&key1, &corrupt_data);
    records.push_back((sub1.clone(), merch1.clone()));

    // Run migration with step 5
    let res = client.try_migrate_records_bounded(&f.admin, &records, &5);
    assert!(matches!(res, Err(Ok(ContractError::InvalidLegacyRecord))));

    // Verify progress marker recorded the pause and failure
    let progress = client.get_migration_progress();
    assert_eq!(progress.status, MigrationStatus::Paused);
    assert_eq!(progress.processed_records, 1);
    assert_eq!(progress.failed_record_index, Some(1));
    assert_eq!(
        progress.last_error_code,
        Some(ContractError::InvalidLegacyRecord as u32)
    );

    // Verify NO partial write occurred on the invalid record (remains amount = 0)
    let uncorrupted: SubscriptionData = f.env.storage().persistent().get(&key1).unwrap();
    assert_eq!(uncorrupted.amount, 0);

    // Fix the invalid record
    let fixed_data = SubscriptionData {
        token: f.token.clone(),
        amount: 50_000,
        interval: 86_400,
        next_payment: 100,
        is_paused: false,
        grace_period: None,
        paused_until: None,
        overdue_since: None,
    };
    f.env.storage().persistent().set(&key1, &fixed_data);

    // Resume migration: should now continue from index 1 and succeed
    let resumed = client.migrate_records_bounded(&f.admin, &records, &5);
    assert_eq!(resumed.status, MigrationStatus::Completed);
    assert_eq!(resumed.processed_records, 2);
    assert_eq!(resumed.batch_cursor, 2);
}

#[test]
fn test_migration_enforces_bounded_step_size() {
    let f = MigrationFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);
    let records = Vec::new(&f.env);

    // 0 step size rejected
    let res_zero = client.try_migrate_records_bounded(&f.admin, &records, &0);
    assert!(matches!(
        res_zero,
        Err(Ok(ContractError::MigrationStepTooLarge))
    ));

    // Exceeding MAX_MIGRATION_STEP (50) rejected
    let res_large =
        client.try_migrate_records_bounded(&f.admin, &records, &(MAX_MIGRATION_STEP + 1));
    assert!(matches!(
        res_large,
        Err(Ok(ContractError::MigrationStepTooLarge))
    ));
}

#[test]
fn test_migration_requires_admin_authorization() {
    let f = MigrationFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);
    let attacker = Address::generate(&f.env);
    let records = Vec::new(&f.env);

    let res = client.try_migrate_records_bounded(&attacker, &records, &10);
    assert!(matches!(res, Err(Ok(ContractError::NotAdmin))));
}

#[test]
fn test_admin_can_reset_interrupted_migration() {
    let f = MigrationFixture::new();
    let client = SubscriptionProtocolClient::new(&f.env, &f.contract_id);

    let sub = Address::generate(&f.env);
    let merch = Address::generate(&f.env);
    f.create_valid_subscription(&sub, &merch, 100_000, 86_400);

    let mut records = Vec::new(&f.env);
    records.push_back((sub, merch));

    client.migrate_records_bounded(&f.admin, &records, &1);
    let p = client.get_migration_progress();
    assert_eq!(p.status, MigrationStatus::Completed);

    // Reset progress back to Idle
    client.reset_migration(&f.admin);
    let p_reset = client.get_migration_progress();
    assert_eq!(p_reset.status, MigrationStatus::Idle);
    assert_eq!(p_reset.processed_records, 0);
}
