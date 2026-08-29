use soroban_sdk::{contracttype, Address};

/// Composite storage key uniquely identifying a subscription or contract-level record.
///
/// - `Subscription(subscriber, merchant)` — one entry per subscriber/merchant pair,
///   stored as persistent storage with TTL management.
/// - `Admin` — single contract-level entry holding the admin/owner `Address`.
///   Set once via `initialize` and used to gate future upgrade or emergency-pause operations.
#[contracttype]
pub enum DataKey {
    /// Per-subscription record keyed by (subscriber, merchant).
    Subscription(Address, Address),
    /// Contract-level admin/owner address. Set once at initialization.
    Admin,
}

/// Represents the lifecycle state of a subscription.
///
/// - `Active`    — subscription is live and payments can be collected.
/// - `Cancelled` — subscriber explicitly cancelled; no further payments will be accepted.
/// - `Expired`   — the persistent storage entry outlived its TTL and was logically expired.
///                 NOTE: Soroban storage expiry is handled externally via TTL ledger counts;
///                 this variant is provided for off-chain indexers and future on-chain checks.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionStatus {
    /// Subscription is live; `execute_payment` may be called when the interval elapses.
    Active,
    /// Subscriber cancelled the subscription; no further payments can be collected.
    Cancelled,
    /// Subscription has logically expired (e.g., TTL not renewed, or marked expired on-chain).
    Expired,
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    /// SEP-41 token contract address used for payment transfers.
    pub token:        Address,
    /// Payment amount per interval (strictly positive, enforced by `subscribe`).
    pub amount:       i128,
    /// Seconds between payments. Constrained to `[86400, 31536000]`.
    pub interval:     u64,
    /// Unix timestamp of the next valid payment window. Set to `now + interval` on creation
    /// and advanced by `interval` after each successful `execute_payment`.
    pub next_payment: u64,
    /// Current lifecycle state of this subscription.
    /// Set to `Active` on creation/update, `Cancelled` when the subscriber calls `cancel`.
    pub status:       SubscriptionStatus,
}

// ─── TTL Constants ────────────────────────────────────────────────────────────
//
// Soroban persistent storage entries are subject to ledger TTL (time-to-live).
// If an entry's TTL expires without renewal, it is evicted from the ledger state
// and future reads return `None`. We proactively extend TTLs after every write
// to avoid silent subscription loss.
//
// Assumptions:
//   - Average Stellar network ledger close time: ~5 seconds
//   - MIN_TTL_LEDGERS ensures an entry survives at least ~30 days after the last write.
//     This acts as a safety floor: even if no payment is collected, the subscription
//     persists long enough for the subscriber or merchant to interact with it.
//   - MAX_TTL_LEDGERS caps the TTL at ~365 days. On every successful `subscribe` or
//     `execute_payment`, the TTL is bumped up to this ceiling so an active subscription
//     can live for a full year without manual renewal. This mirrors the maximum allowed
//     payment interval (31,536,000 seconds = 365 days), ensuring the record outlives
//     the interval it encodes.
//
// Formula: ledgers = seconds / close_time_secs
//   MIN: 30  days × 86400 s/day ÷ 5 s/ledger =   518,400 ledgers
//   MAX: 365 days × 86400 s/day ÷ 5 s/ledger = 6,307,200 ledgers

/// Minimum TTL in ledgers (~30 days at 5 s/ledger).
///
/// Used as the `threshold` argument to `extend_ttl`: the TTL is only extended when
/// the current remaining TTL drops below this value, preventing redundant ledger I/O
/// on every invocation while still ensuring the entry never falls below ~30 days
/// of remaining lifetime.
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;   // 518_400

/// Maximum TTL in ledgers (~365 days at 5 s/ledger).
///
/// Used as the `extend_to` argument to `extend_ttl`: when the threshold is crossed
/// the TTL is extended all the way out to this ceiling. This keeps active subscriptions
/// alive for a full year after their last on-chain interaction (subscribe or payment),
/// which matches the maximum permitted payment interval and avoids frequent TTL-renewal
/// transactions for long-lived subscriptions.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;  // 6_307_200
