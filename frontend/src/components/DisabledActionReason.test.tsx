/**
 * DisabledActionReason.test.tsx
 *
 * Tests for inline disabled action explanations, accessibility attributes,
 * rule-priority evaluation, and synchronization with form eligibility rules.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DisabledActionReason, { getFirstDisabledReason } from '@/components/DisabledActionReason';

describe('getFirstDisabledReason', () => {
  it('returns null when no rules are triggered', () => {
    const result = getFirstDisabledReason([
      { when: false, reason: 'Wallet not connected.', nextStep: 'Connect wallet.' },
      { when: false, reason: 'Amount missing.', nextStep: 'Enter amount.' },
    ]);
    expect(result).toBeNull();
  });

  it('returns the first matching rule in priority order', () => {
    const result = getFirstDisabledReason([
      { when: false, reason: 'Submitting.', nextStep: 'Wait.' },
      { when: true, reason: 'Wallet not connected.', nextStep: 'Connect your Stellar wallet.' },
      { when: true, reason: 'Amount missing.', nextStep: 'Enter amount.' },
    ]);
    expect(result).toEqual({
      reason: 'Wallet not connected.',
      nextStep: 'Connect your Stellar wallet.',
    });
  });
});

describe('DisabledActionReason', () => {
  it('renders nothing when reason is null or empty', () => {
    const { container: c1 } = render(<DisabledActionReason id="test-reason" reason={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<DisabledActionReason id="test-reason" reason="" />);
    expect(c2.firstChild).toBeNull();
  });

  it('renders accessible status region with reason and nextStep', () => {
    render(
      <div>
        <button type="button" disabled aria-describedby="submit-reason">
          Submit
        </button>
        <DisabledActionReason
          id="submit-reason"
          reason="Wallet not connected."
          nextStep="Connect your Stellar wallet to continue."
        />
      </div>
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('id', 'submit-reason');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Wallet not connected.');
    expect(status).toHaveTextContent('Connect your Stellar wallet to continue.');

    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', 'submit-reason');
  });

  it('renders reason without nextStep when nextStep is omitted', () => {
    render(<DisabledActionReason id="only-reason" reason="Action unavailable." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Action unavailable.');
  });
});
