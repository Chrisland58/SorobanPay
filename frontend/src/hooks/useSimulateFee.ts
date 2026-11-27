'use client';

/**
 * useSimulateFee.ts
 *
 * Debounced hook that calls simulateTransaction() against the Soroban RPC
 * to estimate the resource fee for a `subscribe` call before the user
 * submits the form.
 *
 * Features:
 *  - Debounced 500 ms so that rapid typing doesn't flood the RPC
 *  - Returns loading, fee (in stroops), breakdown (instructions, readBytes,
 *    writeBytes), and any simulation error
 *  - Skips simulation when formValid is false or publicKey is absent
 *  - Cancels in-flight work when params change or the component unmounts
 *  - Uses useReducer to batch all state updates into a single dispatch,
 *    preventing multiple React renders and act() warnings in tests
 */

import { useReducer, useEffect } from 'react';
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from '@/constants/network';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimulateFeeParams {
  /** Subscriber G-address (from connected wallet). */
  subscriber: string;
  /** Merchant G-address (from form). */
  merchant: string;
  /** Token contract C-address (from form). */
  token: string;
  /** Payment amount in token's smallest unit. */
  amount: number;
  /** Payment interval in seconds. */
  interval: number;
  /** Whether all form fields pass validation. Simulation is skipped when false. */
  formValid: boolean;
}

export interface SimulateFeeBreakdown {
  /** CPU instructions consumed by the transaction. */
  instructions: number;
  /** Ledger bytes read. */
  readBytes: number;
  /** Ledger bytes written. */
  writeBytes: number;
}

