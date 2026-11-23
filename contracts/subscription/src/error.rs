use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
/// These are surfaced to callers via the Stellar RPC error response.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// `subscribe` called with amount <= 0
    AmountMustBePositive = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort     = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong      = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription = 4,
    /// `execute_payment` called before next_payment timestamp has elapsed
    PaymentNotDue        = 5,
    /// Authorization check failed (supplementary; require_auth() panics directly)
    Unauthorized         = 6,
    /// `execute_payment` token transfer failed (insufficient balance or allowance)
    TransferFailed       = 7,
    /// ledger timestamp is zero or would overflow when computing next_payment
    InvalidTimestamp     = 8,
    /// `subscribe` called with amount exceeding the safe maximum threshold
    AmountTooLarge       = 9,
    /// `propose_transfer` called with no pending transfer proposal for this pair
    NoPendingTransfer = 10,
    /// `accept_transfer` called but the proposal has expired
    TransferExpired = 11,
    /// `accept_transfer` called by wrong address (not the pending recipient)
    TransferUnauthorized = 12,
    /// `propose_transfer` called with no active subscription
    NoSubscriptionToTransfer = 13,
    /// `accept_transfer` called but no proposal exists
    NoTransferProposal = 14,
    /// `propose_transfer` called with invalid expiry (must be in future)
    InvalidTransferExpiry = 15,
    /// Arithmetic overflow in settlement calculation
    SettlementOverflow   = 16,
}
