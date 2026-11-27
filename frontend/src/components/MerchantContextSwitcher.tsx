'use client';

import React, { useEffect, useId, useRef } from 'react';
import { useMerchantContext } from '@/context/MerchantContext';
import { truncateAddress } from '@/lib/utils';

export function MerchantContextSwitcher() {
  const {
    merchants,
    activeMerchant,
    pendingMerchant,
    isSwitching,
    switchError,
    announcement,
    requestMerchantSwitch,
    confirmMerchantSwitch,
    cancelMerchantSwitch,
  } = useMerchantContext();

  const selectId = useId();
  const dialogTitleId = useId();
  const dialogDescId = useId();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pendingMerchant) {
      cancelBtnRef.current?.focus();
    }
  }, [pendingMerchant]);

  useEffect(() => {
    if (!pendingMerchant) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSwitching) {
        cancelMerchantSwitch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingMerchant, isSwitching, cancelMerchantSwitch]);

  if (!activeMerchant) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2 text-sm"
        data-testid="active-merchant-indicator"
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full bg-emerald-400"
            aria-hidden="true"
          />
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Active Merchant:
          </span>
          <span className="font-semibold text-white">{activeMerchant.name}</span>
          <span
            className="font-mono text-xs text-gray-400"
            title={activeMerchant.address}
          >
            ({truncateAddress(activeMerchant.address)})
          </span>
          {activeMerchant.role && (
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300">
              {activeMerchant.role}
            </span>
          )}
        </div>

        {merchants.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="sr-only">
              Switch active merchant account
            </label>
            <select
              id={selectId}
              aria-label="Switch active merchant account"
              value={activeMerchant.id}
              onChange={(e) => requestMerchantSwitch(e.target.value)}
              disabled={isSwitching}
              className="rounded-md border border-gray-600 bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {merchants.map((merchant) => (
                <option key={merchant.id} value={merchant.id}>
                  {merchant.name} ({truncateAddress(merchant.address)})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Screen-reader live announcement for merchant context changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {switchError && !pendingMerchant && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-200"
        >
          {switchError}
        </div>
      )}

      {pendingMerchant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          aria-describedby={dialogDescId}
        >
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h2
              id={dialogTitleId}
              className="text-lg font-semibold text-white"
            >
              Switch Active Merchant?
            </h2>
            <p id={dialogDescId} className="mt-2 text-sm text-gray-300">
              You are about to switch from{' '}
              <strong className="text-white">{activeMerchant.name}</strong> to{' '}
              <strong className="text-white">{pendingMerchant.name}</strong>.
              Switching will clear cached tenant data and reload subscriptions,
              reports, and settings for the selected merchant.
            </p>

            {switchError && (
              <div
                role="alert"
                className="mt-3 rounded-md border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-200"
              >
                {switchError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={cancelMerchantSwitch}
                disabled={isSwitching}
                className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmMerchantSwitch()}
                disabled={isSwitching}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              >
                {isSwitching ? 'Switching…' : 'Confirm Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
