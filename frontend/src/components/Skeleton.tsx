"use client";

/**
 * Skeleton.tsx
 *
 * Reusable skeleton loading components for async data fetch areas.
 * Uses a motion-safe pulse so reduced-motion preferences are respected.
 *
 * FE-46: Add skeleton loading states for all async data fetches.
 * #1430: Loading skeleton screens for all async components.
 *
 * ## Components
 * - `SkeletonLine`  — a single line of placeholder text
 * - `SkeletonCard`  — a card-shaped block (subscription card, history entry)
 * - `SkeletonRow`   — a horizontal row (table/list item)
 * - `SkeletonBadge` — a small badge / pill placeholder
 * - `SkeletonForm`  — a full form skeleton (used by SubscriptionForm pre-mount)
 * - `SkeletonPaymentHistory` — payment history table rows placeholder
 * - `SkeletonMerchantSubscriberList` — merchant portal subscriber list
 * - `SkeletonSubscriptionList` — My Subscriptions list
 * - `SkeletonSubscriptionDetail` — single subscription detail with next payment date
 * - `SkeletonTokenBalance` — token balance display
 *
 * All skeletons carry `aria-busy="true"` and `aria-label="Loading…"` so screen
 * readers announce that content is being loaded.
 *
 * The `useMinLoadingDuration` hook ensures skeletons are shown for at least
 * 200 ms to prevent a jarring flash when data arrives immediately.
 */

import React, { useEffect, useRef, useState } from "react";

// ─── Base skeleton block ───────────────────────────────────────────────────────

interface SkeletonBaseProps {
  className?: string;
  /** Override the default aria-label */
  label?: string;
}

/** A single skeleton block — the primitive for all other skeleton components. */
export function SkeletonBlock({ className = "", label = "Loading…" }: SkeletonBaseProps) {
  return (
    <div
      className={`motion-safe:animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`}
      aria-hidden="true"
      role="presentation"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ─── SkeletonLine ──────────────────────────────────────────────────────────────

interface SkeletonLineProps {
  /** Width as a Tailwind class, e.g. "w-1/2", "w-full" */
  width?: string;
  /** Height as a Tailwind class, e.g. "h-4", "h-3" */
  height?: string;
  className?: string;
}

/** A single line of placeholder text. */
export function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className = "",
}: SkeletonLineProps) {
  return <SkeletonBlock className={`${height} ${width} ${className}`} />;
}

// ─── SkeletonBadge ─────────────────────────────────────────────────────────────

/** A small pill/badge skeleton. */
export function SkeletonBadge({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`h-6 w-20 rounded-full ${className}`} />;
}

// ─── SkeletonRow ──────────────────────────────────────────────────────────────

interface SkeletonRowProps {
  /** Number of column blocks to render */
  columns?: number;
  className?: string;
}

