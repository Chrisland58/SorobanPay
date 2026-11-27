'use client';

import React from 'react';
import { truncateAddress, stroopsToTokens } from '@/lib/utils';

export interface BatchReviewItem {
  subscriber: string;
  amount: bigint;
  token?: string;
}

export interface BatchPaymentReviewModalProps {
  items: BatchReviewItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export default function BatchPaymentReviewModal({
  items,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: BatchPaymentReviewModalProps) {
  if (items.length === 0) return null;

  const totalAmount = items.reduce((sum, item) => sum + item.amount, BigInt(0));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-review-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="batch-review-title" className="text-lg font-bold text-white">
              Review Batch Payment Collection
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Verify the selected recipients and amounts before opening your wallet to sign.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close review modal"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <div>
            <p className="text-xs text-gray-400">Selected Recipients</p>
            <p className="text-lg font-semibold text-white">{items.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Total Amount</p>
            <p className="text-lg font-semibold text-white">
              {stroopsToTokens(totalAmount)} tokens
            </p>
          </div>
        </div>

        {/* Partial outcome notice */}
        <div
          role="note"
          className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 leading-relaxed"
        >
          <strong className="font-semibold">Potential partial outcomes:</strong>{' '}
          Individual subscriptions in this batch may succeed or fail independently.
          If some payments fail, you will be able to inspect the failures and retry
          only the failed recipients without resubmitting successful payments.
        </div>

        {/* Recipients list */}
        <div className="overflow-x-auto max-h-60 rounded-xl border border-gray-800 bg-gray-950/40">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 text-gray-400">
              <tr>
                <th className="p-3">Recipient</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map((item) => (
                <tr key={item.subscriber} className="hover:bg-gray-800/40">
                  <td className="p-3 font-mono text-gray-200" title={item.subscriber}>
                    {truncateAddress(item.subscriber, 10)}
                  </td>
                  <td className="p-3 text-right font-medium text-white">
                    {stroopsToTokens(item.amount)} tokens
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting…' : `Confirm & Submit (${items.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
