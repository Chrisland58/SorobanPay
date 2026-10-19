import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { DataTable, type DataTableColumn } from '../components/DataTable';

// ── Sample data ───────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  date: string;
  merchant: string;
  token: string;
  amount: string;
  amountRaw: number;
  ledger: number;
  status: 'executed' | 'failed' | 'cancelled';
  txHash: string;
}

function truncate(addr: string, len = 6): string {
  if (addr.length <= len * 2 + 3) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}

const MERCHANTS = [
  'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
  'GAXHFT2SDNOZPHKXTLNKXIFRQQCQXSCXO2EFVH3CXIHSOFQCCEYHVQF',
  'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBDMB3RJEA9YW7GDRJZOA',
  'GD6GKRABNDVYDETEZJQEPS7IBQMERCN5ZDQMMA6BWQMPHPQHVSWFZWXP',
];

const TOKENS = [
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
  'CCWAMGJHE4ZVKAJK3DXKVDCM7LTCQHG3OOQLWMZ2GNE22QOCPZFQXNO',
];

const STATUSES: PaymentRow['status'][] = ['executed', 'executed', 'executed', 'failed', 'cancelled'];

function makeRows(count: number): PaymentRow[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(2025, 0, 1 + i);
    const status = STATUSES[i % STATUSES.length];
    return {
      id: `evt-${String(i + 1).padStart(4, '0')}`,
      date: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }),
      merchant: MERCHANTS[i % MERCHANTS.length],
      token: TOKENS[i % TOKENS.length],
      amount: ((i + 1) * 10).toFixed(7),
      amountRaw: (i + 1) * 10,
      ledger: 1_000_000 + i * 200,
      status,
      txHash: `a3f1b2c4d5e6f7${String(i).padStart(50, '0')}`,
    };
  });
}

const sampleRows = makeRows(25);

// ── Column definitions ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<PaymentRow['status'], string> = {
  executed: 'text-green-400 bg-green-900/30 border-green-700/40',
  failed: 'text-red-400 bg-red-900/30 border-red-700/40',
  cancelled: 'text-gray-400 bg-gray-800 border-gray-700',
};

