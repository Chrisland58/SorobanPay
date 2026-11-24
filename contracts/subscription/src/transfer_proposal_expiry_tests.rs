/// transfer_proposal_expiry_tests.rs — Comprehensive unit tests for transfer proposal expiry & cancellation
///
/// Issue #1620: Explicit expiry for unaccepted subscription transfer proposals
///
/// Acceptance criteria coverage:
/// - Expired proposals are rejected using ledger time and do not change ownership.
/// - Tests cover acceptance at the boundary, after expiry, and proposal replacement.
/// - Cancellation path via merchant and subscriber.
/// - Unauthorized recipient rejection.

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

struct TestHarness {
    env:            Env,
    client:         SubscriptionProtocolClient,
    subscriber:     Address,
    old_merchant:   Address,
    new_merchant:   Address,
    other_merchant: Address,
    token:          Address,
}

impl TestHarness {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin          = Address::generate(&env);
        let subscriber     = Address::generate(&env);
        let old_merchant   = Address::generate(&env);
        let new_merchant   = Address::generate(&env);
        let other_merchant = Address::generate(&env);

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

        // Create initial active subscription
        client.subscribe(
            &subscriber,
            &old_merchant,
            &token,
            &100_000_i128,
            &86_400_u64,
            &false,
        );

        Self {
            env,
            client,
            subscriber,
            old_merchant,
            new_merchant,
            other_merchant,
            token,
        }
    }

    fn has_sub_for(&self, merchant: &Address) -> bool {
        let hash = subscription_key(&self.env, &self.subscriber, merchant);
        self.env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(hash))
    }
}

// ─── Proposal creation & validation ──────────────────────────────────────────

#[test]
fn test_propose_transfer_happy_path() {
    let th = TestHarness::setup();
    let now = th.env.ledger().timestamp();
    let expires_at = now + 3600;

    let res = th.client.try_propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );
    assert!(res.is_ok(), "proposing a valid transfer must succeed");

    let proposal = th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant);
    assert!(proposal.is_some(), "transfer proposal must be stored");
    let p = proposal.unwrap();
    assert_eq!(p.new_merchant, th.new_merchant);
    assert_eq!(p.expires_at, expires_at);
}

#[test]
fn test_propose_transfer_rejects_past_or_current_expiry() {
    let th = TestHarness::setup();
    let now = th.env.ledger().timestamp();

    // Equal to current timestamp
    let res_equal = th.client.try_propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &now,
    );
    assert!(
        matches!(res_equal, Err(Ok(ContractError::InvalidTransferExpiry))),
        "expiry equal to ledger timestamp must be rejected"
    );

    // In the past
    let res_past = th.client.try_propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &(now - 10),
    );
    assert!(
        matches!(res_past, Err(Ok(ContractError::InvalidTransferExpiry))),
        "expiry in the past must be rejected"
    );
}

#[test]
fn test_propose_transfer_rejects_same_merchant_and_self_sub() {
    let th = TestHarness::setup();
    let expires_at = th.env.ledger().timestamp() + 3600;

    let res_same = th.client.try_propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.old_merchant,
        &expires_at,
    );
    assert!(
        matches!(res_same, Err(Ok(ContractError::SameMerchant))),
        "proposing transfer to same merchant must fail"
    );

    let res_self = th.client.try_propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.subscriber,
        &expires_at,
    );
    assert!(
        matches!(res_self, Err(Ok(ContractError::SelfSubscription))),
        "proposing transfer where recipient is subscriber must fail"
    );
}

// ─── Proposal Replacement ─────────────────────────────────────────────────────

#[test]
fn test_propose_transfer_replaces_existing_proposal() {
    let th = TestHarness::setup();
    let now = th.env.ledger().timestamp();
    let expires_at_1 = now + 1000;
    let expires_at_2 = now + 5000;

    // Proposal 1: to new_merchant expiring at expires_at_1
    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at_1,
    );

    // Proposal 2: replace with other_merchant expiring at expires_at_2
    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.other_merchant,
        &expires_at_2,
    );

    let proposal = th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant).unwrap();
    assert_eq!(proposal.new_merchant, th.other_merchant, "proposal replacement must update recipient");
    assert_eq!(proposal.expires_at, expires_at_2, "proposal replacement must update expiry");
}

