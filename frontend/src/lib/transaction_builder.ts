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
 *
 * All errors thrown are {@link ContractLifecycleError} instances with a
 * stable {@link ContractLifecycleErrorCode} so UI consumers can switch on
 * typed codes rather than pattern-matching raw strings.
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
import {
  ContractLifecycleError,
  ContractLifecycleErrorCode,
} from './errors';

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
 * @throws {@link ContractLifecycleError} on any failure in the build/sign/submit/confirm pipeline
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
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.VALIDATION_ERROR,
      `Invalid subscriber address: ${params.subscriber}`,
    );
  }
  if (!isValidGAddress(params.merchant)) {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.VALIDATION_ERROR,
      `Invalid merchant address: ${params.merchant}`,
    );
  }
  if (!isValidCAddress(params.token)) {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.VALIDATION_ERROR,
      `Invalid token contract address: ${params.token}`,
    );
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account
  let account: Awaited<ReturnType<typeof server.getAccount>>;
  try {
    account = await server.getAccount(publicKey);
  } catch (err: unknown) {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      `Failed to fetch account: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

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
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      `Transaction preparation failed: ${msg}`,
      err,
    );
  }

  // 4. Sign with Freighter
  let signedXdr: string;
  try {
    signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish explicit user cancellation from other signing failures
    const isUserCancel = /user (declined|rejected|cancelled|dismissed)/i.test(msg);
    throw new ContractLifecycleError(
      isUserCancel
        ? ContractLifecycleErrorCode.USER_CANCELLED
        : ContractLifecycleErrorCode.SIGNING_FAILED,
      msg,
      err,
    );
  }

  // 5. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  let sendResult: Awaited<ReturnType<typeof server.sendTransaction>>;
  try {
    sendResult = await server.sendTransaction(parsedTx);
  } catch (err: unknown) {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.SUBMISSION_FAILED,
      `Transaction submission failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (sendResult.status === 'ERROR') {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.SUBMISSION_FAILED,
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
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
      throw new ContractLifecycleError(
        ContractLifecycleErrorCode.CONFIRMATION_FAILED,
        `Transaction failed on-chain: ${meta ?? 'no result meta available'}`,
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw new ContractLifecycleError(
    ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT,
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
