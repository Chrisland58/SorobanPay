/**
 * offline_transaction_resumer.ts
 *
 * Utilities and state machine for persisting and resuming transaction status checks
 * across offline network disruptions (#1577).
 */

export const PENDING_TX_STORAGE_KEY_PREFIX = 'sorobanpay_pending_tx_';

export interface PendingTransactionRecord {
  txHash: string;
  submittedAt: number;
  lastPolledAt: number;
  status: 'confirming' | 'offline';
  attemptCount: number;
}

export function savePendingTransaction(txHash: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  const record: PendingTransactionRecord = {
    txHash,
    submittedAt: Date.now(),
    lastPolledAt: Date.now(),
    status: 'confirming',
    attemptCount: 0,
  };
  window.sessionStorage.setItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${txHash}`, JSON.stringify(record));
}

export function getPendingTransaction(txHash: string): PendingTransactionRecord | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  const raw = window.sessionStorage.getItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${txHash}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingTransactionRecord;
  } catch {
    return null;
  }
}

export function clearPendingTransaction(txHash: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  window.sessionStorage.removeItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${txHash}`);
}

export function updatePendingTransactionStatus(
  txHash: string,
  status: 'confirming' | 'offline',
  incrementAttempt = false,
): void {
  const existing = getPendingTransaction(txHash);
  if (!existing) return;
  existing.status = status;
  existing.lastPolledAt = Date.now();
  if (incrementAttempt) {
    existing.attemptCount += 1;
  }
  window.sessionStorage.setItem(`${PENDING_TX_STORAGE_KEY_PREFIX}${txHash}`, JSON.stringify(existing));
}

/**
 * Calculates next bounded backoff interval for polling.
 * Initial: 2000ms, Multiplier: 1.5x, Cap: 10000ms.
 */
export function calculateBoundedPollingDelay(attempt: number): number {
  const initial = 2000;
  const factor = 1.5;
  const maxDelay = 10000;
  return Math.min(Math.round(initial * Math.pow(factor, attempt)), maxDelay);
}