// ─── Boundary Acceptance ──────────────────────────────────────────────────────

#[test]
fn test_accept_transfer_at_exact_boundary_succeeds() {
    let th = TestHarness::setup();
    let now = th.env.ledger().timestamp();
    let expires_at = now + 3600;

    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );

    // Advance ledger timestamp to exactly expires_at (boundary condition)
    th.env.ledger().with_mut(|l| l.timestamp = expires_at);

    let res = th.client.try_accept_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
    );
    assert!(res.is_ok(), "acceptance at the exact boundary (now == expires_at) must succeed");

    // Verify ownership transferred
    assert!(!th.has_sub_for(&th.old_merchant), "old merchant must no longer own subscription");
    assert!(th.has_sub_for(&th.new_merchant), "new merchant must now own subscription");

    // Proposal must be cleaned up
    assert!(
        th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant).is_none(),
        "accepted proposal must be removed from storage"
    );
}

// ─── Expiry Rejection & Ownership Preservation ───────────────────────────────

#[test]
fn test_accept_transfer_after_expiry_fails_and_preserves_ownership() {
    let th = TestHarness::setup();
    let now = th.env.ledger().timestamp();
    let expires_at = now + 3600;

    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );

    // Advance ledger timestamp past expires_at
    th.env.ledger().with_mut(|l| l.timestamp = expires_at + 1);

    let res = th.client.try_accept_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
    );
    assert!(
        matches!(res, Err(Ok(ContractError::TransferProposalExpired))),
        "acceptance after expiry must return TransferProposalExpired; got {:?}",
        res
    );

    // Invariant check: Ownership remains unchanged!
    assert!(th.has_sub_for(&th.old_merchant), "old merchant must retain ownership after expired attempt");
    assert!(!th.has_sub_for(&th.new_merchant), "new merchant must not gain ownership");
}

// ─── Cancellation Paths ───────────────────────────────────────────────────────

#[test]
fn test_cancel_transfer_proposal_by_merchant() {
    let th = TestHarness::setup();
    let expires_at = th.env.ledger().timestamp() + 3600;

    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );
    assert!(th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant).is_some());

    // Merchant cancels
    let res = th.client.try_cancel_transfer_proposal(&th.subscriber, &th.old_merchant);
    assert!(res.is_ok(), "merchant cancellation must succeed");
    assert!(th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant).is_none());

    // Recipient acceptance should fail with NoTransferProposal
    let accept_res = th.client.try_accept_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
    );
    assert!(matches!(accept_res, Err(Ok(ContractError::NoTransferProposal))));
}

#[test]
fn test_cancel_transfer_proposal_by_subscriber() {
    let th = TestHarness::setup();
    let expires_at = th.env.ledger().timestamp() + 3600;

    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );

    // Subscriber cancels
    let res = th.client.try_cancel_transfer_proposal_by_subscriber(&th.subscriber, &th.old_merchant);
    assert!(res.is_ok(), "subscriber cancellation must succeed");
    assert!(th.client.get_transfer_proposal(&th.subscriber, &th.old_merchant).is_none());
}

// ─── Unauthorized Recipient Rejection ────────────────────────────────────────

#[test]
fn test_accept_transfer_unauthorized_recipient_fails() {
    let th = TestHarness::setup();
    let expires_at = th.env.ledger().timestamp() + 3600;

    th.client.propose_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.new_merchant,
        &expires_at,
    );

    // other_merchant tries to accept instead of new_merchant
    let res = th.client.try_accept_subscription_transfer(
        &th.subscriber,
        &th.old_merchant,
        &th.other_merchant,
    );
    assert!(
        matches!(res, Err(Ok(ContractError::Unauthorized))),
        "acceptance by unexpected recipient must return Unauthorized"
    );
}
