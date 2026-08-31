import {
  Address,
  BASE_FEE,
  Contract,
  type Keypair,
  rpc as SorobanRpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export interface ExecutePaymentParams {
  subscriber: string;
  merchant: string;
}

export interface ExecutePaymentOptions {
  server: SorobanRpc.Server;
  contractId: string;
  signer: Keypair;
  networkPassphrase: string;
}

export interface ExecutePaymentResult {
  txHash: string;
}

export class ExecutePaymentHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutePaymentHelperError';
  }
}

/**
 * Submit an execute_payment contract call and wait for on-chain confirmation.
 *
 * This helper centralizes the contract call construction, simulation, signing,
 * transaction submission, and confirmation polling used by the backend payment
 * scheduler and retry flow.
 */
export async function submitExecutePayment(
  params: ExecutePaymentParams,
  options: ExecutePaymentOptions,
): Promise<ExecutePaymentResult> {
  const { server, contractId, signer, networkPassphrase } = options;

  if (!params.subscriber || !params.merchant) {
    throw new ExecutePaymentHelperError('subscriber and merchant are required for execute_payment');
  }

  try {
    new Address(params.subscriber);
    new Address(params.merchant);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Invalid execute_payment addresses: ${msg}`);
  }

  let account;
  try {
    account = await server.getAccount(signer.publicKey());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Failed to fetch signing account: ${msg}`);
  }

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

  let simResult;
  try {
    simResult = await server.simulateTransaction(tx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Simulation failed: ${msg}`);
  }

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const detail = simResult.error ? String(simResult.error) : 'unknown simulation error';
    throw new ExecutePaymentHelperError(`Simulation failed: ${detail}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(signer);

  let sendResult;
  try {
    sendResult = await server.sendTransaction(preparedTx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Send failed: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult ? JSON.stringify(sendResult.errorResult) : 'unknown error';
    throw new ExecutePaymentHelperError(`Send failed: ${detail}`);
  }

  const txHash = sendResult.hash;

  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const status = await server.getTransaction(txHash);

    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { txHash };
    }

    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new ExecutePaymentHelperError(`Transaction failed on-chain: ${txHash}`);
    }
  }

  throw new ExecutePaymentHelperError(`Transaction ${txHash} not confirmed after 30 s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
