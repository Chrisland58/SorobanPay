#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::error::ContractError;
use crate::storage::{
    DataKey, SubscriptionData, SubscriptionStatus, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS,
};

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    // ─── Admin / Initialization ───────────────────────────────────────────────

    /// Initialize the contract by recording an admin/owner address.
    ///
    /// Must be called once after deployment. The stored admin address is used to gate
    /// future upgrade or emergency-pause operations. Calling this a second time returns
    /// `ContractError::AlreadyInitialized` to prevent ownership takeover.
    ///
    /// # Authorization
    /// Requires a valid signature from `admin` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::AlreadyInitialized` — if an admin has already been set.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        // Prevent re-initialization.
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        // Require the prospective admin to sign this transaction.
        admin.require_auth();

        // Persist admin address in instance storage (lives with the contract instance).
        env.storage().instance().set(&DataKey::Admin, &admin);

        Ok(())
    }

    /// Return the current contract admin address, or `None` if not yet initialized.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    // ─── Subscription entry points ────────────────────────────────────────────

    /// Create or update a recurring payment subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Parameters
    /// - `subscriber`: Account that will be charged on each payment interval.
    /// - `merchant`:   Account that receives payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::AmountMustBePositive` — if `amount <= 0`.
    /// - `ContractError::IntervalTooShort`     — if `interval < 86400`.
    /// - `ContractError::IntervalTooLong`      — if `interval > 31536000`.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> Result<(), ContractError> {
        // 1. Authorization — must be first, before any state reads.
        subscriber.require_auth();

        // 2. Validate amount.
        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }

        // 3. Validate interval.
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 4. Build subscription record with Active status.
        let next_payment = env.ledger().timestamp() + interval;
        let data = SubscriptionData {
            token,
            amount,
            interval,
            next_payment,
            status: SubscriptionStatus::Active,
        };

        // 5. Persist subscription.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        env.storage().persistent().set(&key, &data);

        // 6. Extend TTL to keep entry alive for up to MAX_TTL_LEDGERS.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 7. Emit event — after all state mutations have succeeded.
        events::emit_subscribe(&env, &subscriber, &merchant, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    /// - `ContractError::SubscriptionNotActive` — if the subscription status is not `Active`.
    /// - `ContractError::PaymentNotDue`        — if the payment interval has not elapsed.
    /// - Propagated token contract errors      — if the transfer fails (insufficient allowance
    ///                                           or balance). SubscriptionData is NOT modified.
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization — merchant triggers collection.
        merchant.require_auth();

        // 2. Load subscription — return error if absent.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // 3. Reject payment on non-Active subscriptions.
        if data.status != SubscriptionStatus::Active {
            return Err(ContractError::SubscriptionNotActive);
        }

        // 4. Enforce time-lock.
        let now = env.ledger().timestamp();
        if now < data.next_payment {
            return Err(ContractError::PaymentNotDue);
        }

        // 5. Execute token transfer (subscriber → merchant).
        //    If this panics/errors, no state mutation below will execute.
        token::Client::new(&env, &data.token).transfer(
            &subscriber,
            &merchant,
            &data.amount,
        );

        // 6. Advance next_payment — using the `now` captured at invocation start.
        data.next_payment = now + data.interval;

        // 7. Persist updated subscription.
        env.storage().persistent().set(&key, &data);

        // 8. Extend TTL.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 9. Emit event with charged amount and new next_payment for analytics consumers.
        events::emit_executed(&env, &subscriber, &merchant, data.amount, data.next_payment);

        Ok(())
    }

    /// Cancel an active subscription.
    ///
    /// Sets `status` to `Cancelled` rather than removing the storage entry, preserving
    /// the record for off-chain indexers and audit trails. The cancelled entry will
    /// naturally expire via TTL after ~30 days with no further interaction.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    pub fn cancel(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization.
        subscriber.require_auth();

        // 2. Load subscription — return error if absent.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // 3. Mark subscription as Cancelled (preserves record for indexers).
        data.status = SubscriptionStatus::Cancelled;
        env.storage().persistent().set(&key, &data);

        Ok(())
    }

    /// Return the current subscription data for a (subscriber, merchant) pair, if it exists.
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Option<SubscriptionData> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(subscriber, merchant))
    }
}

#[cfg(test)]
mod test;
