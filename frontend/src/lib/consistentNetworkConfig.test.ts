/**
 * consistentNetworkConfig.test.ts
 *
 * Automated tests for enforcing consistent network configuration across clients (Issue #1580):
 * - Guarantees a single validated network configuration is used across API and wallet integrations
 * - Confirms that mismatched passphrases prevent transaction construction
 */

import { getNetworkConfig, NETWORK_CONFIGS } from './network_config';
import { buildSignAndSubmitSubscribe, buildSignAndSubmitCancel } from './transaction_builder';

describe('Consistent Network Configuration Enforcement (#1580)', () => {
  it('retrieves canonical network configuration with correct passphrase', () => {
    const cfg = getNetworkConfig();
    expect(cfg.networkPassphrase).toBeDefined();
    expect(cfg.networkPassphrase.length).toBeGreaterThan(10);
  });

  it('rejects subscription transaction construction if passphrase mismatches canonical network', async () => {
    const wrongPassphrase = 'Wrong Network Passphrase ; June 2020';

    await expect(
      buildSignAndSubmitSubscribe(
        {
          subscriber: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          merchant: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          amount: 100,
          interval: 86400,
        },
        'CCONTRACT',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrongPassphrase,
        'https://rpc',
      ),
    ).rejects.toThrow(/Network passphrase mismatch/);
  });

  it('rejects cancel transaction construction if passphrase mismatches canonical network', async () => {
    const wrongPassphrase = 'Completely Invalid Passphrase';

    await expect(
      buildSignAndSubmitCancel(
        {
          subscriber: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          merchant: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          amount: '100',
        },
        'CCONTRACT',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrongPassphrase,
        'https://rpc',
      ),
    ).rejects.toThrow(/Network passphrase mismatch/);
  });
});
