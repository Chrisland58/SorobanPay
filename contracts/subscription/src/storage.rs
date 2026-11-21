use soroban_sdk::{contracttype, Address, Vec};

// ==================== Version Metadata ====================
/// Contract semantic version: MAJOR.MINOR.PATCH
/// Increment MAJOR for breaking changes, MINOR for new backwards-compatible features, PATCH for bug fixes
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Contract version as numeric components for off-chain compatibility checks
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;

/// Human-readable contract identifier for integration verification
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

// ==================== Storage & Data Structures ====================

/// Composite storage key uniquely identifying a subscription, split config, or contract-level metadata.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
    Admin,
    TokenStatus(Address),
    SplitConfig(Address, Address),  // (subscriber, merchant)
}

/// Token lifecycle status for the allowlist.
/// - `Active`:   token may be used in new subscriptions and payments.
/// - `Disabled`: token may not be used in new subscriptions, but existing
///               obligations (already-subscribed pairs) may still settle.
/// - `Retired`:  token is fully blocked; no new subscriptions and no settlements.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TokenStatus {
    Active,
    Disabled,
    Retired,
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
    pub is_paused:    bool,      // true if subscription payments are suspended
}

/// Schedule status for the read-only preview query.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScheduleStatus {
    /// Subscription is active and payment is not yet due.
    Active,
    /// Subscription is active and payment is overdue (now >= next_payment).
    Overdue,
    /// Subscription is paused; no payment will be collected until resumed.
    Paused,
}

/// Output of the `preview_schedule` read-only query.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SchedulePreview {
    pub next_due:  u64,            // Unix timestamp of next payment (same as next_payment)
    pub status:    ScheduleStatus, // Current schedule status
    pub amount:    i128,           // Amount due per interval
    pub interval:  u64,            // Interval in seconds
}

/// Maximum scheduling horizon: subscriptions may not project their first
/// next_payment more than 10 years (315_360_000 seconds) beyond the current
/// ledger time.  This prevents unbounded future timestamps and the arithmetic
/// edge-cases they create.
///
/// Unit: seconds.  Governance: change requires a contract upgrade (MAJOR bump).
pub const MAX_HORIZON_SECS: u64 = 315_360_000; // 10 years

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
///
/// Stellar Asset Contract (SAC) balances are represented as i64 internally, so
/// the theoretical maximum is i64::MAX ≈ 9.2 × 10¹⁸.  We cap at 1 × 10¹⁸ to:
///   - stay comfortably below i64::MAX and avoid edge-case overflow in downstream
///     arithmetic (e.g. fee calculations, multi-hop aggregations);
///   - prevent accidental fat-finger amounts that would drain a subscriber in a
///     single interval;
///   - keep the value human-readable (10¹² XLM at 10⁶ stroops/XLM — far beyond
///     any realistic subscription use-case).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18 stroops

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ==================== Beneficiary Split Configuration (Issue #1609) ====================

/// Maximum number of beneficiaries in a payment split.
pub const MAX_SPLIT_RECIPIENTS: u32 = 5;

/// Basis-point denominator for split shares (10000 = 100%).
pub const SPLIT_BASIS_POINTS: u32 = 10_000;

/// A single beneficiary in a payment split.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SplitRecipient {
    pub recipient:  Address,
    pub share_bps:  u32,   // basis points, 1-9999
}

/// Split configuration for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SplitConfig {
    pub recipients: Vec<SplitRecipient>,
}
