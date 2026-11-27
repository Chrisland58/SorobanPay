#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::{
    error::ContractError,
    SubscriptionProtocol, SubscriptionProtocolClient,
    MAX_SUPPORTED_DECIMALS,
};

// ─── Configurable Decimals Mock Token ─────────────────────────────────────────

#[contract]
pub struct MockDecimalsToken;

#[contracttype]
pub enum MockTokenKey {
    Decimals,
    Balance(Address),
    Allowance(Address, Address),
}

#[contractimpl]
impl MockDecimalsToken {
    pub fn initialize(env: Env, decimals: u32) {
        env.storage().instance().set(&MockTokenKey::Decimals, &decimals);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&MockTokenKey::Decimals).unwrap_or(7)
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "MCK")
    }

    pub fn allowance(_env: Env, _from: Address, _spender: Address) -> i128 {
        10_000_000_000_000_i128
    }

    pub fn balance(_env: Env, _id: Address) -> i128 {
        10_000_000_000_000_i128
    }

    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

// ─── Test Harness ─────────────────────────────────────────────────────────────

struct DecimalsTestFixture {
    env: Env,
    client: SubscriptionProtocolClient,
    subscriber: Address,
    merchant: Address,
    contract_id: Address,
}

impl DecimalsTestFixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        let subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        Self {
            env,
            client,
            subscriber,
            merchant,
            contract_id,
        }
    }

    fn create_token_with_decimals(&self, decimals: u32) -> Address {
        let token_addr = self.env.register(MockDecimalsToken, ());
        let token_client = MockDecimalsTokenClient::new(&self.env, &token_addr);
        token_client.initialize(&decimals);
        token_addr
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn test_supported_zero_decimals() {
    let f = DecimalsTestFixture::setup();
    let token = f.create_token_with_decimals(0);

    // Standard subscribe with 0 decimals
    let res = f.client.try_subscribe(
        &f.subscriber,
        &f.merchant,
        &token,
        &100, // 100 whole units
        &86_400,
        &true,
        &None,
    );
    assert!(res.is_ok(), "0 decimal token should be accepted");

    // Explicit decimal subscribe with matching 0
    let subscriber2 = Address::generate(&f.env);
    let res_explicit = f.client.try_subscribe_with_decimals(
        &subscriber2,
        &f.merchant,
        &token,
        &50,
        &86_400,
        &true,
        &None,
        &0,
    );
    assert!(res_explicit.is_ok(), "Matching 0 decimals should succeed");
}

#[test]
fn test_supported_low_decimals() {
    let f = DecimalsTestFixture::setup();

    // 2 decimals (fiat cents)
    let token_2 = f.create_token_with_decimals(2);
    let res_2 = f.client.try_subscribe_with_decimals(
        &f.subscriber,
        &f.merchant,
        &token_2,
        &10_00, // 10.00
        &86_400,
        &true,
        &None,
        &2,
    );
    assert!(res_2.is_ok(), "2 decimal token should be accepted");

    // 7 decimals (Stellar SAC / XLM / USDC)
    let sub2 = Address::generate(&f.env);
    let token_7 = f.create_token_with_decimals(7);
    let res_7 = f.client.try_subscribe_with_decimals(
        &sub2,
        &f.merchant,
        &token_7,
        &50_000_000,
        &86_400,
        &true,
        &None,
        &7,
    );
    assert!(res_7.is_ok(), "7 decimal token should be accepted");
}

#[test]
fn test_supported_high_decimals() {
    let f = DecimalsTestFixture::setup();

    // 18 decimals (MAX_SUPPORTED_DECIMALS / standard ERC-20)
    let token_18 = f.create_token_with_decimals(18);
    let res_18 = f.client.try_subscribe_with_decimals(
        &f.subscriber,
        &f.merchant,
        &token_18,
        &1_000_000_000_000_000_000, // 1.0 token
        &86_400,
        &true,
        &None,
        &18,
    );
    assert!(res_18.is_ok(), "18 decimal token should be accepted");

    let sub = f.client.get_subscription(&f.subscriber, &f.merchant, &token_18);
    assert!(sub.is_some());
    assert_eq!(sub.unwrap().amount, 1_000_000_000_000_000_000);
}

#[test]
fn test_unsupported_high_decimals_rejected_before_state_written() {
    let f = DecimalsTestFixture::setup();

    // 19 decimals (exceeds MAX_SUPPORTED_DECIMALS = 18)
    let token_19 = f.create_token_with_decimals(19);

    let res = f.client.try_subscribe(
        &f.subscriber,
        &f.merchant,
        &token_19,
        &10_000,
        &86_400,
        &true,
        &None,
    );
    assert_eq!(res, Err(Ok(ContractError::UnsupportedTokenDecimals)));

    // Ensure state was NOT written
    let sub = f.client.get_subscription(&f.subscriber, &f.merchant, &token_19);
    assert!(sub.is_none(), "Subscription state must not be written on decimal failure");

    // Also check via subscribe_with_decimals
    let res_explicit = f.client.try_subscribe_with_decimals(
        &f.subscriber,
        &f.merchant,
        &token_19,
        &10_000,
        &86_400,
        &true,
        &None,
        &19,
    );
    assert_eq!(res_explicit, Err(Ok(ContractError::UnsupportedTokenDecimals)));
}

#[test]
fn test_inconsistent_decimals_rejected_before_state_written() {
    let f = DecimalsTestFixture::setup();

    // Token has 7 decimals on-chain
    let token_7 = f.create_token_with_decimals(7);

    // Caller expects 6 decimals (inconsistent!)
    let res = f.client.try_subscribe_with_decimals(
        &f.subscriber,
        &f.merchant,
        &token_7,
        &10_000,
        &86_400,
        &true,
        &None,
        &6,
    );
    assert_eq!(res, Err(Ok(ContractError::InconsistentTokenDecimals)));

    // Ensure state was NOT written
    let sub = f.client.get_subscription(&f.subscriber, &f.merchant, &token_7);
    assert!(sub.is_none(), "Subscription state must not be written on inconsistent decimals");
    assert_eq!(f.client.get_subscription_count(&f.merchant), 0);
}

#[test]
fn test_validate_token_decimals_view_function() {
    let f = DecimalsTestFixture::setup();
    let token_6 = f.create_token_with_decimals(6);
    let token_20 = f.create_token_with_decimals(20);

    // Valid query without expectation
    let dec = f.client.validate_token_decimals(&token_6, &None);
    assert_eq!(dec, 6);

    // Valid query with matching expectation
    let dec_match = f.client.validate_token_decimals(&token_6, &Some(6));
    assert_eq!(dec_match, 6);

    // Mismatched expectation fails
    let err_mismatch = f.client.try_validate_token_decimals(&token_6, &Some(7));
    assert_eq!(err_mismatch, Err(Ok(ContractError::InconsistentTokenDecimals)));

    // Unsupported decimals fail
    let err_unsupported = f.client.try_validate_token_decimals(&token_20, &None);
    assert_eq!(err_unsupported, Err(Ok(ContractError::UnsupportedTokenDecimals)));
}
