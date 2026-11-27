use soroban_sdk::{contracttype, Address, BytesN, Env};

// ==================== Version Metadata ====================

/// Semantic version reported by the deployed contract.
pub const CONTRACT_VERSION: &str = "1.0.0";
/// Stable contract name used in deployment metadata.
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// Current on-chain schema version.  Increment when `SubscriptionData` changes.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

// ==================== Key helpers ====================

/// Derive the compact 32-byte storage key for a subscription.
///
/// Uses SHA-256 over the concatenation of the subscriber and merchant address
/// bytes, producing a fixed-size `BytesN<32>` that replaces the old
/// `(Address, Address)` tuple key.
///
/// # Key size comparison
/// - Old: ~70 bytes  (two 32-byte Addresses + enum discriminant)
/// - New: 32 bytes   (SHA-256 digest)
///
/// The ~38-byte reduction (~54 %) translates directly to lower ledger write
/// fees on every `subscribe` and `execute_payment` call.
pub fn subscription_key(env: &Env, subscriber: &Address, merchant: &Address) -> BytesN<32> {
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.append(&subscriber.to_xdr(env));
    preimage.append(&merchant.to_xdr(env));
    env.crypto().sha256(&preimage)
}

// ==================== Storage & Data Structures ====================

/// Storage keys used by the contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-subscription record, keyed by sha256(subscriber_xdr ++ merchant_xdr).
    /// Compact 32-byte key instead of the old two-Address tuple (~70 bytes).
    Subscription(BytesN<32>),

    /// Merchant subscription index: maps merchant → Vec<BytesN<32>> of
    /// all hashed subscription keys the merchant is party to.
    /// Enables enumeration ("all subscriptions for merchant X") on-chain.
    MerchantIndex(Address),

    /// On-chain schema version; updated by `migrate(admin)`.
    SchemaVersion,

    /// Designated admin address authorised to call `migrate`.
    Admin,

    /// Optional maximum subscription amount for this deployment.
    MaxAmount,

    /// Optional admin configuration (rate limits, caps).
    AdminConfig,

    /// Per-merchant active subscriber count.
    MerchantSubscriberCount(Address),

    /// Temporary nonce execution marker.
    ExecutionMarker(BytesN<32>, u64),

    /// Deduplication record for unique payment execution identifiers (#1610).
    PaymentDedup(BytesN<32>),

    /// Protocol fee configuration stored in instance storage.
    ProtocolFeeConfig,
}

/// Deduplication record stored for an execution identifier within its retention window.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionRecord {
    /// Unique execution identifier.
    pub execution_id: BytesN<32>,
    /// Ledger Unix timestamp when settlement occurred.
    pub executed_at: u64,
    /// Amount transferred during settlement.
    pub amount: i128,
}

/// Retention window for deduplication records in seconds: 7 days.
pub const DEDUP_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Bounded TTL for deduplication temporary storage entries: ~7 days at 5-second ledger closes.
pub const DEDUP_WINDOW_LEDGERS: u32 = (7 * 24 * 60 * 60) / 5;

/// Persistent on-chain record for a subscription.
///
/// ## Schema versioning
///
/// The `ver` field starts at 1 for all new entries written by this version of the
/// contract. Future migrations can inspect `ver` to decide whether to transform an
/// entry before using it.
///
/// ## Backward compatibility
///
/// `grace_period`, `paused_until`, and `overdue_since` are `Option` fields so that
/// old entries written without these fields (ver 0 / missing) deserialise correctly
/// as `None`. Use the provided getter methods instead of direct field access to
/// ensure default values are applied consistently.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    /// SEP-41 token contract address
    pub token:        Address,
    /// Payment amount per interval (strictly positive, <= MAX_AMOUNT)
    pub amount:       i128,
    /// Seconds between payments  [86_400, 31_536_000]
    pub interval:     u64,
    /// Unix timestamp of the next valid payment window
    pub next_payment: u64,
    /// True when subscription payments are suspended
    pub is_paused:    bool,
    /// Grace-period duration in seconds, if configured for this subscription.
    pub grace_period: Option<u64>,
    /// Timestamp until which payments are paused.
    pub paused_until: Option<u64>,
    /// Timestamp when the subscription first became overdue.
    pub overdue_since: Option<u64>,
}

/// Subscription layout stored before schema version 2.
#[contracttype]
#[derive(Clone, Debug)]
pub struct LegacySubscriptionData {
    /// SEP-41 token contract address used by the subscription.
    pub token: Address,
    /// Payment amount per interval in token base units.
    pub amount: i128,
    /// Seconds between payments.
    pub interval: u64,
    /// Unix timestamp at which the next payment becomes due.
    pub next_payment: u64,
    /// Whether payment collection is suspended.
    pub is_paused: bool,
}

impl SubscriptionData {
    /// Return the configured grace period in seconds, or zero when absent.
    pub fn grace_period_secs(&self) -> u64 {
        self.grace_period.unwrap_or(0)
    }

