'use client';

/**
 * FeeEstimateConfirmation.tsx
 *
 * Enforces confirmation when transaction fees expire or increase
 * beyond a tolerance threshold prior to submission (#1639).
 */

import React, { useState } from 'react';
import { stroopsToXlm } from '../hooks/useSimulateFee';

export interface FeeEstimateConfirmationProps {
  initialFeeStroops: string | null;
  currentFeeStroops: string | null;
  expiresAtMs: number;
  tolerancePercentage?: number; // e.g. 10%
  onConfirmChangedFee: (confirmedFee: string) => void;
  onRefreshEstimate: () => void;
  onSubmit: () => void;
}

export function FeeEstimateConfirmation({
  initialFeeStroops,
  currentFeeStroops,
  expiresAtMs,
  tolerancePercentage = 10,
  onConfirmChangedFee,
  onRefreshEstimate,
  onSubmit,
}: FeeEstimateConfirmationProps) {
  const [confirmedFee, setConfirmedFee] = useState<string | null>(initialFeeStroops);
  const now = Date.now();
  const isExpired = now >= expiresAtMs;

  const initialNum = Number(initialFeeStroops ?? 0);
  const currentNum = Number(currentFeeStroops ?? 0);

  const feeIncreased = currentNum > initialNum;
  const percentageIncrease =
    initialNum > 0 ? ((currentNum - initialNum) / initialNum) * 100 : 0;
  const requiresReconfirmation =
    feeIncreased &&
    percentageIncrease > tolerancePercentage &&
    confirmedFee !== currentFeeStroops;

  if (isExpired) {
    return (
      <div role="alert" className="p-3 bg-red-950/40 border border-red-500 rounded text-red-200 text-sm space-y-2">
        <p className="font-semibold">Fee Estimate Expired</p>
        <p>The simulated fee estimate is no longer valid. Refresh to get the latest network fee.</p>
        <button
          type="button"
          onClick={onRefreshEstimate}
          className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium"
        >
          Refresh Fee Estimate
        </button>
      </div>
    );
  }

  if (requiresReconfirmation) {
    return (
      <div role="dialog" aria-label="Fee Change Confirmation" className="p-3 bg-amber-950/40 border border-amber-500 rounded text-amber-200 text-sm space-y-2">
        <p className="font-semibold">Network Fee Changed</p>
        <p>
          The transaction fee has increased by {percentageIncrease.toFixed(1)}% (from{' '}
          {stroopsToXlm(initialFeeStroops!)} XLM to {stroopsToXlm(currentFeeStroops!)} XLM).
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmedFee(currentFeeStroops);
              onConfirmChangedFee(currentFeeStroops!);
            }}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium"
          >
            Accept & Confirm Fee
          </button>
          <button
            type="button"
            onClick={onRefreshEstimate}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium"
          >
            Re-simulate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-300">
        Estimated Fee: <span className="font-mono text-emerald-400">{stroopsToXlm(currentFeeStroops ?? '0')} XLM</span>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-sm"
      >
        Submit Subscription
      </button>
    </div>
  );
}
