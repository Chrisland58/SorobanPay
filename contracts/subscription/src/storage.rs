use soroban_sdk::{contracttype, Address};

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
}

/// Storage TTL policy for subscriptions.
///
/// The contract uses Soroban persistent storage TTL to avoid indefinite accumulation
/// of stale subscription records. Active subscriptions refresh their TTL on create
/// and successful payment execution. Cancellations remove entries immediately.
///
/// - `MIN_TTL_LEDGERS`: minimum ledger lifetime for a fresh subscription record.
/// - `MAX_TTL_LEDGERS`: maximum lifetime for an active subscription before it may
///   be reclaimed by Soroban storage if no further activity occurs.
///
/// This design favors low on-chain bookkeeping while still providing automatic
/// cleanup for abandoned subscriptions over time.
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