    /// Return the scheduled pause end timestamp, or zero when no end is set.
    pub fn paused_until_ts(&self) -> u64 {
        self.paused_until.unwrap_or(0)
    }

    /// Return the timestamp when the subscription became overdue, or zero if current.
    pub fn overdue_since_ts(&self) -> u64 {
        self.overdue_since.unwrap_or(0)
    }

    /// Return whether the subscription is paused at `now`.
    ///
    /// An explicit pause flag always pauses the subscription. A scheduled pause
    /// also applies while `now` is earlier than its end timestamp.
    pub fn is_paused(&self, now: u64) -> bool {
        self.is_paused || self.paused_until.map(|until| until > now).unwrap_or(false)
    }
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18

/// Minimum storage TTL, approximately 30 days at a five-second ledger close time.
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// Maximum storage TTL, approximately 365 days at a five-second ledger close time.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ─── AdminConfig helpers ──────────────────────────────────────────────────────

/// Load the admin config from instance storage; returns a zero-cap default if absent.
pub fn get_admin_config(env: &Env) -> AdminConfig {
    env.storage()
        .instance()
        .get(&DataKey::AdminConfig)
        .unwrap_or(AdminConfig { max_subscribers_per_merchant: 0 })
}

/// Persist the admin config to instance storage.
pub fn set_admin_config(env: &Env, config: AdminConfig) {
    env.storage().instance().set(&DataKey::AdminConfig, &config);
}

// ─── MerchantSubscriberCount helpers ─────────────────────────────────────────

/// Return the current active-subscriber count for a merchant (0 if never set).
pub fn get_subscriber_count(env: &Env, merchant: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantSubscriberCount(merchant.clone()))
        .unwrap_or(0u32)
}

/// Persist the active-subscriber count for a merchant and extend its TTL.
pub fn set_subscriber_count(env: &Env, merchant: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantSubscriberCount(merchant.clone()), &count);
    env.storage()
        .persistent()
        .extend_ttl(
            &DataKey::MerchantSubscriberCount(merchant.clone()),
            MIN_TTL_LEDGERS,
            MAX_TTL_LEDGERS,
        );
}

// ─── ProtocolFeeConfig ────────────────────────────────────────────────────────

pub const MAX_FEE_BPS: u32 = 500;

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolFeeConfig {
    pub fee_bps: u32,
    pub fee_collector: Address,
}

pub fn get_protocol_fee_config(env: &Env) -> Option<ProtocolFeeConfig> {
    env.storage().instance().get(&DataKey::ProtocolFeeConfig)
}

pub fn set_protocol_fee_config(env: &Env, config: ProtocolFeeConfig) {
    env.storage().instance().set(&DataKey::ProtocolFeeConfig, &config);
}

// ─── Execution marker helpers ────────────────────────────────────────────────

pub const MARKER_TTL_LEDGERS: u32 = MAX_TTL_LEDGERS * 2;

pub fn has_execution_marker(env: &Env, hash: &BytesN<32>, nonce: u64) -> bool {
    let key = DataKey::ExecutionMarker(hash.clone(), nonce);
    env.storage().temporary().has(&key)
}

pub fn write_execution_marker(env: &Env, hash: &BytesN<32>, nonce: u64) {
    let key = DataKey::ExecutionMarker(hash.clone(), nonce);
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, MARKER_TTL_LEDGERS, MARKER_TTL_LEDGERS);
}

// ─── Payment execution identifier deduplication helpers (#1610) ──────────────

/// Derive scoped 32-byte deduplication key from (subscriber, merchant, execution_id).
pub fn execution_dedup_key(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    execution_id: &BytesN<32>,
) -> BytesN<32> {
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.append(&subscriber.to_xdr(env));
    preimage.append(&merchant.to_xdr(env));
    preimage.append(&execution_id.to_xdr(env));
    env.crypto().sha256(&preimage)
}

/// Retrieve stored execution deduplication record, if present in temporary storage.
pub fn get_execution_record(env: &Env, key: &BytesN<32>) -> Option<ExecutionRecord> {
    env.storage().temporary().get(&DataKey::PaymentDedup(key.clone()))
}

/// Persist deduplication record with bounded retention window TTL in temporary storage.
pub fn set_execution_record(env: &Env, key: &BytesN<32>, record: &ExecutionRecord) {
    let data_key = DataKey::PaymentDedup(key.clone());
    env.storage().temporary().set(&data_key, record);
    env.storage()
        .temporary()
        .extend_ttl(&data_key, DEDUP_WINDOW_LEDGERS, DEDUP_WINDOW_LEDGERS);
}

/// Remove deduplication record after retention window expiry.
pub fn remove_execution_record(env: &Env, key: &BytesN<32>) {
    env.storage().temporary().remove(&DataKey::PaymentDedup(key.clone()));
}