const columns: DataTableColumn<PaymentRow>[] = [
  {
    key: 'date',
    label: 'Date',
    sortable: true,
    sortValue: (r) => new Date(r.date).getTime(),
  },
  {
    key: 'merchant',
    label: 'Merchant',
    sortable: true,
    sortValue: (r) => r.merchant,
    render: (r) => (
      <span title={r.merchant} className="font-mono">
        {truncate(r.merchant)}
      </span>
    ),
  },
  {
    key: 'token',
    label: 'Token',
    render: (r) => (
      <span title={r.token} className="font-mono text-gray-400">
        {truncate(r.token)}
      </span>
    ),
  },
  {
    key: 'amount',
    label: 'Amount',
    sortable: true,
    align: 'right',
    sortValue: (r) => r.amountRaw,
    render: (r) => <span className="font-mono text-green-400">{r.amount}</span>,
  },
  {
    key: 'ledger',
    label: 'Ledger',
    sortable: true,
    align: 'right',
    render: (r) => (
      <span className="tabular-nums text-gray-400">{r.ledger.toLocaleString()}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    sortValue: (r) => r.status,
    render: (r) => (
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}
      >
        {r.status}
      </span>
    ),
  },
  {
    key: 'txHash',
    label: 'Tx Hash',
    render: (r) => (
      <a
        href={`https://stellar.expert/explorer/testnet/tx/${r.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-blue-400 hover:text-blue-300 underline underline-offset-2"
      >
        {truncate(r.txHash)}
      </a>
    ),
  },
];

// ── Story meta ────────────────────────────────────────────────────────────────

const meta: Meta<typeof DataTable> = {
  title: 'Components/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Generic responsive data table for subscription and payment lists. ' +
          'Desktop: traditional table with sticky header. Mobile: stacked card layout. ' +
          'Supports client-side sorting and row selection for bulk actions.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTable>;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * Default table with 25 rows — demonstrates sorting and responsive layout.
 * Resize the viewport below 640 px to see the mobile card layout.
 */
export const Default: Story = {
  render: () => (
    <div className="bg-gray-950 p-4 rounded-xl min-h-screen">
      <DataTable
        columns={columns}
        rows={sampleRows}
        getRowId={(r) => r.id}
        ariaLabel="Payment history"
      />
    </div>
  ),
};

/**
 * Selectable rows — checkboxes appear on each row and in the header.
 * Selection state is lifted to the parent via onSelectionChange.
 */
export const WithSelection: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <div className="bg-gray-950 p-4 rounded-xl min-h-screen space-y-4">
        {selected.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-700/40 bg-blue-900/20 px-4 py-2 text-sm text-blue-300">
            <span>{selected.length} row(s) selected</span>
            <button
              className="ml-auto rounded border border-blue-600/50 px-3 py-1 text-xs hover:bg-blue-800/40 transition-colors"
              onClick={() => alert(`Bulk action on: ${selected.join(', ')}`)}
            >
              Bulk Collect
            </button>
          </div>
        )}
        <DataTable
          columns={columns}
          rows={sampleRows}
          getRowId={(r) => r.id}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          ariaLabel="Selectable payment history"
        />
      </div>
    );
  },
};

/**
 * Loading skeleton — isLoading=true renders animated placeholder rows
 * (table on desktop, cards on mobile).
 */
export const Loading: Story = {
  render: () => (
    <div className="bg-gray-950 p-4 rounded-xl">
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => (r as PaymentRow).id}
        isLoading
        skeletonRowCount={8}
        ariaLabel="Loading payment history"
      />
    </div>
  ),
};

/**
 * Empty state — no rows and not loading.
 */
export const Empty: Story = {
  render: () => (
    <div className="bg-gray-950 p-4 rounded-xl">
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => (r as PaymentRow).id}
        emptyMessage="No payments found for this wallet."
        ariaLabel="Empty payment history"
      />
    </div>
  ),
};

/**
 * Subscription list variant — demonstrates that DataTable works with any row shape.
 */
interface SubscriptionRow {
  id: string;
  merchant: string;
  amount: string;
  interval: string;
  nextPayment: string;
  status: 'active' | 'overdue' | 'paused';
}

const subColumns: DataTableColumn<SubscriptionRow>[] = [
  { key: 'merchant', label: 'Merchant', sortable: true, render: (r) => <span className="font-mono">{truncate(r.merchant)}</span> },
  { key: 'amount', label: 'Amount', sortable: true, align: 'right', sortValue: (r) => parseFloat(r.amount) },
  { key: 'interval', label: 'Interval', sortable: true },
  { key: 'nextPayment', label: 'Next Payment', sortable: true },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    render: (r) => {
      const cls = r.status === 'active'
        ? 'text-green-400 bg-green-900/30 border-green-700/40'
        : r.status === 'overdue'
          ? 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40'
          : 'text-gray-400 bg-gray-800 border-gray-700';
      return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
          {r.status}
        </span>
      );
    },
  },
];

const subRows: SubscriptionRow[] = Array.from({ length: 22 }, (_, i) => ({
  id: `sub-${i + 1}`,
  merchant: MERCHANTS[i % MERCHANTS.length],
  amount: `${(i + 1) * 25}.0000000`,
  interval: i % 3 === 0 ? '30 days' : i % 3 === 1 ? '7 days' : '1 day',
  nextPayment: new Date(2025, 1, 1 + i).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
  status: (['active', 'active', 'overdue', 'active', 'paused'] as const)[i % 5],
}));

export const SubscriptionList: Story = {
  name: 'Subscription List Variant',
  render: () => (
    <div className="bg-gray-950 p-4 rounded-xl min-h-screen">
      <DataTable
        columns={subColumns}
        rows={subRows}
        getRowId={(r) => r.id}
        selectable
        ariaLabel="My subscriptions"
      />
    </div>
  ),
};
