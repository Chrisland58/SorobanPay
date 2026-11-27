/**
 * validation.preflight.test.ts
 *
 * Unit tests for validateTransactionSize — the preflight guard that checks
 * operation count and XDR payload size before the wallet signing prompt.
 *
 * Covers:
 *   - Happy path (within both limits)
 *   - Operation count exceeded
 *   - Byte size exceeded
 *   - Boundary conditions (at-limit and one-over)
 *   - Both limits exceeded simultaneously (op count reported first)
 *   - Error message content (actionable text, specific numbers)
 *   - Return shape (ok, operationCount, estimatedBytes always present)
 *   - Base64 vs non-base64 XDR measurement
 */

import { validateTransactionSize, TransactionSizeCheckResult } from './validation';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MAX_OPS   = 10;
const MAX_BYTES = 500;

/** Build a base64 string whose decoded byte length is approximately `bytes`. */
function base64OfBytes(bytes: number): string {
  // ceil(bytes * 4/3) chars → decodes back to `bytes` bytes
  const chars = Math.ceil(bytes * 4 / 3);
  return 'A'.repeat(chars);
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('validateTransactionSize: happy path', () => {
  it('returns ok=true when both limits are satisfied', () => {
    const result = validateTransactionSize(base64OfBytes(100), 5, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('always returns operationCount in the result', () => {
    const result = validateTransactionSize(base64OfBytes(100), 3, MAX_OPS, MAX_BYTES);
    expect(result.operationCount).toBe(3);
  });

  it('always returns estimatedBytes in the result', () => {
    const xdr = base64OfBytes(200);
    const result = validateTransactionSize(xdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.estimatedBytes).toBeGreaterThan(0);
    expect(result.estimatedBytes).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('returns ok=true for a single operation with a minimal payload', () => {
    const result = validateTransactionSize('AAAA', 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
  });
});

// ─── Operation count limit ────────────────────────────────────────────────────

describe('validateTransactionSize: operation count exceeded', () => {
  it('returns ok=false when operation count exceeds the limit', () => {
    const result = validateTransactionSize(base64OfBytes(100), MAX_OPS + 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
  });

  it('error message includes the actual operation count', () => {
    const result = validateTransactionSize(base64OfBytes(100), 15, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/15 operation/i);
  });

  it('error message includes the configured max operations', () => {
    const result = validateTransactionSize(base64OfBytes(100), 15, MAX_OPS, MAX_BYTES);
    expect(result.error).toContain(String(MAX_OPS));
  });

  it('error message tells the user to split the batch', () => {
    const result = validateTransactionSize(base64OfBytes(100), 15, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/split/i);
  });

  it('still returns operationCount when over the limit', () => {
    const result = validateTransactionSize(base64OfBytes(100), 15, MAX_OPS, MAX_BYTES);
    expect(result.operationCount).toBe(15);
  });

  it('uses plural "operations" for count > 1', () => {
    const result = validateTransactionSize(base64OfBytes(50), 11, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/11 operations/i);
  });

  it('uses singular "operation" for count === 1 (over a limit of 0 — edge)', () => {
    // limit 0 is contrived but tests singular grammar
    const result = validateTransactionSize(base64OfBytes(50), 1, 0, MAX_BYTES);
    expect(result.error).toMatch(/1 operation[^s]/i);
  });
});

// ─── Byte size limit ──────────────────────────────────────────────────────────

describe('validateTransactionSize: byte size exceeded', () => {
  it('returns ok=false when estimated byte size exceeds the limit', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
  });

  it('error message mentions "bytes"', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/bytes/i);
  });

  it('error message includes the configured byte limit', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.error).toContain(MAX_BYTES.toLocaleString());
  });

  it('error message tells the user to reduce operations or arguments', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/reduce/i);
  });

  it('still returns estimatedBytes when over the limit', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.estimatedBytes).toBeGreaterThan(MAX_BYTES);
  });
});

// ─── Boundary cases ───────────────────────────────────────────────────────────

describe('validateTransactionSize: boundary conditions', () => {
  it('passes at exactly the operation count limit', () => {
    const result = validateTransactionSize(base64OfBytes(100), MAX_OPS, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
  });

  it('fails at one over the operation count limit', () => {
    const result = validateTransactionSize(base64OfBytes(100), MAX_OPS + 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
  });

  it('passes when estimated bytes is at or below the byte limit', () => {
    // 100 bytes ≤ 500
    const result = validateTransactionSize(base64OfBytes(100), 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
  });

  it('fails when estimated bytes exceed the byte limit', () => {
    const result = validateTransactionSize(base64OfBytes(MAX_BYTES + 1), 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
  });
});

// ─── Both limits exceeded ─────────────────────────────────────────────────────

describe('validateTransactionSize: both limits exceeded', () => {
  it('reports ok=false when both limits are exceeded', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, MAX_OPS + 5, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
  });

  it('reports the operation count error first (checked before byte size)', () => {
    const bigXdr = base64OfBytes(MAX_BYTES + 100);
    const result = validateTransactionSize(bigXdr, MAX_OPS + 5, MAX_OPS, MAX_BYTES);
    expect(result.error).toMatch(/operation/i);
    expect(result.error).not.toMatch(/bytes/i);
  });
});

// ─── XDR measurement — base64 vs non-base64 ──────────────────────────────────

describe('validateTransactionSize: XDR measurement', () => {
  it('treats a valid base64 string as base64 and measures decoded bytes', () => {
    // 100 chars of pure base64 → ceil(100 * 3/4) = 75 bytes
    const xdr = 'A'.repeat(100);
    const result = validateTransactionSize(xdr, 1, MAX_OPS, MAX_BYTES);
    // 75 bytes is well within MAX_BYTES (500)
    expect(result.ok).toBe(true);
    expect(result.estimatedBytes).toBe(75);
  });

  it('treats a non-base64 string as raw bytes', () => {
    // 10 raw UTF-8 characters with non-base64 chars (e.g. spaces)
    const rawXdr = 'hello world';  // contains a space → not base64
    const result = validateTransactionSize(rawXdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
    expect(result.estimatedBytes).toBe(new TextEncoder().encode(rawXdr).length);
  });

  it('a 100-char base64 string measures as 75 bytes, not 100', () => {
    const xdr = 'A'.repeat(100);
    const result = validateTransactionSize(xdr, 1, MAX_OPS, MAX_BYTES);
    expect(result.estimatedBytes).toBe(75);
    expect(result.estimatedBytes).not.toBe(100);
  });
});

// ─── Return shape ──────────────────────────────────────────────────────────────

describe('validateTransactionSize: return shape', () => {
  it('always includes ok, operationCount, and estimatedBytes', () => {
    const result: TransactionSizeCheckResult =
      validateTransactionSize('AAAA', 1, MAX_OPS, MAX_BYTES);
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('operationCount');
    expect(result).toHaveProperty('estimatedBytes');
  });

  it('error is undefined when ok=true', () => {
    const result = validateTransactionSize('AAAA', 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('error is a non-empty string when ok=false', () => {
    const result = validateTransactionSize('AAAA', MAX_OPS + 1, MAX_OPS, MAX_BYTES);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect((result.error as string).length).toBeGreaterThan(0);
  });
});
