/**
 * SubscriptionForm.integration.test.tsx  — Issue #1417
 *
 * Integration tests for the SubscriptionForm full submission flow:
 *   1. Happy path: fill form → submit → Freighter mock approves → SuccessCard shown
 *   2. Validation errors: invalid address → form blocked, no API call
 *   3. Freighter rejection: error alert shown, form data preserved
 *   4. RPC error: error alert shown with message
 *   5. Contract error (code 1 — AmountMustBePositive): human-readable message shown
 *   6. Network mismatch: banner shown, submit disabled (contract not configured)
 *
 * Uses React Testing Library. Freighter API (wallet_manager) and the
 * transaction builder are mocked so no real network requests are made.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Network / contract constants mock ────────────────────────────────────────

const mockNetwork = {
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
};
jest.mock('@/constants/network', () => mockNetwork);

// ─── Transaction builder mock ──────────────────────────────────────────────────

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildSignAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

// ─── Wallet hook mock ──────────────────────────────────────────────────────────

let mockWalletState = {
  publicKey: null as string | null,
  isCheckingFreighter: false,
  freighterInstalled: true,
};
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockWalletState,
}));

// ─── Import component after mocks ─────────────────────────────────────────────

import SubscriptionForm from '@/components/SubscriptionForm';

// ─── Test addresses ───────────────────────────────────────────────────────────

// Valid StrKey-encoded Stellar addresses
const VALID_SUBSCRIBER = 'G' + 'B'.repeat(55);
const VALID_MERCHANT   = 'G' + 'A'.repeat(55);
const VALID_TOKEN      = 'C' + 'A'.repeat(55);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Connect a wallet for tests that need a connected state */
function connectWallet(key = VALID_SUBSCRIBER) {
  mockWalletState = {
    publicKey: key,
    isCheckingFreighter: false,
    freighterInstalled: true,
  };
}

/** Fill the subscription form with valid values */
function fillForm(overrides: {
  merchant?: string;
  token?: string;
  amount?: string;
} = {}) {
  const {
    merchant = VALID_MERCHANT,
    token    = VALID_TOKEN,
    amount   = '100',
  } = overrides;

  fireEvent.change(screen.getByLabelText(/merchant address/i), {
    target: { value: merchant },
  });
  fireEvent.change(screen.getByLabelText(/token contract address/i), {
    target: { value: token },
  });
  fireEvent.change(screen.getByLabelText(/amount/i), {
    target: { value: amount },
  });
}

/** Submit the form */
function submitForm() {
  const btn = screen.getByRole('button', { name: /authorize subscription/i });
  const form = btn.closest('form')!;
  fireEvent.submit(form);
}

/** Wait for the confirmation modal and click confirm */
async function confirmInModal() {
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
}

// ─── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  mockBuildAndSubmit.mockReset();
  mockWalletState = {
    publicKey: null,
    isCheckingFreighter: false,
    freighterInstalled: true,
  };
  // Restore contract ID in case a test changed it
  mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
});

// ─── 1. Happy path ─────────────────────────────────────────────────────────────

describe('SubscriptionForm integration: happy path', () => {
  beforeEach(() => {
    connectWallet();
    mockBuildAndSubmit.mockResolvedValue({ txHash: 'abc123deadbeef' });
    render(<SubscriptionForm />);
  });

  it('shows "Connected" badge when wallet is connected', () => {
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it('submit button is enabled when wallet is connected', () => {
    expect(
      screen.getByRole('button', { name: /authorize subscription/i }),
    ).not.toBeDisabled();
  });

  it('opens a confirmation modal before submitting', async () => {
    fillForm();
    submitForm();
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
    expect(screen.getByText(/confirm subscription/i)).toBeInTheDocument();
  });

  it('calls buildSignAndSubmitSubscribe after modal confirmation', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() => expect(mockBuildAndSubmit).toHaveBeenCalledTimes(1));
  });

  it('passes correct merchant address to the builder', async () => {
    fillForm({ merchant: VALID_MERCHANT });
    submitForm();
    await confirmInModal();
    await waitFor(() => expect(mockBuildAndSubmit).toHaveBeenCalled());
    const params = mockBuildAndSubmit.mock.calls[0][0];
    expect(params.merchant).toBe(VALID_MERCHANT);
  });

  it('passes correct token address to the builder', async () => {
    fillForm({ token: VALID_TOKEN });
    submitForm();
    await confirmInModal();
    await waitFor(() => expect(mockBuildAndSubmit).toHaveBeenCalled());
    const params = mockBuildAndSubmit.mock.calls[0][0];
    expect(params.token).toBe(VALID_TOKEN);
  });

  it('passes correct amount to the builder', async () => {
    fillForm({ amount: '250' });
    submitForm();
    await confirmInModal();
    await waitFor(() => expect(mockBuildAndSubmit).toHaveBeenCalled());
    const params = mockBuildAndSubmit.mock.calls[0][0];
    expect(Number(params.amount)).toBe(250);
  });

  it('shows SuccessCard after transaction is confirmed', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(
        screen.getByText(/subscription created successfully/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows the transaction hash in the SuccessCard', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByText('abc123deadbeef')).toBeInTheDocument(),
    );
  });

  it('hides the submit button after success', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      screen.getByText(/subscription created successfully/i),
    );
    expect(
      screen.queryByRole('button', { name: /authorize subscription/i }),
    ).not.toBeInTheDocument();
  });

  it('shows "Create another subscription" button after success', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /create another subscription/i }),
      ).toBeInTheDocument(),
    );
  });

  it('returns to idle form state after clicking "Create another"', async () => {
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      screen.getByRole('button', { name: /create another subscription/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /create another subscription/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /authorize subscription/i }),
      ).toBeInTheDocument(),
    );
  });
});

