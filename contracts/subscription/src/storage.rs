use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contracttype, Address, BytesN, Env};

// ==================== Version Metadata ====================

/// Contract semantic version: MAJOR.MINOR.PATCH
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Human-readable contract identifier for integration verification.
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// Current on-chain schema version. Increment when `SubscriptionData` changes.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

// ==================== Storage Version ====================

/// Monotonically increasing integer that identifies the on-chain storage schema.
///
/// Rules:
/// - Bump by 1 on every breaking change to `SubscriptionData` or `DataKey`.
/// - Never reuse a value; old values are permanently recorded in migration logic.
pub const STORAGE_VERSION: u32 = 1;

/// Singleton key that stores the current schema version in instance storage.
#[contracttype]
pub enum MetaKey {
    /// Current on-chain storage schema version (u32).
    StorageVersion,
}

/// Outcome returned by [`ensure_storage_version`].
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// Storage was already at the expected version — nothing was written.
    AlreadyCurrent,
    /// Storage was absent or at an older version — schema was initialised/migrated.
    Migrated { from: u32 },
}

/// Errors produced by the storage migration subsystem.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StorageVersionError {
    /// The on-chain version is *newer* than this binary knows about.
    DowngradeRejected { found: u32 },
    /// The migration loop encountered a version number it has no handler for.
    UnknownVersion { version: u32 },
}

/// Ensure that on-chain instance storage is at `STORAGE_VERSION`.
///
/// Calling this function multiple times in the same transaction is safe: the
/// first call performs the migration and writes the new version; subsequent calls
/// find the version already current and return `AlreadyCurrent` immediately.
pub fn ensure_storage_version(env: &Env) -> Result<MigrationOutcome, StorageVersionError> {
    let current: u32 = env
        .storage()
        .instance()
        .get(&MetaKey::StorageVersion)
        .unwrap_or(0u32);

    if current == STORAGE_VERSION {
        return Ok(MigrationOutcome::AlreadyCurrent);
    }

    if current > STORAGE_VERSION {
        return Err(StorageVersionError::DowngradeRejected { found: current });
    }

    let from_version = current;
    let mut v = current;
    while v < STORAGE_VERSION {
        v += 1;
        match v {
            1 => {}
            _ => {
                return Err(StorageVersionError::UnknownVersion { version: v });
            }
        }
    }

    env.storage()
        .instance()
        .set(&MetaKey::StorageVersion, &STORAGE_VERSION);

    Ok(MigrationOutcome::Migrated { from: from_version })
}

// ==================== Key helpers ====================

/// Derive the compact 32-byte storage key for a subscription.
///
/// Uses SHA-256 over the concatenation of the subscriber and merchant address
/// bytes, producing a fixed-size `BytesN<32>` that replaces the old
/// `(Address, Address)` tuple key.
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
    /// Storage type: **persistent**.
    Subscription(BytesN<32>),

    /// Merchant subscription index: maps merchant -> Vec<BytesN<32>> of
    /// all hashed subscription keys the merchant is party to.
    MerchantIndex(Address),

    /// Merchant subscriber roster: maps merchant -> Vec<Address> of all
    /// subscriber addresses for that merchant.
    MerchantSubscribers(Address),

    /// On-chain schema version; updated by `migrate(admin)`.
    SchemaVersion,

    /// Designated admin address authorised to call `migrate` and `set_protocol_fee`.
    Admin,

    /// Optional admin configuration (rate limits, caps).
    AdminConfig,

    /// Execution marker for duplicate-execution protection (#1083).
    ///
    /// Key: (subscription_hash, payment_nonce), written to **temporary** storage
    /// the first time a given nonce is successfully executed.
    ExecutionMarker(BytesN<32>, u32),

    /// Protocol fee configuration stored in instance storage.
    ProtocolFeeConfig,
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    /// SEP-41 token contract address used for transfers.
    pub token: Address,
    /// Payment amount per interval (strictly positive, <= `MAX_AMOUNT`).
    pub amount: i128,
    /// Seconds between payment windows [86_400, 31_536_000].
    pub interval: u64,
    /// Unix timestamp (seconds) after which the next payment may be collected.
    pub next_payment: u64,
    /// When `true`, `execute_payment` is blocked until the subscription is resumed.
    pub is_paused: bool,
    /// Seconds after `overdue_since` before the subscription may expire.
    pub grace_period: u64,
    /// Unix timestamp when the most recent payment attempt failed.
    pub overdue_since: Option<u64>,
    /// Monotonically incrementing counter of successful `execute_payment` calls.
    pub payment_nonce: u32,
    /// Unix timestamp at which a paused subscription auto-resumes.
    pub paused_until: Option<u64>,
}

/// Admin-level configuration stored per contract instance.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminConfig {
    /// The privileged address that may call admin-only entry points.
    pub admin: Address,
    /// Per-contract ceiling on `SubscriptionData.amount`.
    pub max_amount: i128,
}

/// A subscription record paired with its subscriber address.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionEntry {
    /// The subscriber's Stellar account address.
    pub subscriber: Address,
    /// The full subscription state for this subscriber-merchant pair.
    pub data: SubscriptionData,
}

/// Safe upper bound for a single subscription payment amount (1 x 10^18 stroops).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18

/// ~30 days at 5-second ledger close time (518_400 ledgers).
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers).
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

/// TTL for execution markers (#1083): ~60 days at 5-second ledger close time.
pub const MARKER_TTL_LEDGERS: u32 = MAX_TTL_LEDGERS * 2;

/// Maximum allowed protocol fee in basis points (500 bps = 5%).
pub const MAX_FEE_BPS: u32 = 500;

// ==================== Protocol fee configuration ====================

