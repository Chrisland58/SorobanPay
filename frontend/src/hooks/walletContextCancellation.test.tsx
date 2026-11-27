/**
 * @jest-environment jsdom
 *
 * walletContextCancellation.test.tsx
 *
 * Automated regression suite verifying that obsolete API requests are cancelled
 * and late responses cannot overwrite state when account or network changes (#1575).
 */

import {
  WalletContextRequestManager,
  WalletContext,
} from '@/lib/cancellable_request_manager';

describe('Wallet Context Request Cancellation Suite (#1575)', () => {
  let manager: WalletContextRequestManager;

  const ACCOUNT_A: WalletContext = { accountId: 'G_ACCOUNT_A', networkId: 'Testnet' };
  const ACCOUNT_B: WalletContext = { accountId: 'G_ACCOUNT_B', networkId: 'Testnet' };
  const MAINNET_A: WalletContext = { accountId: 'G_ACCOUNT_A', networkId: 'Mainnet' };

  beforeEach(() => {
    manager = new WalletContextRequestManager();
  });

  it('aborts and invalidates in-flight requests when account changes', () => {
    const sessionA = manager.beginRequest(ACCOUNT_A);
    expect(sessionA.controller.signal.aborted).toBe(false);

    // Switch account to Account B
    manager.switchContext(ACCOUNT_B);
    expect(sessionA.controller.signal.aborted).toBe(true);

    // Response from Account A arriving late is rejected
    const isValid = manager.isResponseValid(sessionA, ACCOUNT_B);
    expect(isValid).toBe(false);
  });

  it('prevents late responses from Account A from mutating state for Account B', async () => {
    let activeUiData = 'Initial State';
    let currentContext = ACCOUNT_A;

    // 1. Request started for Account A
    const sessionA = manager.beginRequest(currentContext);

    // 2. User immediately switches to Account B
    currentContext = ACCOUNT_B;
    const sessionB = manager.beginRequest(currentContext);

    // 3. Late response for Account A arrives with payload "Data For Account A"
    const lateDataA = 'Data For Account A';
    if (manager.isResponseValid(sessionA, currentContext)) {
      activeUiData = lateDataA;
    }

    // UI state must NOT be modified by Account A's late response
    expect(activeUiData).toBe('Initial State');

    // 4. Response for Account B arrives
    const validDataB = 'Data For Account B';
    if (manager.isResponseValid(sessionB, currentContext)) {
      activeUiData = validDataB;
    }

    expect(activeUiData).toBe('Data For Account B');
  });

  it('discards late responses when network changes from Testnet to Mainnet', () => {
    let currentContext = ACCOUNT_A;
    const sessionTestnet = manager.beginRequest(currentContext);

    // Switch network to Mainnet
    currentContext = MAINNET_A;
    manager.switchContext(currentContext);

    // Response from Testnet arrives late
    expect(manager.isResponseValid(sessionTestnet, currentContext)).toBe(false);
  });

  it('recognizes AbortError so cancellation does not surface as a user-facing error or retry', () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';

    const networkErr = new Error('Network connection failed');

    expect(WalletContextRequestManager.isCancellationError(abortErr)).toBe(true);
    expect(WalletContextRequestManager.isCancellationError(networkErr)).toBe(false);
  });
});
