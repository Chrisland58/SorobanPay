import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type ColumnDef } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name },
];

describe('DataTable state handling', () => {
  it('renders error state with role="alert" and retry action without clearing filters', () => {
    const onRetry = jest.fn();
    const onResetFilters = jest.fn();

    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        error={new Error('Network timeout')}
        onRetry={onRetry}
        isFiltered={true}
        onResetFilters={onResetFilters}
      />,
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveAttribute('data-state', 'error');
    expect(screen.getAllByText('Network timeout')[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onResetFilters).not.toHaveBeenCalled();
  });

  it('renders filtered-no-results state distinctly from true empty state', () => {
    const onResetFilters = jest.fn();

    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        isFiltered={true}
        onResetFilters={onResetFilters}
        emptyMessage="No subscriptions yet."
      />,
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses[0]).toHaveAttribute('data-state', 'filtered');
    expect(
      screen.getAllByText(/no records match your current filters/i)[0],
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it('renders true empty state with optional recovery action', () => {
    const onCreate = jest.fn();

    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyMessage="No subscriptions yet."
        emptyAction={{ label: 'Create Subscription', onClick: onCreate }}
      />,
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses[0]).toHaveAttribute('data-state', 'empty');
    expect(screen.getAllByText('No subscriptions yet.')[0]).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: /create subscription/i })[0],
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
