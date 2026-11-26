/**
 * asyncWorkflowStates.ts
 *
 * Distinct lifecycle states for asynchronous frontend workflows (#1578).
 * Separates background data reads, wallet signature prompts, and on-chain
 * transaction submissions so unrelated read errors never freeze write forms
 * or misreport transaction status.
 */

export type ReadOperationStatus = 'idle' | 'loading' | 'success' | 'error';
export type WalletPromptStatus = 'idle' | 'prompting' | 'approved' | 'rejected' | 'timeout';
export type TransactionExecutionStatus = 'idle' | 'simulating' | 'submitting' | 'confirming' | 'success' | 'failed';

export interface AsyncWorkflowState {
  /** Background data refresh status (e.g. balance check, token info, fee simulation) */
  dataRefresh: {
    status: ReadOperationStatus;
    error: string | null;
    lastUpdated: number | null;
  };

  /** Interactive browser extension signature status */
  walletPrompt: {
    status: WalletPromptStatus;
    error: string | null;
  };

  /** On-chain transaction execution and RPC submission status */
  transaction: {
    status: TransactionExecutionStatus;
    txHash: string | null;
    error: string | null;
  };
}

export function createInitialWorkflowState(): AsyncWorkflowState {
  return {
    dataRefresh: { status: 'idle', error: null, lastUpdated: null },
    walletPrompt: { status: 'idle', error: null },
    transaction: { status: 'idle', txHash: null, error: null },
  };
}

/**
 * Evaluates whether the submission action is blocked based on individual stage states.
 * Form submission is only blocked if a write operation or prompt is actively in flight.
 * Background read errors (e.g. non-critical token info reload) DO NOT block submission.
 */
export function isSubmissionActionBlocked(state: AsyncWorkflowState): boolean {
  const isPrompting = state.walletPrompt.status === 'prompting';
  const isSubmitting =
    state.transaction.status === 'simulating' ||
    state.transaction.status === 'submitting' ||
    state.transaction.status === 'confirming';

  return isPrompting || isSubmitting;
}
