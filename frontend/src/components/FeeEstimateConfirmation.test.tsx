import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeeEstimateConfirmation } from './FeeEstimateConfirmation';

describe('FeeEstimateConfirmation (#1639)', () => {
  it('renders standard submit button when fee is valid and unchanged', () => {
    const onSubmit = jest.fn();
    render(
      <FeeEstimateConfirmation
        initialFeeStroops="1000"
        currentFeeStroops="1000"
        expiresAtMs={Date.now() + 60000}
        onConfirmChangedFee={jest.fn()}
        onRefreshEstimate={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /submit subscription/i });
    expect(submitBtn).toBeInTheDocument();

    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('displays expiration alert and blocks submission when estimate is expired', () => {
    const onRefresh = jest.fn();
    const onSubmit = jest.fn();

    render(
      <FeeEstimateConfirmation
        initialFeeStroops="1000"
        currentFeeStroops="1000"
        expiresAtMs={Date.now() - 1000} // Expired 1 second ago
        onConfirmChangedFee={jest.fn()}
        onRefreshEstimate={onRefresh}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/fee estimate expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit subscription/i })).not.toBeInTheDocument();

    const refreshBtn = screen.getByRole('button', { name: /refresh fee estimate/i });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('prompts user for confirmation when fee increases beyond tolerance', () => {
    const onConfirmChangedFee = jest.fn();
    const onSubmit = jest.fn();

    render(
      <FeeEstimateConfirmation
        initialFeeStroops="1000"
        currentFeeStroops="1500" // 50% increase > 10% tolerance
        expiresAtMs={Date.now() + 60000}
        tolerancePercentage={10}
        onConfirmChangedFee={onConfirmChangedFee}
        onRefreshEstimate={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('dialog', { name: /fee change confirmation/i })).toBeInTheDocument();
    expect(screen.getByText(/network fee changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit subscription/i })).not.toBeInTheDocument();

    const acceptBtn = screen.getByRole('button', { name: /accept & confirm fee/i });
    fireEvent.click(acceptBtn);

    expect(onConfirmChangedFee).toHaveBeenCalledWith('1500');

    // After acceptance, submit button is now enabled
    const submitBtn = screen.getByRole('button', { name: /submit subscription/i });
    expect(submitBtn).toBeInTheDocument();
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
