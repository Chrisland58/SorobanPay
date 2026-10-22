'use client';

/**
 * /history page
 *
 * Displays the full payment history for the connected wallet by polling
 * the Soroban RPC `getEvents()` endpoint for `executed` events emitted
 * by the SorobanPay contract.
 *
 * Features:
 *  - Cursor-based pagination via the usePaymentHistory hook
 *  - 60-second localStorage cache to reduce RPC calls
 *  - Accessible table (WCAG 2.1 AA) via PaymentHistoryTable component
 *  - Search and filter panel via PaymentHistoryFilters (issue #1435):
 *      date range, event type multi-select, merchant address search,
 *      amount range, token filter
 *  - Filter state persisted in URL query params
 *  - Client-side filtering for < 100 results; server-side notice above
 *  - Loading, empty, error, and disconnected states
 *  - Back-link to the home page
 *  - Network indicator (Testnet / Mainnet)
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import { usePaymentHistoryFilters, SERVER_THRESHOLD } from '@/hooks/usePaymentHistoryFilters';
import PaymentHistoryTable from '@/components/PaymentHistoryTable';
import { PaymentHistoryFilters } from '@/components/PaymentHistoryFilters';
import { NETWORK_NAME } from '@/constants/network';

// ── Inner page (needs useSearchParams, wrapped in Suspense below) ─────────────

function HistoryPageInner() {
  const { publicKey } = useWallet();

  const { events, isLoading, error, hasMore, loadMore, refresh } =
    usePaymentHistory({ publicKey });

  const {
    filters,
    setFilter,
    toggleEventType,
    clearFilters,
    hasActiveFilters,
    filteredEvents,
    needsServerFilter,
  } = usePaymentHistoryFilters(events);

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-12"
      aria-label="Payment history page"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl mb-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          aria-label="Back to home page"
        >
          <span aria-hidden="true">←</span> Home
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Payment History
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Executed payments from your SorobanPay subscriptions
            </p>
          </div>

          {/* Network badge */}
          <span
            className={`inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-xs font-semibold ${
              NETWORK_NAME === 'Mainnet'
                ? 'border-green-600/40 bg-green-900/20 text-green-300'
                : 'border-blue-600/40 bg-blue-900/20 text-blue-300'
            }`}
            aria-label={`Network: ${NETWORK_NAME}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                NETWORK_NAME === 'Mainnet' ? 'bg-green-400' : 'bg-blue-400'
              }`}
              aria-hidden="true"
            />
            {NETWORK_NAME}
          </span>
        </div>
      </div>

      {/* ── Wallet required notice ───────────────────────────────────────── */}
      {!publicKey && (
        <div className="w-full max-w-4xl mb-6">
          <div
            role="status"
            className="rounded-xl border border-yellow-700/40 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200"
          >
            <strong className="font-semibold">Wallet not connected.</strong>{' '}
            <Link
              href="/"
              className="underline hover:text-yellow-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded"
            >
              Connect your Freighter wallet
            </Link>{' '}
            on the home page to view your payment history.
          </div>
        </div>
      )}

      {/* ── Filter panel ────────────────────────────────────────────────── */}
      {publicKey && (
        <div className="w-full max-w-4xl mb-6">
          <PaymentHistoryFilters
            filters={filters}
            onFilterChange={setFilter}
            onToggleEventType={toggleEventType}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
            totalCount={events.length}
            filteredCount={filteredEvents.length}
          />

          {/* Server-side filter notice */}
          {needsServerFilter && hasActiveFilters && (
            <p
              role="status"
              aria-live="polite"
              className="mt-2 text-xs text-yellow-400"
            >
              {events.length}+ results loaded — server-side filtering applies.
              Showing all {events.length} events; refine your date range to
              narrow results via the RPC.
            </p>
          )}
        </div>
      )}

      {/* ── Table section ───────────────────────────────────────────────── */}
      <section
        className="w-full max-w-4xl"
        aria-label="Payment history table"
        aria-live="polite"
      >
        <PaymentHistoryTable
          events={
            needsServerFilter || !hasActiveFilters ? events : filteredEvents
          }
          isLoading={isLoading}
          error={error}
          hasMore={hasMore && !hasActiveFilters}
          onLoadMore={loadMore}
          onRefresh={refresh}
          isConnected={!!publicKey}
          networkName={NETWORK_NAME}
        />
      </section>

      {/* ── Footer note ─────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl mt-8">
        <p className="text-gray-600 text-xs text-center leading-relaxed">
          Showing{' '}
          <code className="rounded bg-gray-800 px-1 text-gray-400">executed</code>{' '}
          events for your account from the SorobanPay contract on{' '}
          <span className="text-gray-500">{NETWORK_NAME}</span>.{' '}
          Results are cached for 60 seconds. Filters below {SERVER_THRESHOLD}{' '}
          results are applied client-side; above that threshold the RPC
          is queried with date range parameters.
        </p>
      </div>
    </main>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ───────────────────────

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryPageInner />
    </Suspense>
  );
}
