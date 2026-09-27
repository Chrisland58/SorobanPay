use soroban_sdk::contracterror;

/// Contract error codes — stable `u32` values safe to return across invocation boundaries.
///
/// # Stability guarantee
///
/// Once a variant is assigned a discriminant it **must not change**. Off-chain
/// tooling (frontends, indexers, backend APIs) maps these numeric codes to
/// human-readable messages. Renumbering a code is a breaking change.
///
/// # Frontend / backend symbolic mapping
///
/// | Code | Rust variant              | TypeScript / JS name               | HTTP hint |
/// |------|---------------------------|------------------------------------|-----------|
/// |  1   | `AmountMustBePositive`    | `ERR_AMOUNT_MUST_BE_POSITIVE`      | 400       |
/// |  2   | `IntervalTooShort`        | `ERR_INTERVAL_TOO_SHORT`           | 400       |
/// |  3   | `IntervalTooLong`         | `ERR_INTERVAL_TOO_LONG`            | 400       |
/// |  4   | `NoActiveSubscription`    | `ERR_NO_ACTIVE_SUBSCRIPTION`       | 404       |
/// |  5   | `PaymentNotDue`           | `ERR_PAYMENT_NOT_DUE`              | 409       |
/// |  6   | `Unauthorized`            | `ERR_UNAUTHORIZED`                 | 403       |
/// |  7   | `TransferFailed`          | `ERR_TRANSFER_FAILED`              | 402       |
/// |  8   | `InvalidTimestamp`        | `ERR_INVALID_TIMESTAMP`            | 500       |
/// |  9   | `AmountTooLarge`          | `ERR_AMOUNT_TOO_LARGE`             | 400       |
/// | 10   | `SelfSubscription`        | `ERR_SELF_SUBSCRIPTION`            | 400       |
/// | 11   | `InvalidTokenAddress`     | `ERR_INVALID_TOKEN_ADDRESS`        | 400       |
/// | 12   | `SubscriptionPaused`      | `ERR_SUBSCRIPTION_PAUSED`          | 409       |
/// | 13   | `EmptyBatch`              | `ERR_EMPTY_BATCH`                  | 400       |
/// | 14   | `BatchTooLarge`           | `ERR_BATCH_TOO_LARGE`              | 400       |
/// | 15   | `InsufficientAllowance`   | `ERR_INSUFFICIENT_ALLOWANCE`       | 402       |
/// | 16   | `AlreadyMigrated`         | `ERR_ALREADY_MIGRATED`             | 409       |
/// | 17   | `NotAdmin`                | `ERR_NOT_ADMIN`                    | 403       |
/// | 18   | `NotInitialized`          | `ERR_NOT_INITIALIZED`              | 503       |
/// | 19   | `AmountExceedsLimit`      | `ERR_AMOUNT_EXCEEDS_LIMIT`         | 400       |
/// | 20   | `GracePeriodActive`       | `ERR_GRACE_PERIOD_ACTIVE`          | 409       |
/// | 21   | `SameMerchant`            | `ERR_SAME_MERCHANT`                | 400       |
/// | 22   | `SubscriptionAlreadyExists` | `ERR_SUBSCRIPTION_ALREADY_EXISTS`| 409       |
/// | 23   | `FeeBpsTooHigh`           | `ERR_FEE_BPS_TOO_HIGH`             | 400       |
/// | 24   | `MerchantNotApproved`     | `ERR_MERCHANT_NOT_APPROVED`        | 403       |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// Returned by `subscribe` when `amount <= 0`.
    ///
    /// The subscriber must specify a strictly positive payment amount.
    ///
    /// Frontend: display "Payment amount must be greater than zero."
    AmountMustBePositive = 1,

    /// Returned by `subscribe` when `interval < 86_400` seconds (less than 1 day).
    ///
    /// The minimum billing interval is 1 day (86 400 seconds).
    ///
    /// Frontend: display "Billing interval must be at least 1 day."
    IntervalTooShort = 2,

    /// Returned by `subscribe` when `interval > 31_536_000` seconds (more than 365 days).
    ///
    /// The maximum billing interval is 365 days (31 536 000 seconds).
    ///
    /// Frontend: display "Billing interval must be at most 365 days."
    IntervalTooLong = 3,

    /// Returned by `execute_payment`, `cancel`, or `get_subscription` when no active
    /// subscription exists for the `(subscriber, merchant, token)` triple.
    ///
    /// The subscription may have been cancelled, expired (TTL lapsed), or never created.
    ///
    /// Frontend: display "No active subscription found for this account pair."
    NoActiveSubscription = 4,

    /// Returned by `execute_payment` when `now < next_payment`.
    ///
    /// The billing interval has not yet elapsed since the last successful collection.
    /// Merchants should back off and retry after `next_payment - now` seconds.
    ///
    /// Frontend: display "Payment is not yet due — try again later."
    PaymentNotDue = 5,

    /// Returned when the Soroban host rejects a `require_auth()` check.
    ///
    /// Each entry point requires a specific signer:
    /// - `subscribe` / `cancel` — subscriber
    /// - `execute_payment` / `batch_execute_payment` — merchant
    /// - `set_protocol_fee` / `migrate` — admin
    ///
    /// Frontend: display "Transaction rejected — wrong account signed."
    Unauthorized = 6,

    /// Returned by `execute_payment` when the subscriber's token balance is
    /// insufficient to cover the payment amount at execution time.
    ///
    /// The subscription remains active; the merchant may retry after the subscriber
    /// replenishes their balance or the grace period expires.
    ///
    /// Frontend: display "Insufficient subscriber balance — payment could not be collected."
    TransferFailed = 7,

    /// Returned when the Soroban ledger timestamp is zero (uninitialised environment)
    /// or when `timestamp + interval` would overflow a `u64`.
    ///
    /// This is a defensive guard against broken clock environments or integer overflow.
    /// It should never be triggered on mainnet under normal conditions.
    ///
    /// Backend: alert on any occurrence — it indicates an infrastructure issue.
    InvalidTimestamp = 8,

    /// Returned by `subscribe` when `amount > 10^18` (the `MAX_AMOUNT` constant).
    ///
    /// The upper bound prevents integer overflow in fee and transfer arithmetic.
    ///
    /// Frontend: display "Payment amount exceeds the maximum allowed value."
    AmountTooLarge = 9,

    /// Returned by `subscribe` when `subscriber == merchant`.
    ///
    /// Self-subscription is a logical error and is blocked at the contract level.
    ///
    /// Frontend: display "Subscriber and merchant must be different accounts."
    SelfSubscription = 10,

    /// Returned by `subscribe` when the `token` argument equals the contract's own address.
    ///
    /// Prevents circular / re-entrant token interactions.
    ///
    /// Frontend: display "Invalid token address — cannot use the subscription contract as a token."
    InvalidTokenAddress = 11,

    /// Returned by `execute_payment` when the subscription is paused.
    ///
    /// Payment collection is suspended until the subscriber or merchant resumes it.
    /// Check `paused_until` in `SubscriptionData` for the scheduled resume timestamp.
    ///
    /// Frontend: display "Subscription is paused — payment collection is suspended."
    SubscriptionPaused = 12,

    /// Returned by `batch_execute_payment` when the input subscribers vector is empty.
    ///
    /// A batch call with zero items is a no-op and is rejected to avoid wasting fees.
    ///
    /// Frontend: display "Batch payment list must not be empty."
    EmptyBatch = 13,

    /// Returned by `batch_execute_payment` when the subscribers vector length exceeds
    /// `BATCH_MAX_SIZE` (50).
    ///
    /// Split the batch into smaller chunks of at most 50 subscribers.
    ///
    /// Frontend: display "Batch size exceeds the limit of 50 — split into smaller batches."
    BatchTooLarge = 14,

    /// Returned by `subscribe` when `strict = true` and the subscriber's current
    /// SEP-41 allowance for this contract is less than `amount`.
    ///
    /// Increase the allowance via `token.approve(contract, amount, expiry)` first.
    ///
    /// Frontend: display "Insufficient token allowance — please approve the contract to spend your tokens."
    InsufficientAllowance = 15,

    /// Returned by `migrate` when the contract schema is already at the current version.
    ///
    /// No migration action is needed.
    ///
    /// Backend: treat as a no-op; log and ignore.
    AlreadyMigrated = 16,

    /// Returned by `migrate` or `set_protocol_fee` when the caller is not the stored admin.
    ///
    /// Only the address passed to `initialize` may perform admin operations.
    ///
    /// Frontend: display "Only the contract admin can perform this action."
    NotAdmin = 17,

    /// Returned when an admin operation is attempted before `initialize` has been called.
    ///
    /// Deploy → call `initialize(admin)` once before using any admin entry points.
    ///
    /// Frontend: display "Contract is not initialised — contact the operator."
    NotInitialized = 18,

    /// Returned by `subscribe` when the requested `amount` exceeds the admin-configured
    /// per-deployment cap set via `set_max_amount`.
    ///
    /// The operator can raise the cap with `set_max_amount` if needed.
    ///
    /// Frontend: display "Payment amount exceeds the operator-configured limit."
    AmountExceedsLimit = 19,

    /// Returned by `expire_subscription` when the subscription is still within its
    /// grace period and cannot yet be forcibly expired.
    ///
    /// Wait until `overdue_since + grace_period` has elapsed before calling again.
    ///
    /// Frontend: display "Subscription is still within its grace period."
    GracePeriodActive = 20,

    /// Returned by `transfer_subscription` when `old_merchant == new_merchant`.
    ///
    /// A no-op transfer is rejected to prevent wasting fees.
    ///
    /// Frontend: display "New merchant address must differ from the current merchant."
    SameMerchant = 21,

    /// Returned by `transfer_subscription` when a subscription already exists for
    /// `(subscriber, new_merchant, token)`.
    ///
    /// Cancel the existing subscription for the new merchant pair before transferring.
    ///
    /// Frontend: display "A subscription already exists for this merchant — cancel it first."
    SubscriptionAlreadyExists = 22,

    /// Returned by `set_protocol_fee` when `fee_bps > MAX_FEE_BPS` (500 = 5 %).
    ///
    /// The 5 % cap prevents admin abuse. Fees above this threshold are disallowed.
    ///
    /// Frontend: display "Protocol fee exceeds the maximum of 5%."
    FeeBpsTooHigh = 23,

    /// Returned when a merchant attempts an action that requires prior approval from the
    /// subscriber but no approval has been granted.
    ///
    /// Frontend: display "Merchant is not approved by the subscriber for this action."
    MerchantNotApproved = 24,
}
