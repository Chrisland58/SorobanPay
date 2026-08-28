use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
/// These are surfaced to callers via the Stellar RPC error response.
///
/// **IMPORTANT**: Every discriminant must be unique. Duplicate values cause the wrong
/// error variant to be decoded on the client side because `contracterror` maps the
/// raw u32 back to the enum by value.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// `subscribe` called with amount <= 0
    AmountMustBePositive      = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort          = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong           = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription      = 4,
    /// `execute_payment` called before next_payment timestamp has elapsed
    PaymentNotDue             = 5,
    /// Authorization check failed (supplementary; require_auth() panics directly)
    Unauthorized              = 6,
    /// `execute_payment` token transfer failed (insufficient balance or allowance)
    TransferFailed            = 7,
    /// ledger timestamp is zero or would overflow when computing next_payment
    InvalidTimestamp          = 8,
    /// `subscribe` called with amount exceeding the safe maximum threshold
    AmountTooLarge            = 9,
    /// `subscribe` called with subscriber == merchant (self-subscription)
    SelfSubscription          = 10,
    /// `subscribe` called with token == contract's own address
    InvalidTokenAddress       = 11,
    /// `execute_payment_batch` called with an empty payments vector
    EmptyBatch                = 12,
    /// Operation requires admin privileges
    NotAdmin                  = 17,
    /// Contract has not been initialized
    NotInitialized            = 20,
    /// subscriber == merchant in an update operation
    SameMerchant              = 18,
    /// Payment amount exceeds the per-subscription limit
    AmountExceedsLimit        = 21,
    /// A subscription already exists for this (subscriber, merchant) pair
    SubscriptionAlreadyExists = 19,
    /// A grace period is still active; the operation cannot proceed yet
    GracePeriodActive         = 22,
}
