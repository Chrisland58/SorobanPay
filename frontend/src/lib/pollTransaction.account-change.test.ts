import { pollForConfirmation, POLL_INTERVAL_MS } from './pollTransaction';

const mockAssertWalletAccount = jest.fn();

jest.mock('./wallet_manager', () => ({
  assertWalletAccount: (...args: unknown[]) =>
    mockAssertWalletAccount(...args),
}));

describe('pollForConfirmation account binding', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('stops polling when Freighter no longer has the signing account selected', async () => {
    jest.useFakeTimers();
    mockAssertWalletAccount.mockRejectedValueOnce(
      new Error('Your Freighter account changed during this operation.'),
    );
    const getTransaction = jest.fn();
    const server = { getTransaction } as never;
    const pending = pollForConfirmation(server, 'transaction-hash', 'GACCOUNT');
    const rejected = expect(pending).rejects.toThrow(/account changed/i);

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await rejected;

    expect(getTransaction).not.toHaveBeenCalled();
  });
});
