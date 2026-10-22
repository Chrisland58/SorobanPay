"use client";

/**
 * WalletContext.tsx
 *
 * React context for Freighter wallet state.
 * Wrap the app in <WalletProvider> to make wallet state available
 * to all child components via useWallet().
 *
 * Requirements: 9.1–9.6
 */

import React, {
  createContext,
  useCallback,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  connectWallet,
  detectFreighter,
  restoreWalletSession,
} from "@/lib/wallet_manager";

const WALLET_CACHE_KEY = "sorobanpay_wallet_public_key";

function readCachedPublicKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(WALLET_CACHE_KEY);
  } catch {
    return null;
  }
}

function writeCachedPublicKey(publicKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WALLET_CACHE_KEY, publicKey);
  } catch {
    // Storage may be unavailable (private mode); connection still works.
  }
}

function clearCachedPublicKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WALLET_CACHE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  /** Connected account public key, or null when disconnected. */
  publicKey: string | null;
  /** True while a connect request is in flight. */
  isConnecting: boolean;
  /** Error message from the last failed connect attempt. */
  connectError: string | null;
  /** True when Freighter extension is detected in the browser. */
  freighterInstalled: boolean;
  /** True while checking Freighter availability on initial load. */
  isCheckingFreighter: boolean;
  /** True when the active wallet session is no longer valid because Freighter is unavailable. */
  sessionInvalid: boolean;
  /** Trigger wallet connection — opens Freighter permission dialog. */
  connect: () => Promise<void>;
  /** Clear publicKey and return to disconnected state. */
  disconnect: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState(false);
  const [isCheckingFreighter, setIsCheckingFreighter] = useState(true);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const sessionActionRef = useRef(0);

  useEffect(() => {
    if (publicKey && !freighterInstalled) {
      setSessionInvalid(true);
      setConnectError(
        "Freighter is no longer available. Disconnect and reconnect to restore your session.",
      );
    } else if (publicKey && freighterInstalled) {
      setSessionInvalid(false);
      setConnectError(null);
    }
  }, [publicKey, freighterInstalled]);

  // Check Freighter availability and restore a cached session on mount
  // (Issues #110 and #1323).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const installed = await detectFreighter();
        if (cancelled || sessionActionRef.current !== 0) return;

        setFreighterInstalled(installed);
        if (!installed) {
          clearCachedPublicKey();
          setConnectError(
            "Freighter is not installed. Install it from https://www.freighter.app",
          );
          return;
        }

        const cachedKey = readCachedPublicKey();
        if (!cachedKey) return;

        const restoredKey = await restoreWalletSession().catch(() => null);
        if (cancelled || sessionActionRef.current !== 0) return;

        if (restoredKey && restoredKey === cachedKey) {
          setPublicKey(restoredKey);
          setSessionInvalid(false);
          setConnectError(null);
        } else {
          // The extension has no active session or the active account changed:
          // drop the stale cache and stay disconnected.
          clearCachedPublicKey();
          setPublicKey(null);
          if (restoredKey) {
            setConnectError(
              "The Freighter account changed. Reconnect to continue with the active account.",
            );
          }
        }
      } finally {
        if (!cancelled) setIsCheckingFreighter(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    const actionId = ++sessionActionRef.current;
    setIsConnecting(true);
    setConnectError(null);
    setSessionInvalid(false);

    try {
      // Check installation first so we can show the install link (Req 9.1)
      const installed = await detectFreighter();
      if (sessionActionRef.current !== actionId) return;
      setFreighterInstalled(installed);

      if (!installed) {
        setConnectError(
          "Freighter is not installed. Install it from https://www.freighter.app",
        );
        return;
      }

      // Request explicit access — stores ONLY the key from this session (Req 9.3)
      const key = await connectWallet();
      if (sessionActionRef.current !== actionId) return;
      setPublicKey(key);
      writeCachedPublicKey(key);
    } catch (err) {
      if (sessionActionRef.current !== actionId) return;
      // User denied access or another Freighter error (Req 9.4)
      const msg =
        err instanceof Error ? err.message : "Wallet connection failed.";
      setConnectError(msg);
      setPublicKey(null); // Return to disconnected state (Req 9.4)
    } finally {
      if (sessionActionRef.current === actionId) {
        setIsConnecting(false);
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    sessionActionRef.current += 1;
    setPublicKey(null); // Clears stored key (Req 9.6)
    clearCachedPublicKey();
    setConnectError(null);
    setSessionInvalid(false);
    setIsConnecting(false);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnecting,
        connectError,
        freighterInstalled,
        isCheckingFreighter,
        sessionInvalid,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
