import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TransferSubscriptionForm from './TransferSubscriptionForm';

const mockWallet = {
  publicKey: ('G' + 'A'.repeat(55)) as string | null,
  isCheckingFreighter: false,
  freighterInstalled: true,
  accountChangeDetected: false,
  connect: jest.fn(),
};

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockWallet,
}));

jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitTransferSubscription: jest.fn(),
}));

describe('TransferSubscriptionForm account changes', () => {
  it('requires an explicit restart after reconnecting before allowing another submission', () => {
    const { rerender } = render(
      <TransferSubscriptionForm
        initialValues={{
          oldMerchant: 'G' + 'B'.repeat(55),
          newMerchant: 'G' + 'C'.repeat(55),
        }}
      />,
    );
    const submitButton = screen.getByRole('button', {
      name: 'Transfer Subscription',
    });
    expect(submitButton).toBeEnabled();

    mockWallet.publicKey = null;
    mockWallet.accountChangeDetected = true;
    rerender(
      <TransferSubscriptionForm
        initialValues={{
          oldMerchant: 'G' + 'B'.repeat(55),
          newMerchant: 'G' + 'C'.repeat(55),
        }}
      />,
    );

    mockWallet.publicKey = 'G' + 'D'.repeat(55);
    mockWallet.accountChangeDetected = false;
    rerender(
      <TransferSubscriptionForm
        initialValues={{
          oldMerchant: 'G' + 'B'.repeat(55),
          newMerchant: 'G' + 'C'.repeat(55),
        }}
      />,
    );

    expect(submitButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', {
        name: /I checked the transaction — restart operation/i,
      }),
    );
    expect(submitButton).toBeEnabled();
  });
});
