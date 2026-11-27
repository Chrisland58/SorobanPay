import React from 'react';
import TxHashLink from './TxHashLink';
import {
  isFinalStage,
  isValidTxHash,
  type TransactionActivityEntry,
  type TransactionStage,
  useTransactionActivity,
} from '../context/TransactionActivityContext';

const STAGE_LABELS: Record<TransactionStage, string> = {
  submitting: 'Submitting',
  submitted: 'Submitted',
  confirming: 'Confirming',
  confirmed: 'Confirmed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STAGE_BADGE_CLASSES: Record<TransactionStage, string> = {
  submitting: 'bg-blue-100 text-blue-800',
  submitted: 'bg-indigo-100 text-indigo-800',
  confirming: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-700',
};

export function formatRelativeAge(createdAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - createdAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface TransactionActivityCenterProps {
  now?: number;
}

export const TransactionActivityCenter: React.FC<TransactionActivityCenterProps> = ({ now }) => {
  const { entries, pendingCount, dismissTransaction, clearFinalized } = useTransactionActivity();
  const hasFinalized = entries.some((entry) => isFinalStage(entry.stage));

  return (
    <section
      role="region"
      aria-label="Transaction Activity Center"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Transaction Activity</h2>
          {pendingCount > 0 && (
            <span
              data-testid="tx-activity-pending-count"
              className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
            >
              {pendingCount} pending
            </span>
          )}
        </div>
        {hasFinalized && (
          <button
            type="button"
            onClick={clearFinalized}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
          >
            Clear completed
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">No recent or pending transactions.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-live="polite">
          {entries.map((entry: TransactionActivityEntry) => {
            const finalized = isFinalStage(entry.stage);
            const stageLabel = STAGE_LABELS[entry.stage];
            const badgeClass = STAGE_BADGE_CLASSES[entry.stage];
            const ageText = formatRelativeAge(entry.createdAt, now);

            return (
              <li
                key={entry.id}
                data-testid={`tx-activity-item-${entry.id}`}
                className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{entry.label}</span>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`tx-activity-stage-${entry.id}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                    >
                      {stageLabel}
                    </span>
                    {finalized && (
                      <button
                        type="button"
                        onClick={() => dismissTransaction(entry.id)}
                        aria-label={`Dismiss ${entry.label}`}
                        className="text-xs text-slate-400 hover:text-slate-700"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span data-testid={`tx-activity-age-${entry.id}`}>{ageText}</span>
                  {isValidTxHash(entry.txHash) && (
                    <TxHashLink
                      txHash={entry.txHash}
                      network={entry.network === 'mainnet' ? 'mainnet' : 'testnet'}
                    />
                  )}
                </div>

                {entry.stage === 'failed' && entry.errorMessage && (
                  <p role="alert" className="text-xs text-rose-600">
                    {entry.errorMessage}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TransactionActivityCenter;
