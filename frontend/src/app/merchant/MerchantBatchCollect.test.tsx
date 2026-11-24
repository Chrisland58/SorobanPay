import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MerchantSubscriptionsTable from '@/components/MerchantSubscriptionsTable';
import { ErrorBoundary } from '@/components/ErrorBoundary';

describe('MerchantPortal Batch Execution and Error Boundary', () => {
  it('renders Collect All Due button when due subscriptions exist', () => {
    const onBatchCollect = jest.fn();
    const mockSubscriptions = [
      {
        subscriber: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
        token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount: BigInt(50000000),
        interval: 86400 * 30,
        lastPayment: Math.floor(Date.now() / 1000) - 86400 * 32,
        nextPayment: Math.floor(Date.now() / 1000) - 86400 * 2,
        isDue: true,
        isExpired: false,
      },
    ];

    render(
      <MerchantSubscriptionsTable
        subscriptions={mockSubscriptions}
        isLoading={false}
        error={null}
        onCollect={jest.fn()}
        onBatchCollect={onBatchCollect}
        collectingRows={new Set()}
        rowResults={new Map()}
        onRefresh={jest.fn()}
        hasMore={false}
      />
    );

    const collectAllButton = screen.getByRole('button', { name: /collect all 1 due payments/i });
    expect(collectAllButton).toBeInTheDocument();
    fireEvent.click(collectAllButton);
    expect(onBatchCollect).toHaveBeenCalledWith([mockSubscriptions[0].subscriber]);
  });

  it('catches render errors in isolated ErrorBoundary without crashing page', () => {
    const ThrowingComponent = () => {
      throw new Error('MerchantPortal test explosion');
    };

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary name="MerchantPortal">
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
