'use client';

/**
 * SubscriptionCard.tsx
 *
 * Displays a single active subscription for the subscriber dashboard.
 * Shows: merchant address, token, amount, interval, next payment date.
 * Provides a Cancel button that triggers the cancel() contract call with
 * optimistic UI — immediately marks the card as cancelled while awaiting
 * on-chain confirmation.
 *
 * Dashboard feature – subscriber view
 */

import { useState, useCallback, useEffect } from 'react';
import { truncateAddress, formatInterval, stroopsToTokens, stellarExpertUrl } from '@/lib/utils';
import { buildAndSubmitCancel } from '@/lib/cancel_builder';
import UpdateSubscriptionForm from './UpdateSubscriptionForm';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from '@/constants/network';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionCardProps {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount in token's smallest unit (stroops) as BigInt */
  amount: bigint;
  /** Payment interval in seconds */
  interval: number;
  /** Unix timestamp (seconds) of the next scheduled payment */
  nextPayment: number;
  /** Unix timestamp when subscription became overdue, if any */
  overdueSince?: number | null;
  /** Unique key for this subscription */
  subscriptionKey: string;
  /** True when a cancel tx is already in flight */
  isCancelling: boolean;
  /** Non-null if already optimistically cancelled */
  cancelledAt: Date | null;
  /** Called when the cancel flow completes or the card should be hidden */
  onCancelled: (key: string) => void;
  /** Called when the cancel flow starts/ends to update isCancelling state */
  onCancelStateChange: (key: string, cancelling: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isOverdue(unixSeconds: number): boolean {
  return unixSeconds > 0 && Date.now() / 1000 > unixSeconds;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionCard({
  subscriber,
  merchant,
  token,
  amount,
  interval,
  nextPayment,
  overdueSince,
  subscriptionKey,
  isCancelling,
  cancelledAt,
  onCancelled,
  onCancelStateChange,
}: SubscriptionCardProps) {
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const GRACE_PERIOD_SECONDS = 604800; // 7 days grace period
  const now = Date.now() / 1000;
  const overdue = isOverdue(nextPayment);
  const overdueStart = overdueSince || (overdue ? nextPayment : null);
  const elapsedOverdue = overdueStart ? now - overdueStart : 0;
  const isExpired = elapsedOverdue > GRACE_PERIOD_SECONDS;
  const remainingGraceSeconds = Math.max(0, GRACE_PERIOD_SECONDS - elapsedOverdue);
  const remainingGraceDays = Math.ceil(remainingGraceSeconds / 86400);

  useEffect(() => {
    if (!showEditModal && !showConfirm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEditModal(false);
        setShowConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showEditModal, showConfirm]);

  const handleCancelClick = useCallback(() => {
    setCancelError(null);
    setShowConfirm(true);
  }, []);

  const handleCancelDismiss = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    setShowConfirm(false);
    onCancelStateChange(subscriptionKey, true);
    setCancelError(null);

    try {
      await buildAndSubmitCancel(
        { subscriber, merchant, token },
        CONTRACT_ID,
        subscriber,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      // On-chain confirmed — notify parent to remove the card
      onCancelled(subscriptionKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCancelError(msg);
      onCancelStateChange(subscriptionKey, false);
    }
  }, [subscriber, merchant, subscriptionKey, onCancelled, onCancelStateChange]);

  // Optimistic cancel already applied — show muted "cancelled" state
  if (cancelledAt) {
    return (
      <article
        aria-label={`Cancelled subscription to ${truncateAddress(merchant)}`}
        className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 opacity-60 transition-opacity"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full bg-gray-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
            Cancelled
          </span>
        </div>
        <p className="text-sm text-gray-500 font-mono">{truncateAddress(merchant, 8)}</p>
      </article>
    );
  }

  return (
    <>
      <article
        aria-label={`Active subscription to ${truncateAddress(merchant)}`}
        className="rounded-2xl border border-gray-800 bg-gray-900 p-5 shadow-md hover:border-gray-700 transition-colors"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
              Merchant
            </p>
            <a
              href={stellarExpertUrl('account', merchant)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-white text-sm truncate hover:text-blue-400 hover:underline inline-flex items-center gap-1"
              title={`View ${merchant} on Stellar Expert`}
              aria-label={`View merchant ${merchant} on Stellar Expert`}
            >
              {truncateAddress(merchant, 8)} ↗
            </a>
          </div>

          {/* Status badge */}
          {isExpired ? (
            <span
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-red-950/80 border border-red-700 px-2.5 py-1 text-xs font-semibold text-red-300"
              aria-label="Subscription status: Expired"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
              Expired
            </span>
          ) : overdue ? (
            <span
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-red-900/60 border border-red-600 px-2.5 py-1 text-xs font-semibold text-red-200"
              aria-label="Subscription status: Overdue"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
              Overdue
            </span>
          ) : (
            <span
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-900/40 border border-green-700/50 px-2.5 py-1 text-xs font-semibold text-green-300"
              aria-label="Subscription status: Active"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
              Active
            </span>
          )}
        </div>

        {/* Details grid */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
          {/* Token */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Token</dt>
            <dd className="font-mono text-gray-200 text-xs truncate">
              <a
                href={stellarExpertUrl('contract', token)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 hover:underline inline-flex items-center gap-1"
                title={`View token ${token} on Stellar Expert`}
                aria-label={`View token ${token} on Stellar Expert`}
              >
                {truncateAddress(token, 6)} ↗
              </a>
            </dd>
          </div>

          {/* Amount */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Amount</dt>
            <dd className="text-white font-semibold">
              {stroopsToTokens(amount)}
            </dd>
          </div>

          {/* Interval */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Interval</dt>
            <dd className="text-gray-200">Every {formatInterval(interval)}</dd>
          </div>

          {/* Next payment */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Next payment</dt>
            <dd
              className={
                isExpired
                  ? 'text-red-500 font-bold'
                  : overdue
                    ? 'text-red-400 font-semibold'
                    : 'text-gray-200'
              }
              aria-label={
                isExpired
                  ? `Payment expired: ${formatDate(nextPayment)}`
                  : overdue
                    ? `Next payment overdue: ${formatDate(nextPayment)}`
                    : `Next payment: ${formatDate(nextPayment)}`
              }
            >
              {formatDate(nextPayment)}
              {isExpired ? (
                <span className="ml-1.5 text-xs text-red-500 font-bold" aria-hidden="true">
                  (expired)
                </span>
              ) : overdue ? (
                <span className="ml-1.5 text-xs text-red-400 font-bold" aria-hidden="true">
                  (overdue)
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        {/* Overdue & Grace Period Alert */}
        {overdue && !isExpired && (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-950/50 border border-red-700/70 p-3 text-xs text-red-200"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-red-300">⚠️ Subscription Overdue</p>
                <p className="mt-0.5 text-red-300/80">
                  Grace period expires in {remainingGraceDays} day{remainingGraceDays !== 1 ? 's' : ''}.
                </p>
              </div>
              <a
                href="https://laboratory.stellar.org/#account-creator"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded bg-red-700 hover:bg-red-600 text-white font-medium px-2.5 py-1 text-xs transition-colors"
              >
                Add Funds
              </a>
            </div>
          </div>
        )}

        {/* Expired alert */}
        {isExpired && (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-950/80 border border-red-800 p-3 text-xs text-red-300"
          >
            <p className="font-semibold text-red-200">Subscription Expired</p>
            <p className="mt-0.5 text-red-300/80">
              The 7-day grace period has elapsed. Payments cannot be collected.
            </p>
          </div>
        )}

        {/* Cancel error */}
        {cancelError && (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-900/50 border border-red-700 p-3 text-xs text-red-200"
          >
            <span className="font-semibold">Cancel failed:</span> {cancelError}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => setShowEditModal(true)}
            disabled={isCancelling}
            aria-label={`Edit subscription terms for merchant ${truncateAddress(merchant)}`}
            className="
              flex-1 rounded-lg border border-blue-600/50 bg-blue-900/20
              px-3 py-2 text-xs font-semibold text-blue-300
              hover:bg-blue-900/40 hover:border-blue-500 hover:text-blue-200
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
              transition-colors
            "
          >
            Edit
          </button>

          {/* Cancel button */}
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={isCancelling}
            aria-busy={isCancelling}
            className="
              flex-1 rounded-lg border border-red-700/50 bg-red-900/20
              px-3 py-2 text-xs font-semibold text-red-300
              hover:bg-red-900/40 hover:border-red-600 hover:text-red-200
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
              transition-colors
            "
          >
            {isCancelling ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 rounded-full border-2 border-red-400 border-t-transparent animate-spin"
                />
                Cancelling…
              </span>
            ) : (
              'Cancel'
            )}
          </button>
        </div>
      </article>

      {/* Edit subscription modal */}
      {showEditModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-subscription-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 overflow-y-auto"
        >
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4">
              <h2 id="edit-subscription-title" className="text-lg font-bold text-white">
                Edit Subscription Terms
              </h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                aria-label="Close edit subscription modal"
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-blue-200 mb-4 bg-blue-950/40 p-2.5 rounded border border-blue-800">
              ℹ️ Subscription updated terms preserve your current billing cycle. Next payment date remains unchanged.
            </p>
            <UpdateSubscriptionForm
              initialValues={{
                merchantAddress: merchant,
                tokenAddress: token,
                amount: stroopsToTokens(amount),
                interval: String(interval),
              }}
            />
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h2
              id="cancel-dialog-title"
              className="text-lg font-bold text-white mb-2"
            >
              Cancel subscription?
            </h2>
            <p className="text-sm text-gray-400 mb-1">
              You are about to cancel your subscription to:
            </p>
            <p className="font-mono text-sm text-white mb-4" aria-label={`Merchant: ${merchant}`}>
              {truncateAddress(merchant, 12)}
            </p>
            <p className="text-xs text-gray-500 mb-6">
              This will submit a{' '}
              <code className="bg-gray-800 px-1 rounded text-gray-300">cancel</code>{' '}
              transaction to the Soroban contract. You will need to approve it in
              Freighter. The subscription will be removed on-chain and no further
              payments will be collected.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelDismiss}
                className="
                  flex-1 rounded-lg border border-gray-700 bg-gray-800
                  px-4 py-2.5 text-sm font-semibold text-gray-300
                  hover:bg-gray-700 hover:text-white
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500
                  transition-colors
                "
              >
                Keep subscription
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="
                  flex-1 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white
                  hover:bg-red-600
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
                  transition-colors
                "
              >
                Yes, cancel it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
