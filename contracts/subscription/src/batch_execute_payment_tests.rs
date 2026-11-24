/// batch_execute_payment_tests.rs — Comprehensive unit tests for batch_execute_payment
///
/// Issue #1413: All success, partial-success, and error paths for batch_execute_payment.
///
/// Test Cases:
/// 1. All subscribers paid successfully
/// 2. Partial success: some subscribers have insufficient balance
/// 3. Partial success: some payments not due yet
/// 4. EmptyBatch error
/// 5. BatchTooLarge error (> 50 subscribers)
/// 6. Auth: missing merchant signature
/// 7. Protocol fee applied per subscriber
/// 8. Payment nonce incremented per subscriber

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey, ProtocolFeeConfig},
    SubscriptionProtocol, SubscriptionProtocolClient, BATCH_MAX_SIZE,
};

// ─── Test harness ─────────────────────────────────────────────────────────────

struct BT {
    env:         Env,
    client:      SubscriptionProtocolClient,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl BT {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin    = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token       = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        Self { env, client, merchant, token, contract_id }
    }

    /// Create a funded subscriber with an active subscription to self.merchant.
    /// Returns the subscriber address.
    fn make_subscriber(&self, balance: i128, amount: i128, interval: u64) -> Address {
        let sub = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.token).mint(&sub, &balance);
        token::Client::new(&self.env, &self.token).approve(
            &sub,
            &self.contract_id,
            &(balance + 1),
            &(self.env.ledger().sequence() + 100_000_u32),
        );
        self.client.subscribe(&sub, &self.merchant, &self.token, &amount, &interval, &false);
        sub
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn balance_of(&self, addr: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(addr)
    }

    fn get_sub(&self, subscriber: &Address) -> crate::storage::SubscriptionData {
        let hash = subscription_key(&self.env, subscriber, &self.merchant);
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(hash))
            .expect("subscription not found")
    }
}

// ─── Test 1: All subscribers paid successfully ────────────────────────────────

/// A batch where every subscriber has sufficient balance and all payments are due
/// must return a Vec of (address, true) for each subscriber, and transfer funds.
#[test]
fn batch_all_subscribers_succeed() {
    let bt      = BT::new();
    let amount  = 1_000_i128;
    let interval = 86_400_u64;

    let sub1 = bt.make_subscriber(10_000, amount, interval);
    let sub2 = bt.make_subscriber(10_000, amount, interval);
    let sub3 = bt.make_subscriber(10_000, amount, interval);

    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub1.clone());
    subs.push_back(sub2.clone());
    subs.push_back(sub3.clone());

    let mer_bal_before = bt.balance_of(&bt.merchant);

    let results = bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    assert_eq!(results.len(), 3, "batch must return 3 results");
    for i in 0..3u32 {
        let (_, ok) = results.get(i).unwrap();
        assert!(ok, "subscriber {} must be marked successful", i);
    }

    // Merchant must have received amount × 3.
    assert_eq!(
        bt.balance_of(&bt.merchant),
        mer_bal_before + amount * 3,
        "merchant balance must increase by amount * 3"
    );
}

// ─── Test 2: Partial success — insufficient balance ───────────────────────────

/// A subscriber with zero balance must produce a false result; other subscribers
/// in the same batch with sufficient balance must still produce true results.
#[test]
fn batch_partial_success_insufficient_balance() {
    let bt      = BT::new();
    let amount  = 5_000_i128;
    let interval = 86_400_u64;

    // sub_poor has balance 0 (cannot pay)
    let sub_poor = Address::generate(&bt.env);
    token::Client::new(&bt.env, &bt.token).approve(
        &sub_poor,
        &bt.contract_id,
        &10_000_i128,
        &(bt.env.ledger().sequence() + 100_000_u32),
    );
    bt.client.subscribe(&sub_poor, &bt.merchant, &bt.token, &amount, &interval, &false);

    let sub_rich = bt.make_subscriber(10_000, amount, interval);

    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub_poor.clone());
    subs.push_back(sub_rich.clone());

    let results = bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    assert_eq!(results.len(), 2);
    let (addr0, ok0) = results.get(0).unwrap();
    let (addr1, ok1) = results.get(1).unwrap();

    assert_eq!(addr0, sub_poor, "first result address must be sub_poor");
    assert!(!ok0, "insolvent subscriber must produce false");

    assert_eq!(addr1, sub_rich, "second result address must be sub_rich");
    assert!(ok1, "solvent subscriber must produce true");

    // sub_poor's next_payment must NOT have advanced (failed payment)
    // sub_rich's next_payment must have advanced
    let poor_data = bt.get_sub(&sub_poor);
    let rich_data = bt.get_sub(&sub_rich);

    let original_next = 1_700_000_000_u64 + interval;
    assert_eq!(poor_data.next_payment, original_next,
        "failed subscriber's next_payment must not advance");
    assert!(rich_data.next_payment > original_next,
        "successful subscriber's next_payment must advance");
}

