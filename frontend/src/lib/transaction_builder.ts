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

// ── Merchant subscription query ───────────────────────────────────────────────

/**
 * On-chain subscription record as decoded from `get_merchant_subscriptions`.
 * Mirrors the Rust `SubscriptionData` struct.
 */
export interface SubscriptionData {
  /** SEP-41 token contract address */
  token: string;
  /** Payment amount per interval (in token's smallest unit) */
  amount: bigint;
  /** Seconds between payments */
  interval: bigint;
  /** Unix timestamp when the next payment becomes collectable */
  nextPayment: bigint;
  /** True when subscription payments are suspended */
  isPaused: boolean;
}

/**
 * A subscription paired with its subscriber address.
 * Mirrors the Rust `SubscriptionEntry` struct returned by `get_merchant_subscriptions`.
 */
export interface SubscriptionEntry {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Full subscription state */
  data: SubscriptionData;
}

/**
 * Query all active subscriptions for a merchant by calling
 * `get_merchant_subscriptions` on the SorobanPay contract.
 *
 * This is a read-only simulation — no transaction is submitted and no wallet
 * signature is required.
 *
 * @param merchantAddress  Merchant Stellar G-address to query
 * @param contractId       Deployed SorobanPay contract address
 * @param rpcUrl           Soroban RPC endpoint URL
 * @param networkPassphrase Stellar network passphrase
 * @returns                Array of subscriber–subscription pairs (may be empty)
 */
export async function getMerchantSubscriptions(
  merchantAddress: string,
  contractId: string,
  rpcUrl: string,
  networkPassphrase: string,
): Promise<SubscriptionEntry[]> {
  if (!isValidGAddress(merchantAddress)) {
    throw new Error(`Invalid merchant address: ${merchantAddress}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const contract = new Contract(contractId);

  // Use a placeholder source account for simulation (no auth needed).
  const sourceAccount = await server.getAccount(merchantAddress);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'get_merchant_subscriptions',
        new Address(merchantAddress).toScVal(),
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    const errMsg =
      (simResult as SorobanRpc.Api.SimulationError).error ?? 'Simulation failed';
    throw new Error(`get_merchant_subscriptions simulation error: ${errMsg}`);
  }

  // Decode the returned Vec<SubscriptionEntry> from the simulation result.
  const returnVal = simResult.result?.retval;
  if (!returnVal) {
    return [];
  }

  // The return value is a Soroban Vec of Map (struct) entries.
  // Each map has keys: "subscriber" (Address), "data" (Map of SubscriptionData fields).
  const { scValToNative } = await import('@stellar/stellar-sdk');
  const native = scValToNative(returnVal) as Array<{
    subscriber: string;
    data: {
      token: string;
      amount: bigint;
      interval: bigint;
      next_payment: bigint;
      is_paused: boolean;
    };
  }>;

  return native.map((entry) => ({
    subscriber: entry.subscriber,
    data: {
      token: entry.data.token,
      amount: entry.data.amount,
      interval: entry.data.interval,
      nextPayment: entry.data.next_payment,
      isPaused: entry.data.is_paused,
    },
  }));
}
