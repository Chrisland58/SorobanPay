/**
 * @jest-environment jsdom
 *
 * SubscriptionForm.account-switch.test.tsx
 *
 * Automated regression suite proving that switching Freighter accounts across
 * transaction lifecycle boundaries (construction, signing, confirmation)
 * safely discards stale results, aborts in-flight attempts, and prevents
 * submitting under the wrong account (#1637).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

let currentMockAccount = 'G' + 'A'.repeat(55);
const SECONDARY_ACCOUNT = 'G' + 'B'.repeat(55);

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: currentMockAccount,
    isCheckingFreighter: false,
    freighterInstalled: true,
  }),
}));

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildSignAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'C'.repeat(55);
const VALID_TOKEN = 'C' + 'A'.repeat(55);

function fillForm() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), { target: { value: VALID_MERCHANT } });
  fireEvent.change(screen.getByLabelText(/token contract address/i), { target: { value: VALID_TOKEN } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });
}

describe('SubscriptionForm - Account Switching Safety Invariants (#1637)', () => {
  beforeEach(() => {
    mockBuildAndSubmit.mockReset();
    currentMockAccount = 'G' + 'A'.repeat(55);
  });

  it('aborts active signing and discards stale transaction if account changes during wallet prompt', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolvePrompt: ((val: { txHash: string }) => void) | undefined;

    mockBuildAndSubmit.mockImplementationOnce((...args: unknown[]) => {
      capturedSignal = args[5] as AbortSignal;
      return new Promise((resolve) => {
        resolvePrompt = resolve;
      });
    });

    const { rerender } = render(<SubscriptionForm />);
    fillForm();

    // Submit form and confirm in modal
    act(() => {
      fireEvent.submit(
        screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
      );
    });

    await waitFor(() => screen.getByRole('dialog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    });

    expect(mockBuildAndSubmit).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    // LIFECYCLE BOUNDARY: User switches Freighter account while signing prompt is open
    currentMockAccount = SECONDARY_ACCOUNT;
    rerender(<SubscriptionForm />);

    // Signal must be aborted immediately
    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });

    // Stale wallet prompt late-resolves
    await act(async () => {
      resolvePrompt?.({ txHash: 'stale_tx_hash_account_A' });
    });

    // Stale result is discarded — no success card for Account A is displayed
    expect(screen.queryByText(/subscription created successfully/i)).not.toBeInTheDocument();
    // No second transaction was submitted automatically
    expect(mockBuildAndSubmit).toHaveBeenCalledTimes(1);
  });

  it('resets in-flight submission state and re-enables form for the newly selected account', async () => {
    let capturedSignal: AbortSignal | undefined;

    mockBuildAndSubmit.mockImplementationOnce((...args: unknown[]) => {
      capturedSignal = args[5] as AbortSignal;
      return new Promise(() => {}); // never resolves
    });

    const { rerender } = render(<SubscriptionForm />);
    fillForm();

    act(() => {
      fireEvent.submit(
        screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
      );
    });

    await waitFor(() => screen.getByRole('dialog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    });

    // Account switch happens
    currentMockAccount = SECONDARY_ACCOUNT;
    rerender(<SubscriptionForm />);

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });

    // Submit button is available again for Account B
    await waitFor(() => {
      const submitBtn = screen.getByRole('button', { name: /authorize subscription/i });
      expect(submitBtn).not.toBeDisabled();
    });
  });
});
