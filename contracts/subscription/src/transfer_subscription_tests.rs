/// transfer_subscription_tests.rs — Comprehensive unit tests for transfer_subscription
///
/// Issue #1412: All success and error paths for the transfer_subscription entry point.
///
/// Test Cases:
/// 1. Happy path: subscription moved from old merchant to new merchant
/// 2. NoActiveSubscription: (subscriber, old_merchant) not found
/// 3. SameMerchant: old_merchant == new_merchant
/// 4. SelfSubscription: subscriber == new_merchant
/// 5. SubscriptionAlreadyExists: (subscriber, new_merchant) already active
/// 6. Auth: missing subscriber signature
/// 7. Auth: missing old_merchant signature
/// 8. State verification: all fields preserved after transfer

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test harness ─────────────────────────────────────────────────────────────

struct TS {
    env:          Env,
    client:       SubscriptionProtocolClient,
    subscriber:   Address,
    old_merchant: Address,
    new_merchant: Address,
    token:        Address,
    contract_id:  Address,
}

impl TS {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin        = Address::generate(&env);
        let subscriber   = Address::generate(&env);
        let old_merchant = Address::generate(&env);
        let new_merchant = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, client, subscriber, old_merchant, new_merchant, token, contract_id }
    }

    /// Subscribe the test subscriber to old_merchant.
    fn subscribe_to_old(&self) {
        self.client.subscribe(
            &self.subscriber,
            &self.old_merchant,
            &self.token,
            &100_000_i128,
            &86_400_u64,
            &false,
        );
    }

    /// Check whether a subscription exists for (subscriber, merchant).
    fn has_sub_for(&self, merchant: &Address) -> bool {
        let hash = subscription_key(&self.env, &self.subscriber, merchant);
        self.env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(hash))
    }

    /// Get subscription data for (subscriber, merchant). Panics if absent.
    fn get_sub_for(&self, merchant: &Address) -> crate::storage::SubscriptionData {
        let hash = subscription_key(&self.env, &self.subscriber, merchant);
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(hash))
            .expect("subscription not found")
    }
}

// ─── Test 1: Happy path ───────────────────────────────────────────────────────

/// Transferring a subscription from old_merchant to new_merchant should:
/// - Remove the entry keyed by (subscriber, old_merchant)
/// - Create an entry keyed by (subscriber, new_merchant)
/// - Return Ok(())
#[test]
fn transfer_happy_path_moves_subscription() {
    let ts = TS::new();
    ts.subscribe_to_old();

    assert!(ts.has_sub_for(&ts.old_merchant), "subscription must exist before transfer");
    assert!(!ts.has_sub_for(&ts.new_merchant), "new_merchant must have no subscription before transfer");

    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );
    assert!(result.is_ok(), "transfer_subscription must succeed for a valid pair; got {:?}", result);

    assert!(!ts.has_sub_for(&ts.old_merchant), "old subscription must be removed after transfer");
    assert!(ts.has_sub_for(&ts.new_merchant),  "new subscription must exist after transfer");
}

// ─── Test 2: NoActiveSubscription ─────────────────────────────────────────────

/// Transferring a subscription that was never created must return NoActiveSubscription.
#[test]
fn transfer_no_active_subscription_returns_error() {
    let ts = TS::new();
    // Do NOT call subscribe_to_old — there is no subscription.

    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "missing subscription must return NoActiveSubscription; got {:?}",
        result
    );
}

/// Transferring after the subscription has already been cancelled must also
/// return NoActiveSubscription.
#[test]
fn transfer_after_cancel_returns_no_active_subscription() {
    let ts = TS::new();
    ts.subscribe_to_old();
    ts.client.cancel(&ts.subscriber, &ts.old_merchant);

    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "post-cancel transfer must return NoActiveSubscription; got {:?}",
        result
    );
}

// ─── Test 3: SameMerchant ─────────────────────────────────────────────────────

