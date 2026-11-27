/**
 * useSimulateFeeExpiry.test.tsx
 *
 * Automated tests for fee estimate freshness and expiry refresh (Issue #1574):
 * - Fee estimate includes a freshness timestamp (estimatedAt) and expiry policy (ttlMs)
 * - Transitions to isExpired: true when expiry policy duration elapses
 * - refreshFee re-estimates fee and detects material fee changes
 */

import { renderHook, act } from '@testing-library/react';
import { useSimulateFee } from '@/hooks/useSimulateFee';

jest.mock('@stellar/stellar-sdk', () => {
  const SorobanRpc = {
    Server: jest.fn(),
    Api: {
      isSimulationError: jest.fn().mockReturnValue(false),
      isSimulationSuccess: jest.fn().mockReturnValue(true),
    },
  };

  class MockAddress {
    private addr: string;
    constructor(addr: string) { this.addr = addr; }
    toScVal() { return { type: 'Address', value: this.addr }; }
  }

  return {
    SorobanRpc,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'operation' }),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ type: 'transaction' }),
    })),
    BASE_FEE: '100',
    nativeToScVal: jest.fn().mockReturnValue({ type: 'ScVal' }),
    Address: MockAddress,
  };
});

const { SorobanRpc } = jest.requireMock('@stellar/stellar-sdk');

function makeSimSuccess(fee = '15000') {
  const resources = {
    instructions: () => 100_000,
    readBytes: () => 256,
    writeBytes: () => 128,
  };
  return {
    minResourceFee: fee,
    transactionData: {
      build: () => ({ resources: () => resources }),
    },
  };
}

describe('useSimulateFee Expiry & Pre-signing Refresh (#1574)', () => {
  const mockServer = {
    getAccount: jest.fn().mockResolvedValue({ id: 'GVALID', sequence: '1' }),
    simulateTransaction: jest.fn().mockResolvedValue(makeSimSuccess('15000')),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (SorobanRpc.Server as jest.Mock).mockReturnValue(mockServer);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('populates estimatedAt, expiresAt, and expires after ttlMs', async () => {
    const params = {
      subscriber: 'GA...',
      merchant: 'GB...',
      token: 'CA...',
      amount: 100,
      interval: 86400,
      formValid: true,
    };

    const { result } = renderHook(() =>
      useSimulateFee(params, 'https://rpc', 'CCONTRACT', 'Testnet Passphrase', 10_000),
    );

    // Advance 500ms debounce
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.status).toBe('success');
    expect(result.current.minResourceFee).toBe('15000');
    expect(result.current.estimatedAt).not.toBeNull();
    expect(result.current.expiresAt).toBe(result.current.estimatedAt! + 10_000);
    expect(result.current.isExpired).toBe(false);

    // Advance past TTL (10s)
    act(() => {
      jest.advanceTimersByTime(10_001);
    });

    expect(result.current.isExpired).toBe(true);
  });

  it('refreshFee imperatively re-estimates and detects changed fee before signing', async () => {
    const params = {
      subscriber: 'GA...',
      merchant: 'GB...',
      token: 'CA...',
      amount: 100,
      interval: 86400,
      formValid: true,
    };

    const { result } = renderHook(() =>
      useSimulateFee(params, 'https://rpc', 'CCONTRACT', 'Testnet Passphrase', 30_000),
    );

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.minResourceFee).toBe('15000');

    // Simulate network congestion fee surge
    mockServer.simulateTransaction.mockResolvedValueOnce(makeSimSuccess('35000'));

    let refreshOutcome!: Awaited<ReturnType<typeof result.current.refreshFee>>;
    await act(async () => {
      refreshOutcome = await result.current.refreshFee();
    });

    expect(refreshOutcome.changed).toBe(true);
    expect(refreshOutcome.previousFee).toBe('15000');
    expect(refreshOutcome.newFee).toBe('35000');
    expect(result.current.minResourceFee).toBe('35000');
    expect(result.current.isExpired).toBe(false);
  });
});
