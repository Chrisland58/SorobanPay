#![cfg(test)]
use super::*;
use soroban_sdk::{Env, Address, String, Vec, Map, testutils::Address as _};

// ================================================================
// Test Helpers
// ================================================================

pub struct TestHelper {
    pub env: Env,
    pub contract: Address,
}

impl TestHelper {
    pub fn new() -> Self {
        let env = Env::default();
        let contract = Address::random(&env);
        
        // Initialize contract
        let owner = Address::random(&env);
        let _ = SubscriptionContract::initialize(env.clone(), owner.clone());
        
        Self { env, contract }
    }

    pub fn client(&self) -> SubscriptionContractClient {
        SubscriptionContractClient::new(&self.env, &self.contract)
    }
}

// ================================================================
// Core Subscription Tests
// ================================================================

#[test]
fn test_subscribe_success() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600; // 1 hour

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_ok());
}

#[test]
fn test_subscribe_invalid_amount() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 0;
    let interval = 3600;

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_err());
}

#[test]
fn test_subscribe_zero_interval() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 0;

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_err());
}

#[test]
fn test_get_subscription() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    let subscription = client.get_subscription(&subscriber, &merchant, &token);
    assert!(subscription.is_some());
    
    let data = subscription.unwrap();
    assert_eq!(data.amount, amount);
    assert_eq!(data.interval, interval);
}

#[test]
fn test_get_subscription_not_found() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);

    let client = helper.client();
    let subscription = client.get_subscription(&subscriber, &merchant, &token);
    
    assert!(subscription.is_none());
}

// ================================================================
// Payment Tests
// ================================================================

#[test]
fn test_payment_not_due_after_subscribe() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    // Check if payment is due (should not be immediately)
    let is_due = client.is_payment_due(&subscriber, &merchant, &token);
    assert!(!is_due);
}

#[test]
fn test_payment_due_after_interval() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    // Advance time past interval
    helper.env.ledger().set_timestamp(interval + 100);

    let is_due = client.is_payment_due(&subscriber, &merchant, &token);
    assert!(is_due);
}

// ================================================================
// Pause/Resume Tests
// ================================================================

#[test]
fn test_pause_subscription() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    let result = client.pause_subscription(&subscriber, &merchant, &token);
    assert!(result.is_ok());
}

#[test]
fn test_resume_subscription() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    client.pause_subscription(&subscriber, &merchant, &token).unwrap();
    let result = client.resume_subscription(&subscriber, &merchant, &token);
    assert!(result.is_ok());
}

// ================================================================
// Subscription Data Schema Tests
// ================================================================

#[test]
fn test_subscription_data_fields() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    let data = client.get_subscription(&subscriber, &merchant, &token).unwrap();
    
    // Verify all fields match current schema
    assert_eq!(data.amount, amount);
    assert_eq!(data.interval, interval);
    assert!(!data.is_paused);
    assert_eq!(data.grace_period, 0);
    assert!(data.overdue_since.is_none());
    assert!(data.paused_until.is_none());
}

#[test]
fn test_subscription_data_schema_compatibility() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    let data = client.get_subscription(&subscriber, &merchant, &token).unwrap();
    
    // Schema fields should be accessible directly
    let _ = data.token;
    let _ = data.amount;
    let _ = data.interval;
    let _ = data.next_payment;
    let _ = data.is_paused;
    let _ = data.grace_period;
    let _ = data.overdue_since;
    let _ = data.payment_nonce;
    let _ = data.paused_until;
}

// ================================================================
// Large Amount & Boundary Tests
// ================================================================

#[test]
fn test_subscribe_large_amount() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = i128::MAX / 2;
    let interval = 3600;

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_ok());
}

#[test]
fn test_subscribe_max_interval() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = u64::MAX / 2;

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_ok());
}

// ================================================================
// Bulk Operations Tests
// ================================================================

#[test]
fn test_bulk_subscribe_distinct_pairs() {
    let helper = TestHelper::new();
    let client = helper.client();
    let amount = 100;
    let interval = 3600;

    // Subscribe multiple distinct pairs
    for i in 0..10 {
        let subscriber = Address::random(&helper.env);
        let merchant = Address::random(&helper.env);
        let token = Address::random(&helper.env);
        
        let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
        assert!(result.is_ok());
    }
}

#[test]
fn test_bulk_subscribe_duplicate_pairs() {
    let helper = TestHelper::new();
    let client = helper.client();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    // First subscription should succeed
    let result1 = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    assert!(result1.is_ok());

    // Second subscription should fail (duplicate)
    let result2 = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    assert!(result2.is_err());
}

// ================================================================
// Grace Period Tests
// ================================================================

#[test]
fn test_grace_period_after_payment_due() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    // Advance time past interval
    helper.env.ledger().set_timestamp(interval + 100);

    // Check grace period
    let data = client.get_subscription(&subscriber, &merchant, &token).unwrap();
    assert_eq!(data.grace_period, 0);
}

// ================================================================
// Error Cases
// ================================================================

#[test]
fn test_error_already_subscribed() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::random(&helper.env);
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    client.subscribe(&subscriber, &merchant, &token, &amount, &interval).unwrap();

    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    assert!(result.is_err());
}

#[test]
fn test_error_invalid_merchant() {
    let helper = TestHelper::new();
    let subscriber = Address::random(&helper.env);
    let merchant = Address::from_string(&String::from_str(&helper.env, "invalid"));
    let token = Address::random(&helper.env);
    let amount = 100;
    let interval = 3600;

    let client = helper.client();
    let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
    
    assert!(result.is_err());
}

// ================================================================
// Test Helper Methods
// ================================================================

#[test]
fn test_client_method_available() {
    let helper = TestHelper::new();
    let client = helper.client();
    
    // Should be able to call methods on client
    let _ = client;
}

#[test]
fn test_contract_initialization() {
    let helper = TestHelper::new();
    let client = helper.client();
    
    // Contract should be initialized
    let is_initialized = client.is_initialized();
    assert!(is_initialized);
}

// ================================================================
// Proptest - Only in proptest module
// ================================================================

#[cfg(feature = "testutils")]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn property_subscription_roundtrip(
            amount in 1..10000i128,
            interval in 1..10000u64,
        ) {
            let helper = TestHelper::new();
            let subscriber = Address::random(&helper.env);
            let merchant = Address::random(&helper.env);
            let token = Address::random(&helper.env);

            let client = helper.client();
            let result = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);
            
            if let Ok(_) = result {
                let data = client.get_subscription(&subscriber, &merchant, &token);
                if let Some(d) = data {
                    prop_assert_eq!(d.amount, amount);
                    prop_assert_eq!(d.interval, interval);
                }
            }
        }

        #[test]
        fn property_payment_after_interval(
            amount in 1..10000i128,
            interval in 1..1000u64,
            time_offset in 1..10000u64,
        ) {
            let helper = TestHelper::new();
            let subscriber = Address::random(&helper.env);
            let merchant = Address::random(&helper.env);
            let token = Address::random(&helper.env);

            let client = helper.client();
            let _ = client.subscribe(&subscriber, &merchant, &token, &amount, &interval);

            helper.env.ledger().set_timestamp(interval + time_offset);

            let is_due = client.is_payment_due(&subscriber, &merchant, &token);
            prop_assert!(is_due);
        }
    }
}
