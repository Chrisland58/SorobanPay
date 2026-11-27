/**
 * useSubmissionGuard.test.ts
 *
 * Automated tests for useSubmissionGuard hook (Issue #1573):
 * - Guarantees one intent produces at most one active transaction submission
 * - Rapid successive clicks / calls are rejected while prompt is unresolved
 * - Lock is held during transaction construction and wallet prompts
 * - Lock releases reliably on user signature rejection, network errors, and success
 */

import { renderHook, act } from '@testing-library/react';
import { useSubmissionGuard } from '@/hooks/useSubmissionGuard';

describe('useSubmissionGuard (#1573)', () => {
  it('initializes with isSubmitting false and activeIntentKey null', () => {
    const { result } = renderHook(() => useSubmissionGuard());
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.activeIntentKey).toBeNull();
  });

  it('acquires lock on first call and blocks duplicate submissions on rapid clicks', () => {
    const { result } = renderHook(() => useSubmissionGuard());

    let acquiredFirst = false;
    let acquiredSecond = false;
    let acquiredThird = false;

    act(() => {
      acquiredFirst = result.current.acquireLock('tx_1');
      acquiredSecond = result.current.acquireLock('tx_1');
      acquiredThird = result.current.acquireLock('tx_2');
    });

    expect(acquiredFirst).toBe(true);
    expect(acquiredSecond).toBe(false);
    expect(acquiredThird).toBe(false);
    expect(result.current.isSubmitting).toBe(true);
  });

  it('releases lock when releaseLock is called with matching intent key', () => {
    const { result } = renderHook(() => useSubmissionGuard());

    act(() => {
      result.current.acquireLock('tx_1');
    });
    expect(result.current.isSubmitting).toBe(true);

    act(() => {
      // Releasing with mismatched key should not release
      result.current.releaseLock('tx_other');
    });
    expect(result.current.isSubmitting).toBe(true);

    act(() => {
      // Releasing with matching key
      result.current.releaseLock('tx_1');
    });
    expect(result.current.isSubmitting).toBe(false);

    // Can acquire again after release
    let reacquired = false;
    act(() => {
      reacquired = result.current.acquireLock('tx_1');
    });
    expect(reacquired).toBe(true);
  });

  it('guardedSubmit executes function and releases lock upon completion', async () => {
    const { result } = renderHook(() => useSubmissionGuard());
    let executed = 0;

    let submitPromise: Promise<string | null>;
    act(() => {
      submitPromise = result.current.guardedSubmit(async () => {
        executed += 1;
        return 'success';
      }, 'tx_submit');
    });

    // Rapid second click while first is unresolved
    let secondResult: string | null = null;
    act(() => {
      result.current.guardedSubmit(async () => {
        executed += 1;
        return 'second';
      }, 'tx_submit').then((res) => {
        secondResult = res;
      });
    });

    const res = await submitPromise!;
    expect(res).toBe('success');
    expect(secondResult).toBeNull();
    expect(executed).toBe(1);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('guardedSubmit releases lock reliably when user rejects signature or error throws', async () => {
    const { result } = renderHook(() => useSubmissionGuard());

    let thrownError: Error | null = null;
    await act(async () => {
      try {
        await result.current.guardedSubmit(async () => {
          throw new Error('User declined transaction signature in Freighter');
        }, 'tx_fail');
      } catch (err) {
        thrownError = err as Error;
      }
    });

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain('User declined transaction signature');
    expect(result.current.isSubmitting).toBe(false);

    // Can immediately retry submission after failure
    let retried = false;
    await act(async () => {
      const retryResult = await result.current.guardedSubmit(async () => {
        retried = true;
        return 'ok';
      }, 'tx_fail');
      expect(retryResult).toBe('ok');
    });
    expect(retried).toBe(true);
  });
});
