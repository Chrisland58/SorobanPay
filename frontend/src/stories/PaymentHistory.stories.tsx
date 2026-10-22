import type { Meta, StoryObj } from '@storybook/react';
import { PaymentHistoryTable } from '../components/PaymentHistoryTable';
import { type PaymentEvent } from '@/hooks/usePaymentHistory';

const mockEvents: PaymentEvent[] = [
  {
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ledger: 123456,
    timestamp: 1690000000,
    merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
    subscriber: 'GAAAZ3TUXRPLHGSDETGN7OQCHLVPBX2N5G7D7H2OETEZ5VGYFZ6N5JJD',
    token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: '10.00',
  },
  {
    txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    ledger: 123460,
    timestamp: 1690086400,
    merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
    subscriber: 'GBEXAMPLESUBSCRIBERADDRESS7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
    token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: '25.50',
  },
];

const meta: Meta<typeof PaymentHistoryTable> = {
  title: 'Components/PaymentHistory',
  component: PaymentHistoryTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof PaymentHistoryTable>;

export const Loading: Story = {
  args: {
    events: [],
    isLoading: true,
    error: null,
    hasMore: false,
    onLoadMore: () => {},
    onRefresh: () => {},
    isConnected: true,
    networkName: 'Testnet',
  },
};

export const Empty: Story = {
  args: {
    events: [],
    isLoading: false,
    error: null,
    hasMore: false,
    onLoadMore: () => {},
    onRefresh: () => {},
    isConnected: true,
    networkName: 'Testnet',
  },
};

export const Populated: Story = {
  args: {
    events: mockEvents,
    isLoading: false,
    error: null,
    hasMore: true,
    onLoadMore: () => {},
    onRefresh: () => {},
    isConnected: true,
    networkName: 'Testnet',
  },
};

export const ErrorState: Story = {
  args: {
    events: [],
    isLoading: false,
    error: 'Failed to fetch payments from Soroban RPC endpoint.',
    hasMore: false,
    onLoadMore: () => {},
    onRefresh: () => {},
    isConnected: true,
    networkName: 'Testnet',
  },
};

export const DarkMode: Story = {
  args: {
    events: mockEvents,
    isLoading: false,
    error: null,
    hasMore: true,
    onLoadMore: () => {},
    onRefresh: () => {},
    isConnected: true,
    networkName: 'Testnet',
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
