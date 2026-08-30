/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Validate addresses (synchronous — throws before any network call)
 *   2. Check subscriber's token allowance via simulateTransaction (read-only)
 *   3. Fetch account sequence number from Soroban RPC
 *   4. Build transaction with `subscribe` contract call (including `strict` flag)
 *   5. prepareTransaction (simulates and fills resource fees)
 *   6. Sign with Freighter via signTx()
 *   7. Submit and poll for confirmation (up to 60 seconds)
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
import { normalizeRpcError } from './rpc_error_normalizer';
import { checkAllowance, type AllowanceResult } from './allowance_checker';

// Re-export NormalizedRpcError so callers can import from one place.
export type { NormalizedRpcError, RpcErrorCategory } from './rpc_error_normalizer';

// Re-export AllowanceResult for callers that want structured allowance data.
export type { AllowanceResult } from './allowance_checker';

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
  /**
   * When `true`, the on-chain `subscribe` call will reject with
   * `InsufficientAllowance` if the subscriber's current allowance is below
   * `amount`. When `false` (default) the contract emits a `low_allowance`
   * event instead of reverting, giving the subscriber time to approve more.
   *
   * The front-end performs its own pre-flight check via `checkAllowance`
   * regardless of this flag, and surfaces a warning to the user when the
   * allowance is insufficient. Set `strict = true` to also enforce the check
   * on-chain as a hard gate.
   */
  strict?: boolean;
}

/** Result of a successful subscription transaction */
export interface SubscribeResult {
  /** Transaction hash on Stellar network */
  txHash: string;
  /**
   * Allowance state at the time the transaction was submitted.
   * Populated from the pre-flight `checkAllowance` call.
   * `null` when the allowance check was skipped (e.g. test environments
   * where the RPC is unavailable before building).
   */
  allowanceCheck: AllowanceResult | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `subscribe` transaction to the SorobanPay contract.
 *
 * Before building the transaction a **read-only allowance check** is performed
 * via `simulateTransaction`. The result is included in the return value so the
 * caller can surface a low-allowance warning even after a successful submission.
 *
 * @param params            Subscription parameters (including optional `strict`)
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash and pre-flight allowance check result
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

  const strict = params.strict ?? false;
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Pre-flight allowance check (read-only, no fees, no signing)
  //    This mirrors what the on-chain `subscribe` does before writing storage.
  //    A failure here is non-fatal unless `strict` is true — we surface the
  //    result to the caller but still proceed with the transaction.
  let allowanceCheck: AllowanceResult | null = null;
  try {
    allowanceCheck = await checkAllowance({
      subscriberAddress: params.subscriber,
      tokenContractId: params.token,
      contractId,
      requiredAmount: BigInt(params.amount),
      rpcUrl,
      networkPassphrase,
    });

    if (strict && !allowanceCheck.sufficient) {
      throw new Error(
        `Insufficient token allowance: have ${allowanceCheck.allowance}, ` +
        `need ${BigInt(params.amount)} ` +
        `(shortfall: ${allowanceCheck.shortfall}). ` +
        `Approve more tokens in your wallet before subscribing.`,
      );
    }
  } catch (err) {
    // If strict mode threw above, re-throw it immediately
    if (
      strict &&
      err instanceof Error &&
      err.message.startsWith('Insufficient token allowance')
    ) {
      throw err;
    }
    // For non-strict mode or unexpected errors (network hiccup, unsupported
    // token contract), log and continue — the on-chain call is the source of
    // truth and will emit its own low_allowance event if needed.
    console.warn(
      '[allowance_checker] Pre-flight allowance check failed; proceeding anyway.',
      err,
    );
    allowanceCheck = null;
  }

  // 2. Fetch account
  const account = await server.getAccount(publicKey);

  // 3. Build transaction
  //    The `subscribe` entry point now takes 6 positional arguments:
  //      subscriber, merchant, token, amount, interval, strict
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
        // strict: bool — tells the contract to hard-reject on low allowance
        nativeToScVal(strict, { type: 'bool' }),
      )
    )
    .setTimeout(30)
    .build();

  // 4. Prepare transaction (simulation + resource fee injection)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Wrap in a descriptive message so the normalizer can classify it, then
    // throw the NormalizedRpcError so callers receive structured metadata.
    throw normalizeRpcError(new Error(`Transaction preparation failed: ${msg}`));
  }

  // 5. Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // 6. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw normalizeRpcError(
      new Error(
        `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
      )
    );
  }

  // 7. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  return { txHash, allowanceCheck };
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
      throw normalizeRpcError(
        new Error(
          `Transaction failed on-chain: ${meta ?? 'no result meta available'}`
        )
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw normalizeRpcError(
    new Error(
      `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`
    )
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