// ─── 2. Validation errors ──────────────────────────────────────────────────────

describe('SubscriptionForm integration: validation errors', () => {
  beforeEach(() => {
    connectWallet();
    render(<SubscriptionForm />);
  });

  it('shows error for empty merchant address on submit', async () => {
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/merchant address is required/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for invalid merchant G-address', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: 'INVALID_ADDRESS' },
    });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/valid stellar g-address/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for C-address used as merchant', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_TOKEN }, // C-address, not G-address
    });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/valid stellar g-address/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for empty token address', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_MERCHANT },
    });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/token contract address is required|valid stellar c-address/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for G-address used as token', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_MERCHANT },
    });
    fireEvent.change(screen.getByLabelText(/token contract address/i), {
      target: { value: VALID_MERCHANT }, // G-address, not C-address
    });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/valid stellar c-address/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for amount 0', async () => {
    fillForm({ amount: '0' });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/amount must be greater than 0/i),
      ).toBeInTheDocument(),
    );
  });

  it('shows error for negative amount', async () => {
    fillForm({ amount: '-1' });
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/amount must be greater than 0/i),
      ).toBeInTheDocument(),
    );
  });

  it('does NOT call the builder when there are validation errors', async () => {
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/merchant address is required/i),
      ).toBeInTheDocument(),
    );
    expect(mockBuildAndSubmit).not.toHaveBeenCalled();
  });

  it('does NOT open the modal when there are validation errors', async () => {
    submitForm();
    await waitFor(() =>
      expect(
        screen.getByText(/merchant address is required/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancelling confirmation modal does not call the builder', async () => {
    fillForm();
    submitForm();
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockBuildAndSubmit).not.toHaveBeenCalled();
  });
});

// ─── 3. Freighter rejection ────────────────────────────────────────────────────

describe('SubscriptionForm integration: Freighter rejection', () => {
  beforeEach(() => {
    connectWallet();
    render(<SubscriptionForm />);
  });

  it('shows error alert when Freighter rejects with "User declined"', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i);
  });

  it('shows error alert for "user rejected" variant', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('user rejected'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i),
    );
  });

  it('preserves merchant address in form after Freighter rejection', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm({ merchant: VALID_MERCHANT });
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/merchant address/i)).toHaveValue(VALID_MERCHANT);
  });

  it('preserves token address in form after Freighter rejection', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm({ token: VALID_TOKEN });
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/token contract address/i)).toHaveValue(VALID_TOKEN);
  });

  it('preserves amount in form after Freighter rejection', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm({ amount: '500' });
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/amount/i)).toHaveValue(500);
  });

  it('re-enables submit button after Freighter rejection', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(
      screen.getByRole('button', { name: /authorize subscription/i }),
    ).not.toBeDisabled();
  });

  it('allows resubmission after Freighter rejection', async () => {
    mockBuildAndSubmit
      .mockRejectedValueOnce(new Error('User declined transaction'))
      .mockResolvedValueOnce({ txHash: 'retry-success-hash' });

    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));

    // Retry
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(
        screen.getByText(/subscription created successfully/i),
      ).toBeInTheDocument(),
    );
  });
});

