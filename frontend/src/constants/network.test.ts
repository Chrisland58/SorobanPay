/**
 * network.test.ts
 *
 * Unit tests for getNetworkConfig() and the NETWORKS preset map.
 * Covers: default (no env), explicit testnet, explicit mainnet,
 * unknown value fallback, contractId passthrough, and type shape.
 */

// We need to re-import the module fresh for each env variation, so we use
// jest.resetModules() + require() inside each test.

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASS = 'Test SDF Network ; September 2015';
const MAINNET_RPC =
  'https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI=';
const MAINNET_PASS = 'Public Global Stellar Network ; September 2015';

/** Re-import the module after mutating process.env */
function loadModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/constants/network') as typeof import('@/constants/network');
}

beforeEach(() => {
  jest.resetModules();
  // Start each test with a clean slate
  delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  delete process.env.NEXT_PUBLIC_CONTRACT_ID;
});

// ─── getNetworkConfig() ────────────────────────────────────────────────────────

describe('getNetworkConfig()', () => {
  it('returns testnet preset when NEXT_PUBLIC_STELLAR_NETWORK is not set', () => {
    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(cfg.name).toBe('testnet');
    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.networkPassphrase).toBe(TESTNET_PASS);
  });

  it('returns testnet preset when NEXT_PUBLIC_STELLAR_NETWORK is "testnet"', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(cfg.name).toBe('testnet');
    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.networkPassphrase).toBe(TESTNET_PASS);
  });

  it('returns mainnet preset when NEXT_PUBLIC_STELLAR_NETWORK is "mainnet"', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(cfg.name).toBe('mainnet');
    expect(cfg.rpcUrl).toBe(MAINNET_RPC);
    expect(cfg.networkPassphrase).toBe(MAINNET_PASS);
  });

  it('falls back to testnet for an unknown network value and warns in dev', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'staging';
    // NODE_ENV is read-only in strict TS; use defineProperty to override in tests
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(cfg.name).toBe('testnet');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown NEXT_PUBLIC_STELLAR_NETWORK value'),
    );

    warnSpy.mockRestore();
  });

  it('does not warn when falling back to testnet in production', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'staging';
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { getNetworkConfig } = loadModule();
    getNetworkConfig();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('propagates NEXT_PUBLIC_CONTRACT_ID into contractId', () => {
    const CONTRACT = 'CABC1234567890XXXXX';
    process.env.NEXT_PUBLIC_CONTRACT_ID = CONTRACT;
    const { getNetworkConfig } = loadModule();

    expect(getNetworkConfig().contractId).toBe(CONTRACT);
  });

  it('returns empty string contractId when NEXT_PUBLIC_CONTRACT_ID is not set', () => {
    const { getNetworkConfig } = loadModule();
    expect(getNetworkConfig().contractId).toBe('');
  });

  it('is case-insensitive for network name (e.g. "TESTNET")', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'TESTNET';
    const { getNetworkConfig } = loadModule();
    expect(getNetworkConfig().name).toBe('testnet');
  });

  it('trims whitespace from the network env value', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = '  mainnet  ';
    const { getNetworkConfig } = loadModule();
    expect(getNetworkConfig().name).toBe('mainnet');
  });
});

// ─── NETWORKS preset map ───────────────────────────────────────────────────────

describe('NETWORKS', () => {
  it('exposes both testnet and mainnet keys', () => {
    const { NETWORKS } = loadModule();
    expect(NETWORKS).toHaveProperty('testnet');
    expect(NETWORKS).toHaveProperty('mainnet');
  });

  it('testnet preset has correct rpcUrl and networkPassphrase', () => {
    const { NETWORKS } = loadModule();
    expect(NETWORKS.testnet.rpcUrl).toBe(TESTNET_RPC);
    expect(NETWORKS.testnet.networkPassphrase).toBe(TESTNET_PASS);
    expect(NETWORKS.testnet.name).toBe('testnet');
  });

  it('mainnet preset has correct rpcUrl and networkPassphrase', () => {
    const { NETWORKS } = loadModule();
    expect(NETWORKS.mainnet.rpcUrl).toBe(MAINNET_RPC);
    expect(NETWORKS.mainnet.networkPassphrase).toBe(MAINNET_PASS);
    expect(NETWORKS.mainnet.name).toBe('mainnet');
  });
});

// ─── NetworkConfig shape ───────────────────────────────────────────────────────

describe('NetworkConfig shape', () => {
  it('returned object contains all required fields', () => {
    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(cfg).toHaveProperty('name');
    expect(cfg).toHaveProperty('rpcUrl');
    expect(cfg).toHaveProperty('networkPassphrase');
    expect(cfg).toHaveProperty('contractId');
  });

  it('all fields are strings', () => {
    const { getNetworkConfig } = loadModule();
    const cfg = getNetworkConfig();

    expect(typeof cfg.name).toBe('string');
    expect(typeof cfg.rpcUrl).toBe('string');
    expect(typeof cfg.networkPassphrase).toBe('string');
    expect(typeof cfg.contractId).toBe('string');
  });
});