/** A horizontal row of skeleton blocks — suitable for table rows or list items. */
export function SkeletonRow({ columns = 3, className = "" }: SkeletonRowProps) {
  return (
    <div
      className={`flex items-center gap-3 ${className}`}
      aria-busy="true"
      aria-label="Loading row…"
    >
      {/* Leading icon/avatar placeholder */}
      <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
      {/* Column blocks */}
      <div className="flex-1 flex gap-3">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBlock
            key={i}
            className={`h-4 ${i === 0 ? "w-1/3" : i === columns - 1 ? "w-1/4" : "flex-1"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

interface SkeletonCardProps {
  /** Number of content lines to render inside the card */
  lines?: number;
  /** Whether to show a header area */
  showHeader?: boolean;
  className?: string;
}

/** A card-shaped skeleton — suitable for subscription cards and history entries. */
export function SkeletonCard({
  lines = 3,
  showHeader = true,
  className = "",
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40 p-5 sm:p-6 space-y-3 ${className}`}
      aria-busy="true"
      aria-label="Loading…"
    >
      {showHeader && (
        <div className="flex items-center justify-between gap-3 pb-2">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBadge />
        </div>
      )}
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i % 2 === 0 ? "w-full" : i % 3 === 1 ? "w-3/4" : "w-1/2"}
          />
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonForm ─────────────────────────────────────────────────────────────

/**
 * Full-form skeleton — shown while SubscriptionForm is loading (pre-mount).
 * Matches the approximate dimensions of the real form to prevent layout shift.
 */
export function SkeletonForm({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 space-y-5 ${className}`}
      aria-busy="true"
      aria-label="Loading subscription form…"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <SkeletonBlock className="h-7 w-48" />
        <SkeletonBadge />
      </div>

      {/* Subtitle */}
      <SkeletonLine width="w-3/4" height="h-3" />

      {/* Four field groups */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <SkeletonLine width="w-28" height="h-3" />
          <SkeletonBlock className="h-12 w-full rounded-lg" />
          <SkeletonLine width="w-3/4" height="h-3" />
        </div>
      ))}

      {/* Submit button */}
      <SkeletonBlock className="h-12 w-full rounded-lg bg-gray-700" />
    </div>
  );
}

// ─── SkeletonPaymentHistory ───────────────────────────────────────────────────

interface SkeletonPaymentHistoryProps {
  /** Number of rows to render */
  rows?: number;
  className?: string;
}

/**
 * Payment history section skeleton — displayed while transaction history is
 * being fetched from the Soroban RPC.
 */
export function SkeletonPaymentHistory({
  rows = 4,
  className = "",
}: SkeletonPaymentHistoryProps) {
  return (
    <section
      className={`w-full max-w-lg mt-6 ${className}`}
      aria-busy="true"
      aria-label="Loading payment history…"
    >
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 sm:p-6">
        {/* Section header */}
        <div className="flex items-center justify-between mb-4">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBadge />
        </div>

        {/* Rows */}
        <div className="space-y-3" role="list" aria-label="Loading history rows">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
              role="listitem"
            >
              <SkeletonRow columns={3} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PageLoadingSkeleton() {
  return (
    <main
      aria-busy="true"
      className="min-h-[60vh] w-full px-4 py-8 sm:py-12"
    >
      <p role="status" aria-label="Loading page" className="sr-only">
        Loading page
      </p>
      <div
        aria-hidden="true"
        className="mx-auto w-full max-w-5xl space-y-6"
      >
        <div className="space-y-3">
          <SkeletonLine width="w-48 sm:w-64" height="h-8" />
          <SkeletonLine width="w-3/4 sm:w-96" height="h-4" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-4 dark:border-gray-800 dark:bg-gray-900/40 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <SkeletonLine width="w-36" height="h-5" />
            <SkeletonBlock className="h-9 w-24 rounded-lg" />
          </div>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex min-h-14 items-center gap-3 border-b border-gray-200 py-3 last:border-0 dark:border-gray-800 sm:gap-6"
              >
                <SkeletonLine width="w-1/3 sm:w-1/4" height="h-4" />
                <SkeletonLine width="w-1/4 sm:w-1/5" height="h-4" />
                <SkeletonLine width="w-1/4 sm:w-1/6" height="h-4" />
                <SkeletonBlock className="ml-auto h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonBlock className="h-28 w-full rounded-xl" />
          <SkeletonBlock className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </main>
  );
}

// ─── SkeletonTokenBalance ─────────────────────────────────────────────────────

/** Token balance display skeleton. */
export function SkeletonTokenBalance({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 ${className}`}
      aria-busy="true"
      aria-label="Loading token balance…"
    >
      <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width="w-24" height="h-3" />
        <SkeletonLine width="w-16" height="h-5" />
      </div>
      <SkeletonBadge className="w-16" />
    </div>
  );
}

// ─── SkeletonFeeSimulation ────────────────────────────────────────────────────

/** Fee simulation result skeleton. */
export function SkeletonFeeSimulation({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-2 ${className}`}
      aria-busy="true"
      aria-label="Simulating transaction fee…"
    >
      <SkeletonLine width="w-40" height="h-4" />
      <div className="flex items-center gap-3">
        <SkeletonLine width="w-24" height="h-6" />
        <SkeletonLine width="w-16" height="h-3" />
      </div>
    </div>
  );
}

// ─── SkeletonWallet ───────────────────────────────────────────────────────────

/**
 * Wallet connection area skeleton — shown while wallet state is being
 * determined after mount. (FE-47 + FE-46 combined)
 */
export function SkeletonWallet({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-gray-900 rounded-2xl p-6 shadow-lg ${className}`}
      aria-busy="true"
      aria-label="Loading wallet status…"
    >
      <SkeletonBlock className="h-11 w-full rounded-lg" />
    </div>
  );
}

// ─── useMinLoadingDuration ────────────────────────────────────────────────────

/**
 * Ensures a skeleton is shown for at least `minMs` milliseconds (default 200)
 * to prevent a jarring flash when data arrives immediately.
 *
 * @param isLoading  — the "real" loading flag from your data hook
 * @param minMs      — minimum time (ms) to show skeleton (default 200)
 * @returns          — true while the skeleton should remain visible
 *
 * @example
 * const showSkeleton = useMinLoadingDuration(isLoading);
 * return showSkeleton ? <SkeletonPaymentHistory /> : <PaymentTable />;
 */
export function useMinLoadingDuration(isLoading: boolean, minMs = 200): boolean {
  const [show, setShow] = useState(isLoading);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      startedAt.current = Date.now();
      setShow(true);
    } else {
      const elapsed = startedAt.current !== null ? Date.now() - startedAt.current : minMs;
      const remaining = Math.max(0, minMs - elapsed);
      if (remaining === 0) {
        setShow(false);
      } else {
        timerRef.current = setTimeout(() => setShow(false), remaining);
      }
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isLoading, minMs]);

  return show;
}

// ─── SkeletonMerchantSubscriberList ──────────────────────────────────────────

interface SkeletonMerchantSubscriberListProps {
  /** Number of subscriber rows to render */
  rows?: number;
  className?: string;
}

