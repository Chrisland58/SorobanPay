use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// Error code 1: `subscribe` called with amount <= 0.
    AmountMustBePositive  = 1,
    /// Error code 2: `subscribe` called with interval < 86400 seconds (1 day).
    IntervalTooShort      = 2,
    /// Error code 3: `subscribe` called with interval > 31536000 seconds (365 days).
    IntervalTooLong       = 3,
    /// Error code 4: `execute_payment` or `cancel` called with no active subscription for the pair.
    NoActiveSubscription  = 4,
    /// Error code 5: `execute_payment` called before next_payment timestamp has elapsed.
    PaymentNotDue         = 5,
    /// Error code 6: authorization check failed.
    Unauthorized          = 6,
    /// Error code 7: `execute_payment` token transfer failed (insufficient balance or allowance).
    TransferFailed        = 7,
    /// Error code 8: ledger timestamp is zero or would overflow when computing next_payment.
    InvalidTimestamp      = 8,
    /// Error code 9: `subscribe` called with amount exceeding the safe maximum threshold.
    AmountTooLarge        = 9,
    /// Error code 10: `subscribe` called with subscriber == merchant (self-subscription).
    SelfSubscription      = 10,
    /// Error code 11: `subscribe` called with `token` equal to the contract's own address.
    InvalidTokenAddress   = 11,
    /// Error code 12: `batch_execute_payment` called with an empty subscribers vector.
    EmptyBatch            = 12,
    /// Error code 13: `batch_execute_payment` called with more than BATCH_MAX_SIZE (50) subscribers.
    BatchTooLarge         = 13,
    /// Error code 14: `subscribe` called with allowance < amount in strict mode.
    InsufficientAllowance = 14,
    /// Error code 15: `migrate` called when contract is already at the current schema version.
    AlreadyMigrated       = 15,
    /// Error code 16: `migrate` called by an address that is not the stored admin.
    NotAdmin              = 16,
    /// Error code 17: admin address not initialised; call `initialize` first.
    NotInitialized        = 17,
    /// Error code 19: subscription grace period has not elapsed.
    GracePeriodNotElapsed = 19,
}