/// Protocol-level fee configuration stored in instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolFeeConfig {
    /// Fee in basis points. 0 = disabled. Max = [`MAX_FEE_BPS`].
    pub fee_bps: u32,
    /// Address that receives the protocol fee portion on each payment.
    pub fee_collector: Address,
}

/// Load the protocol fee config from instance storage.
pub fn get_protocol_fee_config(env: &Env) -> Option<ProtocolFeeConfig> {
    env.storage().instance().get(&DataKey::ProtocolFeeConfig)
}

/// Persist the protocol fee config to instance storage.
pub fn set_protocol_fee_config(env: &Env, config: ProtocolFeeConfig) {
    env.storage()
        .instance()
        .set(&DataKey::ProtocolFeeConfig, &config);
}

// ==================== Execution marker helpers (#1083) ====================

/// Check whether an execution marker already exists for `(hash, nonce)`.
pub fn has_execution_marker(env: &Env, hash: &BytesN<32>, nonce: u32) -> bool {
    let key = DataKey::ExecutionMarker(hash.clone(), nonce);
    env.storage().temporary().has(&key)
}

/// Persist an execution marker for `(hash, nonce)` to temporary storage.
pub fn write_execution_marker(env: &Env, hash: &BytesN<32>, nonce: u32) {
    let key = DataKey::ExecutionMarker(hash.clone(), nonce);
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, MARKER_TTL_LEDGERS, MARKER_TTL_LEDGERS);
}

// ==================== Storage Version Migration Tests ====================

#[cfg(test)]
mod storage_version_tests {
    use super::*;
    use soroban_sdk::Env;

    fn read_stored_version(env: &Env) -> Option<u32> {
        env.storage().instance().get(&MetaKey::StorageVersion)
    }

    #[test]
    fn test_fresh_deploy_migrates_from_zero() {
        let env = Env::default();
        assert_eq!(read_stored_version(&env), None, "no version on fresh env");

        let outcome = ensure_storage_version(&env).expect("migration must succeed");
        assert_eq!(outcome, MigrationOutcome::Migrated { from: 0 });
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    #[test]
    fn test_already_current_is_idempotent() {
        let env = Env::default();
        ensure_storage_version(&env).unwrap();

        let outcome = ensure_storage_version(&env).expect("second call must succeed");
        assert_eq!(outcome, MigrationOutcome::AlreadyCurrent);
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    #[test]
    fn test_idempotent_repeated_calls() {
        let env = Env::default();
        ensure_storage_version(&env).unwrap();

        for i in 0..10 {
            let outcome = ensure_storage_version(&env).expect("repeated call must succeed");
            assert_eq!(
                outcome,
                MigrationOutcome::AlreadyCurrent,
                "call {} must return AlreadyCurrent",
                i
            );
        }
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    #[test]
    fn test_explicit_current_version_returns_already_current() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &STORAGE_VERSION);

        let outcome = ensure_storage_version(&env).unwrap();
        assert_eq!(outcome, MigrationOutcome::AlreadyCurrent);
    }

    #[test]
    fn test_version_zero_treated_as_unversioned() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &0u32);

        let outcome = ensure_storage_version(&env).unwrap();
        assert_eq!(outcome, MigrationOutcome::Migrated { from: 0 });
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    #[test]
    fn test_downgrade_rejected_when_stored_version_is_newer() {
        let env = Env::default();
        let future_version = STORAGE_VERSION + 1;
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &future_version);

        let err = ensure_storage_version(&env).expect_err("downgrade must be rejected");
        assert_eq!(
            err,
            StorageVersionError::DowngradeRejected {
                found: future_version
            }
        );
        assert_eq!(read_stored_version(&env), Some(future_version));
    }

    #[test]
    fn test_downgrade_rejected_for_any_future_version() {
        for delta in [1u32, 5, 100, u32::MAX - STORAGE_VERSION] {
            let env = Env::default();
            let future = STORAGE_VERSION + delta;
            env.storage()
                .instance()
                .set(&MetaKey::StorageVersion, &future);

            let err = ensure_storage_version(&env).expect_err("any future version must be rejected");
            assert!(
                matches!(err, StorageVersionError::DowngradeRejected { found } if found == future),
                "delta={delta}: expected DowngradeRejected {{ found: {future} }}, got {err:?}"
            );
        }
    }

    #[test]
    fn test_migration_outcome_eq() {
        assert_eq!(
            MigrationOutcome::AlreadyCurrent,
            MigrationOutcome::AlreadyCurrent
        );
        assert_eq!(
            MigrationOutcome::Migrated { from: 0 },
            MigrationOutcome::Migrated { from: 0 }
        );
        assert_ne!(
            MigrationOutcome::AlreadyCurrent,
            MigrationOutcome::Migrated { from: 0 }
        );
        assert_ne!(
            MigrationOutcome::Migrated { from: 0 },
            MigrationOutcome::Migrated { from: 1 }
        );
    }

    #[test]
    fn test_storage_version_error_eq() {
        assert_eq!(
            StorageVersionError::DowngradeRejected { found: 5 },
            StorageVersionError::DowngradeRejected { found: 5 }
        );
        assert_ne!(
            StorageVersionError::DowngradeRejected { found: 5 },
            StorageVersionError::DowngradeRejected { found: 6 }
        );
        assert_eq!(
            StorageVersionError::UnknownVersion { version: 99 },
            StorageVersionError::UnknownVersion { version: 99 }
        );
    }

    #[test]
    fn test_u32_max_stored_version_rejected() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &u32::MAX);

        let err = ensure_storage_version(&env).expect_err("u32::MAX version must be rejected");
        assert!(
            matches!(err, StorageVersionError::DowngradeRejected { found: u32::MAX }),
            "expected DowngradeRejected with u32::MAX"
        );
    }
}
