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

fn setup_with_mint(fee_bps: u32, mint_amount: i128) -> (Env, Address, Address, Address, Address, Address) {
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

    StellarAssetClient::new(&env, &token).mint(&subscriber, &mint_amount);
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &mint_amount,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.set_protocol_fee(&admin, &fee_bps, &collector);

    (env, subscriber, merchant, collector, token, contract_id)
}

#[test]
fn fee_accounting_invariants_across_token_precisions_and_boundaries() {
    // (label, gross_amount_in_base_units, fee_bps)
    let cases: [(&str, i128, u32); 9] = [
        // 0-decimal token, minimum amount (1 base unit) with max fee (500 bps -> fee rounds to 0)
        ("0-dec_min_amount_max_fee", 1, 500),
        // 2-decimal token (e.g. fiat cents), odd amount with non-divisible fee
        ("2-dec_odd_amount", 999, 333),
        // 6-decimal token (USDC-style), 1.000000 USDC at 250 bps (2.5%)
        ("6-dec_usdc_standard", 1_000_000, 250),
        // 7-decimal token (Stellar XLM-style), 1.0000007 XLM at max fee (500 bps)
        ("7-dec_xlm_max_fee", 10_000_007, 500),
        // 7-decimal token, zero fee
        ("7-dec_xlm_zero_fee", 10_000_000, 0),
        // 18-decimal token (EVM-bridged style), 1.000000000000000007 at max fee (500 bps)
        ("18-dec_evm_max_fee", 1_000_000_000_000_000_007, 500),
        // 18-decimal token, 1000 tokens at 1 bps (0.01%)
        ("18-dec_1bps", 1_000_000_000_000_000_000_000, 1),
        // Arithmetic boundary: exact 10_000 base units at 1 bps -> fee = 1
        ("boundary_exact_1_fee", 10_000, 1),
        // Arithmetic boundary: 9_999 base units at 1 bps -> fee = 0 (rounds down)
        ("boundary_9999_1bps", 9_999, 1),
    ];

    for (label, gross, fee_bps) in cases {
        let mint_amount = gross.saturating_mul(2).max(100);
        let (env, subscriber, merchant, collector, token, contract_id) =
            setup_with_mint(fee_bps, mint_amount);
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        let interval = 86_400_u64;

        client.subscribe(&subscriber, &merchant, &token, &gross, &interval, &false);
        advance(&env, interval + 1);
        client.execute_payment(&subscriber, &merchant, &token);

        let expected_fee = gross * (fee_bps as i128) / 10_000;
        let expected_net = gross - expected_fee;
        assert_eq!(
            expected_fee + expected_net,
            gross,
            "{label}: fee + net must equal gross without rounding drift"
        );

        let token_client = token::Client::new(&env, &token);
        let actual_net = token_client.balance(&merchant);
        let actual_fee = token_client.balance(&collector);

        assert_eq!(actual_net, expected_net, "{label}: merchant balance mismatch");
        assert_eq!(actual_fee, expected_fee, "{label}: collector balance mismatch");
        assert_eq!(
            actual_fee + actual_net,
            gross,
            "{label}: actual transferred fee + net must equal gross"
        );

        let events = env.events().all();
        let fee_topics = (
            Symbol::new(&env, "fee_collected"),
            subscriber.clone(),
            merchant.clone(),
            collector.clone(),
        )
            .into_val(&env);
        let fee_event = events
            .iter()
            .find(|event| event.0 == contract_id && event.1 == fee_topics);

        if expected_fee > 0 {
            let ev = fee_event.unwrap_or_else(|| panic!("{label}: expected fee_collected event"));
            assert_eq!(
                ev.2,
                expected_fee.into_val(&env),
                "{label}: fee_collected event payload must match transferred fee"
            );
        } else {
            assert!(
                fee_event.is_none(),
                "{label}: zero-fee case must not emit fee_collected event"
            );
        }
    }
}

#[test]
fn set_protocol_fee_rejects_above_max_bps() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    client.initialize(&admin);

    let res = client.try_set_protocol_fee(&admin, &501_u32, &collector);
    assert!(res.is_err(), "fee_bps > MAX_FEE_BPS (500) must be rejected");
}
