'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWallet } from '@/hooks/useWallet';

export interface MerchantAccount {
  id: string;
  name: string;
  address: string;
  role?: string;
}

export interface MerchantContextValue {
  merchants: MerchantAccount[];
  activeMerchant: MerchantAccount | null;
  pendingMerchant: MerchantAccount | null;
  isSwitching: boolean;
  switchError: string | null;
  announcement: string;
  requestMerchantSwitch: (merchantId: string) => void;
  confirmMerchantSwitch: () => Promise<void>;
  cancelMerchantSwitch: () => void;
  clearSwitchError: () => void;
  registerCacheInvalidator: (fn: () => void) => () => void;
}

const STORAGE_KEY = 'sorobanpay_active_merchant_id';

const DEFAULT_MERCHANTS: MerchantAccount[] = [
  {
    id: 'merchant-primary',
    name: 'Primary Merchant',
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    role: 'Owner',
  },
  {
    id: 'merchant-eu',
    name: 'SorobanPay EU Operations',
    address: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    role: 'Operator',
  },
];

const MerchantContext = createContext<MerchantContextValue | null>(null);

export interface MerchantProviderProps {
  children: ReactNode;
  initialMerchants?: MerchantAccount[];
  onMerchantChanged?: (merchant: MerchantAccount) => void | Promise<void>;
}

export function MerchantProvider({
  children,
  initialMerchants,
  onMerchantChanged,
}: MerchantProviderProps) {
  const { publicKey } = useWallet();
  const cacheInvalidatorsRef = useRef<Set<() => void>>(new Set());

  const merchants = useMemo<MerchantAccount[]>(() => {
    if (initialMerchants && initialMerchants.length > 0) {
      return initialMerchants;
    }
    if (publicKey) {
      return [
        {
          id: `wallet-${publicKey.slice(0, 8)}`,
          name: 'Connected Merchant Wallet',
          address: publicKey,
          role: 'Owner',
        },
        ...DEFAULT_MERCHANTS.filter((m) => m.address !== publicKey),
      ];
    }
    return DEFAULT_MERCHANTS;
  }, [initialMerchants, publicKey]);

  const [activeMerchantId, setActiveMerchantId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
      } catch {
        // Ignore storage access errors in restricted environments
      }
    }
    return merchants[0]?.id ?? '';
  });

  const [pendingMerchantId, setPendingMerchantId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const activeMerchant = useMemo(
    () => merchants.find((m) => m.id === activeMerchantId) ?? merchants[0] ?? null,
    [merchants, activeMerchantId],
  );

  const pendingMerchant = useMemo(
    () => (pendingMerchantId ? merchants.find((m) => m.id === pendingMerchantId) ?? null : null),
    [merchants, pendingMerchantId],
  );

  useEffect(() => {
    if (activeMerchant && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, activeMerchant.id);
      } catch {
        // Ignore storage write errors
      }
    }
  }, [activeMerchant]);

  const registerCacheInvalidator = useCallback((fn: () => void) => {
    cacheInvalidatorsRef.current.add(fn);
    return () => {
      cacheInvalidatorsRef.current.delete(fn);
    };
  }, []);

  const requestMerchantSwitch = useCallback(
    (merchantId: string) => {
      setSwitchError(null);
      if (!merchantId || merchantId === activeMerchant?.id) {
        return;
      }
      const target = merchants.find((m) => m.id === merchantId);
      if (!target) {
        setSwitchError('Selected merchant account is not available.');
        return;
      }
      setPendingMerchantId(merchantId);
    },
    [activeMerchant?.id, merchants],
  );

  const cancelMerchantSwitch = useCallback(() => {
    setPendingMerchantId(null);
    setSwitchError(null);
  }, []);

  const confirmMerchantSwitch = useCallback(async () => {
    if (!pendingMerchant) return;
    setIsSwitching(true);
    setSwitchError(null);

    try {
      for (const invalidate of cacheInvalidatorsRef.current) {
        invalidate();
      }
      if (onMerchantChanged) {
        await onMerchantChanged(pendingMerchant);
      }
      setActiveMerchantId(pendingMerchant.id);
      setPendingMerchantId(null);
      setAnnouncement(`Active merchant switched to ${pendingMerchant.name}.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to switch merchant context.';
      setSwitchError(message);
    } finally {
      setIsSwitching(false);
    }
  }, [pendingMerchant, onMerchantChanged]);

  const clearSwitchError = useCallback(() => {
    setSwitchError(null);
  }, []);

  const value = useMemo<MerchantContextValue>(
    () => ({
      merchants,
      activeMerchant,
      pendingMerchant,
      isSwitching,
      switchError,
      announcement,
      requestMerchantSwitch,
      confirmMerchantSwitch,
      cancelMerchantSwitch,
      clearSwitchError,
      registerCacheInvalidator,
    }),
    [
      merchants,
      activeMerchant,
      pendingMerchant,
      isSwitching,
      switchError,
      announcement,
      requestMerchantSwitch,
      confirmMerchantSwitch,
      cancelMerchantSwitch,
      clearSwitchError,
      registerCacheInvalidator,
    ],
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchantContext(): MerchantContextValue {
  const ctx = useContext(MerchantContext);
  if (!ctx) {
    throw new Error('useMerchantContext must be used within a MerchantProvider');
  }
  return ctx;
}
