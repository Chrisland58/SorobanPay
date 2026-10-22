/**
 * WalletContext.test.tsx
 *
 * Tests wallet disconnect and reconnect flows:
 *  - state resets on disconnect
 *  - reconnect re-populates publicKey
 *  - errors are cleared on disconnect
 *  - useWallet throws outside provider
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { WalletProvider } from '@/context/WalletContext';
import { useWallet } from '@/hooks/useWallet';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/lib/wallet_manager', () => ({
  detectFreighter: jest.fn(),
  connectWallet:   jest.fn(),
  restoreWalletSession: jest.fn(),
}));

import * as walletManager from '@/lib/wallet_manager';

const mockDetect  = walletManager.detectFreighter as jest.Mock;
const mockConnect = walletManager.connectWallet   as jest.Mock;
const mockRestore = walletManager.restoreWalletSession as jest.Mock;

const WALLET_CACHE_KEY = 'sorobanpay_wallet_public_key';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ── Test component ────────────────────────────────────────────────────────────

function WalletConsumer() {
  const { publicKey, isConnecting, connectError, freighterInstalled, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="pk">{publicKey ?? 'null'}</span>
      <span data-testid="connecting">{String(isConnecting)}</span>
      <span data-testid="error">{connectError ?? 'null'}</span>
      <span data-testid="installed">{String(freighterInstalled)}</span>
      <button onClick={connect}    data-testid="connect-btn">connect</button>
      <button onClick={disconnect} data-testid="disconnect-btn">disconnect</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <WalletConsumer />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  mockRestore.mockResolvedValue(null);
});

describe('WalletContext – disconnect flow', () => {
  beforeEach(() => {
    mockDetect.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GPUBLICKEY123');
  });

  it('starts with publicKey null', () => {
    renderWithProvider();
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('sets publicKey after successful connect', async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });
    expect(screen.getByTestId('pk').textContent).toBe('GPUBLICKEY123');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBe(
      'GPUBLICKEY123',
    );
  });

  it('resets publicKey to null on disconnect', async () => {
    renderWithProvider();
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GPUBLICKEY123');

    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('null');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
  });

  it('clears connectError on disconnect', async () => {
    mockConnect.mockRejectedValueOnce(new Error('user rejected'));
    renderWithProvider();

    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('user rejected');

    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('null');
  });
});

describe('WalletContext – reconnect flow', () => {
  beforeEach(() => {
    mockDetect.mockResolvedValue(true);
  });

  it('allows reconnect after disconnect and updates publicKey', async () => {
    mockConnect
      .mockResolvedValueOnce('GFIRST')
      .mockResolvedValueOnce('GSECOND');

    renderWithProvider();

    // first connect
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GFIRST');

    // disconnect
    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('null');

    // reconnect with different key
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GSECOND');
  });

  it('shows reconnect prompt (connectError) when Freighter not installed', async () => {
    mockDetect.mockResolvedValue(false);
    renderWithProvider();

    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toContain('Freighter is not installed');
    expect(screen.getByTestId('installed').textContent).toBe('false');
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('resets error state and allows fresh connect after failed attempt', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce('GNEWKEY');

    renderWithProvider();

    // first attempt fails
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('denied');

    // second attempt succeeds — error should clear, key should populate
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('null');
    expect(screen.getByTestId('pk').textContent).toBe('GNEWKEY');
  });

  it('ignores a connect result that resolves after an explicit disconnect', async () => {
    const pendingConnect = deferred<string>();
    mockConnect.mockReturnValue(pendingConnect.promise);

    renderWithProvider();

    act(() => { screen.getByTestId('connect-btn').click(); });
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('connecting').textContent).toBe('false');

    await act(async () => { pendingConnect.resolve('GNEWKEY'); });

    expect(screen.getByTestId('pk').textContent).toBe('null');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
  });
});

describe('WalletContext – session persistence', () => {
  beforeEach(() => {
    mockDetect.mockResolvedValue(true);
  });

  it('restores a cached public key when Freighter still returns the same account', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GCACHED');
    mockRestore.mockResolvedValue('GCACHED');

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('pk').textContent).toBe('GCACHED');
    });
  });

  it('invalidates the cached key when Freighter returns a different account', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GOLDKEY');
    mockRestore.mockResolvedValue('GNEWKEY');

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('pk').textContent).toBe('null');
      expect(screen.getByTestId('error').textContent).toContain('account changed');
    });
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
  });

  it('drops the cached key when Freighter no longer has an active session', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GSTALE');
    mockRestore.mockResolvedValue(null);

    renderWithProvider();

    await waitFor(() => {
      expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
    });
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('stays disconnected and drops the cache when the silent restore fails', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GSTALE');
    mockRestore.mockRejectedValue(new Error('extension unavailable'));

    renderWithProvider();

    await waitFor(() => {
      expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
    });
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('does not attempt a silent restore when no key is cached', async () => {
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('installed').textContent).toBe('true');
    });
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('clears the cached key when Freighter is unavailable on mount', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GSTALE');
    mockDetect.mockResolvedValue(false);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('not installed');
    });
    expect(mockRestore).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('does not let a pending restore overwrite an explicit connect', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GOLDKEY');
    const restore = deferred<string | null>();
    mockRestore.mockReturnValue(restore.promise);
    mockConnect.mockResolvedValue('GNEWKEY');

    renderWithProvider();
    await waitFor(() => expect(mockRestore).toHaveBeenCalled());

    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });
    expect(screen.getByTestId('pk').textContent).toBe('GNEWKEY');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBe('GNEWKEY');

    await act(async () => {
      restore.resolve('GOLDKEY');
    });

    expect(screen.getByTestId('pk').textContent).toBe('GNEWKEY');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBe('GNEWKEY');
  });

  it('does not reconnect after an explicit disconnect while a restore is pending', async () => {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, 'GOLDKEY');
    const restore = deferred<string | null>();
    mockRestore.mockReturnValue(restore.promise);

    renderWithProvider();
    await waitFor(() => expect(mockRestore).toHaveBeenCalled());

    act(() => {
      screen.getByTestId('disconnect-btn').click();
    });
    expect(screen.getByTestId('pk').textContent).toBe('null');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();

    await act(async () => {
      restore.resolve('GOLDKEY');
    });

    expect(screen.getByTestId('pk').textContent).toBe('null');
    expect(window.sessionStorage.getItem(WALLET_CACHE_KEY)).toBeNull();
  });
});

describe('useWallet – outside provider', () => {
  it('throws a descriptive error when used outside WalletProvider', () => {
    // Suppress React's error boundary noise in test output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<WalletConsumer />)).toThrow(/WalletProvider/);
    spy.mockRestore();
  });
});
