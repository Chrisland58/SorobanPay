//! Two-phase upgrade regression tests.
//!
//! The native test environment registers v1, writes subscriptions, then replaces its
//! implementation at the same contract address with a v1.1 implementation. The v1.1
//! schema adds an optional field and exposes a new entry point.

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    storage::{subscription_key, DataKey},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionDataV2 {
    pub token: Address,
    pub amount: i128,
    pub interval: u64,
    pub next_payment: u64,
    pub is_paused: bool,
    pub grace_period: u64,
    pub overdue_since: Option<u64>,
    pub payment_nonce: u64,
    pub memo: Option<u32>,
}

fn load_subscription(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    token: &Address,
) -> Option<SubscriptionDataV2> {
    let key = DataKey::Subscription(subscription_key(env, subscriber, merchant, token));
    env.storage().persistent().get(&key)
}

#[contract]
pub struct SubscriptionProtocolV2;

#[contractimpl]
impl SubscriptionProtocolV2 {
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
    ) -> Option<SubscriptionDataV2> {
        load_subscription(&env, &subscriber, &merchant, &token)
    }

    pub fn get_subscription_memo(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
    ) -> Option<u32> {
        load_subscription(&env, &subscriber, &merchant, &token).and_then(|data| data.memo)
    }
}

struct UpgradeFixture {
    env: Env,
    subscriber: Address,
    second_subscriber: Address,
    merchant: Address,
    token: Address,
    contract_id: Address,
}

impl U {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger()
            .with_mut(|ledger| ledger.timestamp = 1_700_000_000);

        let admin = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let second_subscriber = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&subscriber, &10_000_000_i128);
        token_admin.mint(&second_subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.initialize(&admin);
        let token_client = token::Client::new(&env, &token);
        let expiration = env.ledger().sequence() + 100_000_u32;
        token_client.approve(&subscriber, &contract_id, &5_000_000_i128, &expiration);
        token_client.approve(
            &second_subscriber,
            &contract_id,
            &5_000_000_i128,
            &expiration,
        );

        client.subscribe(
            &subscriber,
            &merchant,
            &token,
            &100_000_i128,
            &86_400_u64,
            &false,
            &None,
        );
        client.subscribe(
            &second_subscriber,
            &merchant,
            &token,
            &250_000_i128,
            &172_800_u64,
            &false,
            &None,
        );

        Self {
            env,
            subscriber,
            second_subscriber,
            merchant,
            token,
            contract_id,
        }
    }

    fn upgrade(&self) -> SubscriptionProtocolV2Client<'_> {
        self.env
            .register_contract(Some(&self.contract_id), SubscriptionProtocolV2);
        SubscriptionProtocolV2Client::new(&self.env, &self.contract_id)
    }
}

#[test]
fn test_upgrade_reads_existing_subscriptions_after_optional_field_addition() {
    let fixture = UpgradeFixture::new();
    let client = fixture.upgrade();

    let first = client
        .get_subscription(&fixture.subscriber, &fixture.merchant, &fixture.token)
        .expect("first v1 subscription must remain readable");
    assert_eq!(first.amount, 100_000_i128);
    assert_eq!(first.interval, 86_400_u64);
    assert_eq!(first.memo, None);

    let second = client
        .get_subscription(
            &fixture.second_subscriber,
            &fixture.merchant,
            &fixture.token,
        )
        .expect("second v1 subscription must remain readable");
    assert_eq!(second.amount, 250_000_i128);
    assert_eq!(second.interval, 172_800_u64);
    assert_eq!(second.memo, None);
}

#[test]
fn test_upgrade_exposes_new_entrypoint_for_existing_subscription() {
    let fixture = UpgradeFixture::new();
    let client = fixture.upgrade();

    assert_eq!(
        client.get_subscription_memo(&fixture.subscriber, &fixture.merchant, &fixture.token),
        None,
        "the new v1.1 entry point must read the optional field from v1 data"
    );
}
