/**
 * network_contract_refresh.test.ts
 *
 * Automated tests for contract configuration refresh on active network change (Issue #1572):
 * - Guarantees write actions cannot use contract address from previous network
 * - Distinct states for 'ready', 'network-mismatch', and 'missing-config'
 * - Invalidation of dependent caches when wallet network shifts
 * - assertContractConfigForNetwork guard checks
 */

import {
  getContractConfig,
  assertContractConfigForNetwork,
  invalidateContractCache,
  onNetworkChange,
  NETWORK_CONFIGS,
  type StellarNetwork,
} from '@/lib/network_config';

describe('Network & Contract Configuration Refresh (#1572)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID_TESTNET;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID_MAINNET;
    invalidateContractCache();
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it('reports "missing-config" when contract ID is not configured for the active network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const state = getContractConfig('testnet');
    expect(state.status).toBe('missing-config');
    expect(state.contractId).toBeNull();
    expect(state.network).toBe('testnet');
  });

  it('reports "ready" when contract ID is configured and matches active network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    process.env.NEXT_PUBLIC_CONTRACT_ID = 'CTestnetContract1111111111111111111111111111111111111111111';

    const state = getContractConfig('testnet');
    expect(state.status).toBe('ready');
    expect(state.contractId).toBe('CTestnetContract1111111111111111111111111111111111111111111');
  });

  it('reports "network-mismatch" when wallet network differs from app network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    process.env.NEXT_PUBLIC_CONTRACT_ID = 'CTestnetContract1111111111111111111111111111111111111111111';

    // Wallet is on mainnet while app expects testnet
    const state = getContractConfig('mainnet');
    expect(state.status).toBe('network-mismatch');
    expect(state.contractId).toBeNull();
    expect(state.error).toContain('Wallet is on mainnet while app requires testnet');
  });

  it('assertContractConfigForNetwork prevents write action when network mismatches or contract is missing', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';

    // Throws on mismatched target network
    expect(() => {
      assertContractConfigForNetwork('mainnet', 'CMAINNET123');
    }).toThrow(/Contract network mismatch/);

    // Throws on empty contract ID
    expect(() => {
      assertContractConfigForNetwork('testnet', '');
    }).toThrow(/No contract ID configured/);

    // Succeeds when valid
    expect(() => {
      assertContractConfigForNetwork('testnet', 'CTESTNET123');
    }).not.toThrow();
  });

  it('invalidates cache and invokes registered network change listeners', () => {
    const listener = jest.fn();
    const unsubscribe = onNetworkChange(listener);

    invalidateContractCache('mainnet');
    expect(listener).toHaveBeenCalledWith('mainnet');

    unsubscribe();
    invalidateContractCache('testnet');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
