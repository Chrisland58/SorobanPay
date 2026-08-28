use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
/// These are surfaced to callers via the Stellar RPC error response.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
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
    /// Caller is not the contract admin
    NotAdmin                = 17,
    /// Contract has not been initialized
    NotInitialized          = 20,
    /// Subscriber and merchant addresses are the same
    SameMerchant            = 18,
    /// Payment amount exceeds the configured per-payment limit
    AmountExceedsLimit      = 21,
    /// Subscription already exists for the (subscriber, merchant) pair
    SubscriptionAlreadyExists = 19,
    /// A grace period is still active for the subscription
    GracePeriodActive       = 22,
}
