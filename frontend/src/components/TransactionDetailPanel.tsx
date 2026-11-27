'use client';

import { useState, useMemo, useCallback, useId } from 'react';
import { CopyButton } from './CopyButton';
import { StatusBadge, type StatusVariant } from './StatusBadge';

export type StellarNetwork = 'testnet' | 'mainnet' | 'public';

export type TransactionStatus = 'confirmed' | 'pending' | 'failed' | 'cancelled' | string;

export interface TransactionDetailRecord {
  /** Full 64-character Stellar transaction hash */
  txHash: string;
  /** ISO-8601 timestamp or formatted ledger close time */
  ledgerTime: string;
  /** Stellar account public key (G...) */
  account: string;
  /** Formatted token amount (e.g. "125.50") */
  tokenAmount: string;
  /** Optional token symbol (e.g. "USDC", "XLM") */
  tokenSymbol?: string;
  /** Transaction execution status */
  status: TransactionStatus;
  /** Network on which this transaction was recorded */
  network: StellarNetwork;
}

export interface TransactionDetailPanelProps {
  /** Single transaction record or list of records to inspect */
  transaction?: TransactionDetailRecord | null;
  /** Optional list of transactions when browsing multiple records */
  transactions?: TransactionDetailRecord[];
  /** Currently active wallet/app network; explorer link is blocked if it mismatches record.network */
  activeNetwork?: StellarNetwork;
  /** Optional panel heading */
  title?: string;
  /** Optional extra CSS classes */
  className?: string;
}

interface DetailField {
  key: string;
  label: string;
  value: string;
  copyable?: boolean;
  monospace?: boolean;
}

function normalizeExplorerNetwork(network: StellarNetwork): 'testnet' | 'public' {
  return network === 'testnet' ? 'testnet' : 'public';
}

export function buildExplorerTxUrl(txHash: string, network: StellarNetwork): string | null {
  const trimmed = txHash.trim();
  if (!trimmed) return null;
  const explorerNet = normalizeExplorerNetwork(network);
  return `https://stellar.expert/explorer/${explorerNet}/tx/${encodeURIComponent(trimmed)}`;
}

function getStatusVariant(status: TransactionStatus): StatusVariant {
  const normalized = status.toLowerCase();
  if (normalized === 'confirmed' || normalized === 'success' || normalized === 'completed') {
    return 'success';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'rejected') {
    return 'error';
  }
  if (normalized === 'pending' || normalized === 'processing') {
    return 'warning';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'neutral';
  }
  return 'info';
}

function formatLedgerTime(ledgerTime: string): string {
  if (!ledgerTime) return 'Unavailable';
  const parsed = new Date(ledgerTime);
  if (Number.isNaN(parsed.getTime())) {
    return ledgerTime;
  }
  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function TransactionDetailPanel({
  transaction,
  transactions,
  activeNetwork,
  title = 'Transaction Details',
  className = '',
}: TransactionDetailPanelProps) {
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const records = useMemo<TransactionDetailRecord[]>(() => {
    if (transactions && transactions.length > 0) {
      return transactions;
    }
    if (transaction) {
      return [transaction];
    }
    return [];
  }, [transaction, transactions]);

  const handleCopyAnnounce = useCallback((label: string) => {
    setAnnouncement(`Copied ${label} to clipboard.`);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredRecords = useMemo(() => {
    if (!normalizedQuery) return records;

    return records.filter((rec) => {
      // Only search across explicit, non-sensitive display fields.
      const searchableValues = [
        rec.txHash,
        rec.ledgerTime,
        formatLedgerTime(rec.ledgerTime),
        rec.account,
        rec.tokenAmount,
        rec.tokenSymbol ?? '',
        rec.status,
        rec.network,
        'transaction hash',
        'ledger time',
        'account',
        'token amount',
        'status',
      ];
      return searchableValues.some((val) => val.toLowerCase().includes(normalizedQuery));
    });
  }, [records, normalizedQuery]);

  return (
    <section
      aria-label={title}
      className={`rounded-xl border border-gray-800 bg-gray-900/90 p-5 text-gray-100 shadow-lg ${className}`}
    >
      {/* Screen-reader live region for copy announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-white">{title}</h2>

        <div className="relative w-full sm:w-72">
          <label htmlFor={searchInputId} className="sr-only">
            Search transaction details
          </label>
          <input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search hash, account, amount, status…"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {records.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">
          No transaction selected.
        </p>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">
          <p>No transaction details match &ldquo;{searchQuery.trim()}&rdquo;.</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRecords.map((rec) => {
            const recordNet = normalizeExplorerNetwork(rec.network);
            const activeNet = activeNetwork ? normalizeExplorerNetwork(activeNetwork) : null;
            const hasNetworkMismatch = activeNet !== null && activeNet !== recordNet;
            const explorerUrl = hasNetworkMismatch ? null : buildExplorerTxUrl(rec.txHash, rec.network);

            const amountDisplay = rec.tokenSymbol
              ? `${rec.tokenAmount} ${rec.tokenSymbol}`
              : rec.tokenAmount;

            const fields: DetailField[] = [
              {
                key: 'txHash',
                label: 'Transaction Hash',
                value: rec.txHash || 'Unavailable',
                copyable: Boolean(rec.txHash),
                monospace: true,
              },
              {
                key: 'ledgerTime',
                label: 'Ledger Time',
                value: formatLedgerTime(rec.ledgerTime),
                copyable: false,
              },
              {
                key: 'account',
                label: 'Account',
                value: rec.account || 'Unavailable',
                copyable: Boolean(rec.account),
                monospace: true,
              },
              {
                key: 'tokenAmount',
                label: 'Token Amount',
                value: amountDisplay || 'Unavailable',
                copyable: Boolean(amountDisplay),
              },
            ];

            return (
              <div
                key={`${rec.network}-${rec.txHash || rec.account}`}
                className="rounded-lg border border-gray-800 bg-gray-950/70 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      Status
                    </span>
                    <StatusBadge variant={getStatusVariant(rec.status)}>
                      {rec.status}
                    </StatusBadge>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium uppercase text-gray-300">
                      {rec.network}
                    </span>

                    {hasNetworkMismatch ? (
                      <span
                        role="alert"
                        className="text-xs font-medium text-amber-400"
                      >
                        Explorer link unavailable: active network ({activeNetwork}) does not match transaction network ({rec.network}).
                      </span>
                    ) : explorerUrl ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        View on Explorer
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">Explorer link unavailable</span>
                    )}
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      className="flex flex-col justify-between gap-1 rounded-md border border-gray-800/80 bg-gray-900/60 p-3"
                    >
                      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        {field.label}
                      </dt>
                      <dd className="flex items-center justify-between gap-2">
                        <span
                          className={`break-all text-sm text-gray-100 ${
                            field.monospace ? 'font-mono text-xs' : ''
                          }`}
                        >
                          {field.value}
                        </span>
                        {field.copyable && (
                          <span onClick={() => handleCopyAnnounce(field.label)}>
                            <CopyButton
                              text={field.value}
                              label={`Copy ${field.label}`}
                            />
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default TransactionDetailPanel;
