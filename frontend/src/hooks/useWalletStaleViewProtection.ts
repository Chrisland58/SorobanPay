'use client';

/**
 * useWalletStaleViewProtection.ts
 *
 * Prevents stale asynchronous API responses from overwriting the active
 * wallet view when switching accounts or reconnecting (#1640).
 *
 * Problem:
 * If a slow network request is initiated for Account A, and the user switches
 * to Account B before Account A responds, an unshielded hook will update the
 * UI state with Account A's response after Account B is already active.
 *
 * Solution:
 * Uses a monotonically increasing request generation counter and active address
 * binding to guarantee that only responses matching the currently active wallet
 * address and newest generation token are accepted.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface ProtectedWalletState<T> {
  data: T | null;
  activeAddress: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useWalletStaleViewProtection<T>(
  activeAddress: string | null | undefined,
  fetchFn?: (address: string) => Promise<T>,
) {
  const [state, setState] = useState<ProtectedWalletState<T>>({
    data: null,
    activeAddress: activeAddress ?? null,
    isLoading: false,
    error: null,
  });

  const activeAddressRef = useRef<string | null>(activeAddress ?? null);
  const currentGenerationRef = useRef<number>(0);

  useEffect(() => {
    activeAddressRef.current = activeAddress ?? null;
  }, [activeAddress]);

  const executeGuardedFetch = useCallback(
    async (targetAddress: string, fetcher: () => Promise<T>): Promise<T | null> => {
      currentGenerationRef.current += 1;
      const generation = currentGenerationRef.current;

      setState((prev) => ({
        ...prev,
        activeAddress: targetAddress,
        isLoading: true,
        error: null,
      }));

      try {
        const result = await fetcher();

        // Check if the address or generation changed while request was in-flight
        if (
          generation === currentGenerationRef.current &&
          activeAddressRef.current === targetAddress
        ) {
          setState({
            data: result,
            activeAddress: targetAddress,
            isLoading: false,
            error: null,
          });
          return result;
        }
        return null;
      } catch (err: unknown) {
        if (
          generation === currentGenerationRef.current &&
          activeAddressRef.current === targetAddress
        ) {
          const msg = err instanceof Error ? err.message : String(err);
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: msg,
          }));
        }
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeAddress || !fetchFn) {
      setState({
        data: null,
        activeAddress: activeAddress ?? null,
        isLoading: false,
        error: null,
      });
      return;
    }

    void executeGuardedFetch(activeAddress, () => fetchFn(activeAddress));
  }, [activeAddress, fetchFn, executeGuardedFetch]);

  return {
    ...state,
    executeGuardedFetch,
    isCurrent: (address: string) => activeAddressRef.current === address,
  };
}
