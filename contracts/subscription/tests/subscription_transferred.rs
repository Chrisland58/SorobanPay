use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};
use soroban_subscription_contract::{SubscriptionProtocol, SubscriptionProtocolClient};

#[test]
fn subscription_transferred_event_has_expected_topics_and_data() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let old_merchant = Address::generate(&env);
    let new_merchant = Address::generate(&env);
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
    client.set_protocol_fee(&admin, &0, &collector);
    client.subscribe(
        &subscriber,
        &old_merchant,
        &token,
        &500_i128,
        &86_400_u64,
        &false,
    );
    client.transfer_subscription(&subscriber, &old_merchant, &new_merchant);

    let expected_topics = (
        Symbol::new(&env, "subscription_transferred"),
        subscriber,
        old_merchant,
        new_merchant,
    )
        .into_val(&env);
    let events = env.events().all();
    let event = events
        .iter()
        .find(|event| event.0 == contract_id && event.1 == expected_topics)
        .expect("successful transfer must emit subscription_transferred");

    assert_eq!(
        event.2,
        ().into_val(&env),
        "subscription_transferred data must be unit"
    );
}
