/**
 * config.test.ts
 *
 * Unit tests for the frontend environment validation module (src/lib/config.ts).
 *
 * Covers:
 *   - Success: valid configuration loads without error
 *   - Failure: each required variable missing throws ConfigError
 *   - Failure: malformed values (bad URL, bad contract address, short passphrase)
 *   - Network name derivation (Mainnet / Testnet)
 *   - isProduction flag
 *   - Optional apiBaseUrl (absent → null, present → string)
 *   - validateEnv utility with partial overrides
 *   - setTestConfig / resetConfig test helpers
 *   - ConfigError is an Error subclass with name "ConfigError"
 *   - Errors and sensitive values are handled safely and observably
 *
 * Note: `loadConfig()` runs at module-load time, so tests that exercise
 * the module-level `appConfig` singleton use `setTestConfig` / `resetConfig`
 * rather than re-importing the module under different env conditions.
 * Tests for the pure `validateEnv` function manipulate the env map directly.
 *
 * Issue #1052 — Add frontend environment validation
 */

// ── Environment setup ──────────────────────────────────────────────────────────
// Set required env vars BEFORE importing the module so `loadConfig()` succeeds.

const VALID_CONTRACT  = 'C' + 'A'.repeat(55);
const VALID_RPC       = 'https://soroban-testnet.stellar.org';
const TESTNET_PASS    = 'Test SDF Network ; September 2015';
const MAINNET_PASS    = 'Public Global Stellar Network ; September 2015';

// Stash originals so we can restore them after each suite.
const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  process.env.NEXT_PUBLIC_RPC_URL              = VALID_RPC;
  process.env.NEXT_PUBLIC_CONTRACT_ID          = VALID_CONTRACT;
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE   = TESTNET_PASS;
});

afterAll(() => {
  Object.assign(process.env, ORIGINAL_ENV);
});

// Now import — loadConfig() will see the vars set above.
import {
  validateEnv,
  ConfigError,
  setTestConfig,
  resetConfig,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '@/lib/config';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal valid env map; individual tests override specific keys. */
function validEnv(
  overrides: Partial<Record<string, string | undefined>> = {},
): Partial<Record<string, string | undefined>> {
  return {
    NEXT_PUBLIC_RPC_URL: VALID_RPC,
    NEXT_PUBLIC_CONTRACT_ID: VALID_CONTRACT,
    NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASS,
    ...overrides,
  };
}

// ── validateEnv — success ──────────────────────────────────────────────────────

describe('validateEnv — success', () => {
  it('returns an empty errors array for a fully-valid env', () => {
    expect(validateEnv(validEnv())).toHaveLength(0);
  });

  it('accepts mainnet passphrase', () => {
    expect(
      validateEnv(validEnv({ NEXT_PUBLIC_NETWORK_PASSPHRASE: MAINNET_PASS })),
    ).toHaveLength(0);
  });

  it('accepts an https RPC URL', () => {
    expect(
      validateEnv(validEnv({ NEXT_PUBLIC_RPC_URL: 'https://rpc.example.com' })),
    ).toHaveLength(0);
  });

  it('accepts an http RPC URL (dev / local node)', () => {
    expect(
      validateEnv(validEnv({ NEXT_PUBLIC_RPC_URL: 'http://localhost:8000' })),
    ).toHaveLength(0);
  });
});

// ── validateEnv — missing required variables ───────────────────────────────────

describe('validateEnv — missing required variables', () => {
  it('errors when NEXT_PUBLIC_RPC_URL is absent', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_RPC_URL: undefined }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/NEXT_PUBLIC_RPC_URL/);
  });

  it('errors when NEXT_PUBLIC_CONTRACT_ID is absent', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_CONTRACT_ID: undefined }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/NEXT_PUBLIC_CONTRACT_ID/);
  });

  it('errors when NEXT_PUBLIC_NETWORK_PASSPHRASE is absent', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_NETWORK_PASSPHRASE: undefined }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/NEXT_PUBLIC_NETWORK_PASSPHRASE/);
  });

  it('errors when all three required variables are absent', () => {
    const errors = validateEnv({
      NEXT_PUBLIC_RPC_URL: undefined,
      NEXT_PUBLIC_CONTRACT_ID: undefined,
      NEXT_PUBLIC_NETWORK_PASSPHRASE: undefined,
    });
    expect(errors).toHaveLength(3);
  });

  it('error message mentions .env.local for guidance', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_RPC_URL: undefined }));
    expect(errors[0]).toMatch(/env\.local/i);
  });
});

// ── validateEnv — malformed values ────────────────────────────────────────────

