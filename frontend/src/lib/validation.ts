/**
 * validation.ts
 *
 * Client-side input validation for the subscription form.
 * Pure functions — no side effects, no async.
 *
 * Requirements: 10.1, 10.9
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Map of field name → error message. Empty object means all fields are valid. */
export interface FieldErrors {
  merchantAddress?: string;
  tokenAddress?: string;
  amount?: string;
  interval?: string;
}

/** Raw string values from the subscription form inputs. */
export interface SubscriptionFormValues {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  /** The connected subscriber's public key. When provided, used to guard against self-subscription. */
  subscriberAddress?: string;
}

// ─── Interval bounds ──────────────────────────────────────────────────────────

export const MIN_INTERVAL_SECONDS = 86_400;      // 1 day
export const MAX_INTERVAL_SECONDS = 31_536_000;  // 365 days
export const DEFAULT_INTERVAL_SECONDS = 2_592_000; // 30 days

// ─── Address validators ───────────────────────────────────────────────────────

/** Returns true for a valid Stellar G-address (56-char base32, starts with G). */
export function isValidGAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/** Returns true for a valid Stellar contract C-address (56-char base32, starts with C). */
export function isValidCAddress(addr: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(addr.trim());
}

// ─── Form validator ───────────────────────────────────────────────────────────

/**
 * Validate all subscription form fields.
 *
 * @param values  Raw form values (strings from <input> elements).
 * @returns       FieldErrors map. Empty = all valid.
 */
export function validateSubscriptionForm(
  values: SubscriptionFormValues,
): FieldErrors {
  const errors: FieldErrors = {};

  // merchantAddress — valid Stellar G-address, and must not equal the subscriber
  if (!values.merchantAddress.trim()) {
    errors.merchantAddress = 'Merchant address is required.';
  } else if (!isValidGAddress(values.merchantAddress)) {
    errors.merchantAddress =
      'Must be a valid Stellar G-address (56 characters, starts with G).';
  } else if (
    values.subscriberAddress &&
    values.merchantAddress.trim() === values.subscriberAddress.trim()
  ) {
    errors.merchantAddress =
      'Merchant address cannot be the same as your subscriber address. A subscription to yourself is not allowed.';
  }

  // tokenAddress — valid Stellar C-address (contract)
  if (!values.tokenAddress.trim()) {
    errors.tokenAddress = 'Token contract address is required.';
  } else if (!isValidCAddress(values.tokenAddress)) {
    errors.tokenAddress =
      'Must be a valid Stellar C-address (56 characters, starts with C).';
  }

  // amount — positive integer
  const amountNum = Number(values.amount);
  if (!values.amount.trim()) {
    errors.amount = 'Amount is required.';
  } else if (!Number.isInteger(amountNum) || isNaN(amountNum)) {
    errors.amount = 'Amount must be a whole number.';
  } else if (amountNum <= 0) {
    errors.amount = 'Amount must be greater than 0.';
  }

  // interval — seconds in [86400, 31536000]
  const intervalNum = Number(values.interval);
  if (!values.interval.trim()) {
    errors.interval = 'Interval is required.';
  } else if (!Number.isInteger(intervalNum) || isNaN(intervalNum)) {
    errors.interval = 'Interval must be a whole number of seconds.';
  } else if (intervalNum < MIN_INTERVAL_SECONDS) {
    errors.interval = `Minimum interval is ${MIN_INTERVAL_SECONDS.toLocaleString()} seconds (1 day).`;
  } else if (intervalNum > MAX_INTERVAL_SECONDS) {
    errors.interval = `Maximum interval is ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).`;
  }

  return errors;
}

/** Returns true when a FieldErrors object has no error entries. */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
