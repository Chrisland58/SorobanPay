"use client";

/**
 * config.ts
 *
 * Typed, deterministic, environment-driven feature flags for experimental flows.
 * All flags are default-off; enable only via explicit environment variables.
 *
 * Design principles:
 *  - Default-off: All experimental features disabled unless explicitly enabled
 *  - Deterministic: Same env vars produce same behavior across server/client
 *  - Type-safe: TypeScript enforces flag existence and boolean values
 *  - Observable: Console warnings when dev-only flags are active in prod
 *
 * Priority order:
 *  1. Environment variable (NEXT_PUBLIC_FF_*)
 *  2. Default (always false for experimental features)
 *
 * Usage:
 *  ```ts
 *  import { featureFlags } from '@/lib/config';
 *
 *  if (featureFlags.stagedPayments) {
 *    // Show experimental two-phase payment UI
 *  }
 *  ```
 *
 * Environment variables:
 *  - NEXT_PUBLIC_FF_STAGED_PAYMENTS: Enable staged payment flow (default: false)
 *  - NEXT_PUBLIC_FF_BATCH_EXECUTE: Enable batch payment execution (default: false)
 *  - NEXT_PUBLIC_FF_PAYMENT_RETRY: Enable automatic payment retry UI (default: false)
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Feature flags configuration.
 * Each flag represents an experimental or staged feature that can be toggled
 * via environment variables.
 */
export interface FeatureFlags {
  /**
   * Staged Payments: Enable multi-phase payment flow with separate confirmation.
   * When enabled, allows payment submissions to return intermediate confirmation
   * state before final on-chain confirmation (two-phase flow).
   *
   * Env: NEXT_PUBLIC_FF_STAGED_PAYMENTS
   * Default: false
   */
  stagedPayments: boolean;

  /**
   * Batch Payment Execution: Enable batch collection of payments in a single operation.
   * When enabled, merchants can execute multiple subscriber payments atomically.
   *
   * Env: NEXT_PUBLIC_FF_BATCH_EXECUTE
   * Default: false
   */
  batchPaymentExecution: boolean;

  /**
   * Automatic Payment Retry: Enable automatic retry UI for failed payments.
   * When enabled, failed payments show a retry interface with exponential backoff.
   *
   * Env: NEXT_PUBLIC_FF_PAYMENT_RETRY
   * Default: false
   */
  automaticPaymentRetry: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** All known feature flags (for validation and introspection) */
const FLAG_NAMES = ['stagedPayments', 'batchPaymentExecution', 'automaticPaymentRetry'] as const;

/** Map of feature flag names to their environment variable names */
const FLAG_ENV_MAP: Record<keyof FeatureFlags, string> = {
  stagedPayments: 'NEXT_PUBLIC_FF_STAGED_PAYMENTS',
  batchPaymentExecution: 'NEXT_PUBLIC_FF_BATCH_EXECUTE',
  automaticPaymentRetry: 'NEXT_PUBLIC_FF_PAYMENT_RETRY',
};

// ─── State ──────────────────────────────────────────────────────────────────────

/** Cached feature flags (loaded once on first access) */
let cachedFlags: FeatureFlags | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Parse a boolean value from environment variable.
 * Accepts: "true", "1", "yes" (case-insensitive) → true
 * Everything else → false
 */
function parseBoolEnv(value: string | undefined): boolean {
  if (!value) return false;
  return /^(true|1|yes)$/i.test(value);
}

/**
 * Load all feature flags from environment variables.
 * Returns default values (all false) for any undefined variables.
 */
function loadFlagsFromEnv(): FeatureFlags {
  return {
    stagedPayments: parseBoolEnv(process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS),
    batchPaymentExecution: parseBoolEnv(process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE),
    automaticPaymentRetry: parseBoolEnv(process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY),
  };
}

/**
 * Log warnings for development-only flags that are active in production.
 * Production is detected by VERCEL_ENV or by absence of NEXT_PUBLIC_DEV_MODE.
 */
function warnProductionFlags(flags: FeatureFlags): void {
  // Skip warnings in test environment
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }

  // Detect production
  const isProduction =
    typeof window !== 'undefined'
      ? !localStorage.getItem('NEXT_PUBLIC_DEV_MODE')
      : process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  if (!isProduction) return;

  // Log warnings for any enabled experimental flags
  const enabledFlags = (Object.keys(flags) as (keyof FeatureFlags)[]).filter(
    (key) => flags[key],
  );

  if (enabledFlags.length > 0) {
    console.warn(
      '[config] Experimental feature flags enabled in production:',
      enabledFlags.join(', '),
    );
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the current feature flags configuration.
 * Cached on first access; subsequent calls return the same instance.
 *
 * @returns Feature flags configuration object
 */
export function getFeatureFlags(): FeatureFlags {
  if (cachedFlags) {
    return cachedFlags;
  }

  const flags = loadFlagsFromEnv();
  warnProductionFlags(flags);
  cachedFlags = flags;
  return flags;
}

/**
 * Convenience export of feature flags.
 * Prefer using `getFeatureFlags()` in tests or when you need fresh values.
 * Safe for general usage; exports the cached instance.
 */
export const featureFlags = getFeatureFlags();

/**
 * Check if a specific feature flag is enabled.
 * Useful for single-flag checks in conditions.
 *
 * @param flag - The feature flag name
 * @returns true if the flag is enabled, false otherwise
 */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return getFeatureFlags()[flag];
}

/**
 * Get environment variable name for a feature flag.
 * Useful for documentation or debugging.
 *
 * @param flag - The feature flag name
 * @returns The environment variable name
 */
export function getFlagEnvName(flag: keyof FeatureFlags): string {
  return FLAG_ENV_MAP[flag];
}

/**
 * Get all known feature flag names.
 * Useful for introspection or validation.
 *
 * @returns Array of feature flag names
 */
export function getAllFlagNames(): (keyof FeatureFlags)[] {
  return [...FLAG_NAMES];
}

/**
 * Clear cached feature flags (useful for testing).
 * After calling this, the next `getFeatureFlags()` call will re-read env vars.
 */
export function clearFeatureFlagsCache(): void {
  cachedFlags = null;
}

/**
 * Validate that feature flags are correctly configured.
 * This is mainly for documentation; it throws on invalid env var values
 * that don't parse as boolean (though the parser is lenient).
 *
 * @throws Error if feature flag configuration is invalid
 */
export function validateFeatureFlags(): void {
  const flags = loadFlagsFromEnv();

  // Flags are always valid since parseBoolEnv doesn't throw.
  // This function exists for API consistency and future stricter validation.
  if (!flags) {
    throw new Error('Feature flags not initialized');
  }
}

/**
 * Get human-readable description of enabled flags.
 * Useful for logs or debugging.
 *
 * @returns String describing which flags are enabled, or "none"
 */
export function describeEnabledFlags(): string {
  const flags = getFeatureFlags();
  const enabled = (Object.keys(flags) as (keyof FeatureFlags)[])
    .filter((key) => flags[key])
    .map((key) => `${key} (${FLAG_ENV_MAP[key]})`)
    .join(', ');

  return enabled || 'none';
}
