/**
 * useTransactionPoller.ts
 *
 * React hook that polls the Soroban RPC `getTransaction` endpoint until a
 * submitted transaction reaches a terminal state (SUCCESS or FAILED), times
 * out, or is cancelled.
 *
 * Polling strategy:
 *   - Initial delay: 2 000 ms
 *   - Exponential backoff: delay × 1.5 on each attempt (capped at 10 000 ms)
 *   - Hard timeout: 60 seconds — yields 'timeout' status with an explorer link
 *
 * Status lifecycle:
 *   idle  ──(start)──►  confirming  ──(SUCCESS)──►  success
 *                    ├──(FAILED)───►  failed
 *                    └──(timeout)──►  timeout
 *
 * Explorer link (Stellar Expert):
 *   Testnet:  https://stellar.expert/explorer/testnet/tx/{hash}
 *   Mainnet:  https://stellar.expert/explorer/public/tx/{hash}
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { NETWORK_NAME } from '@/constants/network';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PollerStatus = 'idle' | 'confirming' | 'success' | 'failed' | 'timeout';

export interface TransactionPollerState {
  /** Current lifecycle status */
  status: PollerStatus;
  /** Transaction hash being polled (set as soon as polling starts) */
  txHash: string | null;
  /**
   * Error message when status is 'failed'.
   * Includes the contract error code and human-readable description when
   * available from the transaction result metadata.
   */
  errorMessage: string | null;
  /** Stellar Expert explorer URL for the current txHash */
  explorerUrl: string | null;
}

