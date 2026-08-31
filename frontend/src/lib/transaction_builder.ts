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
 *   5. Submit → returns txHash immediately (caller handles polling via
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
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';
import { isValidCAddress, isValidGAddress } from './validation';

// ── Types ─────────────────────────────────────────────────────────────────────

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

/** Parameters for collecting a recurring payment from a single subscriber */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address (the account being charged) */
  subscriber: string;
  /** Merchant Stellar G-address (the account receiving payment) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** A single entry in a batch payment collection request */
export interface BatchPaymentEntry {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

/** Per-entry result from a batch execute_payment run */
export interface BatchPaymentEntryResult {
  subscriber: string;
  merchant: string;
  /** Set on success */
  txHash?: string;
  /** Set on failure */
  error?: string;
}

/** Aggregate result returned by buildAndSubmitBatchExecutePayment */
export interface BatchExecutePaymentResult {
  /** Individual outcome per (subscriber, merchant) pair */
  results: BatchPaymentEntryResult[];
  /** Number of entries that succeeded */
  successCount: number;
  /** Number of entries that failed */
  failureCount: number;
}

/**
 * Intermediate result returned after the transaction is submitted but before
 * it has been confirmed. The caller should pass `txHash` and `server` to
 * `useTransactionPoller.startPolling()` to track the confirmation.
 */
export interface SubmitResult {
  /** Transaction hash (available immediately after sendTransaction) */
  txHash: string;
  /** The SorobanRpc.Server instance used — pass to startPolling() */
  server: SorobanRpc.Server;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** @deprecated Use useTransactionPoller (exponential backoff) instead */
const POLL_INTERVAL_MS = 1_000;
/** @deprecated Use useTransactionPoller (exponential backoff) instead */
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total

// ── Phase 1: build, sign, and submit ─────────────────────────────────────────
//
// HOW buildAndSubmitSubscribe WORKS
// ──────────────────────────────────
// The two exported entry points for creating a subscription follow the same
// five-step pipeline under the hood:
//
//   Step 1  getAccount(publicKey)
//           Fetches the current sequence number from the Soroban RPC so the
//           TransactionBuilder can construct a valid envelope.
//
//   Step 2  TransactionBuilder.addOperation(contract.call('subscribe', …))
//           Encodes the on-chain `subscribe` call with the five contract
//           arguments (subscriber, merchant, token, amount, interval) as
//           ScVal types. No network round-trip yet.
//
//   Step 3  server.prepareTransaction(tx)
//           Sends a simulation request to the RPC. The RPC runs the contract
//           in a sandbox, calculates the exact resource fee, and returns an
//           updated transaction XDR with the fee injected.  This step also
//           surfaces contract-level errors (bad args, rule violations) early —
//           before any signature is requested from the user.
//
//   Step 4  signTx(preparedTx.toXDR(), networkPassphrase)
//           Passes the XDR to Freighter (via wallet_manager.signTx), which
//           shows the user a signing prompt. Returns the signed XDR on
//           approval; throws on rejection.
//
//   Step 5  server.sendTransaction(parsedTx)
//           Submits the signed transaction to the Soroban RPC. Returns
//           immediately with a status of PENDING, DUPLICATE, or ERROR.
//           The function throws on ERROR; for PENDING/DUPLICATE it returns
//           { txHash, server } so the caller can poll for confirmation via
//           `useTransactionPoller.startPolling(txHash, server)`.
//
// The legacy `buildAndSubmitSubscribe` wraps this pipeline and additionally
// polls in-process (fixed 1 s interval) until the transaction is confirmed or
// times out, returning only the confirmed hash.  Prefer the two-phase approach
// (`buildSignAndSubmitSubscribe` + `useTransactionPoller`) for UIs that need
// intermediate loading states.
//
//
// HOW TO ADD A NEW CONTRACT ENTRY POINT
// ──────────────────────────────────────
// All on-chain operations in this file share the same five-step structure.
// To wrap a new contract function (e.g. `pause(subscriber, merchant)`):
//
//   1. Define the parameter / result interfaces above (SubscribeParams style).
//
//   2. Validate all Address arguments with isValidGAddress / isValidCAddress
//      before making any network calls so the user gets a clear error
//      message rather than an opaque RPC rejection.
//
//   3. Construct the operation:
//        contract.call(
//          'pause',
//          new Address(params.subscriber).toScVal(),
//          new Address(params.merchant).toScVal(),
//        )
//      Use nativeToScVal(BigInt(n), { type: 'i128' }) for integers,
//      nativeToScVal(BigInt(n), { type: 'u64' }) for timestamps/intervals,
//      and nativeToScVal(flag, { type: 'bool' }) for booleans.
//
//   4. Wrap prepareTransaction in a try/catch and re-throw with a
//      human-readable message (see the pattern in buildSignAndSubmitSubscribe).
//
//   5. Decide whether to poll in-process (like buildAndSubmitExecutePayment)
//      or return early for the two-phase UX (like buildSignAndSubmitSubscribe).
//      For user-facing flows that benefit from a live progress indicator,
//      prefer the two-phase approach.
//
//   6. Export the function and add it to the barrel export in src/lib/index.ts
//      (if one exists), then import it in the relevant component.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `subscribe` transaction.
 *
 * Returns the transaction hash and server instance as soon as the transaction
 * is accepted by the RPC (status !== 'ERROR'). The caller is responsible for
 * polling for confirmation — use `useTransactionPoller.startPolling()`.
 *
 * @throws On validation failure, signing rejection, or submission error.
 */
export async function buildSignAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<SubmitResult> {
  // 0. Validate addresses before making any network calls
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

  // 1. Fetch account
  const account = await server.getAccount(publicKey);

  // 2. Build transaction
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

  // 3. Prepare transaction (simulation + resource fee injection)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  // 4. Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // 5. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  // Return immediately — polling is handled by useTransactionPoller
  return { txHash: sendResult.hash, server };
}

// ── Legacy all-in-one function (backward compatibility) ───────────────────────

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

// ── Legacy polling helper ─────────────────────────────────────────────────────

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

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── execute_payment builder ───────────────────────────────────────────────────

/**
 * Build, sign, and submit an `execute_payment` transaction.
 *
 * The connected merchant wallet must authorize this call. The contract verifies
 * that `merchant == require_auth()` signer and that the payment interval has
 * elapsed (`now >= next_payment`).
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitExecutePayment(
  params: ExecutePaymentParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<ExecutePaymentResult> {
  // Validate before any network calls
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Fetch account sequence for the signer (merchant)
  const account = await server.getAccount(publicKey);

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

  // Simulate + inject resource fees
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  // Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // Submit
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

// ── batch_execute_payment builder ─────────────────────────────────────────────

/**
 * Execute payment collection for multiple subscribers sequentially.
 *
 * Each entry is submitted as an independent `execute_payment` transaction.
 * Failures are captured per-entry and do not halt the batch — the UI can
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
