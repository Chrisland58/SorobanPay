#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Vec};

use crate::error::ContractError;
use crate::storage::{
    subscription_key, DataKey, SubscriptionData, CONTRACT_VERSION, CURRENT_SCHEMA_VERSION,
    MAX_AMOUNT, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS,
};

/// Maximum number of subscribers allowed in a single `batch_execute_payment` call.
pub const BATCH_MAX_SIZE: u32 = 50;

// ─── Internal helpers ─────────────────────────────────────────────────────────

#[inline]
fn ledger_timestamp(env: &Env) -> Result<u64, ContractError> {
    let ts = env.ledger().timestamp();
    if ts == 0 {
        return Err(ContractError::InvalidTimestamp);
    }
    Ok(ts)
}

#[inline]
fn checked_next_payment(ts: u64, interval: u64) -> Result<u64, ContractError> {
    ts.checked_add(interval).ok_or(ContractError::InvalidTimestamp)
}

/// Enforce the time-lock for a single subscription entry.
///
/// # Exact due-time semantics
///
/// A payment is due when `now >= next_payment` — meaning the ledger timestamp has
/// **reached or passed** the scheduled due instant. The condition checked here is
/// its complement: `now < next_payment` → still early → reject.
///
/// ```text
/// Timeline:
///
///   subscribe()          next_payment          next_payment + interval
///       │                     │                        │
///   ────┼─────────────────────┼────────────────────────┼──▶  time
///       │                     │                        │
///       │◄── PaymentNotDue ──►│◄── payment allowed ───►│
///                             │
///                          now == next_payment  →  OK (inclusive boundary)
///                          now  < next_payment  →  PaymentNotDue
///                          now  > next_payment  →  OK (past due, merchant collects late)
/// ```
///
/// The boundary is **inclusive**: `now == next_payment` is treated as on-time,
/// not early. This is important for billing systems that schedule execution at
/// precisely the due timestamp.
///
/// # Why not strict equality (`now == next_payment`)?
///
/// Requiring exact equality would create a one-ledger window during which payment
/// is collectable (roughly 5 seconds at mainnet close times). Any network latency
/// or scheduling drift would cause the merchant's call to land one ledger late and
/// be permanently rejected. The `>=` condition avoids this operational fragility:
/// a missed-cycle payment remains collectable indefinitely until the next call to
/// `execute_payment`, at which point `next_payment` advances by one interval.
///
/// # Returns
/// `Err(ContractError::PaymentNotDue)` if `now < next_payment`.
/// `Ok(())` if `now >= next_payment`.
#[inline]
fn assert_payment_due(now: u64, next_payment: u64) -> Result<(), ContractError> {
    // Payment is due when now >= next_payment.
    // Equivalently: reject when now < next_payment (payment window has not opened yet).
    if now < next_payment {
        return Err(ContractError::PaymentNotDue);
    }
    Ok(())
}

/// Add a hashed key to a merchant's subscription index.
///
/// The index stores `Vec<BytesN<32>>` under `DataKey::MerchantIndex(merchant)`.
/// On subscribe we append; on cancel we remove. This allows on-chain enumeration
/// of all subscriptions for a given merchant.
fn index_add(env: &Env, merchant: &Address, hash: BytesN<32>) {
    let idx_key = DataKey::MerchantIndex(merchant.clone());
    let mut index: Vec<BytesN<32>> = env
        .storage()
        .temporary()
        .get(&idx_key)
        .unwrap_or_else(|| Vec::new(env));
    index.push_back(hash);
    env.storage().temporary().set(&idx_key, &index);
}

