'use client';

/**
 * /history page
 *
 * Displays recent subscription activity for the connected wallet by polling
 * the Soroban RPC `getEvents()` endpoint for SorobanPay contract events.
 *
 * Features:
 *  - 30-second polling via the useSubscriptionEvents hook
 *  - Client-side pagination in ten-event pages
 *  - Accessible table (WCAG 2.1 AA) via PaymentHistoryTable component
 *  - Loading, empty, error, and disconnected states
 *  - Back-link to the home page
 *  - Network indicator (Testnet / Mainnet)
 *
 * Keyboard shortcut H on the home page scrolls to the live activity preview.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useSubscriptionEvents } from '@/hooks/useSubscriptionEvents';
import PaymentHistoryTable from '@/components/PaymentHistoryTable';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NETWORK_NAME } from '@/constants/network';

const PAGE_SIZE = 10;

function getPageFromUrl(): number {
  const page = Number(new URLSearchParams(window.location.search).get('page'));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { publicKey } = useWallet();
  const [currentPage, setCurrentPage] = useState(1);

  const { events, isLoading, error, refresh } =
    useSubscriptionEvents({ publicKey });

  const syncPageFromUrl = useCallback(() => {
    setCurrentPage(getPageFromUrl());
  }, []);

  useEffect(() => {
    syncPageFromUrl();
    window.addEventListener('popstate', syncPageFromUrl);
    return () => window.removeEventListener('popstate', syncPageFromUrl);
  }, [syncPageFromUrl]);

  const updatePageUrl = useCallback((page: number, replace = false) => {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(page));
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
    setCurrentPage(page);
  }, []);

  const goToNextPage = useCallback(() => {
    if (events.length > currentPage * PAGE_SIZE) {
      updatePageUrl(currentPage + 1);
    }
  }, [currentPage, events.length, updatePageUrl]);

  const refreshHistory = useCallback(() => {
    updatePageUrl(1, true);
    refresh();
  }, [refresh, updatePageUrl]);

  useEffect(() => {
    if (isLoading) return;
    const lastPage = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
    if (currentPage > lastPage) updatePageUrl(lastPage, true);
  }, [currentPage, events.length, isLoading, updatePageUrl]);

  const pageEvents = events.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const canGoNext = events.length > currentPage * PAGE_SIZE;

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
              Live subscription events from your SorobanPay account
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

      {/* ── Table section ───────────────────────────────────────────────── */}
      <section
        className="w-full max-w-4xl"
        aria-label="Payment history table"
        aria-live="polite"
      >
        <ErrorBoundary name="PaymentHistory">
          <PaymentHistoryTable
            events={pageEvents}
            isLoading={isLoading}
            error={error}
            hasMore={canGoNext}
            onLoadMore={refresh}
            onRefresh={refreshHistory}
            currentPage={currentPage}
            canGoPrevious={currentPage > 1}
            canGoNext={canGoNext}
            onPreviousPage={() => updatePageUrl(currentPage - 1)}
            onNextPage={goToNextPage}
            isConnected={!!publicKey}
            networkName={NETWORK_NAME}
          />
        </ErrorBoundary>
      </section>

      {/* ── Footer note ─────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl mt-8">
        <p className="text-gray-600 text-xs text-center leading-relaxed">
          Showing subscribe, executed, cancellation, and payment failure events
          for your account from the SorobanPay contract on{' '}
          <span className="text-gray-500">{NETWORK_NAME}</span>.{' '}
          Activity refreshes every 30 seconds. Use the refresh button to fetch
          the latest data now.
        </p>
      </div>
    </main>
  );
}
