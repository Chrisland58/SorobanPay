/**
 * SubscriptionForm.simulation-preview.test.tsx
 *
 * Unit tests for the transaction simulation preview in the subscription confirmation flow.
 *
 * Requirements:
 *  - The preview reflects the exact transaction built for the selected network and account.
 *  - Simulation failures block signing and expose a retry path without losing form data.
 *  - Successful simulation displays estimated fees and resource breakdown and enables signing.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from '@/components/SubscriptionForm';

describe('ConfirmModal – Simulation Preview & Authorization Review', () => {
  const baseProps = {
    subscriberAddress: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA',
    merchantAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    tokenAddress: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    amount: '250',
    interval: '604800', // 7 days
    networkPassphrase: 'Test SDF Network ; September 2015',
    feeStatus: 'success' as const,
    minResourceFee: '1500000',
    feeBreakdown: {
      instructions: 120500,
      readBytes: 1024,
      writeBytes: 256,
    },
    feeError: null,
    allowanceResult: null,
    onRetrySimulation: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders exact transaction parameters built for the selected network and account', () => {
    render(<ConfirmModal {...baseProps} />);

    // Account & Network
    expect(screen.getByText(/account \(subscriber\)/i)).toBeInTheDocument();
    expect(screen.getByText('Test SDF Network ; September 2015')).toBeInTheDocument();

    // Merchant, Token, Amount, Interval
    expect(screen.getByText(/merchant address/i)).toBeInTheDocument();
    expect(screen.getByText(/token address/i)).toBeInTheDocument();
    expect(screen.getByText('250 tokens')).toBeInTheDocument();
    expect(screen.getByText(/Every 7 days/i)).toBeInTheDocument();
  });

  it('displays loading state and blocks signing while simulation is in flight', () => {
    render(
      <ConfirmModal
        {...baseProps}
        feeStatus="loading"
        minResourceFee={null}
        feeBreakdown={null}
      />
    );

    expect(screen.getByTestId('simulation-loading')).toBeInTheDocument();
    expect(screen.getByText(/simulating transaction on soroban rpc/i)).toBeInTheDocument();

    // Confirm button is disabled
    const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('blocks signing on simulation failure and provides an actionable retry path', () => {
    const onRetryMock = jest.fn();
    render(
      <ConfirmModal
        {...baseProps}
        feeStatus="error"
        feeError="HostError: contract trap - Insufficient funds"
        minResourceFee={null}
        feeBreakdown={null}
        onRetrySimulation={onRetryMock}
      />
    );

    // Simulation error is visible with message
    expect(screen.getByTestId('simulation-error')).toBeInTheDocument();
    expect(screen.getByText(/simulation failed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/HostError: contract trap - Insufficient funds/i)
    ).toBeInTheDocument();

    // Signing is blocked
    const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
    expect(confirmBtn).toBeDisabled();

    // Retry simulation button is present and clickable
    const retryBtn = screen.getByTestId('retry-simulation-btn');
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });

  it('allows user to go back and dismiss review without losing form data', () => {
    const onCancelMock = jest.fn();
    render(
      <ConfirmModal
        {...baseProps}
        onCancel={onCancelMock}
      />
    );

    const goBackBtn = screen.getByRole('button', { name: /go back/i });
    fireEvent.click(goBackBtn);
    expect(onCancelMock).toHaveBeenCalledTimes(1);
  });

  it('enables authorization and shows fee breakdown when simulation passes', () => {
    const onConfirmMock = jest.fn();
    render(
      <ConfirmModal
        {...baseProps}
        feeStatus="success"
        minResourceFee="1500000"
        onConfirm={onConfirmMock}
      />
    );

    expect(screen.getByTestId('simulation-success')).toBeInTheDocument();
    expect(screen.getByText(/0\.1500000 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/1,500,000 stroops/i)).toBeInTheDocument();
    expect(screen.getByText('120,500')).toBeInTheDocument();
    expect(screen.getByText(/1,024 B/i)).toBeInTheDocument();
    expect(screen.getByText(/256 B/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    expect(onConfirmMock).toHaveBeenCalledTimes(1);
  });
});
