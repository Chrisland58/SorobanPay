import { renderHook, act } from '@testing-library/react';
import { useWalletStaleViewProtection } from './useWalletStaleViewProtection';

describe('useWalletStaleViewProtection (#1640)', () => {
  it('updates state when fetch completes for active wallet', async () => {
    const fetcher = jest.fn().mockResolvedValue({ balance: '100' });

    const { result } = renderHook(() =>
      useWalletStaleViewProtection('GACCOUNT_A', fetcher),
    );

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeAddress).toBe('GACCOUNT_A');
    expect(result.current.data).toEqual({ balance: '100' });
  });

  it('drops stale API responses when user switches to a different wallet before response arrives', async () => {
    let resolveAccountA: (val: any) => void;
    let resolveAccountB: (val: any) => void;

    const fetcher = jest.fn().mockImplementation((addr: string) => {
      if (addr === 'GACCOUNT_A') {
        return new Promise((res) => {
          resolveAccountA = res;
        });
      }
      return new Promise((res) => {
        resolveAccountB = res;
      });
    });

    let currentAddress = 'GACCOUNT_A';
    const { result, rerender } = renderHook(() =>
      useWalletStaleViewProtection(currentAddress, fetcher),
    );

    expect(result.current.activeAddress).toBe('GACCOUNT_A');
    expect(result.current.data).toBeNull();

    // User switches to Account B while Account A is still pending
    currentAddress = 'GACCOUNT_B';
    rerender();

    // Account B resolves first
    await act(async () => {
      resolveAccountB({ balance: '250', owner: 'B' });
      await Promise.resolve();
    });

    expect(result.current.activeAddress).toBe('GACCOUNT_B');
    expect(result.current.data).toEqual({ balance: '250', owner: 'B' });

    // Now slow Account A response finally arrives
    await act(async () => {
      resolveAccountA({ balance: '999', owner: 'A' });
      await Promise.resolve();
    });

    // CRITICAL: Account B view must NOT be replaced with stale Account A data
    expect(result.current.activeAddress).toBe('GACCOUNT_B');
    expect(result.current.data).toEqual({ balance: '250', owner: 'B' });
  });

  it('resets state when wallet is disconnected', async () => {
    const fetcher = jest.fn().mockResolvedValue({ balance: '50' });

    let currentAddress: string | null = 'GACCOUNT_CONNECTED';
    const { result, rerender } = renderHook(() =>
      useWalletStaleViewProtection(currentAddress, fetcher),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data).toEqual({ balance: '50' });

    // Disconnect
    currentAddress = null;
    rerender();

    expect(result.current.activeAddress).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
