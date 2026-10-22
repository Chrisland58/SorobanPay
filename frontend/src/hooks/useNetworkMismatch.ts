'use client';

/**
 * useNetworkMismatch.ts
 *
 * Hook to detect if Freighter's active network does not match the app's configured network.
 * Polls or listens for network changes when a wallet is connected.
 *
 * Issue: #1332
 */

import { useState, useEffect, useCallback } from 'react';
import { getNetwork } from '@stellar/freighter-api';
import { useWallet } from '@/hooks/useWallet';
import { NETWORK_PASSPHRASE } from '@/constants/network';

export interface NetworkMismatchState {
  isMismatch: boolean;
  freighterNetwork: string | null;
  appNetwork: string;
  expectedPassphrase: string;
  actualPassphrase: string | null;
  checkNetwork: () => Promise<void>;
}

function resolveNetworkName(passphrase?: string | null): string {
  if (!passphrase) return 'Unknown';
  if (passphrase.toLowerCase().includes('public')) return 'Mainnet';
  if (passphrase.toLowerCase().includes('test')) return 'Testnet';
  if (passphrase.toLowerCase().includes('future')) return 'Futurenet';
  return passphrase;
}

export function useNetworkMismatch(): NetworkMismatchState {
  const { publicKey } = useWallet();
  const [freighterPassphrase, setFreighterPassphrase] = useState<string | null>(null);
  const [isMismatch, setIsMismatch] = useState<boolean>(false);

  const appNetwork = resolveNetworkName(NETWORK_PASSPHRASE);
  const freighterNetwork = freighterPassphrase ? resolveNetworkName(freighterPassphrase) : null;

  const checkNetwork = useCallback(async () => {
    if (!publicKey) {
      setFreighterPassphrase(null);
      setIsMismatch(false);
      return;
    }

    try {
      const net = await getNetwork();
      if (net && !net.error && net.networkPassphrase) {
        setFreighterPassphrase(net.networkPassphrase);
        const mismatch = net.networkPassphrase !== NETWORK_PASSPHRASE;
        setIsMismatch(mismatch);
      } else {
        setIsMismatch(false);
      }
    } catch {
      setIsMismatch(false);
    }
  }, [publicKey]);

  useEffect(() => {
    checkNetwork();
    if (!publicKey) return;

    // Check periodically for network changes in Freighter
    const interval = setInterval(checkNetwork, 3000);
    return () => clearInterval(interval);
  }, [publicKey, checkNetwork]);

  return {
    isMismatch,
    freighterNetwork,
    appNetwork,
    expectedPassphrase: NETWORK_PASSPHRASE,
    actualPassphrase: freighterPassphrase,
    checkNetwork,
  };
}