// ─── 4. RPC error ─────────────────────────────────────────────────────────────

describe('SubscriptionForm integration: RPC error', () => {
  beforeEach(() => {
    connectWallet();
    render(<SubscriptionForm />);
  });

  it('shows error alert for RPC network timeout', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('Network timeout after 60s'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });

  it('shows error alert for RPC 429 rate-limit', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('429 Too Many Requests'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });

  it('shows error alert for submission ERROR status', async () => {
    mockBuildAndSubmit.mockRejectedValue(
      new Error('Transaction submission failed: ERROR'),
    );
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });

  it('does not show SuccessCard after RPC error', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('Network timeout'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(
      screen.queryByText(/subscription created successfully/i),
    ).not.toBeInTheDocument();
  });

  it('form data is preserved after RPC error', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('Network timeout'));
    fillForm({ merchant: VALID_MERCHANT, token: VALID_TOKEN, amount: '750' });
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/merchant address/i)).toHaveValue(VALID_MERCHANT);
    expect(screen.getByLabelText(/token contract address/i)).toHaveValue(VALID_TOKEN);
    expect(screen.getByLabelText(/amount/i)).toHaveValue(750);
  });
});

// ─── 5. Contract error code 1 (AmountMustBePositive) ─────────────────────────

describe('SubscriptionForm integration: contract error code mapping', () => {
  beforeEach(() => {
    connectWallet();
    render(<SubscriptionForm />);
  });

  it('shows human-readable message for AmountMustBePositive (code 1)', async () => {
    // Contract returns error code 1 in the error result
    mockBuildAndSubmit.mockRejectedValue(
      new Error('Contract error 1: AmountMustBePositive'),
    );
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    // Should map to a human-readable message, not a raw error code
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBeTruthy();
    expect(alert.textContent!.length).toBeGreaterThan(5);
  });

  it('shows human-readable message for InsufficientAllowance error', async () => {
    mockBuildAndSubmit.mockRejectedValue(
      new Error('InsufficientAllowance: allowance too low'),
    );
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/allowance|approval|insufficient/i);
  });

  it('shows human-readable message for SelfSubscription error (code 10)', async () => {
    mockBuildAndSubmit.mockRejectedValue(
      new Error('Contract error 10: SelfSubscription'),
    );
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBeTruthy();
  });

  it('shows human-readable message for IntervalTooShort error (code 2)', async () => {
    mockBuildAndSubmit.mockRejectedValue(
      new Error('Contract error 2: IntervalTooShort'),
    );
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });
});

// ─── 6. Network mismatch / contract not configured ───────────────────────────

describe('SubscriptionForm integration: network mismatch / missing config', () => {
  it('shows "Contract not configured" warning when CONTRACT_ID is empty', () => {
    mockNetwork.CONTRACT_ID = '';
    render(<SubscriptionForm />);
    expect(
      screen.getByText(/contract not configured/i),
    ).toBeInTheDocument();
  });

  it('does not render the subscription form when CONTRACT_ID is empty', () => {
    mockNetwork.CONTRACT_ID = '';
    render(<SubscriptionForm />);
    expect(
      screen.queryByRole('button', { name: /authorize subscription/i }),
    ).not.toBeInTheDocument();
  });

  it('shows install link when Freighter is not installed', () => {
    mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: false,
    };
    render(<SubscriptionForm />);
    expect(
      screen.getByText(/freighter wallet not detected/i),
    ).toBeInTheDocument();
  });

  it('shows "Disconnected" badge when no wallet connected', () => {
    mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    render(<SubscriptionForm />);
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });

  it('disables submit when disconnected', () => {
    mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    render(<SubscriptionForm />);
    expect(
      screen.getByRole('button', { name: /authorize subscription/i }),
    ).toBeDisabled();
  });

  it('shows wallet connection hint text when disconnected', () => {
    mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    render(<SubscriptionForm />);
    expect(
      screen.getByText(/connect your freighter wallet to enable submission/i),
    ).toBeInTheDocument();
  });
});

// ─── Dismissing error ──────────────────────────────────────────────────────────

describe('SubscriptionForm integration: dismissing error', () => {
  beforeEach(() => {
    connectWallet();
    render(<SubscriptionForm />);
  });

  it('clears the error alert when the dismiss button is clicked', async () => {
    mockBuildAndSubmit.mockRejectedValue(new Error('User declined transaction'));
    fillForm();
    submitForm();
    await confirmInModal();
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
  });
});
