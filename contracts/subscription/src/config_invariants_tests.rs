#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{AdminConfig, ProtocolFeeConfig, MAX_AMOUNT, MAX_FEE_BPS},
    validate_protocol_config_invariants, SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestEnv {
    env: Env,
    admin: Address,
    contract_id: Address,
    client: SubscriptionProtocolClient<'static>,
}

impl TestEnv {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);

        Self {
            env,
            admin,
            contract_id,
            client,
        }
    }
}

// ─── Unit Tests for Centralized Invariant Validator ────────────────────────────

#[test]
fn test_validator_accepts_valid_configurations() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    // Valid admin and max amount
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(100), None),
        Ok(())
    );
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(MAX_AMOUNT), None),
        Ok(())
    );

    // Valid fee config
    let fee_cfg = ProtocolFeeConfig {
        fee_bps: MAX_FEE_BPS,
        fee_collector: collector.clone(),
    };
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(MAX_AMOUNT), Some(&fee_cfg)),
        Ok(())
    );

    // Zero fee disabled
    let zero_fee = ProtocolFeeConfig {
        fee_bps: 0,
        fee_collector: collector,
    };
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, None, Some(&zero_fee)),
        Ok(())
    );
}

#[test]
fn test_validator_rejects_contract_as_admin() {
    let env = Env::default();
    let contract_id = env.register(SubscriptionProtocol, ());

    // Admin cannot be the contract's own address
    let res = validate_protocol_config_invariants(&env, &contract_id, Some(100), None);
    assert_eq!(res, Err(ContractError::InvalidConfig));
}

#[test]
fn test_validator_rejects_invalid_amount_boundaries() {
    let env = Env::default();
    let admin = Address::generate(&env);

    // Zero amount
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(0), None),
        Err(ContractError::AmountMustBePositive)
    );

    // Negative amount
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(-1), None),
        Err(ContractError::AmountMustBePositive)
    );

    // Over maximum bound
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, Some(MAX_AMOUNT + 1), None),
        Err(ContractError::AmountTooLarge)
    );
}

#[test]
fn test_validator_rejects_invalid_fee_boundaries() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(SubscriptionProtocol, ());
    let valid_collector = Address::generate(&env);

    // Fee bps exceeds maximum (501 > 500)
    let excessive_fee = ProtocolFeeConfig {
        fee_bps: MAX_FEE_BPS + 1,
        fee_collector: valid_collector.clone(),
    };
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, None, Some(&excessive_fee)),
        Err(ContractError::FeeBpsTooHigh)
    );

    // Fee collector cannot be contract's own address
    let invalid_collector = ProtocolFeeConfig {
        fee_bps: 100,
        fee_collector: contract_id,
    };
    assert_eq!(
        validate_protocol_config_invariants(&env, &admin, None, Some(&invalid_collector)),
        Err(ContractError::InvalidConfig)
    );
}

// ─── Entry Point Invariant & Prior-State Preservation Tests ───────────────────

#[test]
fn test_set_max_amount_preserves_state_on_failure() {
    let t = TestEnv::new();
    let initial_config = t.client.get_config();
    assert_eq!(initial_config.max_amount, MAX_AMOUNT);

    // Attempt invalid update: amount > MAX_AMOUNT
    let res = t.client.try_set_max_amount(&t.admin, &(MAX_AMOUNT + 1));
    assert!(res.is_err());
    // Prior state must be preserved
    assert_eq!(t.client.get_config().max_amount, MAX_AMOUNT);

    // Attempt invalid update: amount <= 0
    let res_zero = t.client.try_set_max_amount(&t.admin, &0);
    assert!(res_zero.is_err());
    assert_eq!(t.client.get_config().max_amount, MAX_AMOUNT);

    // Valid update succeeds
    t.client.set_max_amount(&t.admin, &500_000);
    assert_eq!(t.client.get_config().max_amount, 500_000);
}

#[test]
fn test_set_protocol_fee_preserves_state_on_failure() {
    let t = TestEnv::new();
    let initial_fee = t.client.get_protocol_fee();
    assert!(initial_fee.is_none());

    // Valid initial fee configuration
    let collector = Address::generate(&t.env);
    t.client.set_protocol_fee(&t.admin, &100, &collector);
    let set_fee = t.client.get_protocol_fee().unwrap();
    assert_eq!(set_fee.fee_bps, 100);
    assert_eq!(set_fee.fee_collector, collector);

    // Invalid fee update: fee_bps > 500
    let res = t.client.try_set_protocol_fee(&t.admin, &501, &collector);
    assert!(res.is_err());
    // State remains unchanged at 100 bps
    let fee_after = t.client.get_protocol_fee().unwrap();
    assert_eq!(fee_after.fee_bps, 100);

    // Invalid fee update: collector is contract itself
    let res_collector = t.client.try_set_protocol_fee(&t.admin, &200, &t.contract_id);
    assert!(res_collector.is_err());
    assert_eq!(t.client.get_protocol_fee().unwrap().fee_bps, 100);
}

#[test]
fn test_set_admin_preserves_state_on_failure() {
    let t = TestEnv::new();
    let initial_admin = t.client.get_config().admin;
    assert_eq!(initial_admin, t.admin);

    // Attempt to set admin to contract address
    let res = t.client.try_set_admin(&t.admin, &t.contract_id);
    assert!(res.is_err());
    // Admin remains unchanged
    assert_eq!(t.client.get_config().admin, t.admin);

    // Valid admin rotation
    let new_admin = Address::generate(&t.env);
    t.client.set_admin(&t.admin, &new_admin);
    assert_eq!(t.client.get_config().admin, new_admin);
}

#[test]
fn test_update_protocol_config_atomic_rollback() {
    let t = TestEnv::new();
    let initial_config = t.client.get_config();
    let collector = Address::generate(&t.env);
    t.client.set_protocol_fee(&t.admin, &50, &collector);

    // Attempt multi-parameter update with one invalid parameter (excessive fee_bps)
    let new_admin = Address::generate(&t.env);
    let invalid_fee = ProtocolFeeConfig {
        fee_bps: 999,
        fee_collector: collector.clone(),
    };
    let res = t.client.try_update_protocol_config(
        &t.admin,
        &Some(new_admin.clone()),
        &Some(1_000),
        &Some(invalid_fee),
    );
    assert!(res.is_err());

    // Entire update must roll back: admin and max_amount must NOT change
    let current_config = t.client.get_config();
    assert_eq!(current_config.admin, initial_config.admin);
    assert_eq!(current_config.max_amount, initial_config.max_amount);
    assert_eq!(t.client.get_protocol_fee().unwrap().fee_bps, 50);

    // Valid atomic update
    let valid_fee = ProtocolFeeConfig {
        fee_bps: 250,
        fee_collector: collector.clone(),
    };
    t.client.update_protocol_config(
        &t.admin,
        &Some(new_admin.clone()),
        &Some(2_000_000),
        &Some(valid_fee),
    );
    let updated_config = t.client.get_config();
    assert_eq!(updated_config.admin, new_admin);
    assert_eq!(updated_config.max_amount, 2_000_000);
    assert_eq!(t.client.get_protocol_fee().unwrap().fee_bps, 250);
}
