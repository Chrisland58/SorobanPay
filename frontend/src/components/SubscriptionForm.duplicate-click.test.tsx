/**
 * @jest-environment jsdom
 *
 * SubscriptionForm.duplicate-click.test.tsx
 *
 * Automated verification for controlled promise timing, repeated clicks,
 * wallet rejection, retry safety, and unmount/navigation handling (#1638).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: mockWalletPublicKey,
    isCheckingFreighter: false,
    freighterInstalled: true,
  }),
}));

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildSignAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN = 'C' + 'A'.repeat(55);
let mockWalletPublicKey = 'GPUBKEY';

function fillAndSubmitForm() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), { target: { value: VALID_MERCHANT } });
  fireEvent.change(screen.getByLabelText(/token contract address/i), { target: { value: VALID_TOKEN } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });

  act(() => {
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
  });
}

/** Helper to create a deferred promise for controlled timing */
function createDeferredPromise<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SubscriptionForm - Duplicate-Click & Controlled Promise Timing (#1638)', () => {
  beforeEach(() => {
    mockBuildAndSubmit.mockReset();
    mockWalletPublicKey = 'GPUBKEY';
  });

  it('guarantees only one submission occurs when user rapidly double-clicks confirm button', async () => {
    const deferred = createDeferredPromise<{ txHash: string }>();
    mockBuildAndSubmit.mockImplementation(() => deferred.promise);

    render(<SubscriptionForm />);
    fillAndSubmitForm();

    await waitFor(() => screen.getByRole('dialog'));
    const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });

    // Repeated clicks while wallet prompt is in flight
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });

    // Expect buildSignAndSubmitSubscribe was invoked only once
    expect(mockBuildAndSubmit).toHaveBeenCalledTimes(1);

    // Resolve prompt and verify success
    await act(async () => {
      deferred.resolve({ txHash: 'tx_success_double_click' });
    });

    await waitFor(() => {
      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument();
    });
  });

  it('restores submission control availability after terminal wallet rejection', async () => {
    const deferred = createDeferredPromise<{ txHash: string }>();
    mockBuildAndSubmit.mockImplementation(() => deferred.promise);

    render(<SubscriptionForm />);
    fillAndSubmitForm();

    await waitFor(() => screen.getByRole('dialog'));
    const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // Controlled rejection from wallet
    await act(async () => {
      deferred.reject(new Error('User declined transaction'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i);
    });

    // Verify submission button is re-enabled for retry
    const submitBtn = screen.getByRole('button', { name: /authorize subscription/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('allows safe retry after rejection with fresh submission execution', async () => {
    // 1st attempt: rejected
    const deferred1 = createDeferredPromise<{ txHash: string }>();
    mockBuildAndSubmit.mockImplementationOnce(() => deferred1.promise);

    render(<SubscriptionForm />);
    fillAndSubmitForm();

    await waitFor(() => screen.getByRole('dialog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    });

    await act(async () => {
      deferred1.reject(new Error('user rejected'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // 2nd attempt (Retry): user clicks again
    const deferred2 = createDeferredPromise<{ txHash: string }>();
    mockBuildAndSubmit.mockImplementationOnce(() => deferred2.promise);

    act(() => {
      fireEvent.submit(
        screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
      );
    });

    await waitFor(() => screen.getByRole('dialog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    });

    expect(mockBuildAndSubmit).toHaveBeenCalledTimes(2);

    await act(async () => {
      deferred2.resolve({ txHash: 'tx_retry_success' });
    });

    await waitFor(() => {
      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument();
    });
  });

  it('aborts active submission when navigating away (unmounting) during delayed wallet prompt', async () => {
    let capturedSignal: AbortSignal | undefined;
    const deferred = createDeferredPromise<{ txHash: string }>();

    mockBuildAndSubmit.mockImplementation((...args: unknown[]) => {
      capturedSignal = args[5] as AbortSignal;
      return deferred.promise;
    });

    const { unmount } = render(<SubscriptionForm />);
    fillAndSubmitForm();

    await waitFor(() => screen.getByRole('dialog'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Simulate navigation away from the submission screen
    act(() => {
      unmount();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });
});