// ─── Test 3: Partial success — some payments not due yet ──────────────────────

/// A subscriber whose payment is not yet due must produce a false result;
/// other due subscribers in the same batch must still succeed.
#[test]
fn batch_partial_success_payment_not_due() {
    let bt       = BT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    // sub_late: subscribed with a longer interval — payment not due at advance time
    let sub_late = bt.make_subscriber(10_000, amount, interval * 2); // 2-day interval
    // sub_due: subscribed with 1-day interval — payment is due
    let sub_due  = bt.make_subscriber(10_000, amount, interval);

    // Advance 1 day + 1 second: sub_due is due, sub_late is not
    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub_late.clone());
    subs.push_back(sub_due.clone());

    let results = bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    assert_eq!(results.len(), 2);
    let (_, not_due) = results.get(0).unwrap();
    let (_, due)     = results.get(1).unwrap();

    assert!(!not_due, "sub_late must produce false (not yet due)");
    assert!(due,      "sub_due must produce true (payment due)");
}

// ─── Test 4: EmptyBatch error ─────────────────────────────────────────────────

/// Passing an empty subscribers vector must return EmptyBatch (error code 13).
#[test]
fn batch_empty_returns_empty_batch_error() {
    let bt    = BT::new();
    let empty: Vec<Address> = Vec::new(&bt.env);

    let result = bt.client.try_batch_execute_payment(&bt.merchant, &bt.token, &empty);
    assert!(
        matches!(result, Err(Ok(ContractError::EmptyBatch))),
        "empty batch must return EmptyBatch; got {:?}",
        result
    );
}

// ─── Test 5: BatchTooLarge error ──────────────────────────────────────────────

/// Passing more than BATCH_MAX_SIZE (50) subscribers must return BatchTooLarge (error 14).
#[test]
fn batch_too_large_returns_batch_too_large_error() {
    let bt = BT::new();

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    // Push BATCH_MAX_SIZE + 1 addresses (51)
    for _ in 0..=BATCH_MAX_SIZE {
        subs.push_back(Address::generate(&bt.env));
    }

    let result = bt.client.try_batch_execute_payment(&bt.merchant, &bt.token, &subs);
    assert!(
        matches!(result, Err(Ok(ContractError::BatchTooLarge))),
        "batch of {} must return BatchTooLarge; got {:?}",
        BATCH_MAX_SIZE + 1,
        result
    );
}

/// A batch of exactly BATCH_MAX_SIZE (50) must not be rejected with BatchTooLarge.
/// Off-by-one regression guard.
#[test]
fn batch_exactly_max_size_is_accepted() {
    let bt       = BT::new();
    let amount   = 100_i128;
    let interval = 86_400_u64;

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    for _ in 0..BATCH_MAX_SIZE {
        let sub = bt.make_subscriber(10_000, amount, interval);
        subs.push_back(sub);
    }

    bt.advance(interval + 1);

    let result = bt.client.try_batch_execute_payment(&bt.merchant, &bt.token, &subs);
    assert!(
        !matches!(result, Err(Ok(ContractError::BatchTooLarge))),
        "batch of exactly BATCH_MAX_SIZE must not return BatchTooLarge"
    );
    assert!(result.is_ok(), "batch of exactly BATCH_MAX_SIZE must succeed; got {:?}", result);
}

// ─── Test 6: Auth — missing merchant signature ────────────────────────────────

/// Calling batch_execute_payment without merchant's auth must panic.
#[test]
#[should_panic]
fn batch_missing_merchant_auth_panics() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin    = Address::generate(&env);
    let merchant = Address::generate(&env);

    let token       = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let sub = Address::generate(&env);
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    StellarAssetClient::new(&env, &token).mint(&sub, &10_000_i128);

    // Subscribe with mock auth
    env.mock_all_auths();
    token::Client::new(&env, &token).approve(
        &sub, &contract_id,
        &10_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );
    client.subscribe(&sub, &merchant, &token, &amount, &interval, &false);

    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

    let mut subs: Vec<Address> = Vec::new(&env);
    subs.push_back(sub.clone());

    // Call WITHOUT any auth — Soroban must panic.
    env.mock_auths(&[]);
    client.batch_execute_payment(&merchant, &token, &subs);
}

// ─── Test 7: Protocol fee applied per subscriber ──────────────────────────────

