/**
 * transaction_builder.preflight.test.ts
 *
 * Verifies that buildAndSubmitSubscribe enforces transaction size limits
 * (operation count and XDR byte size) after prepareTransaction and before
 * the wallet signing prompt opens.
 *
 * The limits are injected via the mocked @/constants/network module so
 * the tests are self-contained and do not depend on env vars.
 */

// ─── Mock network constants ───────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  MAX_OPERATIONS_PER_TX: 3,
  MAX_TX_BYTE_SIZE: 200,
}));

// ─── Shared RPC mocks ─────────────────────────────────────────────────────────

const mockGetAccount        = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction   = jest.fn();
const mockGetTransaction    = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const NOT_FOUND = 'NOT_FOUND';
  return {
    Contract: jest.fn().mockReturnValue({
      call: jest.fn().mockReturnValue({}),
    }),
    TransactionBuilder: Object.assign(
      jest.fn().mockReturnValue({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout:   jest.fn().mockReturnThis(),
        build:        jest.fn().mockReturnValue({ toXDR: () => 'MOCK_XDR' }),
      }),
      { fromXDR: jest.fn().mockReturnValue({}) },
    ),
    BASE_FEE:      '100',
    nativeToScVal: jest.fn().mockReturnValue({}),
    Address:       jest.fn().mockReturnValue({ toScVal: jest.fn().mockReturnValue({}) }),
    xdr:           {},
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount:          mockGetAccount,
        prepareTransaction:  mockPrepareTransaction,
        sendTransaction:     mockSendTransaction,
        getTransaction:      mockGetTransaction,
      })),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND },
      },
    },
  };
});

jest.mock('@/lib/wallet_manager', () => ({
  signTx: jest.fn().mockResolvedValue('SIGNED_XDR'),
}));

import { buildAndSubmitSubscribe } from './transaction_builder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  subscriber: 'G' + 'A'.repeat(55),
  merchant:   'G' + 'B'.repeat(55),
  token:      'C' + 'A'.repeat(55),
  amount:     100,
  interval:   86400,
};
const CONTRACT_ID        = 'C' + 'A'.repeat(55);
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL            = 'https://soroban-testnet.stellar.org';

function call() {
  return buildAndSubmitSubscribe(
    VALID_PARAMS,
    CONTRACT_ID,
    VALID_PARAMS.subscriber,
    NETWORK_PASSPHRASE,
    RPC_URL,
  );
}

beforeEach(() => {
  mockGetAccount.mockResolvedValue({ id: VALID_PARAMS.subscriber, sequence: '0' });
});

afterEach(() => jest.clearAllMocks());

// ─── Operation count limit ────────────────────────────────────────────────────

describe('buildAndSubmitSubscribe – operation count preflight', () => {
  it('passes when operation count is within the limit', async () => {
    // 1 operation ≤ limit of 3 — passes preflight; then signing + submission proceed.
    // We mock sendTransaction to return SUCCESS so the full flow completes.
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),     // 50 chars ≈ 37 bytes — within 200
      operations: [{}],                      // 1 operation
    });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'testhash' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await expect(call()).resolves.toEqual({ txHash: 'testhash' });
  });

  it('throws before signing when operation count exceeds the limit', async () => {
    // 4 operations > limit of 3
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: [{}, {}, {}, {}],
    });

    await expect(call()).rejects.toThrow(/transaction size limit exceeded/i);
  });

  it('error message names the operation count and the limit', async () => {
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: [{}, {}, {}, {}, {}],   // 5 ops
    });

    await expect(call()).rejects.toThrow(/5 operation/i);
    await expect(call()).rejects.toThrow(/network limit of 3/i);
  });

  it('error message tells the user to split the batch', async () => {
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: Array(10).fill({}),
    });

    await expect(call()).rejects.toThrow(/split/i);
  });

  it('does not call signTx when operation count exceeds the limit', async () => {
    const { signTx } = require('@/lib/wallet_manager');
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: [{}, {}, {}, {}],
    });

    await expect(call()).rejects.toThrow(/transaction size limit exceeded/i);
    expect(signTx).not.toHaveBeenCalled();
  });
});

// ─── Byte size limit ──────────────────────────────────────────────────────────

describe('buildAndSubmitSubscribe – byte size preflight', () => {
  it('passes when estimated byte size is within the limit', async () => {
    // A base64 string of 200 chars ≈ 150 bytes — within limit of 200
    const xdr = 'A'.repeat(200);           // 200 base64 chars → ~150 bytes
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => xdr,
      operations: [{}],
    });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'testhash2' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await expect(call()).resolves.toEqual({ txHash: 'testhash2' });
  });

  it('throws before signing when byte size exceeds the limit', async () => {
    // base64 string of 400 chars ≈ 300 bytes — exceeds limit of 200
    const largeXdr = 'A'.repeat(400);
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => largeXdr,
      operations: [{}],
    });

    await expect(call()).rejects.toThrow(/transaction size limit exceeded/i);
  });

  it('error message names the byte size and the limit', async () => {
    const largeXdr = 'A'.repeat(400);  // → ~300 bytes
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => largeXdr,
      operations: [{}],
    });

    await expect(call()).rejects.toThrow(/bytes/i);
    await expect(call()).rejects.toThrow(/200/);  // the configured limit
  });

  it('error message tells the user to reduce operations or arguments', async () => {
    const largeXdr = 'A'.repeat(400);
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => largeXdr,
      operations: [{}],
    });

    await expect(call()).rejects.toThrow(/reduce/i);
  });

  it('does not call signTx when byte size exceeds the limit', async () => {
    const { signTx } = require('@/lib/wallet_manager');
    const largeXdr = 'A'.repeat(400);
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => largeXdr,
      operations: [{}],
    });

    await expect(call()).rejects.toThrow(/transaction size limit exceeded/i);
    expect(signTx).not.toHaveBeenCalled();
  });
});

// ─── Boundary cases ───────────────────────────────────────────────────────────

describe('buildAndSubmitSubscribe – preflight boundary cases', () => {
  it('passes at exactly the operation count limit', async () => {
    // exactly 3 operations == limit of 3 → should pass
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: [{}, {}, {}],
    });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'boundary-op' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await expect(call()).resolves.toEqual({ txHash: 'boundary-op' });
  });

  it('fails at one over the operation count limit', async () => {
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(50),
      operations: [{}, {}, {}, {}],   // 4 > 3
    });

    await expect(call()).rejects.toThrow(/transaction size limit exceeded/i);
  });

  it('passes at exactly the byte size limit', async () => {
    // 200-char base64 → ceil(200*3/4) = 150 bytes ≤ 200 → passes
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(200),
      operations: [{}],
    });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'boundary-bytes' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await expect(call()).resolves.toEqual({ txHash: 'boundary-bytes' });
  });

  it('fails when both operation count and byte size exceed limits (op count checked first)', async () => {
    // 5 ops > 3  AND  ~300 bytes > 200
    mockPrepareTransaction.mockResolvedValue({
      toXDR:      () => 'A'.repeat(400),
      operations: Array(5).fill({}),
    });

    const error = await call().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/5 operation/i);  // op count checked first
  });
});
