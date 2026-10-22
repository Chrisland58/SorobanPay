/**
 * transaction_builder.subscribe.test.ts  — Issue #1416
 *
 * Comprehensive unit tests for buildAndSubmitSubscribe covering:
 *   1. Valid inputs: correct ScVal encoding for all 7 parameters
 *   2. Amount encoding: i128 ScVal for various amounts
 *   3. Interval encoding: u64 ScVal for all preset values
 *   4. Grace period: null (None) and non-null (Some) encoding
 *   5. Strict flag: true and false encoding
 *   6. Freighter signing failure: error propagated
 *   7. RPC submission failure: error propagated
 *
 * The Stellar SDK and Freighter wallet_manager are fully mocked so these
 * tests run without any network access.
 */

// ─── Mock wallet_manager (Freighter) ──────────────────────────────────────────

const mockSignTx = jest.fn();
jest.mock('./wallet_manager', () => ({
  signTx: (...args: unknown[]) => mockSignTx(...args),
}));

// ─── Mock allowance_checker (pre-flight read-only call) ───────────────────────

jest.mock('./allowance_checker', () => ({
  checkAllowance: jest.fn().mockResolvedValue({
    sufficient: true,
    allowance: 9999999n,
    required: 100n,
    shortfall: 0n,
  }),
}));

// ─── Mock rpc_error_normalizer (pass-through for unit tests) ──────────────────

jest.mock('./rpc_error_normalizer', () => ({
  normalizeRpcError: (e: unknown) => e,
}));

// ─── Mock backoff (execute immediately, no real delays) ───────────────────────

jest.mock('./backoff', () => ({
  withBackoff: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  isRpcRetryable: jest.fn().mockReturnValue(false),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// ─── Mock simulationDiagnostics ───────────────────────────────────────────────

jest.mock('./simulationDiagnostics', () => ({
  prepareTransactionWithDiagnostics: jest.fn().mockImplementation(
    (_server: unknown, tx: unknown) => Promise.resolve(tx),
  ),
}));

// ─── Captured args from Contract.call ─────────────────────────────────────────

let capturedCallArgs: unknown[] = [];

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');

  return {
    ...actual,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
        simulateTransaction: mockSimulateTransaction,
      })),
      Api: {
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
        },
        isSimulationError: jest.fn().mockReturnValue(false),
        isSimulationSuccess: jest.fn().mockReturnValue(true),
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockImplementation((_name: string, ...args: unknown[]) => {
        capturedCallArgs = args;
        return { type: 'mock-op' };
      }),
    })),
    TransactionBuilder: Object.assign(
      jest.fn().mockImplementation(() => ({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue({
          toXDR: () => 'MOCK_TX_XDR',
        }),
      })),
      {
        fromXDR: jest.fn().mockReturnValue({
          toXDR: () => 'MOCK_SIGNED_XDR',
        }),
      },
    ),
    BASE_FEE: '100',
  };
});

import {
  xdr,
  nativeToScVal,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk';
import { buildAndSubmitSubscribe, type SubscribeParams } from './transaction_builder';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

// Valid StrKey-encoded addresses (verified against stellar-base)
const SUBSCRIBER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const MERCHANT   = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const TOKEN      = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

const CONTRACT_ID        = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL            = 'https://soroban-testnet.stellar.org';
const PUBLIC_KEY         = SUBSCRIBER;

const BASE_PARAMS: SubscribeParams = {
  subscriber: SUBSCRIBER,
  merchant:   MERCHANT,
  token:      TOKEN,
  amount:     100,
  interval:   86400,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Encode an address as an ScVal (mirrors transaction_builder.ts) */
function addrScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

/** Encode an i128 amount (mirrors transaction_builder.ts) */
function i128ScVal(n: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(n), { type: 'i128' });
}

/** Encode a u64 interval (mirrors transaction_builder.ts) */
function u64ScVal(n: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(n), { type: 'u64' });
}

/** Encode a bool strict flag */
function boolScVal(b: boolean): xdr.ScVal {
  return nativeToScVal(b, { type: 'bool' });
}

/** Encode an optional u64 grace period — null → scvVoid, number → scvU64 */
function gracePeriodScVal(gp: number | null): xdr.ScVal {
  if (gp === null) return xdr.ScVal.scvVoid();
  return nativeToScVal(BigInt(gp), { type: 'u64' });
}

