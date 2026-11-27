'use client';

/**
 * useSubmissionGuard.ts
 *
 * Request-scoped submission guard hook to prevent duplicate transaction submissions
 * while wallet prompts or network transactions are unresolved.
 *
 * Features:
 * - Guarantees that one user intent produces at most one active transaction submission.
 * - Remains locked through transaction construction, wallet prompt approval, and confirmation.
 * - Releases reliably on every failure path (user signature rejection, network error, timeout).
 * - Thread/event-safe against rapid successive clicks.
 *
 * Issue: #1573
 */

import { useRef, useState, useCallback, useEffect } from 'react';

export interface UseSubmissionGuardReturn {
  /** True when a submission or wallet prompt is currently unresolved. */
  isSubmitting: boolean;
  /** Active intent or transaction key currently holding the lock, or null. */
  activeIntentKey: string | null;
  /**
   * Attempt to acquire the submission lock for a specific intent key.
   * Returns true if lock was acquired, false if a submission is already active.
   */
  acquireLock: (intentKey?: string) => boolean;
  /**
   * Release the submission lock reliably on completion, cancellation, or error.
   */
  releaseLock: (intentKey?: string) => void;
  /**
   * Helper that wraps an async submission function with the submission guard.
   * If an unresolved prompt or submission is already active, subsequent calls are dropped.
   */
  guardedSubmit: <T>(fn: () => Promise<T>, intentKey?: string) => Promise<T | null>;
}

export function useSubmissionGuard(): UseSubmissionGuardReturn {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const activeIntentRef = useRef<string | null>(null);
  const isLockedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isLockedRef.current = false;
      activeIntentRef.current = null;
    };
  }, []);

  const acquireLock = useCallback((intentKey = 'default_intent'): boolean => {
    if (isLockedRef.current) {
      return false;
    }
    isLockedRef.current = true;
    activeIntentRef.current = intentKey;
    if (isMountedRef.current) {
      setIsSubmitting(true);
    }
    return true;
  }, []);

  const releaseLock = useCallback((intentKey?: string): void => {
    // If a specific intentKey is provided, only release if it matches the active one
    if (intentKey && activeIntentRef.current && activeIntentKeyMatches(activeIntentRef.current, intentKey) === false) {
      return;
    }
    isLockedRef.current = false;
    activeIntentRef.current = null;
    if (isMountedRef.current) {
      setIsSubmitting(false);
    }
  }, []);

  const guardedSubmit = useCallback(
    async <T>(fn: () => Promise<T>, intentKey = 'default_intent'): Promise<T | null> => {
      if (!acquireLock(intentKey)) {
        return null;
      }
      try {
        const result = await fn();
        return result;
      } finally {
        releaseLock(intentKey);
      }
    },
    [acquireLock, releaseLock],
  );

  return {
    isSubmitting,
    activeIntentKey: activeIntentRef.current,
    acquireLock,
    releaseLock,
    guardedSubmit,
  };
}

function activeIntentKeyMatches(active: string, candidate: string): boolean {
  return active === candidate;
}
