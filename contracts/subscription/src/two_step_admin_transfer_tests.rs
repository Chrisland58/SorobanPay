#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

use crate::{
    error::ContractError,
    SubscriptionProtocol, SubscriptionProtocolClient,
};

struct TestHarness {
    env: Env,
    client: SubscriptionProtocolClient,
    admin: Address,
    candidate: Address,
    stranger: Address,
}

impl TestHarness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let candidate = Address::generate(&env);
        let stranger = Address::generate(&env);

        let contract_id = env.register_contract(None, SubscriptionProtocol);
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        client.initialize(&admin);

        TestHarness {
            env,
            client,
            admin,
            candidate,
            stranger,
        }
    }
}

#[test]
fn test_initial_admin_and_no_pending_admin() {
    let h = TestHarness::new();
    assert_eq!(h.client.get_admin(), h.admin);
    assert_eq!(h.client.get_pending_admin(), None);
}

#[test]
fn test_propose_admin_success() {
    let h = TestHarness::new();
    let res = h.client.try_propose_admin(&h.admin, &h.candidate);
    assert!(res.is_ok());
    assert_eq!(h.client.get_admin(), h.admin);
    assert_eq!(h.client.get_pending_admin(), Some(h.candidate.clone()));
}

#[test]
fn test_propose_admin_fails_if_not_admin() {
    let h = TestHarness::new();
    let res = h.client.try_propose_admin(&h.stranger, &h.candidate);
    assert_eq!(res, Err(Ok(ContractError::NotAdmin)));
    assert_eq!(h.client.get_pending_admin(), None);
}

#[test]
fn test_propose_admin_fails_if_self_proposed() {
    let h = TestHarness::new();
    let res = h.client.try_propose_admin(&h.admin, &h.admin);
    assert_eq!(res, Err(Ok(ContractError::InvalidAdminCandidate)));
    assert_eq!(h.client.get_pending_admin(), None);
}

#[test]
fn test_accept_admin_success() {
    let h = TestHarness::new();
    h.client.propose_admin(&h.admin, &h.candidate);
    assert_eq!(h.client.get_pending_admin(), Some(h.candidate.clone()));

    let res = h.client.try_accept_admin(&h.candidate);
    assert!(res.is_ok());

    assert_eq!(h.client.get_admin(), h.candidate);
    assert_eq!(h.client.get_pending_admin(), None);
}

#[test]
fn test_accept_admin_fails_if_no_pending_admin() {
    let h = TestHarness::new();
    let res = h.client.try_accept_admin(&h.candidate);
    assert_eq!(res, Err(Ok(ContractError::NoPendingAdmin)));
}

#[test]
fn test_accept_admin_fails_if_wrong_caller() {
    let h = TestHarness::new();
    h.client.propose_admin(&h.admin, &h.candidate);

    let res = h.client.try_accept_admin(&h.stranger);
    assert_eq!(res, Err(Ok(ContractError::Unauthorized)));
    assert_eq!(h.client.get_admin(), h.admin);
    assert_eq!(h.client.get_pending_admin(), Some(h.candidate));
}

#[test]
fn test_cancel_admin_transfer_success() {
    let h = TestHarness::new();
    h.client.propose_admin(&h.admin, &h.candidate);
    assert_eq!(h.client.get_pending_admin(), Some(h.candidate.clone()));

    let res = h.client.try_cancel_admin_transfer(&h.admin);
    assert!(res.is_ok());
    assert_eq!(h.client.get_admin(), h.admin);
    assert_eq!(h.client.get_pending_admin(), None);

    // After cancellation, candidate can no longer accept
    let accept_res = h.client.try_accept_admin(&h.candidate);
    assert_eq!(accept_res, Err(Ok(ContractError::NoPendingAdmin)));
}

#[test]
fn test_cancel_admin_transfer_fails_if_not_admin() {
    let h = TestHarness::new();
    h.client.propose_admin(&h.admin, &h.candidate);

    let res = h.client.try_cancel_admin_transfer(&h.stranger);
    assert_eq!(res, Err(Ok(ContractError::NotAdmin)));
    assert_eq!(h.client.get_pending_admin(), Some(h.candidate));
}

#[test]
fn test_cancel_admin_transfer_fails_if_no_pending() {
    let h = TestHarness::new();
    let res = h.client.try_cancel_admin_transfer(&h.admin);
    assert_eq!(res, Err(Ok(ContractError::NoPendingAdmin)));
}
