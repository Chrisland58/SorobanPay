/**
 * useAccountBalanceStale.test.ts
 *
 * Automated tests for stale-data indicators in account/payment summaries (Issue #1581):
 * - Distinguishes 'current', 'stale', and 'unavailable' data freshness
 * - Retains last known balance during transient RPC outage instead of zeroing or setting null
 * - Successfully recovers freshness when network recovers
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAccountBalance } from '@/hooks/useAccountBalance';

jest.mock('@stellar/stellar-sdk', () => {
  const SorobanRpc = {
    Server: jest.fn(),
  };
  return { SorobanRpc };
});

const { SorobanRpc } = jest.requireMock('@stellar/stellar-sdk');

describe('useAccountBalance Stale Data Indicators (#1581)', () => {
  const mockServer = {
    getAccount: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (SorobanRpc.Server as jest.Mock).mockReturnValue(mockServer);
  });

  it('starts with dataFreshness "unavailable" before first load', async () => {
    mockServer.getAccount.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey: 'G_TEST_USER' }),
    );

    expect(result.current.dataFreshness).toBe('unavailable');
    expect(result.current.balance).toBeNull();
    expect(result.current.isStale).toBe(false);
  });

  it('marks dataFreshness as "current" upon successful balance fetch', async () => {
    mockServer.getAccount.mockResolvedValueOnce({
      balances: [{ asset_type: 'native', balance: '250.5000000' }],
    });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey: 'G_TEST_USER' }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.balance).toBe('250.5000000');
    expect(result.current.dataFreshness).toBe('current');
    expect(result.current.isStale).toBe(false);
    expect(result.current.lastUpdated).not.toBeNull();
  });

  it('preserves cached balance and sets dataFreshness="stale" when refresh fails', async () => {
    // 1. Initial success
    mockServer.getAccount.mockResolvedValueOnce({
      balances: [{ asset_type: 'native', balance: '250.5000000' }],
    });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey: 'G_TEST_USER' }),
    );

    await waitFor(() => {
      expect(result.current.balance).toBe('250.5000000');
    });

    // 2. Subsequent refresh triggers transient network error
    mockServer.getAccount.mockRejectedValueOnce(
      new Error('503 Service Unavailable: RPC connection timeout'),
    );

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Balance is STILL 250.5000000 (not wiped or zeroed!)
    expect(result.current.balance).toBe('250.5000000');
    expect(result.current.isStale).toBe(true);
    expect(result.current.dataFreshness).toBe('stale');
    expect(result.current.error).toContain('RPC connection timeout');

    // 3. Network recovers and refetch succeeds
    mockServer.getAccount.mockResolvedValueOnce({
      balances: [{ asset_type: 'native', balance: '260.0000000' }],
    });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.balance).toBe('260.0000000');
    expect(result.current.isStale).toBe(false);
    expect(result.current.dataFreshness).toBe('current');
    expect(result.current.error).toBeNull();
  });
});
