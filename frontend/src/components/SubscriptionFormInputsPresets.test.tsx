import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubscriptionFormInputs, INTERVAL_PRESETS } from './SubscriptionFormInputs';

describe('SubscriptionFormInputs Interval Presets', () => {
  it('renders dropdown with 5 standard presets and custom option', () => {
    const onIntervalChange = jest.fn();

    render(
      <SubscriptionFormInputs
        merchantAddress=""
        tokenAddress=""
        amount="100"
        interval="2592000"
        fieldErrors={{}}
        isDisabled={false}
        onMerchantChange={jest.fn()}
        onTokenChange={jest.fn()}
        onAmountChange={jest.fn()}
        onIntervalChange={onIntervalChange}
      />
    );

    const select = screen.getByLabelText(/billing cycle preset selector/i);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('2592000');

    // Summary displays monthly
    expect(screen.getByText(/You will be charged/i)).toHaveTextContent('You will be charged 100 tokens every month.');

    // Switch to daily preset
    fireEvent.change(select, { target: { value: '86400' } });
    expect(onIntervalChange).toHaveBeenCalledWith('86400');
  });

  it('reveals custom seconds input when Custom is selected', () => {
    const onIntervalChange = jest.fn();

    render(
      <SubscriptionFormInputs
        merchantAddress=""
        tokenAddress=""
        amount="50"
        interval="86400"
        fieldErrors={{}}
        isDisabled={false}
        onMerchantChange={jest.fn()}
        onTokenChange={jest.fn()}
        onAmountChange={jest.fn()}
        onIntervalChange={onIntervalChange}
      />
    );

    const select = screen.getByLabelText(/billing cycle preset selector/i);
    fireEvent.change(select, { target: { value: 'custom' } });

    const customInput = screen.getByLabelText(/custom interval/i);
    expect(customInput).toBeInTheDocument();
    fireEvent.change(customInput, { target: { value: '172800' } });
    expect(onIntervalChange).toHaveBeenCalledWith('172800');
  });
});