/**
 * Merchant Portal subscriber list skeleton.
 * Matches the shape of MerchantSubscriptionsTable rows:
 * checkbox | address | amount | interval | next payment | status | action
 */
export function SkeletonMerchantSubscriberList({
  rows = 5,
  className = "",
}: SkeletonMerchantSubscriberListProps) {
  return (
    <section
      className={`w-full rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden ${className}`}
      aria-busy="true"
      aria-label="Loading subscriber list…"
    >
      {/* Table header skeleton */}
      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/60 px-4 py-3">
        <SkeletonBlock className="h-4 w-4 rounded flex-shrink-0" />
        <SkeletonLine width="w-32" height="h-3" />
        <SkeletonLine width="w-20" height="h-3" className="ml-auto" />
        <SkeletonLine width="w-20" height="h-3" />
        <SkeletonLine width="w-24" height="h-3" />
        <SkeletonBadge className="w-16" />
        <SkeletonBlock className="h-7 w-20 rounded-lg" />
      </div>

      {/* Subscriber rows */}
      <div className="divide-y divide-gray-800/60" role="list" aria-label="Loading subscriber rows">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3"
            role="listitem"
            aria-hidden="true"
          >
            <SkeletonBlock className="h-4 w-4 rounded flex-shrink-0" />
            {/* Address */}
            <SkeletonLine width="w-36" height="h-4" />
            {/* Amount */}
            <SkeletonLine width="w-16" height="h-4" className="ml-auto" />
            {/* Interval */}
            <SkeletonLine width="w-16" height="h-4" />
            {/* Next payment */}
            <SkeletonLine width="w-24" height="h-4" />
            {/* Status badge */}
            <SkeletonBadge className="w-14" />
            {/* Collect button */}
            <SkeletonBlock className="h-7 w-16 rounded-lg" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading subscriber list…</span>
    </section>
  );
}

// ─── SkeletonSubscriptionList ─────────────────────────────────────────────────

interface SkeletonSubscriptionListProps {
  /** Number of subscription cards to render */
  cards?: number;
  className?: string;
}

/**
 * My Subscriptions list skeleton.
 * Matches the shape of SubscriptionCard: header, amount/interval, status, CTA row.
 */
export function SkeletonSubscriptionList({
  cards = 3,
  className = "",
}: SkeletonSubscriptionListProps) {
  return (
    <div
      className={`space-y-4 ${className}`}
      aria-busy="true"
      aria-label="Loading subscriptions…"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 space-y-3"
          aria-hidden="true"
        >
          {/* Card header: merchant address + status badge */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
              <SkeletonLine width="w-40" height="h-4" />
            </div>
            <SkeletonBadge className="w-16" />
          </div>

          {/* Amount and interval row */}
          <div className="flex items-center gap-4">
            <SkeletonLine width="w-24" height="h-5" />
            <SkeletonLine width="w-20" height="h-3" />
          </div>

          {/* Next payment date row */}
          <SkeletonLine width="w-48" height="h-3" />

          {/* Action row */}
          <div className="flex items-center gap-3 pt-1">
            <SkeletonBlock className="h-8 w-24 rounded-lg" />
            <SkeletonBlock className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading subscriptions…</span>
    </div>
  );
}

// ─── SkeletonSubscriptionDetail ───────────────────────────────────────────────

interface SkeletonSubscriptionDetailProps {
  className?: string;
}

/**
 * Single subscription detail skeleton — shown while a specific subscription's
 * on-chain data (next payment date, amount, interval) is being fetched.
 * Shape matches the SubscriptionCard expanded / detail view.
 */
export function SkeletonSubscriptionDetail({
  className = "",
}: SkeletonSubscriptionDetailProps) {
  return (
    <div
      className={`rounded-2xl border border-gray-800 bg-gray-900/40 p-6 space-y-4 ${className}`}
      aria-busy="true"
      aria-label="Loading subscription details…"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <SkeletonLine width="w-48" height="h-6" />
        <SkeletonBadge className="w-20" />
      </div>

      {/* Merchant / token addresses */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <SkeletonLine width="w-20" height="h-3" />
          <SkeletonLine width="w-48" height="h-3" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonLine width="w-20" height="h-3" />
          <SkeletonLine width="w-48" height="h-3" />
        </div>
      </div>

      {/* Amount + interval */}
      <div className="flex items-baseline gap-2">
        <SkeletonLine width="w-32" height="h-8" />
        <SkeletonLine width="w-24" height="h-4" />
      </div>

      {/* Next payment date — the key field per issue #1430 */}
      <div
        className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 space-y-1.5"
        aria-label="Loading next payment date…"
      >
        <SkeletonLine width="w-32" height="h-3" />
        <SkeletonLine width="w-48" height="h-5" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <SkeletonBlock className="h-10 flex-1 rounded-lg" />
        <SkeletonBlock className="h-10 w-24 rounded-lg" />
      </div>

      <span className="sr-only">Loading subscription details…</span>
    </div>
  );
}