export interface UseTransactionPollerOptions {
  /** Override the Soroban RPC URL (defaults to RPC_URL from constants) */
  rpcUrl?: string;
  /**
   * Called when the transaction reaches SUCCESS status.
   * Receives the confirmed transaction hash.
   */
  onSuccess?: (txHash: string) => void;
  /**
   * Called when the transaction reaches FAILED status.
   * Receives the error message extracted from result metadata.
   */
  onFailed?: (errorMessage: string, txHash: string) => void;
  /**
   * Called when polling times out (60 s elapsed with no terminal status).
   * Receives the transaction hash and the explorer URL.
   */
  onTimeout?: (txHash: string, explorerUrl: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Initial polling interval in milliseconds */
const INITIAL_DELAY_MS = 2_000;
/** Exponential backoff multiplier */
const BACKOFF_FACTOR = 1.5;
/** Maximum polling interval in milliseconds */
const MAX_DELAY_MS = 10_000;
/** Total polling timeout in milliseconds */
const POLL_TIMEOUT_MS = 60_000;

// ── Explorer URL helper ───────────────────────────────────────────────────────

/**
 * Build a Stellar Expert explorer URL for a given transaction hash.
 * Uses NETWORK_NAME from constants to determine testnet vs. mainnet.
 */
export function buildExplorerUrl(txHash: string, networkName = NETWORK_NAME): string {
  const network = networkName === 'Mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

/**
 * Extract a human-readable error message from a failed Soroban transaction.
 *
 * Attempts to pull the contract error code from result metadata XDR while
 * keeping the raw metadata payload out of user-facing errors.
 */
export function extractFailureMessage(
  response: SorobanRpc.Api.GetTransactionResponse,
): string {
  if (response.status !== SorobanRpc.Api.GetTransactionStatus.FAILED) {
    return 'Transaction failed';
  }

  const failedResponse = response as SorobanRpc.Api.GetFailedTransactionResponse;
  const metaXdr = failedResponse.resultMetaXdr;

  if (!metaXdr) {
    return 'Transaction failed on-chain (no result metadata available)';
  }

  const metaStr = typeof metaXdr === 'string' ? metaXdr : metaXdr.toXDR('base64');

  // Attempt to detect contract error code patterns in the XDR base64 string.
  // The base64 encoding of "Error(Contract, #N)" sequences tends to include
  // the raw error code. We also match common textual representations that
  // appear in decoded XDR strings.
  const codeMatch = metaStr.match(
    /Error\(Contract,\s*#(\d+)\)|contract\s+error[:\s#]+(\d+)|ContractError\((\d+)\)/i,
  );
  if (codeMatch) {
    const code = codeMatch[1] ?? codeMatch[2] ?? codeMatch[3];
    return `Transaction failed on-chain: contract error #${code}`;
  }

  return 'Transaction failed on-chain (details unavailable)';
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook for polling a submitted Soroban transaction to its terminal state.
 *
 * @example
 * ```tsx
 * const { state, startPolling } = useTransactionPoller({
 *   rpcUrl: RPC_URL,
 *   onSuccess: (hash) => setSuccessData({ txHash: hash, ... }),
 *   onFailed:  (msg, hash) => setTxError(classifyError(new Error(msg))),
 *   onTimeout: (_hash, url) => setTxError(classifyError(new Error(`timeout:${url}`))),
 * });
 *
 * // After Freighter signs and submits:
 * startPolling(sendResult.hash, server);
 * ```
 */
export function useTransactionPoller(
  options: UseTransactionPollerOptions = {},
): {
  state: TransactionPollerState;
  startPolling: (txHash: string, server: SorobanRpc.Server, immediately?: boolean) => void;
  refresh: () => void;
  reset: () => void;
} {
  const { onSuccess, onFailed, onTimeout } = options;

  const [state, setState] = useState<TransactionPollerState>({
    status: 'idle',
    txHash: null,
    errorMessage: null,
    explorerUrl: null,
  });

  const activeSessionRef = useRef<{
    active: boolean;
    txHash: string;
    server: SorobanRpc.Server;
    startedAt: number;
    delay: number;
  } | null>(null);
  const lastRequestRef = useRef<{ txHash: string; server: SorobanRpc.Server } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelActivePolling = useCallback(() => {
    if (activeSessionRef.current) activeSessionRef.current.active = false;
    activeSessionRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    pollTimerRef.current = null;
    timeoutTimerRef.current = null;
  }, []);

  useEffect(() => () => cancelActivePolling(), [cancelActivePolling]);

  const reset = useCallback(() => {
    cancelActivePolling();
    lastRequestRef.current = null;
    setState({
      status: 'idle',
      txHash: null,
      errorMessage: null,
      explorerUrl: null,
    });
  }, [cancelActivePolling]);

  const startPolling = useCallback(
    (txHash: string, server: SorobanRpc.Server, immediately = false) => {
      cancelActivePolling();

      const explorerUrl = buildExplorerUrl(txHash);

      setState({
        status: 'confirming',
        txHash,
        errorMessage: null,
        explorerUrl,
      });

      const session = {
        active: true,
        txHash,
        server,
        startedAt: Date.now(),
        delay: INITIAL_DELAY_MS,
      };
      activeSessionRef.current = session;
      lastRequestRef.current = { txHash, server };

      const finish = (
        status: 'success' | 'failed' | 'timeout',
        errorMessage: string | null = null,
      ) => {
        if (!session.active || activeSessionRef.current !== session) return;
        session.active = false;
        activeSessionRef.current = null;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
        pollTimerRef.current = null;
        timeoutTimerRef.current = null;
        setState((prev) => ({ ...prev, status, errorMessage }));

        if (status === 'success') onSuccess?.(txHash);
        if (status === 'failed') onFailed?.(errorMessage ?? 'Transaction failed', txHash);
        if (status === 'timeout') onTimeout?.(txHash, explorerUrl);
      };

      const schedulePoll = (delay: number) => {
        pollTimerRef.current = setTimeout(() => void poll(), delay);
      };

      const poll = async (): Promise<void> => {
        if (!session.active || activeSessionRef.current !== session) return;
        if (Date.now() - session.startedAt >= POLL_TIMEOUT_MS) {
          finish('timeout');
          return;
        }

        try {
          const response = await server.getTransaction(txHash);
          if (!session.active || activeSessionRef.current !== session) return;
          if (Date.now() - session.startedAt >= POLL_TIMEOUT_MS) {
            finish('timeout');
            return;
          }

          if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
            finish('success');
            return;
          }
          if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
            finish('failed', extractFailureMessage(response));
            return;
          }
        } catch {
          if (!session.active || activeSessionRef.current !== session) return;
        }

        session.delay = Math.min(session.delay * BACKOFF_FACTOR, MAX_DELAY_MS);
        schedulePoll(session.delay);
      };

      timeoutTimerRef.current = setTimeout(() => finish('timeout'), POLL_TIMEOUT_MS);
      if (immediately) void poll();
      else schedulePoll(session.delay);
    },
    [cancelActivePolling, onSuccess, onFailed, onTimeout],
  );

  const refresh = useCallback(() => {
    const request = lastRequestRef.current;
    if (request) startPolling(request.txHash, request.server, true);
  }, [startPolling]);

  return { state, startPolling, refresh, reset };
}
