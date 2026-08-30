/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Fetch account sequence number from Soroban RPC
 *   2. Build transaction with contract call
 *   3. prepareTransaction (simulates and fills resource fees)
 *   4. Sign with Freighter via signTx()
 *   5. Submit ΓåÆ returns txHash immediately (caller handles polling via
 *      useTransactionPoller for the 'confirming' intermediate UI state)
 *
 * The legacy buildAndSubmitSubscribe remains exported for backward compatibility
 * but delegates to the two-phase helpers below.
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';
import { isValidCAddress, isValidGAddress } from './validation';
import { withBackoff, isRpcRetryable, getErrorMessage } from './backoff';

// ΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/** Parameters for creating a new subscription */
export interface SubscribeParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount as a positive integer (in token's smallest unit) */
  amount: number;
  /** Payment interval in seconds [86400, 31536000] */
  interval: number;
}

/** Result of a successful subscription transaction */
export interface SubscribeResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * Intermediate result returned after the transaction is submitted but before
 * it has been confirmed. The caller should pass `txHash` and `server` to
 * `useTransactionPoller.startPolling()` to track the confirmation.
 */
export interface SubmitResult {
  /** Transaction hash (available immediately after sendTransaction) */
  txHash: string;
  /** The SorobanRpc.Server instance used ΓÇö pass to startPolling() */
  server: SorobanRpc.Server;
}

/** Parameters for executing a payment */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address (must match the signer) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** One entry in a batch payment operation */
export interface BatchPaymentEntry {
  /** Subscriber address */
  subscriber: string;
  /** Merchant address */
  merchant: string;
}

/** Per-entry result for batch execute_payment */
export interface BatchPaymentResultEntry {
  subscriber: string;
  merchant: string;
  txHash?: string;
  error?: string;
}

/** Result of batch_execute_payment */
export interface BatchExecutePaymentResult {
  /** Per-entry results */
  results: BatchPaymentResultEntry[];
  /** Count of successful submissions */
  successCount: number;
  /** Count of failed submissions */
  failureCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** @deprecated Use useTransactionPoller (exponential backoff) instead */
const POLL_INTERVAL_MS = 1_000;
/** @deprecated Use useTransactionPoller (exponential backoff) instead */
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total

// ΓöÇΓöÇ Phase 1: build, sign, and submit ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, and submit a `subscribe` transaction with adaptive retry logic.
 *
 * Wraps RPC calls with exponential backoff and jitter:
 *   - getAccount: Retries up to 5 times over ~30s (transient network issues)
 *   - prepareTransaction: Retries up to 3 times over ~15s (mempool congestion)
 *   - sendTransaction: Retries up to 3 times over ~15s (rate limits, temporary RPC issues)
 *
 * Non-retryable errors (signing rejection, invalid addresses, contract errors)
 * are thrown immediately without retry.
 *
 * Returns the transaction hash and server instance as soon as the transaction
 * is accepted by the RPC (status !== 'ERROR'). The caller is responsible for
 * polling for confirmation ΓÇö use `useTransactionPoller.startPolling()`.
 *
 * @throws On validation failure, signing rejection, or persistent submission errors
 */
export async function buildSignAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<SubmitResult> {
  // 0. Validate addresses before making any network calls (non-retryable)
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }
  if (!isValidCAddress(params.token)) {
    throw new Error(`Invalid token contract address: ${params.token}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account with retry (up to 5 attempts, transient network issues)
  const account = await withBackoff(
    () => server.getAccount(publicKey),
    {
      maxRetries: 5,
      baseDelayMs: 300,
      maxDelayMs: 30_000,
      jitterFactor: 0.25,
      isRetryable,
      onRetry: (attempt, error, delayMs) => {
        console.warn(
          `[subscribe] getAccount retry ${attempt}/6 after ${delayMs}ms:`,
          getErrorMessage(error),
        );
      },
    },
  );

  // 2. Build transaction (local operation, no retry needed)
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'subscribe',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        new Address(params.token).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.interval), { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  // 3. Prepare transaction with retry (simulation + resource fee, can fail transiently)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await withBackoff(
      () => server.prepareTransaction(tx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[subscribe] prepareTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction preparation failed after retries: ${msg}`);
  }

