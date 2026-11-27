import { fireEvent, render, screen } from '@testing-library/react';
import MerchantSubscriptionsTable from './MerchantSubscriptionsTable';
import type { MerchantSubscription } from '@/hooks/useMerchantSubscriptions';

function makeSubscription(
  subscriber: string,
  overrides: Partial<MerchantSubscription> = {},
): MerchantSubscription {
  return {
    subscriber,
    merchant: `G${'M'.repeat(55)}`,
    token: `C${'T'.repeat(55)}`,
    amount: '10.0000000',
    amountRaw: 100000000n,
    interval: 86400,
    intervalLabel: '1 day',
    nextPaymentTimestamp: 1,
    nextPaymentDate: '2026-09-28T00:00:00.000Z',
    isDue: true,
    isExpired: false,
    ...overrides,
  };
}

const dueSubscriber = `G${'A'.repeat(55)}`;
const upcomingSubscriber = `G${'B'.repeat(55)}`;
const expiredSubscriber = `G${'C'.repeat(55)}`;
const subscriptions = [
  makeSubscription(dueSubscriber),
  makeSubscription(upcomingSubscriber, { isDue: false }),
  makeSubscription(expiredSubscriber, { isDue: false, isExpired: true }),
];

function renderTable() {
  return render(
    <MerchantSubscriptionsTable
      subscriptions={subscriptions}
      isLoading={false}
      error={null}
      onCollect={jest.fn()}
      onBatchCollect={jest.fn()}
      collectingRows={new Set()}
      rowResults={new Map()}
      onRefresh={jest.fn()}
      hasMore={false}
      onLoadMore={jest.fn()}
    />,
  );
}

describe('MerchantSubscriptionsTable filters', () => {
  it('filters by status without changing the total subscriber count', () => {
    renderTable();

    fireEvent.change(screen.getByRole('combobox', { name: /filter subscriptions by status/i }), {
      target: { value: 'due' },
    });

    expect(screen.getByTitle(dueSubscriber)).toBeInTheDocument();
    expect(screen.queryByTitle(upcomingSubscriber)).not.toBeInTheDocument();
    expect(screen.queryByTitle(expiredSubscriber)).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('searches wallet addresses case-insensitively and trims the query', () => {
    renderTable();
    fireEvent.change(screen.getByRole('searchbox', { name: /search subscribers/i }), {
      target: { value: `  ${upcomingSubscriber.toLowerCase()}  ` },
    });

    expect(screen.getByTitle(upcomingSubscriber)).toBeInTheDocument();
    expect(screen.queryByTitle(dueSubscriber)).not.toBeInTheDocument();
  });

  it('shows a recoverable no-match state and clears active filters', () => {
    renderTable();
    fireEvent.change(screen.getByRole('searchbox', { name: /search subscribers/i }), {
      target: { value: 'not-a-wallet' },
    });

    expect(screen.getByRole('status')).toHaveTextContent(/no subscriptions match/i);
    expect(screen.queryByRole('row', { name: /collect payment/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByTitle(dueSubscriber)).toBeInTheDocument();
    expect(screen.getByTitle(upcomingSubscriber)).toBeInTheDocument();
    expect(screen.getByTitle(expiredSubscriber)).toBeInTheDocument();
  });

  it('keeps due-only batch selection independent of the visible filter', () => {
    const onBatchCollect = jest.fn();
    render(
      <MerchantSubscriptionsTable
        subscriptions={subscriptions}
        isLoading={false}
        error={null}
        onCollect={jest.fn()}
        onBatchCollect={onBatchCollect}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={jest.fn()}
        hasMore={false}
        onLoadMore={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /select all due subscriptions/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /filter subscriptions by status/i }), {
      target: { value: 'expired' },
    });
    fireEvent.click(screen.getByRole('button', { name: /collect 1 selected payment/i }));

    expect(onBatchCollect).toHaveBeenCalledWith([dueSubscriber]);
  });

  it('offers accessible pagination and announces the end of the list', () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <MerchantSubscriptionsTable
        subscriptions={subscriptions}
        isLoading={false}
        error={null}
        onCollect={jest.fn()}
        onBatchCollect={jest.fn()}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={jest.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /load more merchant subscriptions/i }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <MerchantSubscriptionsTable
        subscriptions={subscriptions}
        isLoading={false}
        error={null}
        onCollect={jest.fn()}
        onBatchCollect={jest.fn()}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={jest.fn()}
        hasMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByRole('status', { name: /all subscriptions loaded/i })).toBeInTheDocument();
  });
});

describe('MerchantSubscriptionsTable touch targets and responsive actions', () => {
  it('enforces 44px minimum touch targets on toolbar, checkbox wrappers, and row actions', () => {
    renderTable();

    expect(screen.getByRole('searchbox', { name: /search subscribers/i })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('combobox', { name: /filter subscriptions by status/i })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: /collect all 1 due payments/i })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: /refresh subscription list/i })).toHaveClass('min-h-[44px]');

    const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all due subscriptions/i });
    expect(selectAllCheckbox.closest('label')).toHaveClass('min-h-[44px]', 'min-w-[44px]');

    const collectButton = screen.getByRole('button', { name: /collect payment from/i });
    expect(collectButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });

  it('provides accessible 44px retry and refresh targets in error and empty states', () => {
    const onRefresh = jest.fn();
    const { rerender } = render(
      <MerchantSubscriptionsTable
        subscriptions={[]}
        isLoading={false}
        error="RPC timeout"
        onCollect={jest.fn()}
        onBatchCollect={jest.fn()}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={onRefresh}
        hasMore={false}
        onLoadMore={jest.fn()}
      />,
    );

    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    fireEvent.click(retryButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <MerchantSubscriptionsTable
        subscriptions={[]}
        isLoading={false}
        error={null}
        onCollect={jest.fn()}
        onBatchCollect={jest.fn()}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={onRefresh}
        hasMore={false}
        onLoadMore={jest.fn()}
      />,
    );

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    expect(refreshButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});