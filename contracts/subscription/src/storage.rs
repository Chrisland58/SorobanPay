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

/// Minimum TTL threshold (~30 days at 5 s/ledger = 518 400 ledgers).
///
/// Used as the `threshold` argument to `extend_ttl`: the host skips the
/// extension if the entry already has more than this many ledgers of
/// lifetime remaining, avoiding unnecessary fee spend.
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// Maximum TTL ceiling (~365 days at 5 s/ledger = 6 307 200 ledgers).
///
/// Used as the `extend_to` argument to `extend_ttl`: when an extension is
/// needed, the entry's TTL is bumped up to this value. Guarantees that an
/// active subscription survives a full annual billing cycle without expiring.
/// Stale subscriptions that go a full year without a successful payment will
/// expire and be garbage-collected by the Soroban host automatically.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
