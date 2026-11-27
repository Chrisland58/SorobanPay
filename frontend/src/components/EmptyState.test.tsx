/**
 * EmptyState.test.tsx
 *
 * Unit tests for actionable EmptyState components:
 *  - EmptyFilteredResults
 *  - EmptyPlansList
 *  - EmptyAnalyticsState
 *  - EmptyWebhookList
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  EmptyFilteredResults,
  EmptyPlansList,
  EmptyAnalyticsState,
  EmptyWebhookList,
  ErrorState,
  FilteredEmptyState,
  NetworkMismatchState,
  SkeletonList,
} from './EmptyState';

describe('Actionable Empty States', () => {
  it('renders EmptyFilteredResults with functional primary and secondary CTAs', () => {
    const onClear = jest.fn();
    const onReset = jest.fn();

    render(
      <EmptyFilteredResults
        onClearFilters={onClear}
        onResetSearch={onReset}
      />,
    );

    expect(screen.getByText(/no matching records found/i)).toBeInTheDocument();
    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    const resetBtn = screen.getByRole('button', { name: /reset search/i });

    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyPlansList with actionable create and browse buttons', () => {
    const onCreate = jest.fn();
    const onBrowse = jest.fn();

    render(
      <EmptyPlansList
        onCreatePlan={onCreate}
        onImportTemplates={onBrowse}
      />,
    );

    expect(screen.getByText(/no pricing plans yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create new plan/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /browse templates/i }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyAnalyticsState with guide CTA', () => {
    const onGetStarted = jest.fn();

    render(<EmptyAnalyticsState onGetStarted={onGetStarted} />);

    expect(screen.getByText(/no analytics data available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /integration guide/i }));
    expect(onGetStarted).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyWebhookList with add webhook CTA', () => {
    const onAdd = jest.fn();

    render(<EmptyWebhookList onAddWebhook={onAdd} />);

    expect(screen.getByText(/no webhooks configured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add webhook/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('Distinct Empty, Loading, Error, and Filtered States', () => {
  it('renders ErrorState with role="alert" and retry recovery action', () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.getByText(/failed to load data/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders FilteredEmptyState with role="status" and clear filters action', () => {
    const onResetFilters = jest.fn();
    render(<FilteredEmptyState onResetFilters={onResetFilters} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-state', 'filtered');
    expect(screen.getByText(/no matching results/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it('renders NetworkMismatchState with role="alert" and switch network action', () => {
    const onSwitchNetwork = jest.fn();
    const onReconnect = jest.fn();
    render(
      <NetworkMismatchState
        expectedNetwork="Testnet"
        onSwitchNetwork={onSwitchNetwork}
        onReconnect={onReconnect}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'network-mismatch');
    expect(screen.getByText(/testnet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /switch network/i }));
    expect(onSwitchNetwork).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /reconnect wallet/i }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('renders SkeletonList with aria-busy="true" for loading state', () => {
    render(<SkeletonList rows={2} />);
    const loading = screen.getByRole('status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });
});
