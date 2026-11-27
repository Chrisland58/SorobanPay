/**
 * transactionTelemetry.test.ts
 *
 * Automated tests for request-scoped transaction lifecycle telemetry (Issue #1579):
 * - Generates non-sensitive correlation ID
 * - Emits lifecycle events: build -> simulate -> sign -> submit -> confirm -> error
 * - Strips secrets, private keys, seed phrases, and personal data
 * - Respects configuration enablement and sampling
 */

import {
  createTransactionTelemetry,
  configureTelemetry,
  resetTelemetryConfig,
  type TransactionLifecycleEvent,
} from './transaction_telemetry';

describe('Transaction Lifecycle Telemetry (#1579)', () => {
  beforeEach(() => {
    resetTelemetryConfig();
  });

  it('generates non-sensitive correlation ID and emits lifecycle stages', () => {
    const emitted: TransactionLifecycleEvent[] = [];
    configureTelemetry({
      enabled: true,
      sampleRate: 1.0,
      sink: (evt) => emitted.push(evt),
    });

    const telemetry = createTransactionTelemetry('subscribe', 'testnet');
    expect(telemetry.correlationId).toMatch(/^corr_\d+_[a-z0-9]+$/);

    telemetry.emit('build', { metadata: { merchant: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } });
    telemetry.emit('simulate');
    telemetry.emit('sign');
    telemetry.emit('submit', { txHash: 'tx_abc123' });
    telemetry.emit('confirm', { txHash: 'tx_abc123' });

    expect(emitted.length).toBe(5);
    expect(emitted[0].stage).toBe('build');
    expect(emitted[1].stage).toBe('simulate');
    expect(emitted[2].stage).toBe('sign');
    expect(emitted[3].stage).toBe('submit');
    expect(emitted[4].stage).toBe('confirm');
  });

  it('strips private keys and secret values from metadata', () => {
    const emitted: TransactionLifecycleEvent[] = [];
    configureTelemetry({
      enabled: true,
      sink: (evt) => emitted.push(evt),
    });

    const telemetry = createTransactionTelemetry('subscribe', 'testnet');
    telemetry.emit('build', {
      metadata: {
        safeField: 'ok',
        secretKey: 'S_SECRET_PRIVATE_KEY_DO_NOT_LOG',
        privateSeed: 'my seed phrase',
        bearerToken: 'token123',
        merchantAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });

    const meta = emitted[0].metadata;
    expect(meta?.safeField).toBe('ok');
    expect(meta?.secretKey).toBeUndefined();
    expect(meta?.privateSeed).toBeUndefined();
    expect(meta?.bearerToken).toBeUndefined();
    expect(meta?.merchantAddress).toBe('GBBBBBBB...BBBBBBBB'); // Truncated/redacted
  });

  it('disables emissions when telemetry is turned off', () => {
    const emitted: TransactionLifecycleEvent[] = [];
    configureTelemetry({
      enabled: false,
      sink: (evt) => emitted.push(evt),
    });

    const telemetry = createTransactionTelemetry('subscribe', 'testnet');
    const result = telemetry.emit('build');

    expect(result).toBeNull();
    expect(emitted.length).toBe(0);
  });
});
