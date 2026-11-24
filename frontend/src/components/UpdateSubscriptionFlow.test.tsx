/**
 * UpdateSubscriptionFlow.test.tsx
 *
 * Unit tests for the update subscription flow and accessibility (WCAG AA).
 * Covers:
 *   - Edit button rendering and modal open/close
 *   - Escape key dismiss for modal accessibility
 *   - Stellar Expert link formation
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SubscriptionCard from '@/components/SubscriptionCard';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
}));

jest.mock('@/lib/cancel_builder', () => ({
  buildAndSubmitCancel: jest.fn(),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'G' + 'A'.repeat(55),
    isCheckingFreighter: false,
    freighterInstalled: true,
    connect: jest.fn(),
  }),
}));

const SUBSCRIBER = 'G' + 'A'.repeat(55);
const MERCHANT = 'G' + 'B'.repeat(55);
const TOKEN = 'C' + 'A'.repeat(55);
const AMOUNT = 10_000_000n;
const INTERVAL = 2_592_000;
const NEXT_PAYMENT = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const SUB_KEY = `${SUBSCRIBER}:${MERCHANT}`;

function makeProps(overrides: Partial<React.ComponentProps<typeof SubscriptionCard>> = {}) {
  return {
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    token: TOKEN,
    amount: AMOUNT,
    interval: INTERVAL,
    nextPayment: NEXT_PAYMENT,
    subscriptionKey: SUB_KEY,
    isCancelling: false,
    cancelledAt: null,
    onCancelled: jest.fn(),
    onCancelStateChange: jest.fn(),
    ...overrides,
  };
}

describe('UpdateSubscriptionFlow & Accessibility', () => {
  it('renders Edit button and opens edit modal on click', () => {
    render(<SubscriptionCard {...makeProps()} />);
    const editBtn = screen.getByRole('button', { name: /edit subscription terms/i });
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);
    const dialog = screen.getByRole('dialog', { name: /edit subscription terms/i });
    expect(dialog).toBeInTheDocument();
  });

  it('closes edit modal when Escape key is pressed', () => {
    render(<SubscriptionCard {...makeProps()} />);
    const editBtn = screen.getByRole('button', { name: /edit subscription terms/i });
    fireEvent.click(editBtn);
    expect(screen.getByRole('dialog', { name: /edit subscription terms/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /edit subscription terms/i })).not.toBeInTheDocument();
  });

  it('renders Stellar Expert deep links with accessible labels', () => {
    render(<SubscriptionCard {...makeProps()} />);
    const merchantLink = screen.getByRole('link', { name: new RegExp(`view merchant ${MERCHANT} on stellar expert`, 'i') });
    expect(merchantLink).toBeInTheDocument();
    expect(merchantLink).toHaveAttribute('href', expect.stringContaining(`stellar.expert/explorer/testnet/account/${MERCHANT}`));

    const tokenLink = screen.getByRole('link', { name: new RegExp(`view token ${TOKEN} on stellar expert`, 'i') });
    expect(tokenLink).toBeInTheDocument();
    expect(tokenLink).toHaveAttribute('href', expect.stringContaining(`stellar.expert/explorer/testnet/contract/${TOKEN}`));
  });
});
