"use client";

/**
 * NetworkWarningBanner.tsx
 *
 * Displays a prominent warning banner when connected to mainnet to prevent
 * accidental live transactions. Shows network environment status clearly.
 * Dismissible on testnet, persistent on mainnet for safety.
 */

import { useState } from "react";
import { getNetworkInfo } from "@/lib/runtime_config";

export function NetworkWarningBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const { name: networkName, isProduction } = getNetworkInfo();

  // Only show banner if not dismissed
  if (isDismissed && !isProduction) {
    return null;
  }

  // Mainnet: red critical warning
  if (isProduction) {
    return (
      <div
        role="alert"
        className="w-full bg-gradient-to-r from-red-900 to-red-800 border-b-2 border-red-600 px-4 py-3 text-white shadow-lg"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚨</span>
            <div>
              <p className="font-bold text-red-100">MAINNET - LIVE TRANSACTIONS</p>
              <p className="text-sm text-red-200">
                You are connected to Stellar mainnet. All transactions are real and irreversible.
              </p>
            </div>
          </div>
          <div className="flex-shrink-0">
            <span className="inline-block bg-red-700 text-white px-3 py-1 rounded-full text-xs font-semibold">
              PRODUCTION
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Testnet: yellow warning (dismissible)
  return (
    <div
      role="alert"
      className="w-full bg-gradient-to-r from-yellow-900 to-yellow-800 border-b-2 border-yellow-600 px-4 py-3 text-white shadow-md"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-semibold text-yellow-100">TESTNET - DEVELOPMENT ONLY</p>
            <p className="text-sm text-yellow-200">
              You are connected to Stellar testnet. Transactions use test assets (no real value).
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="flex-shrink-0 text-yellow-200 hover:text-yellow-100 transition-colors p-1"
          aria-label="Dismiss banner"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
