/**
 * rpc_fallback.test.ts
 *
 * Unit tests for bounded RPC endpoint failover for idempotent read requests (#1569).
 */

import {
  RpcFallbackManager,
  sanitizeEndpointUrl,
  sanitizeErrorMessage,
  IneligibleForFailoverError,
  RpcFailoverError,
  type IdempotentReadOperation,
} from './rpc_fallback';

describe('RPC Failover for Safe Reads', () => {
  describe('sanitizeEndpointUrl & sanitizeErrorMessage', () => {
    it('strips basic auth credentials from endpoint URLs', () => {
      const raw = 'https://admin:secretPassword@stellar-rpc.example.com/soroban';
      const sanitized = sanitizeEndpointUrl(raw);
      expect(sanitized).toBe('https://stellar-rpc.example.com/soroban');
      expect(sanitized).not.toContain('admin');
      expect(sanitized).not.toContain('secretPassword');
    });

    it('redacts sensitive query parameter keys and tokens', () => {
      const raw = 'https://rpc.example.com/soroban?apiKey=ghp_secretToken12345&mode=test';
      const sanitized = sanitizeEndpointUrl(raw);
      expect(sanitized).toContain('apiKey=%5BREDACTED%5D');
      expect(sanitized).not.toContain('ghp_secretToken12345');
      expect(sanitized).toContain('mode=test');
    });

    it('redacts path-based API keys', () => {
      const raw = 'https://mainnet.stellar.validationcloud.io/v1/abc123xyz987secret/soroban';
      const sanitized = sanitizeEndpointUrl(raw);
      expect(sanitized).toContain('/v1/[REDACTED]');
      expect(sanitized).not.toContain('abc123xyz987secret');
    });

    it('sanitizes embedded URLs in error messages', () => {
      const rawMsg = 'Failed to connect to https://user:pass@rpc.example.com/v1: ECONNREFUSED';
      const sanitized = sanitizeErrorMessage(rawMsg);
      expect(sanitized).not.toContain('user:pass@');
      expect(sanitized).toContain('https://rpc.example.com/v1');
    });
  });

  describe('Idempotency enforcement', () => {
    it('rejects non-idempotent operations like sendTransaction', async () => {
      const manager = new RpcFallbackManager({
        primary: 'https://primary-rpc.example.com',
        fallbacks: ['https://fallback-rpc.example.com'],
      });

      await expect(
        manager.executeSafeRead('sendTransaction' as unknown as IdempotentReadOperation, async () => {
          return { status: 'PENDING' };
        }),
      ).rejects.toThrow(IneligibleForFailoverError);
    });

    it('allows valid idempotent read operations', async () => {
      const manager = new RpcFallbackManager({
        primary: 'https://primary-rpc.example.com',
        fallbacks: ['https://fallback-rpc.example.com'],
      });

      const res = await manager.executeSafeRead('getLatestLedger', async () => {
        return { sequence: 12345 };
      });

      expect(res.data).toEqual({ sequence: 12345 });
      expect(res.usedEndpoint).toBe('https://primary-rpc.example.com');
      expect(res.retries).toBe(0);
    });
  });

  describe('Bounded failover policy and error observability', () => {
    it('fails over to secondary endpoint when primary fails', async () => {
      const manager = new RpcFallbackManager({
        primary: 'https://primary.example.com',
        fallbacks: ['https://secondary.example.com'],
      });

      let callCount = 0;
      const res = await manager.executeSafeRead('getAccount', async (server) => {
        callCount++;
        if (server.serverURL.toString().includes('primary')) {
          throw new Error('Connection reset by peer');
        }
        return { id: 'GABC123', sequence: '1' };
      });

      expect(callCount).toBe(2);
      expect(res.usedEndpoint).toBe('https://secondary.example.com');
      expect(res.retries).toBe(1);
      expect(res.attempts).toHaveLength(2);
      expect(res.attempts[0].success).toBe(false);
      expect(res.attempts[0].endpoint).toBe('https://primary.example.com');
      expect(res.attempts[1].success).toBe(true);
      expect(res.attempts[1].endpoint).toBe('https://secondary.example.com');
    });

    it('throws RpcFailoverError with observable sanitized endpoint and reason when all fail', async () => {
      const manager = new RpcFallbackManager({
        primary: 'https://apiKey123@primary.example.com/v1',
        fallbacks: ['https://secondary.example.com?token=secretPass456'],
      });

      try {
        await manager.executeSafeRead('getEvents', async () => {
          throw new Error('503 Service Unavailable');
        });
        fail('Expected RpcFailoverError to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RpcFailoverError);
        const failoverErr = err as RpcFailoverError;

        // Observable endpoint and failure reason
        expect(failoverErr.selectedEndpoint).toBe('https://secondary.example.com/?token=%5BREDACTED%5D');
        expect(failoverErr.finalFailureReason).toContain('503 Service Unavailable');
        expect(failoverErr.attempts).toHaveLength(2);

        // Ensure credentials are NOT leaked in error properties
        expect(failoverErr.message).not.toContain('apiKey123');
        expect(failoverErr.message).not.toContain('secretPass456');
        expect(failoverErr.selectedEndpoint).not.toContain('secretPass456');
      }
    });

    it('times out and fails over if an endpoint exceeds requestTimeoutMs', async () => {
      const manager = new RpcFallbackManager({
        primary: 'https://slow-rpc.example.com',
        fallbacks: ['https://fast-rpc.example.com'],
        requestTimeoutMs: 50,
      });

      const res = await manager.executeSafeRead('getHealth', async (server) => {
        if (server.serverURL.toString().includes('slow')) {
          await new Promise((r) => setTimeout(r, 200));
          return { status: 'healthy' };
        }
        return { status: 'healthy-fast' };
      });

      expect(res.usedEndpoint).toBe('https://fast-rpc.example.com');
      expect(res.attempts[0].error).toContain('timed out');
    });
  });
});
