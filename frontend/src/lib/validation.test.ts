/**
 * Regression tests for invalid token contract addresses.
 * Covers: src/lib/validation.ts — isValidCAddress, validateSubscriptionForm (tokenAddress)
 */

import {
  isValidCAddress,
  validateSubscriptionForm,
  isFormValid,
  SubscriptionFormValues,
} from './validation';

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const BASE_FORM: SubscriptionFormValues = {
  merchantAddress: VALID_G,
  tokenAddress: VALID_C,
  amount: '100',
  interval: '86400',
};

// ─── isValidCAddress ──────────────────────────────────────────────────────────

describe('isValidCAddress', () => {
  it('accepts a valid 56-char C-address', () => {
    expect(isValidCAddress(VALID_C)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidCAddress('')).toBe(false);
  });

  it('rejects an address starting with G (account address)', () => {
    expect(isValidCAddress(VALID_G)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidCAddress('CAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidCAddress(VALID_C + 'A')).toBe(false);
  });

  it('rejects an address with lowercase characters', () => {
    expect(isValidCAddress('caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects an address with invalid base32 characters (0, 1, 8, 9)', () => {
    // Replace last char with '0' (not in base32 alphabet A-Z2-7)
    const bad = VALID_C.slice(0, -1) + '0';
    expect(isValidCAddress(bad)).toBe(false);
  });

  it('rejects a random string', () => {
    expect(isValidCAddress('not-a-contract-address')).toBe(false);
  });

  it('accepts address with surrounding whitespace (trimmed)', () => {
    expect(isValidCAddress(`  ${VALID_C}  `)).toBe(true);
  });
});

// ─── validateSubscriptionForm — tokenAddress field ────────────────────────────

describe('validateSubscriptionForm: tokenAddress regression', () => {
  it('returns no error for a valid token address', () => {
    const errors = validateSubscriptionForm(BASE_FORM);
    expect(errors.tokenAddress).toBeUndefined();
    expect(isFormValid(errors)).toBe(true);
  });

  it('rejects empty token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: '' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects whitespace-only token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: '   ' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a G-address used as token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: VALID_G });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a truncated C-address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'CAAAAAAA' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects an address with invalid characters', () => {
    const bad = 'C' + '0'.repeat(55); // '0' not in base32 A-Z2-7
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: bad });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a plain URL accidentally entered as token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'https://example.com/token' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('does not set errors on other fields when only token address is invalid', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'BAD' });
    expect(errors.tokenAddress).toBeDefined();
    expect(errors.merchantAddress).toBeUndefined();
    expect(errors.amount).toBeUndefined();
    expect(errors.interval).toBeUndefined();
  });

  it('isFormValid returns false when token address is the only error', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'BAD' });
    expect(isFormValid(errors)).toBe(false);
  });
});
