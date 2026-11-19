import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TransactionDetailPanel,
  buildExplorerTxUrl,
  type TransactionDetailRecord,
} from './TransactionDetailPanel';

const SAMPLE_TX: TransactionDetailRecord = {
  txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff',
  ledgerTime: '2026-11-19T14:30:00.000Z',
  account: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
  tokenAmount: '125.50',
  tokenSymbol: 'USDC',
  status: 'confirmed',
  network: 'testnet',
};

describe('TransactionDetailPanel', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('renders labeled transaction hash, ledger time, account, token amount, and status', () => {
    render(<TransactionDetailPanel transaction={SAMPLE_TX} activeNetwork="testnet" />);

    expect(screen.getByText('Transaction Hash')).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_TX.txHash)).toBeInTheDocument();

    expect(screen.getByText('Ledger Time')).toBeInTheDocument();
    expect(screen.getByText('2026-11-19 14:30:00 UTC')).toBeInTheDocument();

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_TX.account)).toBeInTheDocument();

    expect(screen.getByText('Token Amount')).toBeInTheDocument();
    expect(screen.getByText('125.50 USDC')).toBeInTheDocument();

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('selects the explorer link for the matching transaction network', () => {
    const { rerender } = render(
      <TransactionDetailPanel transaction={SAMPLE_TX} activeNetwork="testnet" />
    );

    const testnetLink = screen.getByRole('link', { name: /view on explorer/i });
    expect(testnetLink).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/tx/${SAMPLE_TX.txHash}`
    );
    expect(testnetLink).toHaveAttribute('target', '_blank');
    expect(testnetLink).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(
      <TransactionDetailPanel
        transaction={{ ...SAMPLE_TX, network: 'mainnet' }}
        activeNetwork="mainnet"
      />
    );

    const mainnetLink = screen.getByRole('link', { name: /view on explorer/i });
    expect(mainnetLink).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/public/tx/${SAMPLE_TX.txHash}`
    );
  });

  it('blocks the explorer link when activeNetwork mismatches the transaction record network', () => {
    render(<TransactionDetailPanel transaction={SAMPLE_TX} activeNetwork="mainnet" />);

    expect(screen.queryByRole('link', { name: /view on explorer/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /active network \(mainnet\) does not match transaction network \(testnet\)/i
    );
  });

  it('announces copied values in the live status region', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const user = userEvent.setup();

    render(<TransactionDetailPanel transaction={SAMPLE_TX} activeNetwork="testnet" />);

    const copyHashBtn = screen.getByRole('button', {
      name: /copy transaction hash to clipboard/i,
    });
    await user.click(copyHashBtn);

    expect(writeText).toHaveBeenCalledWith(SAMPLE_TX.txHash);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Copied Transaction Hash to clipboard.'
    );
  });

  it('filters transactions via the search input and supports clearing search', () => {
    const secondTx: TransactionDetailRecord = {
      ...SAMPLE_TX,
      txHash: 'ffeeddccbbaa0099887766554433221109f8e7d6c5b4a39281706f5e4d3c2b1a',
      account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenAmount: '42.00',
      status: 'failed',
    };

    render(<TransactionDetailPanel transactions={[SAMPLE_TX, secondTx]} activeNetwork="testnet" />);

    const searchInput = screen.getByRole('searchbox', { name: /search transaction details/i });
    fireEvent.change(searchInput, { target: { value: 'failed' } });

    expect(screen.getByText(secondTx.txHash)).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_TX.txHash)).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'nonexistent-query' } });
    expect(screen.getByText(/no transaction details match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(screen.getByText(SAMPLE_TX.txHash)).toBeInTheDocument();
    expect(screen.getByText(secondTx.txHash)).toBeInTheDocument();
  });

  it('does not expose or search sensitive internal identifiers attached to a record', () => {
    const recordWithSecrets = {
      ...SAMPLE_TX,
      internalId: 'internal-db-row-9999',
      sessionToken: 'secret-session-token-xyz',
      secretKey: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      apiKey: 'sk_live_1234567890',
    } as TransactionDetailRecord;

    render(<TransactionDetailPanel transaction={recordWithSecrets} activeNetwork="testnet" />);

    expect(screen.queryByText('internal-db-row-9999')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-session-token-xyz')).not.toBeInTheDocument();
    expect(screen.queryByText(/sk_live_1234567890/)).not.toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', { name: /search transaction details/i });
    fireEvent.change(searchInput, { target: { value: 'secret-session-token-xyz' } });
    expect(screen.getByText(/no transaction details match/i)).toBeInTheDocument();
  });

  it('handles empty state, missing txHash, and invalid ledgerTime gracefully', () => {
    const { rerender } = render(<TransactionDetailPanel transaction={null} />);
    expect(screen.getByText(/no transaction selected/i)).toBeInTheDocument();

    rerender(
      <TransactionDetailPanel
        transaction={{
          ...SAMPLE_TX,
          txHash: '',
          ledgerTime: 'not-a-date',
        }}
        activeNetwork="testnet"
      />
    );

    expect(screen.queryByRole('link', { name: /view on explorer/i })).not.toBeInTheDocument();
    expect(screen.getByText('Explorer link unavailable')).toBeInTheDocument();
    expect(screen.getByText('not-a-date')).toBeInTheDocument();
    expect(buildExplorerTxUrl('   ', 'testnet')).toBeNull();
  });
});