/// Transferring to the same merchant (old == new) must return SameMerchant.
#[test]
fn transfer_same_merchant_returns_error() {
    let ts = TS::new();
    ts.subscribe_to_old();

    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.old_merchant, // same address
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SameMerchant))),
        "transfer to same merchant must return SameMerchant; got {:?}",
        result
    );

    // Subscription must still exist under old_merchant after the rejected call.
    assert!(ts.has_sub_for(&ts.old_merchant), "subscription must survive a SameMerchant rejection");
}

// ─── Test 4: SelfSubscription ─────────────────────────────────────────────────

/// Transferring so that subscriber == new_merchant must return SelfSubscription.
#[test]
fn transfer_self_subscription_returns_error() {
    let ts = TS::new();
    ts.subscribe_to_old();

    // new_merchant is the subscriber themselves
    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.subscriber, // new_merchant == subscriber
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SelfSubscription))),
        "subscriber == new_merchant must return SelfSubscription; got {:?}",
        result
    );

    // Subscription must still exist under old_merchant.
    assert!(ts.has_sub_for(&ts.old_merchant), "subscription must survive a SelfSubscription rejection");
}

// ─── Test 5: SubscriptionAlreadyExists ────────────────────────────────────────

/// Transferring when (subscriber, new_merchant) already has an active subscription
/// must return SubscriptionAlreadyExists and leave both subscriptions intact.
#[test]
fn transfer_subscription_already_exists_returns_error() {
    let ts = TS::new();
    ts.subscribe_to_old();

    // Also subscribe to new_merchant directly.
    ts.client.subscribe(
        &ts.subscriber,
        &ts.new_merchant,
        &ts.token,
        &50_000_i128,
        &86_400_u64,
        &false,
    );

    let result = ts.client.try_transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SubscriptionAlreadyExists))),
        "existing destination subscription must return SubscriptionAlreadyExists; got {:?}",
        result
    );

    // Both subscriptions must remain unchanged.
    assert!(ts.has_sub_for(&ts.old_merchant), "old subscription must survive the rejection");
    assert!(ts.has_sub_for(&ts.new_merchant), "new subscription must survive the rejection");
}

// ─── Test 6: Auth — missing subscriber signature ──────────────────────────────

/// Calling transfer_subscription without the subscriber's authorization must panic.
#[test]
#[should_panic]
fn transfer_missing_subscriber_auth_panics() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin        = Address::generate(&env);
    let subscriber   = Address::generate(&env);
    let old_merchant = Address::generate(&env);
    let new_merchant = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe using mock auth
    env.mock_all_auths();
    client.subscribe(&subscriber, &old_merchant, &token, &100_000_i128, &86_400_u64, &false);

    // Now call transfer WITHOUT mock auth and WITHOUT old_merchant's auth — only old_merchant signs.
    // Soroban will panic because subscriber's auth is required but not provided.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &old_merchant,
        invoke:  &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name:  "transfer_subscription",
            args:     soroban_sdk::vec![
                &env,
                subscriber.clone().into(),
                old_merchant.clone().into(),
                new_merchant.clone().into(),
            ]
            .into(),
            sub_invokes: &[],
        },
    }]);
    client.transfer_subscription(&subscriber, &old_merchant, &new_merchant);
}

// ─── Test 7: Auth — missing old_merchant signature ────────────────────────────

/// Calling transfer_subscription without old_merchant's authorization must panic.
#[test]
#[should_panic]
fn transfer_missing_old_merchant_auth_panics() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin        = Address::generate(&env);
    let subscriber   = Address::generate(&env);
    let old_merchant = Address::generate(&env);
    let new_merchant = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe using mock auth
    env.mock_all_auths();
    client.subscribe(&subscriber, &old_merchant, &token, &100_000_i128, &86_400_u64, &false);

    // Now call transfer WITHOUT mock auth and WITHOUT old_merchant's auth — only subscriber signs.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &subscriber,
        invoke:  &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name:  "transfer_subscription",
            args:     soroban_sdk::vec![
                &env,
                subscriber.clone().into(),
                old_merchant.clone().into(),
                new_merchant.clone().into(),
            ]
            .into(),
            sub_invokes: &[],
        },
    }]);
    client.transfer_subscription(&subscriber, &old_merchant, &new_merchant);
}

