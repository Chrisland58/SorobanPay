'use client';

/**
 * NetworkStatusIndicator.tsx
 *
 * Persistent, non-blocking network status indicator that distinguishes:
 * - offline (browser disconnected)
 * - unsupported (wallet or app on an unsupported network)
 * - wallet-mismatch (Freighter network differs from app network)
 * - testnet (connected to a test network such as Testnet or Futurenet)
 * - mainnet (connected to Mainnet)
 *
 * Remains compact at narrow widths and provides a direct recovery action
 * when in an error/warning state.
 *
 * Issue: #1664
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNetworkMismatch } from '@/hooks/useNetworkMismatch';
import { getNetworkInfo } from '@/lib/runtime_config';

export type NetworkStatusState =
  | 'offline'
  | 'unsupported'
  | 'wallet-mismatch'
  | 'testnet'
  | 'mainnet';

export interface NetworkStatusIndicatorProps {
  /** Override online status (defaults to navigator.onLine) */
  isOnline?: boolean;
  /** Override wallet mismatch status */
  isMismatch?: boolean;
  /** Override unsupported network status */
  isUnsupported?: boolean;
  /** Override app network display name */
  appNetwork?: string;
  /** Override wallet network display name */
  freighterNetwork?: string | null;
  /** Callback invoked when user clicks the recovery action in offline state */
  onRetry?: () => void;
  /** Callback invoked when user clicks the recovery action in mismatch/unsupported state */
  onRecheck?: () => void | Promise<void>;
  /** Optional extra CSS classes */
  className?: string;
}

const SUPPORTED_NETWORKS = new Set(['mainnet', 'testnet', 'futurenet']);

function isKnownSupportedNetwork(name?: string | null): boolean {
  if (!name) return false;
  return SUPPORTED_NETWORKS.has(name.trim().toLowerCase());
}

export function NetworkStatusIndicator(props: NetworkStatusIndicatorProps) {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  const mismatch = useNetworkMismatch();
  const runtimeNetwork = getNetworkInfo();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isOnline = props.isOnline !== undefined ? props.isOnline : browserOnline;
  const appNetwork = props.appNetwork ?? runtimeNetwork.name ?? mismatch.appNetwork;
  const freighterNetwork =
    props.freighterNetwork !== undefined
      ? props.freighterNetwork
      : mismatch.freighterNetwork;
  const isMismatch =
    props.isMismatch !== undefined ? props.isMismatch : mismatch.isMismatch;

  const detectedUnsupported =
    !isKnownSupportedNetwork(appNetwork) ||
    (freighterNetwork !== null &&
      freighterNetwork !== undefined &&
      !isKnownSupportedNetwork(freighterNetwork));

  const isUnsupported =
    props.isUnsupported !== undefined ? props.isUnsupported : detectedUnsupported;

  const state: NetworkStatusState = !isOnline
    ? 'offline'
    : isUnsupported
      ? 'unsupported'
      : isMismatch
        ? 'wallet-mismatch'
        : appNetwork.trim().toLowerCase() === 'mainnet'
          ? 'mainnet'
          : 'testnet';

  const handleRecovery = useCallback(async () => {
    if (state === 'offline') {
      if (typeof navigator !== 'undefined') {
        setBrowserOnline(navigator.onLine);
      }
      props.onRetry?.();
      return;
    }

    setIsRechecking(true);
    try {
      if (props.onRecheck) {
        await props.onRecheck();
      } else {
        await mismatch.checkNetwork();
      }
    } finally {
      setIsRechecking(false);
    }
  }, [state, props, mismatch]);

  const config: Record<
    NetworkStatusState,
    {
      containerClass: string;
      dotClass: string;
      shortLabel: string;
      fullLabel: string;
      actionLabel?: string;
      ariaLabel: string;
    }
  > = {
    offline: {
      containerClass:
        'bg-red-950/80 border-red-500/60 text-red-200',
      dotClass: 'bg-red-400',
      shortLabel: 'Offline',
      fullLabel: 'Offline — No internet connection',
      actionLabel: 'Retry',
      ariaLabel: 'Network status: Offline. No internet connection.',
    },
    unsupported: {
      containerClass:
        'bg-orange-950/80 border-orange-500/60 text-orange-200',
      dotClass: 'bg-orange-400',
      shortLabel: 'Unsupported',
      fullLabel: `Unsupported network (${freighterNetwork || appNetwork})`,
      actionLabel: isRechecking ? 'Checking…' : 'Recheck',
      ariaLabel: `Network status: Unsupported network (${freighterNetwork || appNetwork}).`,
    },
    'wallet-mismatch': {
      containerClass:
        'bg-amber-950/80 border-amber-500/60 text-amber-200',
      dotClass: 'bg-amber-400',
      shortLabel: 'Mismatch',
      fullLabel: `Mismatch: ${freighterNetwork || 'Wallet'} ≠ ${appNetwork}`,
      actionLabel: isRechecking ? 'Checking…' : `Switch to ${appNetwork}`,
      ariaLabel: `Network status: Wallet mismatch. Wallet is on ${freighterNetwork || 'another network'}, app is on ${appNetwork}.`,
    },
    testnet: {
      containerClass:
        'bg-yellow-900/30 border-yellow-600/50 text-yellow-300',
      dotClass: 'bg-yellow-400',
      shortLabel: appNetwork,
      fullLabel: appNetwork,
      ariaLabel: `Network status: Connected to ${appNetwork} (test network).`,
    },
    mainnet: {
      containerClass:
        'bg-emerald-900/30 border-emerald-600/50 text-emerald-300',
      dotClass: 'bg-emerald-400',
      shortLabel: appNetwork,
      fullLabel: appNetwork,
      ariaLabel: `Network status: Connected to ${appNetwork}.`,
    },
  };

  const current = config[state];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={current.ariaLabel}
      data-network-state={state}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium max-w-full ${current.containerClass} ${props.className ?? ''}`}
    >
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${current.dotClass}`}
        aria-hidden="true"
      />
      <span className="sm:hidden truncate">{current.shortLabel}</span>
      <span className="hidden sm:inline truncate">{current.fullLabel}</span>
      {current.actionLabel && (
        <button
          type="button"
          onClick={handleRecovery}
          disabled={isRechecking}
          className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50 transition-colors"
        >
          {current.actionLabel}
        </button>
      )}
    </div>
  );
}

export default NetworkStatusIndicator;
