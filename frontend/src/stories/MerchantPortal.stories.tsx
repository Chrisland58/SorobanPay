import type { Meta, StoryObj } from '@storybook/react';
import {
  MerchantSubscriptionsTable,
  type MerchantSubscriptionsTableProps,
} from '../components/MerchantSubscriptionsTable';
import type { MerchantSubscription } from '@/hooks/useMerchantSubscriptions';

const mockSubscribers: MerchantSubscription[] = [
  {
    subscriber: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
    token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: BigInt(50000000),
    interval: 86400 * 30,
    lastPayment: Math.floor(Date.now() / 1000) - 86400 * 32,
    nextPayment: Math.floor(Date.now() / 1000) - 86400 * 2,
    status: 'due',
  },
  {
    subscriber: 'GAAAZ3TUXRPLHGSDETGN7OQCHLVPBX2N5G7D7H2OETEZ5VGYFZ6N5JJD',
    token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: BigInt(20000000),
    interval: 86400 * 7,
    lastPayment: Math.floor(Date.now() / 1000) - 86400 * 2,
    nextPayment: Math.floor(Date.now() / 1000) + 86400 * 5,
    status: 'not_due',
  },
];

const meta: Meta<typeof MerchantSubscriptionsTable> = {
  title: 'Components/MerchantPortal',
  component: MerchantSubscriptionsTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof MerchantSubscriptionsTable>;

export const Loading: Story = {
  args: {
    subscriptions: [],
    isLoading: true,
    error: null,
    onCollect: () => {},
    onBatchCollect: () => {},
    collectingRows: new Set<string>(),
    rowResults: new Map(),
    onRefresh: () => {},
    hasMore: false,
    onLoadMore: () => {},
  },
};

export const Empty: Story = {
  args: {
    subscriptions: [],
    isLoading: false,
    error: null,
    onCollect: () => {},
    onBatchCollect: () => {},
    collectingRows: new Set<string>(),
    rowResults: new Map(),
    onRefresh: () => {},
    hasMore: false,
    onLoadMore: () => {},
  },
};

export const WithSubscribers: Story = {
  args: {
    subscriptions: mockSubscribers,
    isLoading: false,
    error: null,
    onCollect: () => {},
    onBatchCollect: () => {},
    collectingRows: new Set<string>(),
    rowResults: new Map(),
    onRefresh: () => {},
    hasMore: false,
    onLoadMore: () => {},
  },
};

export const DarkMode: Story = {
  args: {
    subscriptions: mockSubscribers,
    isLoading: false,
    error: null,
    onCollect: () => {},
    onBatchCollect: () => {},
    collectingRows: new Set<string>(),
    rowResults: new Map(),
    onRefresh: () => {},
    hasMore: false,
    onLoadMore: () => {},
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