// ─── Test 8: State verification — all fields preserved after transfer ─────────

/// After a successful transfer, the SubscriptionData stored under (subscriber, new_merchant)
/// must be byte-for-byte identical to the data that was under (subscriber, old_merchant).
/// In particular: token, amount, interval, and next_payment must all be preserved.
#[test]
fn transfer_preserves_all_subscription_fields() {
    let ts = TS::new();

    let amount   = 250_000_i128;
    let interval = 2_592_000_u64; // 30 days

    ts.client.subscribe(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.token,
        &amount,
        &interval,
        &false,
    );

    // Capture state before transfer.
    let before = ts.get_sub_for(&ts.old_merchant);

    ts.client.transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );

    // Verify state after transfer.
    let after = ts.get_sub_for(&ts.new_merchant);

    assert_eq!(after.token,        before.token,        "token must be preserved after transfer");
    assert_eq!(after.amount,       before.amount,       "amount must be preserved after transfer");
    assert_eq!(after.interval,     before.interval,     "interval must be preserved after transfer");
    assert_eq!(after.next_payment, before.next_payment, "next_payment must be preserved (no billing-cycle reset)");
    assert_eq!(after.is_paused,    before.is_paused,    "is_paused must be preserved after transfer");
}

/// Transfer does not advance next_payment — no billing-cycle reset occurs.
#[test]
fn transfer_does_not_reset_billing_cycle() {
    let ts = TS::new();

    let amount   = 100_000_i128;
    let interval = 86_400_u64;

    ts.client.subscribe(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.token,
        &amount,
        &interval,
        &false,
    );

    let expected_next_payment = ts.get_sub_for(&ts.old_merchant).next_payment;

    // Advance some time to make a naive "next_payment = now + interval" differ.
    let now = ts.env.ledger().timestamp();
    ts.env.ledger().with_mut(|l| l.timestamp = now + 3600); // +1 hour

    ts.client.transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );

    let actual_next_payment = ts.get_sub_for(&ts.new_merchant).next_payment;
    assert_eq!(
        actual_next_payment,
        expected_next_payment,
        "transfer must not modify next_payment (no billing-cycle reset)"
    );
}

/// After transfer, execute_payment must be callable against the new merchant
/// (and must fail against the old merchant since the subscription no longer exists there).
#[test]
fn transfer_allows_payment_collection_by_new_merchant() {
    let ts = TS::new();

    let amount   = 100_000_i128;
    let interval = 86_400_u64;

    ts.client.subscribe(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.token,
        &amount,
        &interval,
        &false,
    );

    ts.client.transfer_subscription(
        &ts.subscriber,
        &ts.old_merchant,
        &ts.new_merchant,
    );

    // Advance past the payment window.
    let now = ts.env.ledger().timestamp();
    ts.env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

    // Old merchant can no longer collect.
    let old_result = ts.client.try_execute_payment(&ts.subscriber, &ts.old_merchant);
    assert!(
        matches!(old_result, Err(Ok(ContractError::NoActiveSubscription))),
        "old merchant must not be able to collect after transfer; got {:?}",
        old_result
    );

    // New merchant can collect.
    let sub_bal_before = token::Client::new(&ts.env, &ts.token).balance(&ts.subscriber);
    let new_result     = ts.client.try_execute_payment(&ts.subscriber, &ts.new_merchant);
    let sub_bal_after  = token::Client::new(&ts.env, &ts.token).balance(&ts.subscriber);

    assert!(
        new_result.is_ok(),
        "new merchant must be able to collect after transfer; got {:?}",
        new_result
    );
    assert_eq!(
        sub_bal_after,
        sub_bal_before - amount,
        "subscriber balance must decrease by the payment amount"
    );
}
