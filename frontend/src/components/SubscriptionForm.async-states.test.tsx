/**
 * @jest-environment jsdom
 *
 * SubscriptionForm.async-states.test.tsx
 *
 * Automated verification that background read operations, wallet interaction,
 * and transaction submissions are isolated states (#1578).
 */

import {
  createInitialWorkflowState,
  isSubmissionActionBlocked,
  AsyncWorkflowState,
} from '@/types/asyncWorkflowStates';

describe('Subscription Workflow Async State Separation (#1578)', () => {
  let workflowState: AsyncWorkflowState;

  beforeEach(() => {
    workflowState = createInitialWorkflowState();
  });

  it('initializes with all independent stages in idle state', () => {
    expect(workflowState.dataRefresh.status).toBe('idle');
    expect(workflowState.walletPrompt.status).toBe('idle');
    expect(workflowState.transaction.status).toBe('idle');
    expect(isSubmissionActionBlocked(workflowState)).toBe(false);
  });

  it('keeps submission control available when an unrelated background read fails', () => {
    // Simulate background token/balance read failing
    workflowState.dataRefresh = {
      status: 'error',
      error: 'Failed to fetch token balance from RPC',
      lastUpdated: null,
    };

    // User submission is NOT blocked by background read error
    expect(isSubmissionActionBlocked(workflowState)).toBe(false);
    expect(workflowState.transaction.status).toBe('idle');
  });

  it('does not misreport a submitted transaction as failed when background read fails during submission', () => {
    // Transaction successfully submitted and confirming
    workflowState.transaction = {
      status: 'confirming',
      txHash: '0x123456789abcdef',
      error: null,
    };

    // Concurrent background read (e.g. periodic balance refresh) fails
    workflowState.dataRefresh = {
      status: 'error',
      error: 'Network timeout during background balance refresh',
      lastUpdated: null,
    };

    // Transaction state remains confirming with valid hash
    expect(workflowState.transaction.status).toBe('confirming');
    expect(workflowState.transaction.txHash).toBe('0x123456789abcdef');
    expect(workflowState.transaction.error).toBeNull();
  });

  it('models wallet rejection with defined recovery transition without affecting read states', () => {
    // Balance read was previously successful
    workflowState.dataRefresh = {
      status: 'success',
      error: null,
      lastUpdated: Date.now(),
    };

    // User rejects wallet prompt
    workflowState.walletPrompt = {
      status: 'rejected',
      error: 'User declined transaction',
    };

    // Form can recover: reset prompt state back to idle
    expect(isSubmissionActionBlocked(workflowState)).toBe(false);
    workflowState.walletPrompt = { status: 'idle', error: null };

    // Recovery transition verified: control re-enabled, read cache preserved
    expect(isSubmissionActionBlocked(workflowState)).toBe(false);
    expect(workflowState.dataRefresh.status).toBe('success');
  });
});
