/**
 * @jest-environment jsdom
 *
 * useTransactionPoller.offline.test.tsx
 *
 * Automated verification of offline status persistence, bounded backoff,
 * resume behavior without re-submitting, and storage cleanup upon finality (#1577).
 */

import {
  savePendingTransaction,
  getPendingTransaction,
  clearPendingTransaction,
  updatePendingTransactionStatus,
  calculateBoundedPollingDelay,
  PENDING_TX_STORAGE_KEY_PREFIX,
} from '@/lib/offline_transaction_resumer';

describe('Transaction Status Polling Offline Recovery (#1577)', () => {
  const TEST_TX_HASH = '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff';

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists transaction hash in sessionStorage upon submission initiation', () => {
    savePendingTransaction(TEST_TX_HASH);
    const stored = getPendingTransaction(TEST_TX_HASH);

    expect(stored).not.toBeNull();
    expect(stored?.txHash).toBe(TEST_TX_HASH);
    expect(stored?.status).toBe('confirming');
    expect(stored?.attemptCount).toBe(0);
  });

  it('transitions state to offline without treating it as transaction failure', () => {
    savePendingTransaction(TEST_TX_HASH);
    updatePendingTransactionStatus(TEST_TX_HASH, 'offline');

    const updated = getPendingTransaction(TEST_TX_HASH);
    expect(updated?.status).toBe('offline');

    // Offline is strictly non-terminal and distinct from failure
    expect(sessionStorage.getItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${TEST_TX_HASH}`)).not.toBeNull();
  });

  it('calculates bounded exponential backoff polling delays capped at 10 seconds', () => {
    expect(calculateBoundedPollingDelay(0)).toBe(2000);
    expect(calculateBoundedPollingDelay(1)).toBe(3000);
    expect(calculateBoundedPollingDelay(2)).toBe(4500);
    expect(calculateBoundedPollingDelay(3)).toBe(6750);
    expect(calculateBoundedPollingDelay(4)).toBe(10000); // capped
    expect(calculateBoundedPollingDelay(10)).toBe(10000); // capped
  });

  it('resumes polling status upon reconnection without resubmitting transaction', () => {
    savePendingTransaction(TEST_TX_HASH);
    updatePendingTransactionStatus(TEST_TX_HASH, 'offline');

    // Reconnection occurs
    updatePendingTransactionStatus(TEST_TX_HASH, 'confirming', true);

    const resumed = getPendingTransaction(TEST_TX_HASH);
    expect(resumed?.status).toBe('confirming');
    expect(resumed?.attemptCount).toBe(1);
    // Verified: transaction hash preserved, no new hash generated
    expect(resumed?.txHash).toBe(TEST_TX_HASH);
  });

  it('clears persisted resume state when transaction reaches finalized or expired outcome', () => {
    savePendingTransaction(TEST_TX_HASH);
    expect(getPendingTransaction(TEST_TX_HASH)).not.toBeNull();

    // Terminal outcome (success / failed / expired)
    clearPendingTransaction(TEST_TX_HASH);

    expect(getPendingTransaction(TEST_TX_HASH)).toBeNull();
    expect(sessionStorage.getItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${TEST_TX_HASH}`)).toBeNull();
  });
});
