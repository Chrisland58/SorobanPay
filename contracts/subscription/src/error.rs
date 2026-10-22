use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    // ── Core subscription errors (1–11) ─────────────────────────────────────
    /// `subscribe` called with amount <= 0
    AmountMustBePositive  = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort      = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong       = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription  = 4,
    /// `execute_payment` called before the subscription's `next_payment` timestamp has elapsed.
    PaymentNotDue         = 5,
    /// Authorization check failed
    Unauthorized          = 6,
    /// `execute_payment` or `batch_execute_payment` token transfer failed.
    TransferFailed        = 7,
    /// Ledger timestamp is zero or would overflow when computing next_payment
    InvalidTimestamp      = 8,
    /// `subscribe` called with amount exceeding the safe maximum threshold
    AmountTooLarge        = 9,
    /// `subscribe` called with subscriber == merchant (self-subscription)
    SelfSubscription      = 10,
    /// `subscribe` called with `token` equal to the contract's own address
    InvalidTokenAddress   = 11,

    // ── Pause/resume (12) ───────────────────────────────────────────────────
    /// `execute_payment` called while paused and not yet due to auto-resume, or
    /// `pause_subscription` called on a subscription that is already paused.
    SubscriptionPaused    = 12,

    // ── Batch execution (13–14) ─────────────────────────────────────────────
    /// `batch_execute_payment` called with an empty subscribers vector
    EmptyBatch            = 13,
    /// `batch_execute_payment` called with more than BATCH_MAX_SIZE (50) subscribers
    BatchTooLarge         = 14,
    /// `subscribe` called with allowance < amount in strict mode
    InsufficientAllowance = 15,

    // ── Admin / migration (16–18) ───────────────────────────────────────────
    /// `migrate` called when contract is already at the current schema version
    AlreadyMigrated       = 16,
    /// `migrate` called by an address that is not the stored admin
    NotAdmin              = 17,
    /// Admin address not initialised; call `initialize` first
    NotInitialized        = 18,

    // ── Subscription limits and transfers (19–21) ───────────────────────────
    /// `subscribe` called with amount exceeding the configured admin limit
    AmountExceedsLimit    = 19,
    /// `transfer_subscription` called with old_merchant == new_merchant (no-op transfer)
    SameMerchant          = 20,
    /// `transfer_subscription` called but a subscription already exists for (subscriber, new_merchant)
    SubscriptionAlreadyExists = 21,

    // ── Replay protection / grace / resume (22–24) ──────────────────────────
    /// `execute_payment` detected that the same payment nonce was already executed (#1083).
    DuplicateExecution    = 22,
    /// A grace-period dependent operation was attempted while grace is still active
    GracePeriodActive     = 23,
    /// `resume_subscription` called on a subscription that is not currently paused
    SubscriptionNotPaused = 24,

    // ── Protocol fee (25) ───────────────────────────────────────────────────
    /// `set_protocol_fee` called with `fee_bps` above `MAX_FEE_BPS` (500)
    FeeBpsTooHigh         = 25,
}
