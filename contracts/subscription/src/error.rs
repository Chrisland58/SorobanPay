use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
/// These are surfaced to callers via the Stellar RPC error response.
///
/// IMPORTANT: discriminant values must remain stable across deployments.
/// Clients and SDKs decode errors by numeric value, so never reuse or renumber
/// an existing code — only append new variants at the end.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    // ── Core subscription errors (1–7) ──────────────────────────────────────
    /// `subscribe` called with amount <= 0
    AmountMustBePositive    = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort        = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong         = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription    = 4,
    /// `execute_payment` called before next_payment timestamp has elapsed
    PaymentNotDue           = 5,
    /// Authorization check failed (supplementary; require_auth() panics directly)
    Unauthorized            = 6,
    /// `execute_payment` token transfer failed (insufficient balance or allowance)
    TransferFailed          = 7,

    // ── Admin / initialisation errors (17–20) ────────────────────────────────
    /// Caller is not the designated admin
    NotAdmin                = 17,
    /// Contract has not been initialized
    NotInitialized          = 20,

    // ── Business-rule errors (18–19, 21–22) ──────────────────────────────────
    /// Subscriber and merchant are the same address
    SameMerchant            = 18,
    /// Payment amount exceeds the configured per-payment limit
    AmountExceedsLimit      = 21,
    /// A subscription for this (subscriber, merchant) pair already exists
    SubscriptionAlreadyExists = 19,
    /// Subscription is within its grace period; cancellation is temporarily blocked
    GracePeriodActive       = 22,
}
