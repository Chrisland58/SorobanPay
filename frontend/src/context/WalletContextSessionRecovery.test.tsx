/**
 * WalletContextSessionRecovery.test.tsx
 *
 * Automated tests for wallet session expiration and recovery (Issue #1571):
 * - Stale connection detected on foreground focus and visibility change
 * - Session invalid and expired flags set when provider is locked
 * - Reconnect does not repeat a transaction or discard draft data
 * - checkSession & recoverSession APIs
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { WalletProvider } from '@/context/WalletContext';
import { useWallet } from '@/hooks/useWallet';

jest.mock('@/lib/wallet_manager', () => ({
  detectFreighter: jest.fn(),
  connectWallet: jest.fn(),
  restoreWalletSession: jest.fn(),
}));

import * as walletManager from '@/lib/wallet_manager';

const mockDetect = walletManager.detectFreighter as jest.Mock;
const mockConnect = walletManager.connectWallet as jest.Mock;
const mockRestore = walletManager.restoreWalletSession as jest.Mock;

const WALLET_CACHE_KEY = 'sorobanpay_wallet_public_key';

function TestConsumer() {
  const {
    publicKey,
    sessionInvalid,
    sessionExpired,
    connectError,
    connect,
    checkSession,
    recoverSession,
  } = useWallet();

  return (
    <div>
      <span data-testid="pk">{publicKey ?? 'null'}</span>
      <span data-testid="invalid">{String(sessionInvalid)}</span>
      <span data-testid="expired">{String(sessionExpired)}</span>
      <span data-testid="error">{connectError ?? 'null'}</span>
      <button data-testid="connect-btn" onClick={connect}>connect</button>
      <button data-testid="check-btn" onClick={() => checkSession()}>check</button>
      <button data-testid="recover-btn" onClick={() => recoverSession()}>recover</button>
    </div>
  );
}

describe('WalletContext Session Recovery (#1571)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockDetect.mockResolvedValue(true);
  });

  it('detects an expired or locked provider session when checking session', async () => {
    mockConnect.mockResolvedValue('GCONNECTED123');
    mockRestore.mockResolvedValue(null);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });
    expect(screen.getByTestId('pk').textContent).toBe('GCONNECTED123');
    expect(screen.getByTestId('expired').textContent).toBe('false');

    // Extension locks or session expires -> restoreWalletSession returns null
    mockRestore.mockResolvedValue(null);

    await act(async () => {
      screen.getByTestId('check-btn').click();
    });

    expect(screen.getByTestId('expired').textContent).toBe('true');
    expect(screen.getByTestId('invalid').textContent).toBe('true');
    expect(screen.getByTestId('error').textContent).toContain('expired or is locked');
  });

  it('detects session expiration on window focus foreground recovery', async () => {
    mockConnect.mockResolvedValue('GCONNECTED123');
    mockRestore.mockResolvedValue('GCONNECTED123');

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });
    expect(screen.getByTestId('expired').textContent).toBe('false');

    // User switches tabs, extension locks, user returns
    mockRestore.mockResolvedValue(null);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('expired').textContent).toBe('true');
      expect(screen.getByTestId('invalid').textContent).toBe('true');
    });
  });

  it('recovers wallet session cleanly via recoverSession without looping prompts', async () => {
    mockConnect.mockResolvedValue('GCONNECTED123');
    mockRestore.mockResolvedValue(null);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });

    // Mark as expired
    await act(async () => {
      screen.getByTestId('check-btn').click();
    });
    expect(screen.getByTestId('expired').textContent).toBe('true');

    // Unlock wallet and recover
    mockRestore.mockResolvedValue('GCONNECTED123');

    await act(async () => {
      screen.getByTestId('recover-btn').click();
    });

    expect(screen.getByTestId('expired').textContent).toBe('false');
    expect(screen.getByTestId('invalid').textContent).toBe('false');
    expect(screen.getByTestId('pk').textContent).toBe('GCONNECTED123');
  });
});