/// Remove a hashed key from a merchant's subscription index.
fn index_remove(env: &Env, merchant: &Address, hash: &BytesN<32>) {
    let idx_key = DataKey::MerchantIndex(merchant.clone());
    let mut index: Vec<BytesN<32>> = match env.storage().temporary().get(&idx_key) {
        Some(v) => v,
        None => return,
    };
    // Rebuild without the removed entry.
    let mut updated: Vec<BytesN<32>> = Vec::new(env);
    for entry in index.iter() {
        if &entry != hash {
            updated.push_back(entry);
        }
    }
    env.storage().temporary().set(&idx_key, &updated);
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    // =========================================================================
    // Admin / Versioning
    // =========================================================================

    /// Initialise the contract by storing the admin address and initial schema version.
    ///
    /// Must be called once after deployment; subsequent calls panic.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
    }

    /// Return the contract semantic version string (e.g. `"1.0.0"`).
    pub fn get_version(_env: Env) -> &'static str {
        CONTRACT_VERSION
    }

    /// Return the on-chain schema version set during the last `migrate` call.
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32)
    }

    /// Migrate the contract schema to `CURRENT_SCHEMA_VERSION`.
    ///
    /// Requires admin auth.  Returns `AlreadyMigrated` if already current.
    pub fn migrate(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        if admin != stored_admin {
            return Err(ContractError::NotAdmin);
        }

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32);

        if current_version >= CURRENT_SCHEMA_VERSION {
            return Err(ContractError::AlreadyMigrated);
        }

        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);

        events::emit_contract_migrated(&env, &admin, CURRENT_SCHEMA_VERSION);

        Ok(())
    }

    // =========================================================================
    // Compact key utilities (public for off-chain verification)
    // =========================================================================

    /// Compute and return the compact 32-byte storage key for a subscription pair.
    ///
    /// Useful for off-chain tooling that wants to inspect raw storage entries.
    pub fn compute_subscription_key(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> BytesN<32> {
        subscription_key(&env, &subscriber, &merchant)
    }

    /// Return all subscription key hashes indexed for a given merchant.
    ///
    /// Off-chain tools can iterate these hashes to enumerate all active
    /// subscriptions the merchant participates in.
    pub fn get_merchant_subscription_keys(
        env: Env,
        merchant: Address,
    ) -> Vec<BytesN<32>> {
        let idx_key = DataKey::MerchantIndex(merchant);
        env.storage()
            .temporary()
            .get(&idx_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // =========================================================================
    // Core subscription entry points
    // =========================================================================

    /// Create or update a recurring payment subscription.
    ///
    /// # Storage key
    /// Uses `sha256(subscriber_xdr ++ merchant_xdr)` as the storage key —
    /// a compact 32-byte `BytesN<32>` vs. the old ~70-byte two-Address tuple.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber`.
    ///
    /// # Parameters
    /// - `subscriber`: Account charged on each interval.
    /// - `merchant`:   Account receiving payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0 and <= 10^18.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    /// - `strict`:     When `true`, rejects the subscription if the subscriber's
    ///                 current SEP-41 allowance for this contract is below `amount`.
    ///
    /// # Errors
    /// - `ContractError::SelfSubscription`       — `subscriber == merchant`.
    /// - `ContractError::AmountMustBePositive`   — `amount <= 0`.
    /// - `ContractError::AmountTooLarge`         — `amount > 10^18`.
    /// - `ContractError::IntervalTooShort`       — `interval < 86400`.
    /// - `ContractError::IntervalTooLong`        — `interval > 31536000`.
    /// - `ContractError::InvalidTimestamp`       — ledger timestamp is zero or overflows.
    /// - `ContractError::InsufficientAllowance`  — `strict == true` and `allowance < amount`.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
        strict: bool,
    ) -> Result<(), ContractError> {
        subscriber.require_auth();

        if subscriber == merchant {
            return Err(ContractError::SelfSubscription);
        }
        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }
        if amount > MAX_AMOUNT {
            return Err(ContractError::AmountTooLarge);
        }
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // Allowance validation (#346).
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let allowance = token_client.allowance(&subscriber, &contract_address);

        if allowance < amount {
            if strict {
                return Err(ContractError::InsufficientAllowance);
            } else {
                events::emit_low_allowance(&env, &subscriber, &merchant, &token, allowance, amount);
            }
        }

        let ts = ledger_timestamp(&env)?;
        let next_payment = checked_next_payment(ts, interval)?;
        let data = SubscriptionData {
            token: token.clone(),
            amount,
            interval,
            next_payment,
            is_paused: false,
        };

        // Compact key (#347): sha256(subscriber_xdr ++ merchant_xdr).
        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // Update merchant index for enumeration.
        index_add(&env, &merchant, hash);

        events::emit_subscribe(&env, &subscriber, &merchant, &token, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant`.
    ///
    /// # Time-lock guard
    ///
    /// Payment collection is gated by an on-chain time-lock enforced against
    /// `env.ledger().timestamp()`. The guard uses **inclusive** `>=` semantics:
    ///
    /// ```text
    ///   allowed when:  now >= next_payment  (on time or overdue)
    ///   rejected when: now <  next_payment  (payment window not yet open)
    /// ```
    ///
    /// This means `execute_payment` called at the exact ledger whose timestamp equals
    /// `next_payment` will succeed — the boundary is on-time, not early. See
    /// [`assert_payment_due`] for the full semantic rationale.
    ///
    /// On success, `next_payment` is advanced by exactly `interval` seconds:
    ///
    /// ```text
    ///   new_next_payment = now + interval
    /// ```
    ///
    /// Note: `now` is the ledger timestamp at execution time, not the original
    /// `next_payment`. If a merchant collects a payment late (e.g. 2 hours after
    /// the due time), the next due date is `now + interval`, not
    /// `next_payment + interval`. This means the billing window slides forward
    /// from the actual collection time, not from the original schedule.
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        merchant.require_auth();

        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        let now = ledger_timestamp(&env)?;

        // ── Time-lock guard ───────────────────────────────────────────────────────
        // Payment is allowed when now >= next_payment (inclusive boundary).
        // Returns PaymentNotDue when now < next_payment.
        // See assert_payment_due() for the full semantic rationale.
        assert_payment_due(now, data.next_payment)?;

        let token_client = token::Client::new(&env, &data.token);
        let subscriber_balance = token_client.balance(&subscriber);
        if subscriber_balance < data.amount {
            events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
            return Err(ContractError::TransferFailed);
        }

        token_client.transfer(&subscriber, &merchant, &data.amount);

        // Advance next_payment from now (actual collection time), not from next_payment.
        // This slides the billing window forward from the actual transfer, preventing
        // drift accumulation for merchants who collect consistently late.
        data.next_payment = now + data.interval;
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

        Ok(())
    }

    /// Collect payments from multiple subscribers in a single transaction.
    ///
    /// Hard cap: at most [`BATCH_MAX_SIZE`] (50) subscribers per call.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` — authenticated once for the batch.
    ///
    /// # Time-lock guard (per subscriber)
    ///
    /// Each subscriber entry is independently checked against the same `>=` time-lock
    /// as `execute_payment`. If `now < next_payment` for a subscriber, that entry is
    /// recorded as `false` in the result vector and the loop continues — the batch
    /// itself is not aborted. See [`assert_payment_due`] for the semantic detail.
    pub fn batch_execute_payment(
        env: Env,
        merchant: Address,
        subscribers: Vec<Address>,
    ) -> Result<Vec<(Address, bool)>, ContractError> {
        merchant.require_auth();

        if subscribers.is_empty() {
            return Err(ContractError::EmptyBatch);
        }
        if subscribers.len() > BATCH_MAX_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        events::emit_batch_execute_initiated(&env, &merchant, subscribers.len() as u32);

        let now = ledger_timestamp(&env)?;
        let mut results: Vec<(Address, bool)> = Vec::new(&env);
        let mut keys_to_extend: Vec<DataKey> = Vec::new(&env);

        for subscriber in subscribers.iter() {
            let hash = subscription_key(&env, &subscriber, &merchant);
            let key = DataKey::Subscription(hash.clone());

            let mut data: SubscriptionData = match env.storage().persistent().get(&key) {
                Some(d) => d,
                None => {
                    results.push_back((subscriber.clone(), false));
                    continue;
                }
            };

            // ── Time-lock guard (per subscriber) ─────────────────────────────────
            // Uses the same >= semantics as execute_payment: allowed when now >= next_payment.
            // A not-due subscriber is skipped (false result) without aborting the batch.
            if assert_payment_due(now, data.next_payment).is_err() {
                results.push_back((subscriber.clone(), false));
                continue;
            }

            let token_client = token::Client::new(&env, &data.token);
            let balance = token_client.balance(&subscriber);
            if balance < data.amount {
                events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
                results.push_back((subscriber.clone(), false));
                continue;
            }

            token_client.transfer(&subscriber, &merchant, &data.amount);

            // Advance next_payment from now (actual collection time), consistent
            // with execute_payment behaviour.
            data.next_payment = now + data.interval;
            env.storage().persistent().set(&key, &data);
            keys_to_extend.push_back(key);

            events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);
            events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

            results.push_back((subscriber.clone(), true));
        }

        for key in keys_to_extend.iter() {
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        }

        Ok(results)
    }

    /// Cancel an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber`.
    pub fn cancel(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        subscriber.require_auth();

        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NoActiveSubscription);
        }

        env.storage().persistent().remove(&key);

        // Remove from merchant index so enumeration stays accurate.
        index_remove(&env, &merchant, &hash);

        events::emit_cancel(&env, &subscriber, &merchant);

        Ok(())
    }

    /// Query active subscription details for a subscriber-merchant pair.
    ///
    /// Read-only; no authorization required.
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Option<SubscriptionData> {
        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash);
        let data = env.storage().persistent().get(&key)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        Some(data)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod security_tests;

#[cfg(test)]
mod property_tests;
