/**
 * backend/src/utils/tokenAmount.ts
 *
 * Exact token amount parsing, conversion, and serialization (Issue #1584).
 *
 * Avoids JavaScript floating-point (IEEE-754) drift by using BigInt and string
 * arithmetic exclusively across persistence, API responses, and analytics.
 */

export interface TokenAmountInfo {
  raw: string;      // Integer string in token base units (e.g. "10000000")
  decimal: string;  // Formatted human-readable decimal (e.g. "1.0")
  decimals: number; // Token precision (e.g. 7 for Stellar XLM, 6 for USDC, 18 for ERC-20)
}

/**
 * Format raw token base-units into an exact decimal string without floating point operations.
 *
 * @param raw - BigInt or integer string of base units.
 * @param decimals - Token decimal precision (0 to 18, default 7).
 */
export function formatTokenAmount(raw: bigint | string | number, decimals = 7): string {
  const rawStr = String(raw).trim();
  if (!rawStr) return '0.0';

  let n: bigint;
  try {
    n = BigInt(rawStr);
  } catch {
    throw new Error(`Invalid token amount: "${rawStr}" is not a valid integer`);
  }

  if (decimals === 0) {
    return n.toString();
  }

  const isNeg = n < 0n;
  const abs = isNeg ? -n : n;

  const divisor = 10n ** BigInt(decimals);
  const wholePart = abs / divisor;
  const fracPart = abs % divisor;

  const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
  return `${isNeg ? '-' : ''}${wholePart.toString()}.${fracStr}`;
}

/**
 * Parse a human-readable decimal string into exact raw base units as BigInt string.
 *
 * @param decimalStr - e.g. "1.5", "-0.0000001", "100"
 * @param decimals - Token decimal precision (default 7).
 */
export function parseTokenAmount(decimalStr: string, decimals = 7): string {
  const s = decimalStr.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid decimal amount format: "${decimalStr}"`);
  }

  const isNeg = s.startsWith('-');
  const clean = s.replace(/^[+-]/, '');
  const [whole, frac = ''] = clean.split('.');

  if (frac.length > decimals) {
    throw new Error(`Amount precision exceeds token decimal limit of ${decimals}`);
  }

  const paddedFrac = frac.padEnd(decimals, '0');
  const combined = `${whole}${paddedFrac}`;
  const baseUnits = BigInt(combined);

  return (isNeg ? -baseUnits : baseUnits).toString();
}

/**
 * Standard serialization helper for financial amount fields in API responses.
 */
export function serializeAmount(rawAmount: bigint | string | number, decimals = 7): TokenAmountInfo {
  const raw = String(rawAmount);
  const decimal = formatTokenAmount(rawAmount, decimals);
  return {
    raw,
    decimal,
    decimals,
  };
}