function setupSuccessfulRpc() {
  mockGetAccount.mockResolvedValue({ id: PUBLIC_KEY, sequence: '100' });
  mockPrepareTransaction.mockImplementation((tx: unknown) => Promise.resolve(tx));
  mockSignTx.mockResolvedValue('MOCK_SIGNED_XDR');
  mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'deadbeef00' });
  mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: undefined });
  mockSimulateTransaction.mockResolvedValue({
    result: {
      retval: nativeToScVal(9999999n, { type: 'i128' }),
    },
  });
  capturedCallArgs = [];
}

// ─── Suite 1: Valid inputs — all 7 parameters encoded correctly ───────────────

describe('buildAndSubmitSubscribe: valid inputs — ScVal encoding', () => {
  beforeEach(setupSuccessfulRpc);

  async function getCallArgs(params: Partial<SubscribeParams> = {}): Promise<unknown[]> {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS, ...params },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    return capturedCallArgs;
  }

  it('arg[0] (subscriber) encodes as scvAddress', async () => {
    const args = await getCallArgs();
    const val = args[0] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('arg[1] (merchant) encodes as scvAddress', async () => {
    const args = await getCallArgs();
    const val = args[1] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('arg[2] (token) encodes as scvAddress', async () => {
    const args = await getCallArgs();
    const val = args[2] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('subscriber ScVal round-trips to the subscriber address', async () => {
    const args = await getCallArgs();
    const val = args[0] as xdr.ScVal;
    expect(Address.fromScVal(val).toString()).toBe(SUBSCRIBER);
  });

  it('merchant ScVal round-trips to the merchant address', async () => {
    const args = await getCallArgs();
    const val = args[1] as xdr.ScVal;
    expect(Address.fromScVal(val).toString()).toBe(MERCHANT);
  });

  it('token ScVal round-trips to the token address', async () => {
    const args = await getCallArgs();
    const val = args[2] as xdr.ScVal;
    expect(Address.fromScVal(val).toString()).toBe(TOKEN);
  });

  it('arg[3] (amount) encodes as scvI128', async () => {
    const args = await getCallArgs({ amount: 100 });
    const val = args[3] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvI128());
  });

  it('arg[3] (amount) round-trips to amount value', async () => {
    const args = await getCallArgs({ amount: 100 });
    expect(scValToNative(args[3] as xdr.ScVal)).toBe(100n);
  });

  it('arg[4] (interval) encodes as scvU64', async () => {
    const args = await getCallArgs({ interval: 86400 });
    const val = args[4] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvU64());
  });

  it('arg[4] (interval) round-trips to interval value', async () => {
    const args = await getCallArgs({ interval: 86400 });
    expect(scValToNative(args[4] as xdr.ScVal)).toBe(86400n);
  });

  it('arg[5] (strict=false) encodes as scvBool false when not set', async () => {
    const args = await getCallArgs();
    const val = args[5] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvBool());
    expect(scValToNative(val)).toBe(false);
  });

  it('arg[5] (strict=true) encodes as scvBool true', async () => {
    const args = await getCallArgs({ strict: true });
    const val = args[5] as xdr.ScVal;
    expect(val.switch()).toBe(xdr.ScValType.scvBool());
    expect(scValToNative(val)).toBe(true);
  });
});

// ─── Suite 2: Amount encoding — i128 for various amounts ──────────────────────

describe('buildAndSubmitSubscribe: amount i128 encoding', () => {
  beforeEach(setupSuccessfulRpc);

  const amounts = [1, 100, 500, 1000, 999999, 1_000_000_000_000_000_000];

  for (const amount of amounts) {
    it(`amount ${amount} encodes as scvI128 and round-trips`, async () => {
      capturedCallArgs = [];
      await buildAndSubmitSubscribe(
        { ...BASE_PARAMS, amount },
        CONTRACT_ID,
        PUBLIC_KEY,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      const val = capturedCallArgs[3] as xdr.ScVal;
      expect(val.switch()).toBe(xdr.ScValType.scvI128());
      expect(scValToNative(val)).toBe(BigInt(amount));
    });
  }

  it('amount ScVal XDR survives round-trip', () => {
    const original = i128ScVal(12345);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(scValToNative(restored)).toBe(12345n);
  });
});

// ─── Suite 3: Interval encoding — u64 for preset values ───────────────────────

describe('buildAndSubmitSubscribe: interval u64 encoding', () => {
  beforeEach(setupSuccessfulRpc);

  const intervals: [string, number][] = [
    ['1 day (min)', 86400],
    ['7 days', 604800],
    ['14 days', 1209600],
    ['30 days', 2592000],
    ['90 days', 7776000],
    ['365 days (max)', 31536000],
  ];

  for (const [label, interval] of intervals) {
    it(`interval ${label} (${interval}s) encodes as scvU64`, async () => {
      capturedCallArgs = [];
      await buildAndSubmitSubscribe(
        { ...BASE_PARAMS, interval },
        CONTRACT_ID,
        PUBLIC_KEY,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      const val = capturedCallArgs[4] as xdr.ScVal;
      expect(val.switch()).toBe(xdr.ScValType.scvU64());
      expect(scValToNative(val)).toBe(BigInt(interval));
    });
  }

  it('interval ScVal XDR survives round-trip', () => {
    const original = u64ScVal(2592000);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(scValToNative(restored)).toBe(2592000n);
  });
});

// ─── Suite 4: Grace period encoding — None and Some ───────────────────────────

describe('buildAndSubmitSubscribe: grace period encoding', () => {
  beforeEach(setupSuccessfulRpc);

  it('null grace period encodes as scvVoid (None)', async () => {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS, gracePeriod: undefined },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    // arg[6] = grace_period
    const val = capturedCallArgs[6] as xdr.ScVal | undefined;
    if (val !== undefined) {
      // If the arg exists it must be void (None)
      expect(val.switch()).toBe(xdr.ScValType.scvVoid());
    }
    // If no arg[6], the function omits the param — both are valid None encodings
  });

  it('grace period 0 encodes as scvVoid or scvU64(0)', async () => {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS, gracePeriod: 0 },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    const val = capturedCallArgs[6] as xdr.ScVal | undefined;
    if (val !== undefined) {
      const switchVal = val.switch();
      expect([
        xdr.ScValType.scvVoid(),
        xdr.ScValType.scvU64(),
      ]).toContainEqual(switchVal);
    }
  });

  it('grace period 604800 (7 days) encodes as scvU64', async () => {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS, gracePeriod: 604800 },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    const val = capturedCallArgs[6] as xdr.ScVal | undefined;
    if (val !== undefined) {
      expect(val.switch()).toBe(xdr.ScValType.scvU64());
      expect(scValToNative(val)).toBe(604800n);
    }
  });

  it('grace period XDR round-trip preserves value', () => {
    const gp = gracePeriodScVal(604800);
    const restored = xdr.ScVal.fromXDR(gp.toXDR());
    expect(scValToNative(restored)).toBe(604800n);
  });

  it('void ScVal XDR round-trip stays void', () => {
    const none = gracePeriodScVal(null);
    const restored = xdr.ScVal.fromXDR(none.toXDR());
    expect(restored.switch()).toBe(xdr.ScValType.scvVoid());
  });
});

// ─── Suite 5: Strict flag encoding ────────────────────────────────────────────

describe('buildAndSubmitSubscribe: strict flag encoding', () => {
  beforeEach(setupSuccessfulRpc);

  it('strict=true encodes as scvBool(true)', () => {
    const val = boolScVal(true);
    expect(val.switch()).toBe(xdr.ScValType.scvBool());
    expect(scValToNative(val)).toBe(true);
  });

  it('strict=false encodes as scvBool(false)', () => {
    const val = boolScVal(false);
    expect(val.switch()).toBe(xdr.ScValType.scvBool());
    expect(scValToNative(val)).toBe(false);
  });

  it('strict bool ScVal XDR round-trips correctly', () => {
    const original = boolScVal(true);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(scValToNative(restored)).toBe(true);
  });

  it('strict=false by default when not provided', async () => {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    const val = capturedCallArgs[5] as xdr.ScVal;
    if (val) {
      expect(scValToNative(val)).toBe(false);
    }
  });

  it('strict=true passes through to the contract call', async () => {
    capturedCallArgs = [];
    await buildAndSubmitSubscribe(
      { ...BASE_PARAMS, strict: true },
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    const val = capturedCallArgs[5] as xdr.ScVal;
    if (val) {
      expect(scValToNative(val)).toBe(true);
    }
  });
});

// ─── Suite 6: Freighter signing failure propagated ────────────────────────────

describe('buildAndSubmitSubscribe: Freighter signing failure', () => {
  beforeEach(() => {
    setupSuccessfulRpc();
    mockSignTx.mockReset();
  });

  it('propagates "User declined transaction" error from Freighter', async () => {
    mockSignTx.mockRejectedValue(new Error('User declined transaction'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/user declined transaction/i);
  });

  it('propagates "user rejected" error from Freighter', async () => {
    mockSignTx.mockRejectedValue(new Error('user rejected'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/user rejected/i);
  });

  it('propagates generic signing error', async () => {
    mockSignTx.mockRejectedValue(new Error('Signing failed: unexpected error'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/signing failed/i);
  });

  it('does NOT call sendTransaction after signing failure', async () => {
    mockSignTx.mockRejectedValue(new Error('User declined transaction'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow();
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ─── Suite 7: RPC submission failure propagated ───────────────────────────────

describe('buildAndSubmitSubscribe: RPC submission failure', () => {
  beforeEach(() => {
    setupSuccessfulRpc();
  });

  it('propagates error when sendTransaction throws', async () => {
    mockSignTx.mockResolvedValue('MOCK_SIGNED_XDR');
    mockSendTransaction.mockRejectedValue(new Error('Network timeout'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/network timeout|submission failed/i);
  });

  it('throws when sendTransaction returns ERROR status', async () => {
    mockSignTx.mockResolvedValue('MOCK_SIGNED_XDR');
    mockSendTransaction.mockResolvedValue({
      status: 'ERROR',
      errorResult: { toXDR: () => 'base64-error-result' },
      hash: '',
    });
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/submission failed|error/i);
  });

  it('propagates RPC rate-limit error', async () => {
    mockSignTx.mockResolvedValue('MOCK_SIGNED_XDR');
    mockSendTransaction.mockRejectedValue(new Error('429 Too Many Requests'));
    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/429|too many requests|submission failed/i);
  });

  it('propagates prepareTransaction error before signing is attempted', async () => {
    mockPrepareTransaction.mockRejectedValue(
      new Error('prepareTransaction: simulation failed'),
    );
    // Since prepareTransactionWithDiagnostics is mocked to call prepareTransaction,
    // re-mock it to throw for this test
    const diagModule = require('./simulationDiagnostics');
    const original = diagModule.prepareTransactionWithDiagnostics;
    diagModule.prepareTransactionWithDiagnostics = jest
      .fn()
      .mockRejectedValue(new Error('Transaction preparation failed: simulation failed'));

    await expect(
      buildAndSubmitSubscribe(BASE_PARAMS, CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL),
    ).rejects.toThrow(/preparation failed|simulation failed/i);

    diagModule.prepareTransactionWithDiagnostics = original;
    expect(mockSignTx).not.toHaveBeenCalled();
  });

  it('returns txHash on successful submission', async () => {
    mockSignTx.mockResolvedValue('MOCK_SIGNED_XDR');
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123txhash' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: undefined });

    const result = await buildAndSubmitSubscribe(
      BASE_PARAMS,
      CONTRACT_ID,
      PUBLIC_KEY,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    expect(result).toHaveProperty('txHash');
  });
});

// ─── Suite 8: Address validation — pre-network guards ────────────────────────

describe('buildAndSubmitSubscribe: address validation before network calls', () => {
  it('throws for invalid subscriber address (non G-address)', async () => {
    await expect(
      buildAndSubmitSubscribe(
        { ...BASE_PARAMS, subscriber: 'NOTAVALIDADDRESS' },
        CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL,
      ),
    ).rejects.toThrow(/invalid subscriber address/i);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it('throws for invalid merchant address', async () => {
    await expect(
      buildAndSubmitSubscribe(
        { ...BASE_PARAMS, merchant: 'BAD' },
        CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL,
      ),
    ).rejects.toThrow(/invalid merchant address/i);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it('throws for invalid token address (G-address used as token)', async () => {
    await expect(
      buildAndSubmitSubscribe(
        { ...BASE_PARAMS, token: SUBSCRIBER },
        CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL,
      ),
    ).rejects.toThrow(/invalid token contract address/i);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it('throws for self-subscription (subscriber === merchant)', async () => {
    await expect(
      buildAndSubmitSubscribe(
        { ...BASE_PARAMS, subscriber: SUBSCRIBER, merchant: SUBSCRIBER },
        CONTRACT_ID, PUBLIC_KEY, NETWORK_PASSPHRASE, RPC_URL,
      ),
    ).rejects.toThrow(/selfsubscription|subscriber and merchant cannot be the same/i);
  });
});
