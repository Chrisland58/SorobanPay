use soroban_sdk::{contracttype, Address};

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
    pub is_paused:    bool,      // true if subscription payments are suspended
}

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

/// Public configuration returned by `get_config`.
/// Contains only active, non-administrative parameters visible to integrators.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolConfig {
    /// Minimum payment interval in seconds (86400 = 1 day)
    pub min_interval_secs:    u64,
    /// Maximum payment interval in seconds (31536000 = 365 days)
    pub max_interval_secs:    u64,
    /// Maximum single payment amount in base token units (1e18)
    pub max_payment_amount:   i128,
    /// Schema version for integrators to detect breaking changes
    pub schema_version:       u32,
    /// Minimum TTL extension in ledgers for persistent storage entries
    pub min_ttl_ledgers:      u32,
    /// Maximum TTL extension in ledgers for persistent storage entries
    pub max_ttl_ledgers:      u32,
}

// ==================== Settlement Fee Accounting ====================

/// Protocol fee basis points (0 = no fee currently, expressed as basis points out of 10000).
/// 100 bps = 1%, 0 bps = 0% (fee-free).
pub const PROTOCOL_FEE_BPS: u32 = 0;

/// Denominator for basis-point fee calculations.
pub const FEE_DENOMINATOR: u32 = 10_000;

/// Settlement breakdown for a single payment.
/// Separates gross amount, protocol fee, and merchant net for unambiguous accounting.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Settlement {
    /// Gross amount charged to subscriber (base token units, no rounding)
    pub gross_amount:  i128,
    /// Protocol fee deducted from gross (base token units, 0 when fee is 0 bps)
    pub protocol_fee:  i128,
    /// Net amount received by merchant (gross - protocol_fee, base token units)
    pub net_amount:    i128,
}