/// When a protocol fee is configured, each subscriber's payment must be split:
/// merchant receives (amount - fee), fee_collector receives fee.
#[test]
fn batch_protocol_fee_applied_per_subscriber() {
    let bt       = BT::new();
    let amount   = 10_000_i128;
    let interval = 86_400_u64;
    let fee_bps  = 250_u32; // 2.5%

    // Set up admin and fee collector
    let admin         = Address::generate(&bt.env);
    let fee_collector = Address::generate(&bt.env);

    // Configure protocol fee via set_protocol_fee
    bt.client.set_protocol_fee(&admin, &fee_bps, &fee_collector);

    let sub1 = bt.make_subscriber(50_000, amount, interval);
    let sub2 = bt.make_subscriber(50_000, amount, interval);

    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub1.clone());
    subs.push_back(sub2.clone());

    let mer_bal_before       = bt.balance_of(&bt.merchant);
    let collector_bal_before = bt.balance_of(&fee_collector);

    let results = bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    assert_eq!(results.len(), 2);
    for i in 0..2u32 {
        let (_, ok) = results.get(i).unwrap();
        assert!(ok, "subscriber {} must be marked successful", i);
    }

    // fee = 10_000 * 250 / 10_000 = 250
    let expected_fee              = 250_i128;
    let expected_merchant_amount  = amount - expected_fee;

    // 2 subscribers × each split
    assert_eq!(
        bt.balance_of(&bt.merchant),
        mer_bal_before + expected_merchant_amount * 2,
        "merchant must receive (amount - fee) per subscriber"
    );
    assert_eq!(
        bt.balance_of(&fee_collector),
        collector_bal_before + expected_fee * 2,
        "fee_collector must receive fee per subscriber"
    );
}

// ─── Test 8: Payment nonce incremented per subscriber ────────────────────────

/// After a successful batch payment, each paid subscriber's payment_nonce must
/// be incremented by exactly 1. Skipped subscribers must have nonce unchanged.
#[test]
fn batch_payment_nonce_incremented_per_subscriber() {
    let bt       = BT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    let sub_paid    = bt.make_subscriber(10_000, amount, interval);
    // sub_broke has no balance so payment is skipped
    let sub_broke   = Address::generate(&bt.env);
    token::Client::new(&bt.env, &bt.token).approve(
        &sub_broke,
        &bt.contract_id,
        &10_000_i128,
        &(bt.env.ledger().sequence() + 100_000_u32),
    );
    bt.client.subscribe(&sub_broke, &bt.merchant, &bt.token, &amount, &interval, &false);

    // Verify initial nonces are 0
    assert_eq!(bt.get_sub(&sub_paid).payment_nonce,  0, "initial nonce must be 0");
    assert_eq!(bt.get_sub(&sub_broke).payment_nonce, 0, "initial nonce must be 0");

    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub_paid.clone());
    subs.push_back(sub_broke.clone());

    bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    // sub_paid nonce must have advanced by 1
    assert_eq!(bt.get_sub(&sub_paid).payment_nonce, 1,
        "successfully paid subscriber's nonce must increment to 1");

    // sub_broke nonce must remain at 0 (payment was skipped)
    assert_eq!(bt.get_sub(&sub_broke).payment_nonce, 0,
        "skipped subscriber's nonce must remain at 0");
}

/// Calling batch_execute_payment twice advances the nonce by 2 total.
#[test]
fn batch_payment_nonce_increments_across_multiple_batches() {
    let bt       = BT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    let sub = bt.make_subscriber(100_000, amount, interval);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub.clone());

    // First batch
    bt.advance(interval + 1);
    bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);
    assert_eq!(bt.get_sub(&sub).payment_nonce, 1, "nonce must be 1 after first batch");

    // Second batch — advance another interval
    bt.advance(interval + 1);
    bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);
    assert_eq!(bt.get_sub(&sub).payment_nonce, 2, "nonce must be 2 after second batch");
}

/// Verify that Vec<(Address, bool)> return value is correctly structured.
/// Each element must be a tuple of (subscriber_address, success_flag).
#[test]
fn batch_return_value_structure_verified() {
    let bt       = BT::new();
    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    let sub_a = bt.make_subscriber(10_000, amount, interval);
    let sub_b = bt.make_subscriber(10_000, amount, interval);

    bt.advance(interval + 1);

    let mut subs: Vec<Address> = Vec::new(&bt.env);
    subs.push_back(sub_a.clone());
    subs.push_back(sub_b.clone());

    let results = bt.client.batch_execute_payment(&bt.merchant, &bt.token, &subs);

    assert_eq!(results.len(), 2, "result length must equal subscriber count");

    let (returned_addr_a, _) = results.get(0).unwrap();
    let (returned_addr_b, _) = results.get(1).unwrap();

    assert_eq!(returned_addr_a, sub_a, "result[0] address must match sub_a");
    assert_eq!(returned_addr_b, sub_b, "result[1] address must match sub_b");
}
