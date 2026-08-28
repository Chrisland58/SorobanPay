/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Fetch account sequence number from Soroban RPC
 *   2. Build transaction with `subscribe` contract call
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
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';

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

// ── Pause / Resume ────────────────────────────────────────────────────────────

/** Parameters for pause_subscription and resume_subscription calls. */
export interface SubscriptionActionParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

/** Result of a successful pause/resume transaction */
export interface ActionResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * Build, sign, and submit a `pause_subscription` transaction.
 *
 * @param params            Subscriber and merchant addresses
 * @param pauseUntil        Unix timestamp (seconds) when the pause should auto-expire.
 *                          Pass 0 for an indefinite pause.
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 */
export async function buildAndSubmitPauseSubscription(
  params: SubscriptionActionParams,
  pauseUntil: number,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<ActionResult> {
  const server  = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      contract.call(
        'pause_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        nativeToScVal(BigInt(pauseUntil), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Pause transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  const parsedTx  = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Pause submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

/**
 * Build, sign, and submit a `resume_subscription` transaction.
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 */
export async function buildAndSubmitResumeSubscription(
  params: SubscriptionActionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<ActionResult> {
  const server  = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      contract.call(
        'resume_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Resume transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  const parsedTx  = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Resume submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

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
