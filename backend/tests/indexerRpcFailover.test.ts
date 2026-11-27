import {
  RpcProviderPool,
  redactRpcUrl,
} from '../src/services/rpcProviderPool';

describe('RpcProviderPool & Bounded Failover (#1590)', () => {
  it('redacts sensitive parameters from RPC URLs', () => {
    const raw = 'https://user:secretpass@rpc.stellar.org/soroban?apiKey=sk_live_12345&foo=bar';
    const redacted = redactRpcUrl(raw);

    expect(redacted).not.toContain('secretpass');
    expect(redacted).not.toContain('sk_live_12345');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('foo=bar');
  });

  it('executes successfully on primary endpoint when available', async () => {
    const pool = new RpcProviderPool({
      endpoints: ['https://rpc1.stellar.org', 'https://rpc2.stellar.org'],
    });

    const mockOp = jest.fn().mockResolvedValue({ events: [] });
    const result = await pool.executeWithFailover(mockOp);

    expect(result).toEqual({ events: [] });
    expect(mockOp).toHaveBeenCalledTimes(1);
    const [_, endpoint] = mockOp.mock.calls[0];
    expect(endpoint).toBe('https://rpc1.stellar.org');
  });

  it('fails over to secondary endpoint when primary throws error', async () => {
    const pool = new RpcProviderPool({
      endpoints: ['https://failing-rpc.stellar.org', 'https://healthy-rpc.stellar.org'],
    });

    const mockOp = jest.fn().mockImplementation((server, url) => {
      if (url.includes('failing-rpc')) {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve({ events: ['event1'] });
    });

    const result = await pool.executeWithFailover(mockOp);

    expect(result).toEqual({ events: ['event1'] });
    expect(mockOp).toHaveBeenCalledTimes(2);

    const statuses = pool.getEndpointStatuses();
    const failingStatus = statuses.find((s) => s.url.includes('failing-rpc'));
    expect(failingStatus?.consecutiveFailures).toBe(1);
  });

  it('throws and preserves checkpoint integrity when all endpoints fail', async () => {
    const pool = new RpcProviderPool({
      endpoints: ['https://rpc-a.org', 'https://rpc-b.org'],
      maxRetries: 2,
    });

    const mockOp = jest.fn().mockRejectedValue(new Error('HTTP 503 Service Unavailable'));

    await expect(pool.executeWithFailover(mockOp)).rejects.toThrow(
      /All RPC provider endpoints failed after 2 attempts/i,
    );

    expect(mockOp).toHaveBeenCalledTimes(2);
  });
});
