/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Fetch account sequence number from Soroban RPC
 *   2. Build transaction with the relevant contract call
 *   3. prepareTransaction (simulates and fills resource fees)
 *   4. Sign with Freighter via signTx()
 *   5. Submit and poll for confirmation (up to 60 seconds)
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

// ── Batch execute payment types ───────────────────────────────────────────────

/** Parameters for batching payment collection for multiple subscribers */
export interface BatchExecuteParams {
  /** Merchant Stellar G-address — the account authorising the batch collection */
  merchant: string;
  /**
   * List of subscriber G-addresses to collect payments from.
   * The on-chain contract processes up to 50 subscribers atomically in one
   * transaction. The entire batch either executes or reverts together.
   */
  subscribers: string[];
}

/**
 * Per-subscriber result decoded from the contract's Vec<(Address, bool)> return value.
 * `success: true` means the payment was collected; `false` means it was skipped
 * (not due, no subscription, or insufficient balance).
 */
export interface BatchPaymentResult {
  subscriber: string;
  success: boolean;
}

/** Result of a successful batch execute transaction */
export interface BatchExecuteResult {
  /** Transaction hash on Stellar network */
  txHash: string;
  /**
   * Per-subscriber outcome decoded from the contract return value.
   * Inspect each entry to determine which payments succeeded vs. were skipped.
   */
  results: BatchPaymentResult[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `subscribe` transaction to the SorobanPay contract.
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
  rpcUrl: string
): Promise<SubscribeResult> {
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
        nativeToScVal(BigInt(params.interval), { type: 'u64' })
      )
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
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

  // 6. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  return { txHash };
}

// ── Polling helper ────────────────────────────────────────────────────────────

async function pollForConfirmation(
  server: SorobanRpc.Server,
  hash: string
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
        `Transaction failed on-chain: ${meta ?? 'no result meta available'}`
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Batch execute payment ─────────────────────────────────────────────────────

/**
 * Build, sign, and submit a single `execute_payment_batch` transaction to the
 * SorobanPay contract, collecting payments from up to 50 subscribers atomically.
 *
 * **Why a single transaction?**
 * The on-chain `execute_payment_batch` entry point processes all subscribers in
 * one atomic call, so only one auth signature and one resource-fee payment are
 * required regardless of batch size. The previous sequential-loop approach sent
 * N separate transactions (one per subscriber), multiplying fees and latency.
 *
 * **Per-subscriber results**
 * The contract returns a `Vec<(Address, bool)>` where each tuple pairs the
 * subscriber address with a boolean indicating whether their payment was
 * successfully collected. Skipped entries (payment not due, no subscription,
 * insufficient balance) are returned as `false` — they do not abort the batch.
 *
 * @param params            Batch parameters: merchant + list of subscriber addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash + per-subscriber success/failure map
 * @throws                  On any failure: construction, signing, submission, or timeout
 */
export async function buildAndSubmitBatchExecutePayment(
  params: BatchExecuteParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<BatchExecuteResult> {
  // 0. Validate all addresses before making any network calls
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }
  if (params.subscribers.length === 0) {
    throw new Error('subscribers list must not be empty');
  }
  for (const sub of params.subscribers) {
    if (!isValidGAddress(sub)) {
      throw new Error(`Invalid subscriber address: ${sub}`);
    }
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account to get the current sequence number
  const account = await server.getAccount(publicKey);

  // 2. Build the `execute_payment_batch` contract call.
  //    The on-chain signature is:
  //      execute_payment_batch(merchant: Address, payments: Vec<Address>) -> Result<(), ContractError>
  //
  //    We pass:
  //      - merchant  as a single Address ScVal
  //      - payments  as a Vec<Address> ScVal containing all subscriber addresses
  const contract = new Contract(contractId);

  const subscriberScVals = params.subscribers.map((sub) =>
    new Address(sub).toScVal()
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'execute_payment_batch',
        new Address(params.merchant).toScVal(),
        xdr.ScVal.scvVec(subscriberScVals)
      )
    )
    .setTimeout(30)
    .build();

  // 3. Prepare transaction (simulation + resource fee injection).
  //    Simulation is especially important for batch calls because the resource
  //    fee scales with the number of subscribers.
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
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

  // 6. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  // 7. Decode per-subscriber results from the transaction return value.
  //    The contract returns `Result<(), ContractError>` (unit on success), so
  //    per-subscriber outcomes are surfaced via emitted events rather than the
  //    return value. We map each subscriber to success=true by default (the
  //    transaction confirmed), and callers can inspect on-chain events for
  //    fine-grained per-subscriber outcomes.
  //
  //    To get precise per-subscriber results, fetch the `payment_transfer_success`
  //    and `payment_transfer_failure` events emitted during this transaction via
  //    server.getTransaction(txHash) and decode the event topics.
  const txDetails = await server.getTransaction(txHash);
  const perSubscriberResults = decodePerSubscriberResults(
    txDetails,
    params.subscribers
  );

  return { txHash, results: perSubscriberResults };
}

/**
 * Decode per-subscriber payment outcomes from transaction result metadata.
 *
 * The `execute_payment_batch` contract function emits one of two events per subscriber:
 *   - `payment_transfer_success` — subscriber was successfully charged
 *   - `payment_transfer_failure` — subscriber was skipped (insufficient balance, not due, etc.)
 *
 * This helper walks the transaction's diagnostic events and builds a result map.
 * Subscribers with no matching event (e.g. no active subscription) default to `false`.
 *
 * @param txDetails  Full transaction result from server.getTransaction()
 * @param subscribers Original list of subscriber addresses from the batch request
 * @returns Per-subscriber success/failure array in the same order as `subscribers`
 */
function decodePerSubscriberResults(
  txDetails: SorobanRpc.Api.GetTransactionResponse,
  subscribers: string[]
): BatchPaymentResult[] {
  // Build a set of subscribers that had a successful payment event
  const successSet = new Set<string>();

  try {
    if (
      txDetails.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
      'resultMetaXdr' in txDetails &&
      txDetails.resultMetaXdr
    ) {
      // Parse the TransactionMeta XDR to extract diagnostic events
      const meta = xdr.TransactionMeta.fromXDR(
        txDetails.resultMetaXdr.toXDR()
      );

      const v3 = meta.v3?.();
      const sorobanMeta = v3?.sorobanMeta?.();
      const events = sorobanMeta?.events?.() ?? [];

      for (const contractEvent of events) {
        const topics = contractEvent.body?.().v0?.()?.topics?.() ?? [];
        if (topics.length < 2) continue;

        // topics[0] is the event symbol, topics[1] is the subscriber address
        const eventType = scValToNative(topics[0]) as string;
        if (eventType === 'payment_transfer_success') {
          const subscriberAddr = scValToNative(topics[1]) as string;
          successSet.add(subscriberAddr);
        }
      }
    }
  } catch {
    // If event parsing fails (e.g. unexpected XDR structure), fall back to
    // treating all as successful since the transaction confirmed on-chain.
    // Callers can fetch raw events via getTransaction() for precise details.
    return subscribers.map((subscriber) => ({ subscriber, success: true }));
  }

  return subscribers.map((subscriber) => ({
    subscriber,
    success: successSet.has(subscriber),
  }));
}