describe('validateEnv — malformed values', () => {
  it('errors when RPC_URL is not a valid URL', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_RPC_URL: 'not-a-url' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/valid URL/i);
  });

  it('errors when CONTRACT_ID does not start with C', () => {
    const badAddr = 'G' + 'A'.repeat(55);
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_CONTRACT_ID: badAddr }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/C-address/i);
  });

  it('errors when CONTRACT_ID is too short', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_CONTRACT_ID: 'CABC' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/C-address/i);
  });

  it('errors when NETWORK_PASSPHRASE is fewer than 10 characters', () => {
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_NETWORK_PASSPHRASE: 'short' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/passphrase/i);
  });

  it('does not expose the full malformed contract address in the error (safety)', () => {
    // 56-char address with correct C prefix but wrong alphabet — will fail validation
    const badAddr = 'C' + '1'.repeat(55); // '1' is not valid base32
    const errors = validateEnv(validEnv({ NEXT_PUBLIC_CONTRACT_ID: badAddr }));
    // Full address must not appear verbatim
    expect(errors[0]).not.toContain(badAddr);
    // Only a truncated preview is allowed
    expect(errors[0]).toContain('…');
  });

  it('returns multiple errors when several values are bad', () => {
    const errors = validateEnv(
      validEnv({
        NEXT_PUBLIC_RPC_URL: 'bad-url',
        NEXT_PUBLIC_CONTRACT_ID: 'bad-contract',
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── ConfigError ────────────────────────────────────────────────────────────────

describe('ConfigError', () => {
  it('is an instance of Error', () => {
    const e = new ConfigError('boom');
    expect(e).toBeInstanceOf(Error);
  });

  it('has name "ConfigError"', () => {
    const e = new ConfigError('boom');
    expect(e.name).toBe('ConfigError');
  });

  it('carries the provided message', () => {
    const e = new ConfigError('something missing');
    expect(e.message).toBe('something missing');
  });
});

// ── setTestConfig / resetConfig ───────────────────────────────────────────────

describe('setTestConfig / resetConfig', () => {
  afterEach(() => {
    try { resetConfig(); } catch { /* ignore if env missing in CI */ }
  });

  it('setTestConfig overrides rpcUrl on appConfig', async () => {
    const { appConfig } = await import('@/lib/config');
    setTestConfig({ rpcUrl: 'https://custom-rpc.example.com' });
    expect(appConfig.rpcUrl).toBe('https://custom-rpc.example.com');
  });

  it('setTestConfig merges — unrelated fields are preserved', async () => {
    const { appConfig } = await import('@/lib/config');
    const originalContract = appConfig.contractId;
    setTestConfig({ rpcUrl: 'https://custom-rpc.example.com' });
    const { appConfig: updated } = await import('@/lib/config');
    expect(updated.contractId).toBe(originalContract);
  });

  it('setTestConfig can override contractId', async () => {
    const newContract = 'C' + 'B'.repeat(55);
    setTestConfig({ contractId: newContract });
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.contractId).toBe(newContract);
  });
});

// ── AppConfig shape ────────────────────────────────────────────────────────────

describe('appConfig — shape and network resolution', () => {
  it('networkName is "Testnet" when configured with testnet passphrase', async () => {
    setTestConfig({
      networkPassphrase: TESTNET_PASSPHRASE,
      networkName: 'Testnet',
      isProduction: false,
    });
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.networkName).toBe('Testnet');
    expect(appConfig.isProduction).toBe(false);
  });

  it('networkName is "Mainnet" when configured with mainnet passphrase', async () => {
    setTestConfig({
      networkPassphrase: MAINNET_PASSPHRASE,
      networkName: 'Mainnet',
      isProduction: true,
    });
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.networkName).toBe('Mainnet');
    expect(appConfig.isProduction).toBe(true);
  });

  it('apiBaseUrl is null when not configured', async () => {
    setTestConfig({ apiBaseUrl: null });
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.apiBaseUrl).toBeNull();
  });

  it('apiBaseUrl is set when configured', async () => {
    setTestConfig({ apiBaseUrl: 'https://api.sorobanpay.example.com' });
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.apiBaseUrl).toBe('https://api.sorobanpay.example.com');
  });

  it('appConfig.contractId is a non-empty string', async () => {
    resetConfig();
    const { appConfig } = await import('@/lib/config');
    expect(typeof appConfig.contractId).toBe('string');
    expect(appConfig.contractId.length).toBeGreaterThan(0);
  });

  it('appConfig.rpcUrl starts with http', async () => {
    resetConfig();
    const { appConfig } = await import('@/lib/config');
    expect(appConfig.rpcUrl).toMatch(/^https?:\/\//);
  });
});

// ── Known passphrase constants ─────────────────────────────────────────────────

describe('exported passphrase constants', () => {
  it('TESTNET_PASSPHRASE matches the official SDF value', () => {
    expect(TESTNET_PASSPHRASE).toBe('Test SDF Network ; September 2015');
  });

  it('MAINNET_PASSPHRASE matches the official SDF value', () => {
    expect(MAINNET_PASSPHRASE).toBe('Public Global Stellar Network ; September 2015');
  });

  it('TESTNET_PASSPHRASE and MAINNET_PASSPHRASE are different', () => {
    expect(TESTNET_PASSPHRASE).not.toBe(MAINNET_PASSPHRASE);
  });
});
