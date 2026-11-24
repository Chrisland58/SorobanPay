/**
 * validation.ts
 *
 * Client-side input validation for the subscription form.
 * Pure functions — no side effects, no async.
 *
 * Requirements: 10.1, 10.9
 */

import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

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
export const MAX_AMOUNT = 1_000_000_000_000_000_000n;

// ─── Address validators ───────────────────────────────────────────────────────

/** Returns true for a valid Stellar G-address (56-char base32, starts with G). */
export function isValidGAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/** Returns true for a valid Stellar contract C-address (56-char base32, starts with C). */
export function isValidCAddress(addr: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(addr.trim());
}

// ─── Address normalization + assertion helpers (Issue #37) ────────────────────
//
// transaction_builder.ts repeated the same
//   if (!isValidGAddress(x)) throw new Error(`Invalid ... address: ${x}`)
// block seven times across its builder functions, each operating on the raw,
// un-trimmed param. These helpers centralize that: normalize (trim) once,
// validate once, and either return the clean address or throw a consistently
// worded error — so every builder function does address handling the same way
// before it ever builds a contract call.

/** Trim a Stellar address. The sole normalization StrKey addresses need —
 *  they have no case variation, so there's nothing else safe to fold. */
export function normalizeAddress(addr: string): string {
  return addr.trim();
}

/**
 * Normalize and validate a Stellar G-address (account/subscriber/merchant).
 *
 * @param addr  Raw address, e.g. straight from a form field or params object.
 * @param label Used in the thrown message, e.g. "subscriber" → "Invalid subscriber address: …".
 * @returns     The trimmed address, once confirmed to match the G-address shape.
 * @throws      Error with a message matching the `/invalid (subscriber|merchant|...) address/i`
 *              pattern that lib/errors.ts's mapError() and rpc_error_normalizer.ts already key off.
 */
export function assertValidGAddress(addr: string, label: string): string {
  const normalized = normalizeAddress(addr);
  if (!isValidGAddress(normalized)) {
    throw new Error(`Invalid ${label} address: ${addr}`);
  }
  return normalized;
}

/** Same as `assertValidGAddress`, for a token contract C-address. */
export function assertValidCAddress(addr: string, label: string): string {
  const normalized = normalizeAddress(addr);
  if (!isValidCAddress(normalized)) {
    throw new Error(`Invalid ${label} address: ${addr}`);
  }
  return normalized;
}

// ─── Stricter, checksum-verified validation (opt-in) ───────────────────────────
//
// isValidGAddress/isValidCAddress above only check shape (length, charset) via
// regex — a string can match and still carry a corrupted StrKey checksum,
// which would only surface later as a confusing SDK/RPC error. StrKey (from
// @stellar/stellar-sdk) verifies the embedded CRC16 checksum for real.
//
// This is intentionally NOT wired into isValidGAddress/isValidCAddress or the
// assert* helpers above: a lot of this codebase's existing tests use
// regex-shaped-but-not-checksum-valid placeholder addresses (e.g.
// 'G' + 'A'.repeat(55)) as fixtures, and swapping the strictness of the
// widely-used validators out from under them would break those tests. Use
// these directly wherever you specifically want a real checksum guarantee —
// e.g. before persisting an address, or in a new form that isn't relying on
// the existing placeholder-fixture convention.

/** Returns true only for a G-address with a valid embedded StrKey checksum. */
export function isValidGAddressChecksum(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(normalizeAddress(addr));
}

/** Returns true only for a C-address with a valid embedded StrKey checksum. */
export function isValidCAddressChecksum(addr: string): boolean {
  return StrKey.isValidContract(normalizeAddress(addr));
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const integerString = z.string().trim();

export const subscriptionFormSchema = z
  .object({
    merchantAddress: z
      .string()
      .trim()
      .min(1, 'Merchant address is required.')
      .refine(isValidGAddressChecksum, {
        message: 'Enter a valid Stellar address (starts with G)',
      }),
    tokenAddress: z
      .string()
      .trim()
      .min(1, 'Token contract address is required.')
      .refine(isValidCAddressChecksum, {
        message: 'Enter a valid Stellar contract address (starts with C)',
      }),
    amount: integerString
      .min(1, 'Amount is required.')
      .regex(/^-?\d+$/, 'Amount must be a whole number.')
      .refine(
        (value) => !/^-?\d+$/.test(value) || BigInt(value) > 0n,
        'Amount must be greater than 0',
      )
      .refine(
        (value) => !/^-?\d+$/.test(value) || BigInt(value) <= MAX_AMOUNT,
        'Amount exceeds maximum allowed value',
      ),
    interval: integerString
      .min(1, 'Interval is required.')
      .regex(/^-?\d+$/, 'Interval must be a whole number of seconds.')
      .refine(
        (value) =>
          !/^-?\d+$/.test(value) || Number(value) >= MIN_INTERVAL_SECONDS,
        'Interval must be at least 1 day (86400 seconds)',
      )
      .refine(
        (value) =>
          !/^-?\d+$/.test(value) || Number(value) <= MAX_INTERVAL_SECONDS,
        `Interval must not exceed ${MAX_INTERVAL_SECONDS} seconds`,
      ),
    subscriberAddress: z.string().optional(),
  })
  .superRefine((values, context) => {
    if (
      values.subscriberAddress &&
      values.merchantAddress === values.subscriberAddress.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['merchantAddress'],
        message:
          'Merchant address cannot be the same as your subscriber address. A subscription to yourself is not allowed.',
      });
    }
  });

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
  const result = subscriptionFormSchema.safeParse(values);
  if (result.success) return {};

  const errors: FieldErrors = {};
  const fieldErrors = result.error.flatten().fieldErrors;
  for (const field of [
    'merchantAddress',
    'tokenAddress',
    'amount',
    'interval',
  ] as const) {
    const message = fieldErrors[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** Returns true when a FieldErrors object has no error entries. */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
