use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};
use soroban_subscription_contract::{SubscriptionProtocol, SubscriptionProtocolClient};

fn setup(fee_bps: u32) -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1);

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let collector = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(SubscriptionProtocol, ());

    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.set_protocol_fee(&admin, &fee_bps, &collector);

    (env, subscriber, merchant, collector, token, contract_id)
}

fn advance(env: &Env, seconds: u64) {
    let timestamp = env.ledger().timestamp();
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = timestamp + seconds);
}

#[test]
fn fee_collected_event_has_expected_topics_and_data() {
    let (env, subscriber, merchant, collector, token, contract_id) = setup(100);
    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    let amount = 100_000_i128;
    let fee_amount = 1_000_i128;
    let interval = 86_400_u64;

    client.subscribe(&subscriber, &merchant, &token, &amount, &interval, &false);
    advance(&env, interval + 1);
    client.execute_payment(&subscriber, &merchant, &token);

    assert_eq!(
        token::Client::new(&env, &token).balance(&collector),
        fee_amount,
        "the configured fee must be transferred"
    );

    let expected_topics = (
        Symbol::new(&env, "fee_collected"),
        subscriber,
        merchant,
        collector,
    )
        .into_val(&env);
    let events = env.events().all();
    let event = events
        .iter()
        .find(|event| event.0 == contract_id && event.1 == expected_topics)
        .expect("nonzero fee transfer must emit fee_collected");

    assert_eq!(
        event.2,
        fee_amount.into_val(&env),
        "fee_collected data must be the transferred fee as i128"
    );
}

#[test]
fn fee_collected_event_is_not_emitted_for_zero_fee() {
    let (env, subscriber, merchant, collector, token, contract_id) = setup(0);
    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    let amount = 100_000_i128;
    let interval = 86_400_u64;

    client.subscribe(&subscriber, &merchant, &token, &amount, &interval, &false);
    advance(&env, interval + 1);
    client.execute_payment(&subscriber, &merchant, &token);

    let expected_topics = (
        Symbol::new(&env, "fee_collected"),
        subscriber,
        merchant,
        collector,
    )
        .into_val(&env);
    let events = env.events().all();
    assert!(
        !events
            .iter()
            .any(|event| event.0 == contract_id && event.1 == expected_topics),
        "zero-fee payment must not emit fee_collected"
    );
    assert_eq!(
        token::Client::new(&env, &token).balance(&merchant),
        amount,
        "zero-fee payment must transfer the full amount to the merchant"
    );
}
