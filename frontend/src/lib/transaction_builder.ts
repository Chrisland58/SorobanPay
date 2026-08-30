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

/**
 * On-chain subscription record returned by `get_subscription`.
 * Field types mirror the Rust `SubscriptionData` struct.
 */
export interface SubscriptionData {
  /** SEP-41 token contract address used for payments */
  token: string;
  /** Payment amount per interval, in token's smallest unit */
  amount: bigint;
  /** Seconds between payments */
  interval: bigint;
  /** Unix timestamp (seconds) of the next valid payment window */
  next_payment: bigint;
  /** Whether payments are currently paused */
  is_paused: boolean;
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

// ── getSubscription ───────────────────────────────────────────────────────────

/**
 * Query active subscription details for a (subscriber, merchant) pair.
 *
 * Calls the read-only `get_subscription` view function on the SorobanPay
 * contract. No wallet signature is required — this is a pure simulation that
 * does not submit a transaction to the network.
 *
 * @param subscriber        Subscriber G-address
 * @param merchant          Merchant G-address
 * @param contractId        Deployed SorobanPay contract address
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 `SubscriptionData` if a subscription exists, or `null` if not found
 * @throws                  On invalid addresses or RPC/simulation errors
 */
export async function getSubscription(
  subscriber: string,
  merchant: string,
  contractId: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<SubscriptionData | null> {
  if (!isValidGAddress(subscriber)) {
    throw new Error(`Invalid subscriber address: ${subscriber}`);
  }
  if (!isValidGAddress(merchant)) {
    throw new Error(`Invalid merchant address: ${merchant}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Fetch a source account for building the simulation transaction.
  // We use the subscriber address as the fee source because it is already
  // validated. The account does not need to sign; simulation is read-only.
  const account = await server.getAccount(subscriber);

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'get_subscription',
        new Address(subscriber).toScVal(),
        new Address(merchant).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    const errMsg =
      (simResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error ??
      'Simulation failed';
    throw new Error(`get_subscription simulation error: ${errMsg}`);
  }

  const successResult = simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  const returnVal = successResult.result?.retval;

  // Option::None from the contract comes back as ScvVoid
  if (!returnVal || returnVal.switch().name === 'scvVoid') {
    return null;
  }

  // Decode the SubscriptionData map from ScVal
  const native = scValToNative(returnVal) as Record<string, unknown> | null | undefined;
  if (native == null) {
    return null;
  }

  return {
    token:        String(native['token']),
    amount:       BigInt(String(native['amount'])),
    interval:     BigInt(String(native['interval'])),
    next_payment: BigInt(String(native['next_payment'])),
    is_paused:    Boolean(native['is_paused']),
  };
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
