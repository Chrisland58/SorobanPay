use soroban_sdk::{contracttype, Address, BytesN, Env};
use soroban_sdk::xdr::ToXdr;

// ==================== Version Metadata ====================

pub const CONTRACT_VERSION: &str = "1.0.0";
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// Current on-chain schema version.  Increment when `SubscriptionData` changes.
/// Bumped to 2 for Issue #50: added `last_payment` (Option<u64>) field.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

// ==================== Key helpers ====================

/// Derive the compact 32-byte storage key for a subscription.
///
/// Uses SHA-256 over the concatenation of the subscriber and merchant address
/// bytes, producing a fixed-size `BytesN<32>` that replaces the old
/// `(Address, Address, Address)` tuple key.
///
/// # Key size comparison
/// - Old: ~70 bytes  (two 32-byte Addresses + enum discriminant)
/// - New: 32 bytes   (SHA-256 digest)
///
/// The ~38-byte reduction (~54 %) translates directly to lower ledger write
/// fees on every `subscribe` and `execute_payment` call.
pub fn subscription_key(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
) -> BytesN<32> {
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.append(&subscriber.to_xdr(env));
    preimage.append(&merchant.to_xdr(env));
    env.crypto().sha256(&preimage)
}

// ==================== Storage & Data Structures ====================

/// Storage keys used by the contract.
///
/// All `Subscription` entries use **persistent** storage (survives ledger archival
/// when TTL is extended).  `MerchantIndex` entries use **temporary** storage
/// (lower cost; acceptable loss in the unlikely case of archival).
/// `SchemaVersion`, `Admin`, `AdminConfig`, and `ProtocolFeeConfig` use
/// **instance** storage (tied to the contract instance lifetime).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-subscription record, keyed by sha256(subscriber_xdr ++ merchant_xdr ++ token_xdr).
    /// Compact 32-byte key instead of the old two-Address tuple (~70 bytes).
    /// Storage type: **persistent**.
    Subscription(BytesN<32>),

    /// Merchant subscription index: maps merchant → Vec<BytesN<32>> of
    /// all hashed subscription keys the merchant is party to.
    /// Enables on-chain enumeration ("all subscriptions for merchant X").
    /// Storage type: **temporary**.
    MerchantIndex(Address),

    /// Merchant subscriber roster: maps merchant → Vec<Address> of all
    /// subscriber addresses for that merchant.  Maintained in parallel with
    /// `MerchantIndex` and enables `get_merchant_subscriptions` to return
    /// full `SubscriptionData` without reversing compact sha-256 keys.
    MerchantSubscribers(Address),

    /// On-chain schema version; updated by `migrate(admin)`.
    /// Storage type: **instance**.
    SchemaVersion,

    /// Designated admin address authorised to call `migrate` and `set_protocol_fee`.
    /// Storage type: **instance**.
    Admin,

    /// Optional admin configuration (rate limits, caps).
    AdminConfig,

    /// Per-merchant active subscriber count.
    MerchantSubscriberCount(Address),
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    /// SEP-41 token contract address used for transfers.
    pub token: Address,
    /// Payment amount per interval (strictly positive, ≤ `MAX_AMOUNT`).
    pub amount: i128,
    /// Seconds between payment windows  [86_400 (1 day), 31_536_000 (1 year)].
    pub interval: u64,
    /// Unix timestamp (seconds) after which the next payment may be collected.
    pub next_payment: u64,
    /// When `true`, `execute_payment` is blocked until the subscription is
    /// explicitly resumed (see `paused_until` usage in `execute_payment`).
    pub is_paused: bool,
    /// Seconds after `overdue_since` before `expire_subscription` may be called.
    /// `0` disables the grace period (subscription can be expired immediately).
    pub grace_period: u64,
    /// Unix timestamp when the most recent payment attempt failed due to
    /// insufficient subscriber balance.  `None` when the subscription is current.
    pub overdue_since: Option<u64>,
    /// Monotonically incrementing counter of successful `execute_payment` calls.
    /// Used for idempotency checks and off-chain event deduplication.
    pub payment_nonce: u64,
    /// Unix timestamp at which a paused subscription auto-resumes on the next
    /// `execute_payment` call. `None` means the pause is indefinite and requires
    /// an explicit `resume_subscription` call (issue #795).
    pub paused_until: Option<u64>,
}

/// Admin-level configuration stored per contract instance.
///
/// Set during `initialize`; `max_amount` may be updated via `set_max_amount`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminConfig {
    /// The privileged address that may call `migrate`, `set_protocol_fee`,
    /// and `set_max_amount`.
    pub admin: Address,
    /// Per-contract ceiling on `SubscriptionData.amount`.
    /// Defaults to `MAX_AMOUNT` (10¹⁸) at initialisation.
    pub max_amount: i128,
}

/// A subscription record paired with its subscriber address.
///
/// Returned by `get_merchant_subscriptions` so callers receive both the
/// subscriber identity and the full subscription state in a single query.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionEntry {
    /// The subscriber's Stellar account address.
    pub subscriber: Address,
    /// The full subscription state for this subscriber-merchant pair.
    pub data:       SubscriptionData,
}

/// Optional admin configuration stored in instance storage.
#[contracttype]
#[derive(Clone)]
pub struct AdminConfig {
    /// Maximum number of active subscribers allowed per merchant (0 = unlimited).
    pub max_subscribers_per_merchant: u32,
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18

/// ~30 days at 5-second ledger close time (518_400 ledgers).
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers).
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

/// Maximum allowed protocol fee in basis points (500 bps = 5%).
pub const MAX_FEE_BPS: u32 = 500;

// ─── ProtocolFeeConfig ────────────────────────────────────────────────────────

/// Protocol-level fee configuration stored in instance storage.
///
/// `fee_bps = 0` disables fees entirely; the contract behaves identically
/// to the pre-fee implementation.  `fee_bps` is capped at [`MAX_FEE_BPS`]
/// (500 = 5 %) to prevent admin abuse.
///
/// ## Integer division truncation
///
/// The fee is computed as `amount * fee_bps / 10_000`.  Integer division
/// truncates toward zero, so the fee rounds **down** and the merchant
/// receives the remainder (`amount - fee`).  For example, 1 token at 50 bps
/// yields fee = 0 if `amount < 200`; at 10_000 tokens it yields fee = 50 tokens.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolFeeConfig {
    /// Fee in basis points.  0 = disabled.  Max = [`MAX_FEE_BPS`] (500 = 5 %).
    pub fee_bps:       u32,
    /// Address that receives the protocol fee portion on each payment.
    pub fee_collector: Address,
}

/// Load the protocol fee config from instance storage.
/// Returns `None` when no fee has been configured (fee is effectively 0 bps).
pub fn get_protocol_fee_config(env: &Env) -> Option<ProtocolFeeConfig> {
    env.storage()
        .instance()
        .get(&DataKey::ProtocolFeeConfig)
}

/// Persist the protocol fee config to instance storage.
pub fn set_protocol_fee_config(env: &Env, config: ProtocolFeeConfig) {
    env.storage()
        .instance()
        .set(&DataKey::ProtocolFeeConfig, &config);
}