  // 4. Sign with Freighter (user action, no retry — if rejected, fail immediately)
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // 5. Submit with retry (rate limits, mempool backlog)
  let sendResult: SorobanRpc.Api.SendTransactionResponse;
  try {
    sendResult = await withBackoff(
      () => server.sendTransaction(parsedTx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[subscribe] sendTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction submission failed after retries: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  // Return immediately ΓÇö polling is handled by useTransactionPoller
  return { txHash: sendResult.hash, server };
}

// ΓöÇΓöÇ Legacy all-in-one function (backward compatibility) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, submit, and poll a `subscribe` transaction to completion.
 *
 * @deprecated Prefer `buildSignAndSubmitSubscribe` + `useTransactionPoller`
 * for the two-phase flow with intermediate 'confirming' state.
 *
 * @param params            Subscription parameters
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On any failure: construction, signing, submission, or timeout
 */
export async function buildAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<SubscribeResult> {
  const { txHash, server } = await buildSignAndSubmitSubscribe(
    params,
    contractId,
    publicKey,
    networkPassphrase,
    rpcUrl,
  );

  // Legacy in-process polling (fixed 1 s interval)
  const confirmedHash = await pollForConfirmation(server, txHash);
  return { txHash: confirmedHash };
}

// ΓöÇΓöÇ Legacy polling helper ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/** @deprecated Use useTransactionPoller (exponential backoff) instead */
async function pollForConfirmation(
  server: SorobanRpc.Server,
  hash: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const result = await server.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const meta = (result as SorobanRpc.Api.GetFailedTransactionResponse).resultMetaXdr;
      throw new Error(
        `Transaction failed on-chain: ${meta ?? 'no result meta available'}`,
      );
    }

    // status === NOT_FOUND ΓÇö still in mempool, continue polling
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ΓöÇΓöÇ execute_payment builder ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, and submit an `execute_payment` transaction with adaptive retry logic.
 *
 * Wraps RPC calls with exponential backoff and jitter:
 *   - getAccount: Retries up to 5 times (transient network issues)
 *   - prepareTransaction: Retries up to 3 times (mempool congestion)
 *   - sendTransaction: Retries up to 3 times (rate limits, temporary RPC issues)
 *
 * The connected merchant wallet must authorize this call. The contract verifies
 * that `merchant == require_auth()` signer and that the payment interval has
 * elapsed (`now >= next_payment`).
 *
 * Non-retryable errors (signing rejection, invalid addresses, contract errors)
 * are thrown immediately without retry.
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or persistent errors
 */
/** Parameters for collecting a single subscriber's payment */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address being charged */
  subscriber: string;
  /** Merchant Stellar G-address (must match the connected wallet) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

export async function buildAndSubmitExecutePayment(
  params: ExecutePaymentParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<ExecutePaymentResult> {
  // Validate before any network calls (non-retryable)
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Fetch account sequence for the signer (merchant) with retry
  const account = await withBackoff(
    () => server.getAccount(publicKey),
    {
      maxRetries: 5,
      baseDelayMs: 300,
      maxDelayMs: 30_000,
      jitterFactor: 0.25,
      isRetryable,
      onRetry: (attempt, error, delayMs) => {
        console.warn(
          `[execute_payment] getAccount retry ${attempt}/6 after ${delayMs}ms:`,
          getErrorMessage(error),
        );
      },
    },
  );

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'execute_payment',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate + inject resource fees with retry
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await withBackoff(
      () => server.prepareTransaction(tx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[execute_payment] prepareTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction preparation failed after retries: ${msg}`);
  }

  // Sign with Freighter (user action, no retry — if rejected, fail immediately)
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // Submit with retry
  let sendResult: SorobanRpc.Api.SendTransactionResponse;
  try {
    sendResult = await withBackoff(
      () => server.sendTransaction(parsedTx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[execute_payment] sendTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction submission failed after retries: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

// ΓöÇΓöÇ batch_execute_payment builder ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Execute payment collection for multiple subscribers sequentially.
 *
 * Each entry is submitted as an independent `execute_payment` transaction.
 * Failures are captured per-entry and do not halt the batch ΓÇö the UI can
 * show partial success with per-row error messages.
 *
 * Note: This is a client-side sequential batch. When the on-chain
 * `batch_execute_payment` entry point is deployed (SC-9), this function
 * should be updated to use a single multi-operation transaction for
 * atomicity and lower fee cost.
 *
 * @param entries           Array of (subscriber, merchant) pairs to collect from
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Per-entry results with success/failure breakdown
 */
/** A single (subscriber, merchant) pair to collect a payment from */
export interface BatchPaymentEntry {
  subscriber: string;
  merchant: string;
}

/** Per-entry outcome plus aggregate counts for a batch execute_payment run */
export interface BatchExecutePaymentResult {
  results: Array<{
    subscriber: string;
    merchant: string;
    /** Present when this entry's transaction succeeded */
    txHash?: string;
    /** Present when this entry failed (validation, signing, or on-chain error) */
    error?: string;
  }>;
  successCount: number;
  failureCount: number;
}

export async function buildAndSubmitBatchExecutePayment(
  entries: BatchPaymentEntry[],
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<BatchExecutePaymentResult> {
  if (entries.length === 0) {
    return { results: [], successCount: 0, failureCount: 0 };
  }

  const results: BatchExecutePaymentResult['results'] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const entry of entries) {
    try {
      const { txHash } = await buildAndSubmitExecutePayment(
        { subscriber: entry.subscriber, merchant: entry.merchant },
        contractId,
        publicKey,
        networkPassphrase,
        rpcUrl,
      );
      results.push({ subscriber: entry.subscriber, merchant: entry.merchant, txHash });
      successCount++;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ subscriber: entry.subscriber, merchant: entry.merchant, error });
      failureCount++;
    }
  }

  return { results, successCount, failureCount };
}

// ── pause_subscription / resume_subscription builders (Issue #795) ────────────

/** Parameters for pausing an active subscription */
export interface PauseSubscriptionParams {
  /** Subscriber Stellar G-address (must match the connected wallet) */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /**
   * Optional unix timestamp (seconds) at which `execute_payment` should
   * automatically clear the pause. Omit to require an explicit
   * `resume_subscription` call to reactivate.
   */
  resumeAt?: number;
}

/** Parameters for resuming a paused subscription */
export interface ResumeSubscriptionParams {
  /** Subscriber Stellar G-address (must match the connected wallet) */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
}

/** Result of a successful pause_subscription transaction */
export interface PauseSubscriptionResult {
  txHash: string;
}

/** Result of a successful resume_subscription transaction */
export interface ResumeSubscriptionResult {
  txHash: string;
}

/**
 * Build, sign, and submit a `pause_subscription` transaction.
 *
 * The connected subscriber wallet must authorize this call. While paused,
 * `execute_payment` rejects collection attempts on-chain — no funds move
 * while a subscription is paused.
 *
 * @param params            Subscriber, merchant, token, and optional auto-resume time
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitPauseSubscription(
  params: PauseSubscriptionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<PauseSubscriptionResult> {
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }
  if (!isValidCAddress(params.token)) {
    throw new Error(`Invalid token contract address: ${params.token}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  // Contract signature is `Option<u64>` — `Some(ts)` encodes as a u64 ScVal,
  // `None` as ScVal::Void (there is no separate "option" wire type).
  const resumeAtScVal =
    params.resumeAt != null
      ? nativeToScVal(BigInt(params.resumeAt), { type: 'u64' })
      : xdr.ScVal.scvVoid();

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'pause_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        new Address(params.token).toScVal(),
        resumeAtScVal,
      ),
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

/**
 * Build, sign, and submit a `resume_subscription` transaction.
 *
 * The connected subscriber wallet must authorize this call. Reactivates a
 * paused subscription immediately — ahead of any `paused_until` timestamp —
 * and the contract recomputes `next_payment` so no charge is due right away.
 *
 * @param params            Subscriber, merchant, and token addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitResumeSubscription(
  params: ResumeSubscriptionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<ResumeSubscriptionResult> {
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }
  if (!isValidCAddress(params.token)) {
    throw new Error(`Invalid token contract address: ${params.token}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'resume_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        new Address(params.token).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}
