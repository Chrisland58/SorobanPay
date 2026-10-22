'use client';

/**
 * NetworkMismatchBanner.tsx
 *
 * Displays a prominent warning banner when Freighter's active network does not match
 * the app's configured network (e.g. Freighter on Mainnet, app on Testnet, or vice-versa).
 *
 * Issue: #1332
 */

import React from 'react';
import { useNetworkMismatch } from '@/hooks/useNetworkMismatch';

export interface NetworkMismatchBannerProps {
  /** Override for stories / tests */
  isMismatch?: boolean;
  freighterNetwork?: string | null;
  appNetwork?: string;
}

export function NetworkMismatchBanner(props: NetworkMismatchBannerProps) {
  const detected = useNetworkMismatch();

  const isMismatch = props.isMismatch !== undefined ? props.isMismatch : detected.isMismatch;
  const freighterNetwork = props.freighterNetwork !== undefined ? props.freighterNetwork : detected.freighterNetwork;
  const appNetwork = props.appNetwork !== undefined ? props.appNetwork : detected.appNetwork;

  if (!isMismatch) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="w-full border-b-2 border-amber-500 bg-amber-950/90 text-amber-100 px-4 py-3 shadow-lg z-50"
    >
      <div className="mx-auto flex max-w-7xl flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="shrink-0 text-xl" aria-hidden="true">⚠️</span>
          <div>
            <p className="font-bold text-amber-200 text-sm">
              Network Mismatch Detected
            </p>
            <p className="text-xs text-amber-300/90 mt-0.5">
              Freighter is on <strong>{freighterNetwork || 'another network'}</strong> but this app is configured for <strong>{appNetwork}</strong>. Switch Freighter to <strong>{appNetwork}</strong> to proceed.
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 self-start sm:self-center">
          <span className="inline-block bg-amber-800/80 border border-amber-600/60 text-amber-200 px-2.5 py-1 rounded text-xs font-semibold">
            Action Required
          </span>
        </div>
      </div>
    </div>
  );
}

export default NetworkMismatchBanner;
