use soroban_sdk::{contracttype, Address, Env, Symbol};

/// Data payload emitted with the `executed` event.
///
/// Provides analytics consumers with all fields needed to verify a payment:
/// - `amount`       — the exact token units transferred from subscriber to merchant.
/// - `next_payment` — the Unix timestamp after which the next payment becomes collectable.
///                    Allows indexers to schedule alerts or mark subscriptions as overdue
///                    without re-reading contract storage.
#[contracttype]
pub struct ExecutedEventData {
    /// Token units transferred in this payment (matches `SubscriptionData::amount`).
    pub amount:       i128,
    /// Unix timestamp of the next payment window (advanced by `interval` after this payment).
    pub next_payment: u64,
}

/// Emit the `subscribe` event after a subscription has been successfully stored.
///
/// Topics:  `(symbol("subscribe"), subscriber, merchant)`
/// Data:    `amount: i128`
pub fn emit_subscribe(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "subscribe"),
            subscriber.clone(),
            merchant.clone(),
        ),
        amount,
    );
}

/// Emit the `executed` event after a payment transfer has been successfully completed
/// and the `next_payment` timestamp has been advanced.
///
/// Topics:  `(symbol("executed"), subscriber, merchant)`
/// Data:    [`ExecutedEventData`] — contains `amount` (tokens transferred) and
///          `next_payment` (next collectable timestamp), giving analytics consumers
///          everything required to verify the payment and project future cash flow.
pub fn emit_executed(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    amount: i128,
    next_payment: u64,
) {
    env.events().publish(
        (
            Symbol::new(env, "executed"),
            subscriber.clone(),
            merchant.clone(),
        ),
        ExecutedEventData { amount, next_payment },
    );
}
