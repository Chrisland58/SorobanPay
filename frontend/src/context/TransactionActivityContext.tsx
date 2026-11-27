import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type TransactionStage =
  | 'submitting'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface TransactionActivityEntry {
  id: string;
  label: string;
  stage: TransactionStage;
  createdAt: number;
  updatedAt: number;
  finalizedAt?: number;
  txHash?: string;
  network?: 'testnet' | 'mainnet';
  errorMessage?: string;
}

export const TX_ACTIVITY_STORAGE_KEY = 'sorobanpay:tx_activity_v1';
export const FINALIZED_RETENTION_MS = 15 * 60 * 1000; // 15 minutes
export const STALE_PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_RETAINED_ENTRIES = 25;

const FINAL_STAGES: ReadonlySet<TransactionStage> = new Set([
  'confirmed',
  'failed',
  'cancelled',
]);

export function isFinalStage(stage: TransactionStage): boolean {
  return FINAL_STAGES.has(stage);
}

export function isValidTxHash(txHash?: string): txHash is string {
  return typeof txHash === 'string' && /^[a-fA-F0-9]{64}$/.test(txHash);
}

export function applyRetentionPolicy(
  entries: TransactionActivityEntry[],
  now: number = Date.now(),
): TransactionActivityEntry[] {
  const retained = entries.filter((entry) => {
    if (isFinalStage(entry.stage)) {
      const finalizedAt = entry.finalizedAt ?? entry.updatedAt ?? entry.createdAt;
      return now - finalizedAt < FINALIZED_RETENTION_MS;
    }
    return now - entry.updatedAt < STALE_PENDING_TTL_MS;
  });

  // Sort newest first and cap total retained entries
  return retained
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RETAINED_ENTRIES);
}

function readStoredEntries(now: number): TransactionActivityEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(TX_ACTIVITY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const valid = parsed.filter(
      (item): item is TransactionActivityEntry =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.stage === 'string' &&
        typeof item.createdAt === 'number' &&
        typeof item.updatedAt === 'number',
    );
    return applyRetentionPolicy(valid, now);
  } catch {
    return [];
  }
}

function writeStoredEntries(entries: TransactionActivityEntry[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(TX_ACTIVITY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export interface UpsertTransactionInput {
  id: string;
  label: string;
  stage: TransactionStage;
  txHash?: string;
  network?: 'testnet' | 'mainnet';
  errorMessage?: string;
  createdAt?: number;
}

export interface TransactionActivityContextValue {
  entries: TransactionActivityEntry[];
  pendingCount: number;
  upsertTransaction: (input: UpsertTransactionInput) => void;
  dismissTransaction: (id: string) => void;
  clearFinalized: () => void;
  pruneExpired: (now?: number) => void;
}

const TransactionActivityContext = createContext<TransactionActivityContextValue | undefined>(
  undefined,
);

export const TransactionActivityProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [entries, setEntries] = useState<TransactionActivityEntry[]>(() =>
    readStoredEntries(Date.now()),
  );

  useEffect(() => {
    writeStoredEntries(entries);
  }, [entries]);

  const upsertTransaction = useCallback((input: UpsertTransactionInput) => {
    const now = Date.now();
    setEntries((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          item.id === input.id ||
          (isValidTxHash(input.txHash) && item.txHash === input.txHash),
      );

      const finalized = isFinalStage(input.stage);
      let next: TransactionActivityEntry[];

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const updated: TransactionActivityEntry = {
          ...existing,
          label: input.label ?? existing.label,
          stage: input.stage,
          updatedAt: now,
          finalizedAt: finalized ? (existing.finalizedAt ?? now) : undefined,
          txHash: input.txHash ?? existing.txHash,
          network: input.network ?? existing.network,
          errorMessage: input.errorMessage,
        };
        next = prev.map((item, idx) => (idx === existingIndex ? updated : item));
      } else {
        const created: TransactionActivityEntry = {
          id: input.id,
          label: input.label,
          stage: input.stage,
          createdAt: input.createdAt ?? now,
          updatedAt: now,
          finalizedAt: finalized ? now : undefined,
          txHash: input.txHash,
          network: input.network,
          errorMessage: input.errorMessage,
        };
        next = [created, ...prev];
      }

      return applyRetentionPolicy(next, now);
    });
  }, []);

  const dismissTransaction = useCallback((id: string) => {
    setEntries((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearFinalized = useCallback(() => {
    setEntries((prev) => prev.filter((item) => !isFinalStage(item.stage)));
  }, []);

  const pruneExpired = useCallback((now: number = Date.now()) => {
    setEntries((prev) => applyRetentionPolicy(prev, now));
  }, []);

  const pendingCount = useMemo(
    () => entries.filter((item) => !isFinalStage(item.stage)).length,
    [entries],
  );

  const value = useMemo(
    () => ({
      entries,
      pendingCount,
      upsertTransaction,
      dismissTransaction,
      clearFinalized,
      pruneExpired,
    }),
    [entries, pendingCount, upsertTransaction, dismissTransaction, clearFinalized, pruneExpired],
  );

  return (
    <TransactionActivityContext.Provider value={value}>
      {children}
    </TransactionActivityContext.Provider>
  );
};

export function useTransactionActivity(): TransactionActivityContextValue {
  const ctx = useContext(TransactionActivityContext);
  if (!ctx) {
    throw new Error('useTransactionActivity must be used within a TransactionActivityProvider');
  }
  return ctx;
}