export type SimulateFeeStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseSimulateFeeResult {
  /** Current status of the simulation. */
  status: SimulateFeeStatus;
  /**
   * Estimated minimum resource fee in stroops.
   * Convert to XLM: `minResourceFee / 10_000_000`.
   * Null when status !== 'success'.
   */
  minResourceFee: string | null;
  /** Detailed resource breakdown. Null when status !== 'success'. */
  breakdown: SimulateFeeBreakdown | null;
  /** Simulation error message. Null when status !== 'error'. */
  error: string | null;
  /** Timestamp (ms) when the current fee estimate was generated. */
  estimatedAt: number | null;
  /** Timestamp (ms) when the current fee estimate expires. */
  expiresAt: number | null;
  /** True when the estimate has expired according to the expiry policy. */
  isExpired: boolean;
  /** Expiry duration in milliseconds. */
  ttlMs: number;
  /** Imperatively re-estimate fee immediately before signing, returning whether fee changed. */
  refreshFee: () => Promise<{
    minResourceFee: string | null;
    changed: boolean;
    previousFee: string | null;
    newFee: string | null;
  }>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;
const DEFAULT_TTL_MS = 30_000; // 30 seconds fee estimate freshness window
const STROOPS_PER_XLM = 10_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert stroop string to a human-readable XLM value with 7 decimal places. */
export function stroopsToXlm(stroops: string): string {
  const n = Number(stroops);
  if (!Number.isFinite(n)) return '0.0000000';
  return (n / STROOPS_PER_XLM).toFixed(7);
}

// ── Reducer ───────────────────────────────────────────────────────────────────

type State = Omit<UseSimulateFeeResult, 'refreshFee' | 'ttlMs'>;

type Action =
  | { type: 'RESET' }
  | { type: 'LOADING' }
  | {
      type: 'SUCCESS';
      minResourceFee: string;
      breakdown: SimulateFeeBreakdown;
      estimatedAt: number;
      ttlMs: number;
    }
  | { type: 'EXPIRE' }
  | { type: 'ERROR'; error: string };

const initialState: State = {
  status: 'idle',
  minResourceFee: null,
  breakdown: null,
  error: null,
  estimatedAt: null,
  expiresAt: null,
  isExpired: false,
};

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'RESET':
      return initialState;
    case 'LOADING':
      return {
        ...initialState,
        status: 'loading',
      };
    case 'SUCCESS':
      return {
        status: 'success',
        minResourceFee: action.minResourceFee,
        breakdown: action.breakdown,
        error: null,
        estimatedAt: action.estimatedAt,
        expiresAt: action.estimatedAt + action.ttlMs,
        isExpired: false,
      };
    case 'EXPIRE':
      return {
        ..._state,
        isExpired: true,
      };
    case 'ERROR':
      return {
        status: 'error',
        minResourceFee: null,
        breakdown: null,
        error: action.error,
        estimatedAt: null,
        expiresAt: null,
        isExpired: false,
      };
    default:
      return _state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Simulate the `subscribe` transaction and return the fee estimate.
 *
 * @param params     Form field values + formValid gate
 * @param rpcUrl     Override RPC URL (useful in tests)
 * @param contractId Override contract ID (useful in tests)
 * @param networkPassphrase Override network passphrase (useful in tests)
 */
export function useSimulateFee(
  params: SimulateFeeParams,
  rpcUrl = RPC_URL,
  contractId = CONTRACT_ID,
  networkPassphrase = NETWORK_PASSPHRASE,
  ttlMs = DEFAULT_TTL_MS,
): UseSimulateFeeResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const {
    subscriber,
    merchant,
    token,
    amount,
    interval,
    formValid,
  } = params;

  // Track expiry timer
  useEffect(() => {
    if (state.status !== 'success' || !state.expiresAt) return;

    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) {
      dispatch({ type: 'EXPIRE' });
      return;
    }

    const timer = setTimeout(() => {
      dispatch({ type: 'EXPIRE' });
    }, remaining);

    return () => clearTimeout(timer);
  }, [state.status, state.expiresAt]);

  const runSimulation = async (): Promise<{
    minResourceFee: string;
    breakdown: SimulateFeeBreakdown;
  }> => {
    const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    const account = await server.getAccount(subscriber);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'subscribe',
          new Address(subscriber).toScVal(),
          new Address(merchant).toScVal(),
          new Address(token).toScVal(),
          nativeToScVal(BigInt(amount), { type: 'i128' }),
          nativeToScVal(BigInt(interval), { type: 'u64' }),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(simResult.error || 'Simulation failed — see contract requirements.');
    }

    if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
      throw new Error('Simulation returned an unexpected result.');
    }

    const txDataXdr = simResult.transactionData.build();
    const resources = txDataXdr.resources();
    const instrValue = resources.instructions();
    const readValue = resources.readBytes();
    const writeValue = resources.writeBytes();

    return {
      minResourceFee: simResult.minResourceFee,
      breakdown: {
        instructions: typeof instrValue === 'number' ? instrValue : Number(instrValue),
        readBytes: typeof readValue === 'number' ? readValue : Number(readValue),
        writeBytes: typeof writeValue === 'number' ? writeValue : Number(writeValue),
      },
    };
  };

  const refreshFee = async () => {
    const prevFee = state.minResourceFee;
    if (!formValid || !subscriber) {
      return {
        minResourceFee: null,
        changed: false,
        previousFee: prevFee,
        newFee: null,
      };
    }

    try {
      dispatch({ type: 'LOADING' });
      const result = await runSimulation();
      const changed = prevFee !== null && prevFee !== result.minResourceFee;
      dispatch({
        type: 'SUCCESS',
        minResourceFee: result.minResourceFee,
        breakdown: result.breakdown,
        estimatedAt: Date.now(),
        ttlMs,
      });
      return {
        minResourceFee: result.minResourceFee,
        changed,
        previousFee: prevFee,
        newFee: result.minResourceFee,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'ERROR', error: msg });
      return {
        minResourceFee: null,
        changed: false,
        previousFee: prevFee,
        newFee: null,
      };
    }
  };

  useEffect(() => {
    // Reset to idle immediately when form becomes invalid
    if (!formValid || !subscriber) {
      dispatch({ type: 'RESET' });
      return;
    }

    let cancelled = false;

    dispatch({ type: 'LOADING' });

    const timer = setTimeout(async () => {
      if (cancelled) return;

      try {
        const result = await runSimulation();
        if (cancelled) return;

        dispatch({
          type: 'SUCCESS',
          minResourceFee: result.minResourceFee,
          breakdown: result.breakdown,
          estimatedAt: Date.now(),
          ttlMs,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'ERROR', error: msg });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    subscriber,
    merchant,
    token,
    amount,
    interval,
    formValid,
    rpcUrl,
    contractId,
    networkPassphrase,
    ttlMs,
  ]);

  return {
    ...state,
    ttlMs,
    refreshFee,
  };
}
